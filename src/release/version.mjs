import semver from "semver";

/**
 * Parse the canonical X.Y.Z form used for specification and build-infra releases.
 *
 * SemVer also permits prerelease and build metadata. Those forms are intentionally
 * excluded here because this project's release branches, files, and tags use one
 * unambiguous X.Y.Z version.
 */
export function parseReleaseVersion(value) {
  if (typeof value !== "string") {
    return null;
  }

  const version = semver.parse(value);
  if (
    !version
    || version.raw !== version.version
    || version.prerelease.length > 0
    || version.build.length > 0
  ) {
    return null;
  }

  return version;
}
