import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { checkRelease } from "../../scripts/check-release.mjs";

const testDirs = [];
const commit = "0123456789abcdef0123456789abcdef01234567";

afterEach(() => {
  while (testDirs.length > 0) {
    rmSync(testDirs.pop(), { recursive: true, force: true });
  }
});

describe("build-infra release preflight", () => {
  test("accepts an untagged stable version on the selected main commit", () => {
    const root = createPackage({ version: "1.2.3", private: true });
    const git = fakeGit({ head: commit });

    expect(checkRelease({ root, commit, ref: "refs/heads/main" }, git)).toEqual({
      version: "1.2.3",
      tag: "v1.2.3",
      commit
    });
  });

  test.each([
    "1.2.3-rc.1",
    "1.2.3+build.1",
    "01.2.3",
    "9007199254740992.0.0"
  ])("rejects non-release version %s", (version) => {
    const root = createPackage({ version, private: true });

    expect(() => checkRelease({ root, commit, ref: "refs/heads/main" }, fakeGit({ head: commit })))
      .toThrow(/not a canonical X.Y.Z release version/);
  });

  test("rejects packages that could be published to npm", () => {
    const root = createPackage({ version: "1.2.3" });

    expect(() => checkRelease({ root, commit, ref: "refs/heads/main" }, fakeGit({ head: commit })))
      .toThrow(/private to true/);
  });

  test("rejects releases not started from main", () => {
    const root = createPackage({ version: "1.2.3", private: true });

    expect(() => checkRelease({ root, commit, ref: "refs/heads/feature" }, fakeGit({ head: commit })))
      .toThrow(/main branch/);
  });

  test("rejects a checkout that differs from the selected commit", () => {
    const root = createPackage({ version: "1.2.3", private: true });
    const otherCommit = "abcdef0123456789abcdef0123456789abcdef01";

    expect(() => checkRelease({ root, commit, ref: "refs/heads/main" }, fakeGit({ head: otherCommit })))
      .toThrow(/does not match release commit/);
  });

  test("rejects an existing release tag", () => {
    const root = createPackage({ version: "1.2.3", private: true });
    const git = fakeGit({ head: commit, tags: ["v1.2.3"] });

    expect(() => checkRelease({ root, commit, ref: "refs/heads/main" }, git))
      .toThrow(/already exists/);
  });
});

function createPackage(packageJson) {
  const root = mkdtempSync(join(tmpdir(), "oai-build-infra-release-"));
  testDirs.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
  return root;
}

function fakeGit({ head, tags = [] }) {
  return (args) => {
    if (args.join(" ") === "rev-parse HEAD") {
      return head;
    }
    const tag = args.at(-1).replace("refs/tags/", "");
    if (tags.includes(tag)) {
      return "tag-object";
    }
    throw new Error("unknown revision");
  };
}
