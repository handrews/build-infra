import { describe, expect, test } from "vitest";
import { compareVersions, publishedSpecVersion } from "../../src/release/common.mjs";
import { parseReleaseVersion } from "../../src/release/version.mjs";

describe("release semantic versions", () => {
  test.each(["0.0.0", "1.2.3", "10.20.30"])("accepts canonical release version %s", (value) => {
    expect(parseReleaseVersion(value)?.raw).toBe(value);
  });

  test("rejects non-string values", () => {
    expect(parseReleaseVersion()).toBeNull();
  });

  test.each([
    "1.2",
    "1.2.3.4",
    "01.2.3",
    "1.02.3",
    "1.2.03",
    "v1.2.3",
    "=1.2.3",
    " 1.2.3 ",
    "1.2.3-rc.1",
    "1.2.3+build.1",
    "9007199254740992.0.0"
  ])("rejects non-release version %s", (value) => {
    expect(parseReleaseVersion(value)).toBeNull();
  });

  test("extracts versions only from canonical published specification names", () => {
    expect(publishedSpecVersion("versions/3.1.10.md")?.raw).toBe("3.1.10");
    expect(publishedSpecVersion("versions/3.1.10-editors.md")).toBeNull();
    expect(publishedSpecVersion("versions/3.1.10-rc.1.md")).toBeNull();
  });

  test("orders published specifications by semantic version precedence", () => {
    const paths = [
      "versions/3.10.0.md",
      "versions/3.2.10.md",
      "versions/3.2.9.md"
    ];

    expect(paths.sort(compareVersions)).toEqual([
      "versions/3.2.9.md",
      "versions/3.2.10.md",
      "versions/3.10.0.md"
    ]);
  });
});
