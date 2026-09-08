import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "../..");
const testDirs = [];

afterEach(() => {
  while (testDirs.length > 0) {
    rmSync(testDirs.pop(), { recursive: true, force: true });
  }
});

describe("installed package behavior in a consumer repository", () => {
  test("public command line tools work from an installed package layout", () => {
    const fixture = createConsumerFixture();

    expect(runBin(fixture, "oai-spec-validate-markdown")).toContain("linkspector check --config");
    expect(runBin(fixture, "oai-spec-format-markdown")).toContain("--fix");

    runBin(fixture, "oai-spec-build", ["src"]);
    expect(readFileSync(join(fixture.consumer, "deploy-preview/spec.html"), "utf8")).toContain("rendered by respec");

    runBin(fixture, "oai-spec-publish-schemas", ["src"]);
    expect(readFileSync(join(fixture.consumer, "deploy-preview/schema", latestSchemaDate(fixture.consumer)), "utf8")).toContain("type: object");

    expect(runBin(fixture, "oai-spec-test")).toContain("c8 --100");
    expect(() => runBin(fixture, "oai-spec-start-release", ["--no-push"])).toThrow(/development branch/);
    expect(() => runBin(fixture, "oai-spec-adjust-release-branch")).toThrow(/release branch/);
  });
});

function createConsumerFixture() {
  const root = mkdtempSync(join(tmpdir(), "oai-installed-consumer-"));
  testDirs.push(root);

  const consumer = join(root, "consumer");
  const installedPackage = join(consumer, "node_modules/@oai/build-infra");
  const consumerBin = join(consumer, "node_modules/.bin");

  mkdirSync(installedPackage, { recursive: true });
  mkdirSync(consumerBin, { recursive: true });
  for (const path of ["bin", "configs", "src/md2html", "src/release", "src/schema", "src/shell"]) {
    cpSync(join(packageRoot, path), join(installedPackage, path), { recursive: true });
  }
  cpSync(join(packageRoot, "package.json"), join(installedPackage, "package.json"));
  mkdirSync(join(installedPackage, "node_modules"));
  cpSync(
    join(packageRoot, "node_modules/semver"),
    join(installedPackage, "node_modules/semver"),
    { recursive: true }
  );

  writeConsumerFiles(consumer);
  writeToolStubs(consumer, consumerBin);

  git(consumer, ["init"]);
  git(consumer, ["config", "user.name", "Fixture Maintainer"]);
  git(consumer, ["config", "user.email", "fixture@example.com"]);
  git(consumer, ["add", "."]);
  git(consumer, ["commit", "-m", "fixture"]);

  return { consumer, installedPackage, consumerBin };
}

function writeConsumerFiles(consumer) {
  mkdirSync(join(consumer, "src/schemas/validation"), { recursive: true });
  writeFileSync(join(consumer, "spec.config.json"), JSON.stringify({
    slug: "fixture",
    specSrc: "spec.md",
    schemas: ["schema.yaml"]
  }));
  writeFileSync(join(consumer, "README.md"), "# Fixture\n");
  writeFileSync(join(consumer, "EDITORS.md"), "# Editors\n");
  writeFileSync(join(consumer, ".linkspector.yml"), "dirs:\n  - .\n");
  writeFileSync(join(consumer, "src/spec.md"), "# Fixture Spec\n");
  writeFileSync(join(consumer, "src/schemas/validation/schema.yaml"), "type: object\n");
}

function writeToolStubs(consumer, consumerBin) {
  writeBin(join(consumerBin, "markdownlint-cli2"), "echo markdownlint \"$@\"");
  writeBin(join(consumerBin, "linkspector"), "echo linkspector \"$@\"");
  writeBin(join(consumerBin, "yaml"), "cat");
  writeBin(join(consumerBin, "respec"), "while [ \"$#\" -gt 0 ]; do case \"$1\" in --src) src=\"$2\"; shift 2 ;; --out) out=\"$2\"; shift 2 ;; *) shift ;; esac; done; printf '<html>rendered by respec</html>\\n' > \"$out\"");

  mkdirSync(join(consumer, "node_modules/respec/builds"), { recursive: true });
  writeFileSync(join(consumer, "node_modules/respec/package.json"), JSON.stringify({ name: "respec", version: "0.0.0" }));
  writeFileSync(join(consumer, "node_modules/respec/builds/respec-w3c.js"), "/* respec fixture */\n");

  mkdirSync(join(consumer, "node_modules/c8/bin"), { recursive: true });
  writeFileSync(join(consumer, "node_modules/c8/package.json"), JSON.stringify({ name: "c8", version: "0.0.0" }));
  writeFileSync(join(consumer, "node_modules/c8/bin/c8.js"), "console.log(`c8 ${process.argv.slice(2).join(' ')}`);\n");

  mkdirSync(join(consumer, "node_modules/vitest"), { recursive: true });
  writeFileSync(join(consumer, "node_modules/vitest/package.json"), JSON.stringify({ name: "vitest", version: "0.0.0" }));
  writeFileSync(join(consumer, "node_modules/vitest/vitest.mjs"), "console.log('vitest fixture');\n");

  writeFileSync(join(consumer, "node_modules/@oai/build-infra/src/md2html/md2html.js"), "console.log('<html>fixture md2html</html>');\n");
}

function runBin({ consumer, installedPackage, consumerBin }, bin, args = []) {
  try {
    return execFileSync(join(installedPackage, "bin", bin), args, {
      cwd: consumer,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${consumerBin}:${process.env.PATH}`
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    throw new Error(`${error.stdout || ""}${error.stderr || ""}` || error.message);
  }
}

function latestSchemaDate(repo) {
  return git(repo, ["log", "-1", "--format=%cd", "--date=short", "src/schemas/validation/schema.yaml"]);
}

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trimEnd();
}

function writeBin(path, script) {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${script}\n`);
  chmodSync(path, 0o755);
}
