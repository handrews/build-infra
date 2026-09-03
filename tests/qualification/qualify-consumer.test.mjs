import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  expectedReleaseAdditions,
  parseOptions,
  qualifyConsumer,
  qualificationCommands,
  setCandidateDependency
} from "../../scripts/qualify-consumer.mjs";

const testDirs = [];
const candidate = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  while (testDirs.length > 0) {
    rmSync(testDirs.pop(), { recursive: true, force: true });
  }
});

describe("consumer qualification", () => {
  test("selects an exact candidate without changing other package metadata", () => {
    const consumer = createConsumer();

    setCandidateDependency(consumer, candidate);

    const packageJson = JSON.parse(readFileSync(join(consumer, "package.json"), "utf8"));
    expect(packageJson.dependencies["@oai/build-infra"]).toBe(
      `git+https://github.com/OAI/build-infra.git#commit=${candidate}`
    );
    expect(packageJson.name).toBe("qualification-fixture");
  });

  test("runs all checks supported by a source and published-version repository", () => {
    const consumer = createConsumer();
    mkdirSync(join(consumer, "src"));
    mkdirSync(join(consumer, "versions"));
    writeFileSync(join(consumer, "src/spec.md"), "# Source\n");
    writeFileSync(join(consumer, "versions/1.0.0.md"), "# Published\n");

    const commands = qualificationCommands(consumer, "v1.0-dev");

    expect(commands.map(({ args }) => args.join(" "))).toEqual([
      "yarn install",
      "yarn install --immutable",
      "yarn validate-markdown",
      "yarn test",
      "yarn build latest",
      "yarn build-src"
    ]);
    expect(commands[0].env).toEqual({
      YARN_ENABLE_HARDENED_MODE: "0",
      YARN_ENABLE_IMMUTABLE_INSTALLS: "0"
    });
    expect(commands[1].env).toEqual({
      YARN_ENABLE_HARDENED_MODE: "1",
      YARN_ENABLE_IMMUTABLE_INSTALLS: "1"
    });
    expect(commands[3].env).toEqual({ BASE: "v1.0-dev" });
  });

  test("skips tests and published builds that the consumer does not provide", () => {
    const consumer = createConsumer({ test: false });
    mkdirSync(join(consumer, "src"));
    writeFileSync(join(consumer, "src/spec.md"), "# Source\n");

    const commands = qualificationCommands(consumer, "main");

    expect(commands.map(({ args }) => args.join(" "))).toEqual([
      "yarn install",
      "yarn install --immutable",
      "yarn validate-markdown",
      "yarn build-src"
    ]);
  });

  test("derives the release files that must be staged", () => {
    const consumer = createConsumer();
    writeFileSync(join(consumer, "spec.config.json"), JSON.stringify({
      release: {
        versionsDir: "published",
        editorsPath: false
      }
    }));

    expect(expectedReleaseAdditions(consumer, "1.2.3")).toEqual([
      join("published", "1.2.3.md")
    ]);
  });

  test("runs release preparation and checks its staged additions", () => {
    const consumer = createConsumer();
    writeFileSync(join(consumer, "spec.config.json"), "{}\n");
    writeFileSync(join(consumer, "yarn.lock"), "fixture lock\n");
    const invocations = [];

    qualifyConsumer({
      consumer,
      candidate,
      base: "main",
      releaseVersion: "1.2.3"
    }, (command, args, options) => {
      invocations.push([command, ...args]);
      if (options.capture) {
        return "versions/1.2.3.md\nversions/1.2.3-editors.md";
      }
      return "";
    });

    expect(invocations.map((invocation) => invocation.join(" "))).toEqual([
      "corepack yarn install",
      "corepack yarn install --immutable",
      "corepack yarn validate-markdown",
      "corepack yarn test",
      "git add package.json yarn.lock",
      `git -c user.name=Build Infra Qualification -c user.email=build-infra-qualification@openapis.org commit -m Test build-infra candidate ${candidate.slice(0, 12)}`,
      "git switch -c v1.2.3-rel",
      "corepack yarn adjust-release-branch",
      "git diff --cached --name-only --diff-filter=AR"
    ]);
  });

  test("rejects abbreviated commits", () => {
    expect(() => parseOptions(["--candidate=0123456"])).toThrow(/full 40-character/);
  });

  test.each([
    "1.2",
    "1.2.3-rc.1",
    "1.2.3+build.1",
    "01.2.3",
    "9007199254740992.0.0"
  ])("rejects non-release qualification version %s", (version) => {
    expect(() => parseOptions([
      `--candidate=${candidate}`,
      `--release-version=${version}`
    ])).toThrow(/form X.Y.Z/);
  });
});

function createConsumer(options = {}) {
  const consumer = mkdtempSync(join(tmpdir(), "oai-qualification-"));
  testDirs.push(consumer);

  const scripts = {
    "validate-markdown": "validate",
    "build": "build",
    "build-src": "build source"
  };
  if (options.test !== false) {
    scripts.test = "test";
  }

  writeFileSync(join(consumer, "package.json"), JSON.stringify({
    name: "qualification-fixture",
    scripts,
    dependencies: {
      "@oai/build-infra": "git+https://github.com/OAI/build-infra.git#main"
    }
  }, null, 2) + "\n");

  return consumer;
}
