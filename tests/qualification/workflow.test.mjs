import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "../..");

describe("consumer qualification workflow", () => {
  test("installs runner dependencies before invoking the qualification script", () => {
    const workflow = YAML.parse(readFileSync(
      join(packageRoot, ".github/workflows/qualify-consumers.yml"),
      "utf8"
    ));
    const steps = workflow.jobs.qualify.steps;
    const installIndex = steps.findIndex((step) => step.name === "Install build-infra runner dependencies");
    const qualifyIndex = steps.findIndex((step) => step.name === "Qualify candidate");
    const install = steps[installIndex];

    expect(installIndex).toBeGreaterThanOrEqual(0);
    expect(installIndex).toBeLessThan(qualifyIndex);
    expect(install["working-directory"]).toBe("build-infra");
    expect(install.run).toBe("yarn install --immutable --mode=skip-build");
  });
});
