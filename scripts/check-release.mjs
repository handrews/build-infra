#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseReleaseVersion } from "../src/release/version.mjs";

const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function checkRelease(options, git = runGit) {
  const root = resolve(options.root || ".");
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  const version = packageJson.version;

  if (!parseReleaseVersion(version)) {
    throw new Error(`package.json version ${JSON.stringify(version)} is not a canonical X.Y.Z release version`);
  }
  if (packageJson.private !== true) {
    throw new Error("package.json must set private to true because build-infra is not published to npm");
  }
  if (!COMMIT_PATTERN.test(options.commit || "")) {
    throw new Error("The release commit must be a full 40-character lowercase Git SHA");
  }
  if (options.ref !== "refs/heads/main") {
    throw new Error("Build-infra releases must be started from the main branch");
  }

  const head = git(["rev-parse", "HEAD"], root);
  if (head !== options.commit) {
    throw new Error(`Checked-out commit ${head} does not match release commit ${options.commit}`);
  }

  const tag = `v${version}`;
  if (tagExists(tag, root, git)) {
    throw new Error(`Tag ${tag} already exists`);
  }

  return { version, tag, commit: head };
}

function tagExists(tag, root, git) {
  try {
    git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}`], root);
    return true;
  } catch {
    return false;
  }
}

function runGit(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trimEnd();
}

function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      root: { type: "string", default: "." },
      commit: { type: "string", default: process.env.GITHUB_SHA || "" },
      ref: { type: "string", default: process.env.GITHUB_REF || "" }
    },
    strict: true
  });

  return values;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    const release = checkRelease(parseOptions(process.argv.slice(2)));
    console.log(release.version);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
