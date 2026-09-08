#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { parseReleaseVersion } from "../src/release/version.mjs";

const BUILD_INFRA_URL = "git+https://github.com/OAI/build-infra.git";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;

export function parseOptions(args) {
  const { values } = parseArgs({
    args,
    options: {
      consumer: { type: "string", default: "." },
      candidate: { type: "string" },
      base: { type: "string", default: "main" },
      "release-version": { type: "string", default: "" }
    },
    strict: true
  });

  if (!values.candidate || !COMMIT_PATTERN.test(values.candidate)) {
    throw new Error("--candidate must be a full 40-character lowercase Git commit SHA");
  }

  const releaseVersion = values["release-version"] || null;
  if (releaseVersion && !parseReleaseVersion(releaseVersion)) {
    throw new Error("--release-version must have the form X.Y.Z");
  }

  return {
    consumer: resolve(values.consumer),
    candidate: values.candidate,
    base: values.base,
    releaseVersion
  };
}

export function setCandidateDependency(consumer, candidate) {
  if (!COMMIT_PATTERN.test(candidate)) {
    throw new Error("Candidate must be a full 40-character lowercase Git commit SHA");
  }

  const packageJsonPath = join(consumer, "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  const current = packageJson.dependencies?.["@oai/build-infra"];

  if (typeof current !== "string" || !current.startsWith(`${BUILD_INFRA_URL}#`)) {
    throw new Error(`${packageJsonPath} does not use ${BUILD_INFRA_URL}`);
  }

  packageJson.dependencies["@oai/build-infra"] = `${BUILD_INFRA_URL}#commit=${candidate}`;
  writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2) + "\n");

  return packageJson;
}

export function qualificationCommands(consumer, base) {
  const packageJson = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
  const scripts = packageJson.scripts || {};

  for (const requiredScript of ["validate-markdown", "build"]) {
    if (!scripts[requiredScript]) {
      throw new Error(`${packageJson.name || "Consumer"} does not define the ${requiredScript} script`);
    }
  }

  const commands = [
    {
      command: "corepack",
      args: ["yarn", "install"],
      env: {
        YARN_ENABLE_HARDENED_MODE: "0",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "0"
      }
    },
    {
      command: "corepack",
      args: ["yarn", "install", "--immutable"],
      env: {
        YARN_ENABLE_HARDENED_MODE: "1",
        YARN_ENABLE_IMMUTABLE_INSTALLS: "1"
      }
    },
    { command: "corepack", args: ["yarn", "validate-markdown"] }
  ];

  if (scripts.test) {
    commands.push({
      command: "corepack",
      args: ["yarn", "test"],
      env: { BASE: base }
    });
  }

  if (containsMarkdown(consumer, "versions")) {
    commands.push({ command: "corepack", args: ["yarn", "build", "latest"] });
  }

  if (containsMarkdown(consumer, "src")) {
    if (!scripts["build-src"]) {
      throw new Error(`${packageJson.name || "Consumer"} contains source Markdown but does not define build-src`);
    }
    commands.push({ command: "corepack", args: ["yarn", "build-src"] });
  }

  return commands;
}

export function expectedReleaseAdditions(consumer, version) {
  const specConfig = JSON.parse(readFileSync(join(consumer, "spec.config.json"), "utf8"));
  const release = specConfig.release || {};
  const versionsDir = release.versionsDir || "versions";
  const additions = [join(versionsDir, `${version}.md`)];

  if (release.editorsPath !== false) {
    additions.push(join(versionsDir, `${version}-editors.md`));
  }

  return additions;
}

export function qualifyConsumer(options, run = runCommand) {
  const { consumer, candidate, base, releaseVersion } = options;

  setCandidateDependency(consumer, candidate);
  for (const command of qualificationCommands(consumer, base)) {
    run(command.command, command.args, { cwd: consumer, env: command.env });
  }

  if (releaseVersion) {
    qualifyRelease(consumer, candidate, releaseVersion, run);
  }
}

function qualifyRelease(consumer, candidate, version, run) {
  run("git", ["add", "package.json", "yarn.lock"], { cwd: consumer });
  run(
    "git",
    [
      "-c",
      "user.name=Build Infra Qualification",
      "-c",
      "user.email=build-infra-qualification@openapis.org",
      "commit",
      "-m",
      `Test build-infra candidate ${candidate.slice(0, 12)}`
    ],
    { cwd: consumer }
  );
  run("git", ["switch", "-c", `v${version}-rel`], { cwd: consumer });
  run("corepack", ["yarn", "adjust-release-branch"], { cwd: consumer });

  const addedFiles = run(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=AR"],
    { cwd: consumer, capture: true }
  ).split("\n").filter(Boolean);

  for (const expectedFile of expectedReleaseAdditions(consumer, version)) {
    if (!addedFiles.includes(expectedFile)) {
      throw new Error(`Release qualification did not stage ${expectedFile}`);
    }
  }
}

function containsMarkdown(consumer, directory) {
  const path = join(consumer, directory);
  return existsSync(path) && readdirSync(path).some((entry) => entry.endsWith(".md"));
}

function runCommand(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit"
  })?.trimEnd() || "";
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  try {
    qualifyConsumer(parseOptions(process.argv.slice(2)));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
