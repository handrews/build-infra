import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { describe, expect, test } from "vitest";
import semver from "semver";
import { parseReleaseVersion } from "../../src/release/version.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "../..");
const packageJson = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
const yarnConfig = readFileSync(join(packageRoot, ".yarnrc.yml"), "utf8");

describe("package manager policy", () => {
  test("uses stable release metadata and cannot be published to npm", () => {
    expect(parseReleaseVersion(packageJson.version)).not.toBeNull();
    expect(packageJson.private).toBe(true);
  });

  test("pins Yarn and uses the node_modules linker required by shell commands", () => {
    expect(packageJson.packageManager).toBe("yarn@4.18.0");
    expect(yarnConfig).toMatch(/^nodeLinker: node-modules$/m);
  });

  test("pins the directly tested toolchain dependencies exactly", () => {
    for (const [name, version] of Object.entries(packageJson.dependencies)) {
      expect(semver.valid(version), `${name} should use an exact version`).not.toBeNull();
    }
  });

  test("allows Puppeteer's browser installation script", () => {
    expect(packageJson.dependenciesMeta?.puppeteer?.built).toBe(true);
  });
});
