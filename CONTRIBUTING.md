# Contributing To Build Infrastructure

The goal is to keep the specification repositories uncluttered: each spec repo
should call clear package scripts, while this package owns the tool versions and
reusable logic.

## Mental Model

There are four layers:

1. Specification repositories contain Markdown, schemas, tests, workflows, and
   `spec.config.json`.
2. Their `package.json` scripts call commands installed by `@oai/build-infra`.
3. This repository implements those commands and owns the JavaScript
   dependencies they need.
4. GitHub Actions in each specification repository run the same Yarn commands that
   maintainers run locally.

If something is reusable across specification repositories, put it here. If it is
specific to one repository's governance, labels, reviewers, or branch policy,
leave it in that repository.

## Command Overview

Build and validation:

* `oai-spec-build` renders Markdown to HTML using Markdown-it and ReSpec.
* `oai-spec-format-markdown` applies shared Markdown formatting.
* `oai-spec-validate-markdown` runs markdownlint and linkspector.
* `oai-spec-publish-schemas` publishes dated JSON schema iterations.

Tests:

* `oai-spec-test` runs `c8` and `vitest`.
* `@oai/build-infra/test` re-exports Vitest helpers.
* `@oai/build-infra/schema/test-config` registers YAML schema loading and any
  configured custom vocabulary keywords.
* `@oai/build-infra/schema/vitest` re-exports schema coverage helpers.

Release lifecycle:

* `oai-spec-start-release` starts the next development PR branch.
* `oai-spec-adjust-release-branch` prepares a release branch for merge to
  `main`.

## Before Changing Code

Read the consuming repository's `spec.config.json` and `package.json` first.
Most behavior is configured there.

Be especially careful with release commands. They create branches, commit files,
delete configured paths, and may push branches. Test release-command changes in a
scratch repository before asking maintainers to trust them.

## Testing

Run the package tests:

```sh
corepack enable
yarn install --immutable
yarn test
```

These tests include self-contained fixture repositories. They exercise the
public commands against temporary consumer-shaped Git repositories, so they can
run locally and in GitHub CI without another checkout.

After a candidate commit has been pushed to `OAI/build-infra`, run the manual
**Qualify build-infra candidate** GitHub Actions workflow. It installs that exact
commit into disposable checkouts of the active OpenAPI Specification and SIG
branches, then runs each checkout's applicable validation, tests, builds, and
release-adjustment checks. A candidate that has only passed `yarn test` has not
yet been checked against the real downstream content and histories.

The workflow uses `scripts/qualify-consumer.mjs`. You may run it locally against
a disposable clone, but never against a checkout with work you need to keep: it
rewrites the dependency and lockfile, and release qualification also commits the
temporary update and creates a release branch. See the README for its arguments
and current consumer matrix.

For changes that affect behavior not covered by those fixtures, also test in at
least one specification repository with a temporary local dependency:

```json
{
  "dependencies": {
    "@oai/build-infra": "file:../build-infra"
  }
}
```

Then run the relevant consumer scripts:

```sh
yarn install
yarn test
yarn validate-markdown
yarn build
yarn build-src
```

Not every repository has all of those scripts.

Before committing consumer changes, change the dependency back to the GitHub
dependency. Refresh the lockfile only after the build-infra commit is available
on GitHub.

## Dependency Maintenance

This repository owns most JavaScript dependencies for the specification
repositories. Direct dependencies are pinned exactly so consumers receive the
versions tested here. Dependabot's JavaScript ecosystem is named `npm`, even for
projects whose lockfile and commands use Yarn.

When Dependabot opens a pull request:

1. Read the release notes for major updates and security updates.
2. Review Yarn's peer-dependency warnings. A major update may make a formerly
   transitive package a required peer dependency; declare that package directly
   and add it to the same Dependabot group when its version must stay compatible
   with the updated tool.
3. Run `yarn install --immutable` and `yarn test`.
4. If the update touches build, markdown, schema, or test behavior, test a
   consumer repository with the local `file:../build-infra` dependency.
5. Merge the build-infra update.
6. Run the **Qualify build-infra candidate** workflow for the merged commit.
7. In each consumer repository that should pick up the change, run:

   ```sh
   yarn up -R @oai/build-infra
   yarn install --immutable
   ```

8. Run the consumer's relevant tests, validation, and builds.
9. Commit the consumer repository's `yarn.lock` update.

The consumer `package.json` should keep requesting
`git+https://github.com/OAI/build-infra.git#main`. The consumer
`yarn.lock` records both that branch request and the exact Git commit resolved
from it. That commit is intentional: immutable installs do not silently change
behavior when `OAI/build-infra` moves forward. `yarn up -R` refreshes the
resolution without changing `package.json`.

## Build-Infra Releases

Build-infra is not published to npm. Stable semantic-version tags identify the
commits approved for use by specification repositories; untagged commits on
`main` are release candidates.

For each release:

1. Choose the next version using the compatibility rules in the README.
2. Update `package.json` and run:

   ```sh
   yarn install
   yarn install --immutable
   yarn test
   ```

3. Commit and merge the version change through a pull request.
4. Run **Release build-infra** from the GitHub Actions page, selecting `main`.
5. Confirm that the package tests and downstream qualification matrix passed.
6. Review and approve the `build-infra-release` environment deployment.
7. Confirm that the resulting annotated `vX.Y.Z` tag points to the qualified
   commit.

The workflow reads the version from `package.json`; the person running it does
not type the version a second time. `yarn release:check` verifies the package
metadata, selected branch and commit, and absence of the proposed tag before
the expensive downstream qualification begins.

Repository administrators must configure the protected
`build-infra-release` environment and the immutable `v*` tag ruleset described
in the README before the first release. Never force-update or delete a release
tag. Correct a bad release with a new patch release instead.

### Yarn Lockfile And Security Settings

`yarn.lock` is the only dependency lockfile. Yarn generates a complete,
cross-platform dependency graph, including platform-specific optional packages.
Never edit it manually or copy entries from another lockfile. There is no
packaged lockfile snapshot and no consumer lockfile merge step.

Use `yarn install --immutable` for routine installs and CI. Use a command that
may change the lockfile only when that change is intentional:

* Use `yarn install` once when creating a new repository's first lockfile.
* Use `yarn up <package>` for an intentional package version update.
* Use `yarn up -R @oai/build-infra` to refresh a consumer's `#main` resolution.

Yarn 4.18 has two security defaults that every consumer must configure:

* `.yarnrc.yml` must use `nodeLinker: node-modules`, because the shared shell
  commands inspect that layout, and must list the build-infra URL under
  `approvedGitRepositories`.
* The top-level `package.json` must set
  `dependenciesMeta.puppeteer.built: true`. This narrowly permits Puppeteer's
  browser installation script, which linkspector and ReSpec need. Do not enable
  all third-party install scripts merely to silence a warning. Review any new
  package that requests a build script and allow it only when build-infra needs
  the generated artifact.

The expected Node.js version is declared in `.nvmrc`, `package.json`, and CI;
the Yarn version is declared in `packageManager`. When updating either runtime,
change build-infra first, run all tests, and then align consumer repositories.

## Release Command Maintenance

The release commands are intentionally conservative.

`oai-spec-adjust-release-branch`:

* must run on a branch named `vX.Y.Z-rel`;
* requires a clean working tree;
* copies the active source Markdown to `versions/X.Y.Z.md`;
* replaces `| TBD |` with the current date;
* copies `EDITORS.md` to `versions/X.Y.Z-editors.md`, unless disabled;
* removes paths listed in `release.removeOnReleaseBranch`;
* stages the complete release changeset, but does not commit it.

After running the command, use `git diff --cached` to review the proposed
release commit. If manual adjustments are needed, edit the files, run
`git add --all`, and review `git diff --cached` again before committing. This
second staging step is important because otherwise a plain `git commit` would
use the older staged contents rather than the manual edits.

`oai-spec-start-release`:

* must run on a branch named `vX.Y-dev`;
* requires a clean working tree;
* finds the latest published version under `versions/` on the configured main
  branch;
* creates `vX.Y-dev-start-X.Y.Z`;
* resets the active source Markdown history from the previous published version;
* updates the version heading and history table;
* optionally rewrites schema/test files for a new minor version;
* pushes the branch unless `--no-push` is used.

Use `--no-push` in scratch tests.

## Common Failure Modes

* Yarn rejects the build-infra Git URL: add
  `https://github.com/OAI/build-infra.git` to `approvedGitRepositories` in the
  consumer's `.yarnrc.yml`.
* Yarn reports that Puppeteer's build is disabled: add the documented
  `dependenciesMeta.puppeteer.built` allowlist to the consumer's top-level
  `package.json`, then run `yarn install` and commit the resulting lockfile.
* `yarn install --immutable` reports that it would change `yarn.lock`: the
  manifest and lockfile disagree. If a dependency change was intentional, run
  the appropriate `yarn up` command and review the lockfile diff. Otherwise,
  restore the matching manifest or lockfile from Git.
* A consumer cannot fetch its locked build-infra commit: make sure that commit
  has been pushed to GitHub before refreshing the consumer lockfile.
* Release command says the working tree is dirty: commit or stash local changes
  first. These commands intentionally refuse to mix release edits with unrelated
  work.
* `oai-spec-start-release` cannot find published versions: check the configured
  remote, main branch, and `versions/` directory.
* Generated HTML looks wrong: check `spec.config.json` first, especially `slug`,
  `shortName`, `titleName`, `specSrc`, and metadata links.

## What Belongs Here

Good candidates for this repository:

* shared command-line tools;
* shared JavaScript dependency versions;
* Markdown, link, schema, and ReSpec behavior;
* release lifecycle mechanics used by multiple specification repositories;
* templates for new specification repositories.

Keep these in individual specification repositories:

* contributor policy;
* branch sync policy;
* CODEOWNERS;
* issue templates;
* labels, reviewers, and pull request wording;
* one-off scripts for that repository's issue management or governance.
