import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import semver from "semver";
import { parseReleaseVersion } from "./version.mjs";

export function git(args, options = {}) {
  const output = execFileSync("git", args, {
    encoding: "utf8",
    stdio: options.stdio ?? ["ignore", "pipe", "pipe"]
  });

  return typeof output === "string" ? output.trimEnd() : "";
}

export function parseArgs(args) {
  const options = {
    configFile: process.env.SPEC_CONFIG || "spec.config.json",
    push: true,
    dryRun: false
  };

  for (const arg of args) {
    if (arg === "--no-push") {
      options.push = false;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--config=")) {
      options.configFile = arg.slice("--config=".length);
    } else {
      throw new Error(`Unrecognized argument: ${arg}`);
    }
  }

  return options;
}

export function loadReleaseConfig(configFile = "spec.config.json") {
  if (!existsSync(configFile)) {
    throw new Error(`${configFile} not found`);
  }

  const spec = JSON.parse(readFileSync(configFile, "utf8"));
  const release = spec.release || {};
  const specName = spec.titleName || spec.shortName || spec.slug || "Specification";

  return {
    raw: spec,
    configFile,
    slug: spec.slug || "spec",
    specSrc: spec.specSrc || "spec.md",
    sourcePath: release.sourcePath || join("src", spec.specSrc || "spec.md"),
    versionsDir: release.versionsDir || "versions",
    editorsPath: release.editorsPath === false ? null : release.editorsPath || "EDITORS.md",
    releaseHistoryNote: release.releaseHistoryNote || `${specName} $version`,
    releaseHistoryTableHeader: release.releaseHistoryTableHeader || "\n| Version | Date | Notes |\n| ---- | ---- | ---- |\n",
    removeOnReleaseBranch: release.removeOnReleaseBranch || [],
    schemaVersionRewrite: release.schemaVersionRewrite || { enabled: false, paths: [] },
    mainBranch: release.mainBranch || "main",
    remote: release.remote,
    remoteUrl: release.remoteUrl || spec.edDraftURI
  };
}

export function requireCleanWorktree() {
  const status = git(["status", "--porcelain"]);
  if (status) {
    throw new Error("Working tree must be clean before running this release command");
  }
}

export function currentBranch() {
  return git(["branch", "--show-current"]);
}

export function today() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeRemoteUrl(url) {
  return url
    .replace(/\.git$/, "")
    .replace(/\/$/, "")
    .replace(/^git@github.com:/, "https://github.com/");
}

export function findRemote(config) {
  if (config.remote) {
    return config.remote;
  }

  const targetUrl = config.remoteUrl ? normalizeRemoteUrl(config.remoteUrl) : "";
  const remotes = git(["remote", "-v"]).split("\n").filter(Boolean);
  if (targetUrl) {
    for (const line of remotes) {
      const [name, url, kind] = line.split(/\s+/);
      if (kind === "(fetch)" && normalizeRemoteUrl(url) === targetUrl) {
        return name;
      }
    }
  }

  try {
    const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
    return upstream.split("/")[0];
  } catch {
    // Fall through to origin or the first configured remote.
  }

  if (remotes.some((line) => line.startsWith("origin\t") || line.startsWith("origin "))) {
    return "origin";
  }

  if (remotes.length > 0) {
    return remotes[0].split(/\s+/)[0];
  }

  throw new Error("Could not determine git remote");
}

export function remoteBranchExists(remote, branch) {
  try {
    git(["ls-remote", "--exit-code", "--heads", remote, branch], { stdio: ["ignore", "pipe", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

export function listPublishedSpecs(ref, versionsDir) {
  try {
    return git(["ls-tree", "-r", "--name-only", ref, versionsDir])
      .split("\n")
      .filter((name) => dirname(name) === versionsDir && publishedSpecVersion(name));
  } catch {
    return [];
  }
}

export function publishedSpecVersion(path) {
  if (!path.endsWith(".md")) {
    return null;
  }

  return parseReleaseVersion(basename(path, ".md"));
}

export function compareVersions(a, b) {
  const aa = publishedSpecVersion(a);
  const bb = publishedSpecVersion(b);
  if (!aa || !bb) {
    throw new Error(`Cannot compare invalid published specification versions: ${a}, ${b}`);
  }

  return semver.compare(aa, bb);
}

export function renderHistoryNote(template, values) {
  return template
    .replaceAll("$version", values.version)
    .replaceAll("$releaseType", values.releaseType)
    .replaceAll("$minor", values.minor);
}

export function replaceVersionAndHistory(source, lastVersion, nextVersion, releaseType, config) {
  const parsedNextVersion = parseReleaseVersion(nextVersion);
  if (!parsedNextVersion) {
    throw new Error(`Invalid release version: ${nextVersion}`);
  }

  const historyLine = `| ${nextVersion} | TBD | ${renderHistoryNote(config.releaseHistoryNote, {
    version: nextVersion,
    releaseType,
    minor: `${parsedNextVersion.major}.${parsedNextVersion.minor}`
  })} |\n`;

  let result = source.replace(`\n## Version ${lastVersion}\n`, `\n## Version ${nextVersion}\n`);
  if (result === source) {
    throw new Error(`Could not find version heading "## Version ${lastVersion}"`);
  }

  if (!result.includes(config.releaseHistoryTableHeader)) {
    throw new Error("Could not find release history table header");
  }

  result = result.replace(config.releaseHistoryTableHeader, `${config.releaseHistoryTableHeader}${historyLine}`);
  return result;
}

export function expandFiles(patterns) {
  return patterns.flatMap((pattern) => expandPattern(pattern)).filter((path, index, paths) => paths.indexOf(path) === index);
}

function expandPattern(pattern) {
  if (!pattern.includes("*")) {
    return existsSync(pattern) ? [pattern] : [];
  }

  const parts = pattern.split("/");
  const results = [];

  function walk(index, prefix) {
    if (index === parts.length) {
      if (existsSync(prefix)) {
        results.push(prefix);
      }
      return;
    }

    const part = parts[index];
    if (!part.includes("*")) {
      walk(index + 1, prefix ? join(prefix, part) : part);
      return;
    }

    const dir = prefix || ".";
    if (!existsSync(dir)) {
      return;
    }

    const regex = new RegExp(`^${escapeRegExp(part).replaceAll("\\*", ".*")}$`);
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (regex.test(entry.name)) {
        walk(index + 1, join(dir, entry.name));
      }
    }
  }

  walk(0, "");
  return results;
}

export function rewriteVersionInFiles(paths, lastMinor, nextMinor) {
  const tempDir = mkdtempSync(join(tmpdir(), "oai-release-"));
  try {
    const escapedLastMinorRegex = lastMinor.split(".").map(escapeRegExp).join("\\\\\\.");
    const nextMinorRegex = nextMinor.replaceAll(".", "\\.");

    for (const file of paths) {
      let text = readFileSync(file, "utf8");
      text = text
        .replaceAll(lastMinor, nextMinor)
        .replace(new RegExp(`\\^${escapedLastMinorRegex}\\\\\\.`, "g"), `^${nextMinorRegex}\\.`);
      const temp = join(tempDir, basename(file));
      writeFileSync(temp, text);
      writeFileSync(file, readFileSync(temp, "utf8"));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export function removeConfiguredPaths(paths) {
  for (const path of paths) {
    if (existsSync(path)) {
      rmSync(path, { recursive: true, force: true });
    }
  }
}

export function publishedSpecPath(config, version) {
  return join(config.versionsDir, `${version}.md`);
}

export function editorsSnapshotPath(config, version) {
  return join(config.versionsDir, `${version}-editors.md`);
}

export function displayPath(path) {
  return relative(process.cwd(), path) || ".";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
