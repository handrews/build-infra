import { copyFileSync, readFileSync, writeFileSync } from "node:fs";
import {
  currentBranch,
  editorsSnapshotPath,
  git,
  loadReleaseConfig,
  parseArgs,
  publishedSpecPath,
  removeConfiguredPaths,
  requireCleanWorktree,
  today
} from "./common.mjs";
import { parseReleaseVersion } from "./version.mjs";

export async function adjustReleaseBranch(args = []) {
  const options = parseArgs(args);
  const config = loadReleaseConfig(options.configFile);
  const branch = currentBranch();
  const match = branch.match(/^v(.+)-rel$/);
  const version = match ? parseReleaseVersion(match[1]) : null;

  if (!version) {
    throw new Error("This command is intended to be run from a release branch, e.g. v3.1.2-rel");
  }

  requireCleanWorktree();

  const releaseDate = today();
  const targetSpec = publishedSpecPath(config, version.raw);

  console.log(`=== Prepare release of ${version.raw}`);
  console.log(`=== Copy ${config.sourcePath} to ${targetSpec}`);

  const source = readFileSync(config.sourcePath, "utf8");
  writeFileSync(targetSpec, source.replaceAll("| TBD |", `| ${releaseDate} |`));

  if (config.editorsPath) {
    const targetEditors = editorsSnapshotPath(config, version.raw);
    console.log(`=== Copy ${config.editorsPath} to ${targetEditors}`);
    copyFileSync(config.editorsPath, targetEditors);
  }

  if (config.removeOnReleaseBranch.length > 0) {
    console.log("=== Remove development-only files");
    removeConfiguredPaths(config.removeOnReleaseBranch);
  }

  console.log("=== Stage release changes");
  git(["add", "--all"]);

  console.log("=== Done");
  console.log("Release changes have been staged for review.");
  console.log("Review them with: git diff --cached");
  console.log("After making manual edits, run: git add --all");
}
