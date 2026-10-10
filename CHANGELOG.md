# Changelog

All notable changes to `storybook-github-swiss-knife` will be documented in this file.
It is the successor of `storybook-github-pages`; entries from 1.11.0 down are that project's history.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed

- CI fails when a reusable workflow uses source, or a named export, that its pinned toolkit commit does not have. Between #26 and 0.3.0, `main`'s own workflows imported `src/command-file.js` from a toolkit pinned before it existed, and this repository's PR preview publishing failed with `ERR_MODULE_NOT_FOUND`. New `npm run bump-pins` moves the internal action pins without a release, for the second of the two pull requests such a change now takes (see "Workflows and the pinned toolkit" in `docs/development.md`).

## [0.3.0] - 2026-10-10

### Changed

- Docs: how `visual.threshold` and `visual.maxDiffPixels` decide what counts as a change. At the default `threshold` of `0.2`, a colour swap between shades of similar brightness (`#1d4ed8` to `#6d28d9`) is reported as unchanged; `0.1` catches it.
- The visual workflow's reuse job is named **Reuse results (label event)**: since 0.2.1 every label event re-gates the commit's results, not only the approval label.
- `npm run prepare-release` adds a hint when it refuses: with a stale local `origin/main`, main's own newer commits look like the release branch's, so it suggests `git fetch origin main`.
- **Config-file on/off settings now apply when the input is left out** (minor release). `preserve_cname`, `generate_badges`, `generate_stats_graph`, `enable_passcode_gate`, `smoke_test`, `auto_base_url`, `audit_bundle_size` and `create_deployment` in `.storybook/swiss-knife.json` (or `.storybook-pages.yml`) were ignored by the composite action and the reusable workflows: each input had a `true` or `false` default, and a non-empty input wins over the file. The inputs are now strings that default to empty, so the file's value applies, then the old default. Passing `true` or `false` works as before. If your config file sets one of these, check it: that value now takes effect.

### Fixed

- **The default build no longer fails with "unknown option '--base-url'".** With `auto_base_url` on (the default), the build command got `--base-url <path>` appended, an option `storybook build` does not have, so `npm run build-storybook` and similar commands failed. The command now runs as written. Storybook builds use relative asset paths and load from any Pages path (checked on the canary's project-site previews with the Vite builder; no fixture covers the webpack builder). `auto_base_url` now only sets `BASE_URL`, `PUBLIC_URL` and `STORYBOOK_BASE_HREF` for the build.
- **The deploy quickstart works without an `install_command`.** The reusable workflow and the composite action ran `build_command` without installing dependencies (only Bun had a default), so the README quickstart built without `node_modules`. An empty `install_command` now installs before a build, from the lockfile: `npm ci`, `corepack pnpm install --frozen-lockfile`, `corepack yarn install --immutable` (Yarn 2+) or `yarn install --frozen-lockfile` (Yarn 1). Without a lockfile it runs a plain install and warns; without a root `package.json` (a monorepo whose build command installs in a subfolder) it installs nothing, as before. The composite action skips this default when `node_modules` already exists, so dependencies your own steps installed are kept; set `install_command` to install anyway.
- Multi-line values (a multi-line `build_command`, a `|` block in the config file) broke the configuration step with "Invalid format". Outputs and environment variables are now written as `key<<delimiter` blocks, with a random delimiter per value so a value cannot add keys of its own. Multi-line commands also reached the shell with literal `\n`; they now run line by line.
- pnpm projects failed the reusable workflow at Set up Node.js ("Unable to locate executable file: pnpm"): a fresh runner has no pnpm, and setup-node's cache runs it. corepack now provides pnpm and Yarn, at the `packageManager` version, before the cache is restored.
- A project without a lockfile failed the reusable workflow at setup-node's dependency cache ("Dependencies lock file is not found"). The cache is skipped when there is no lockfile.
- The deploy quickstart in the README and usage docs failed at startup: GitHub checks every job of a reusable workflow against the caller's permissions, so the caller must also grant `contents: write` and `deployments: write`.
- Re-running a Pages write that changes nothing (a deploy or PR preview of the same build) failed after every retry. git prints `nothing to commit` on stdout, which the error check never saw. The writer now asks git whether anything is staged (`git diff --cached --quiet`) and returns `{ changed: false }`, and git errors include stdout and the exit code.
- A root publish in directory mode (a `main` deploy to the Pages branch root) deleted everything except `managed_directories`, which is empty by default, so every deploy wiped the PR previews under `pr-preview/`. It now always keeps the preview root (`preview_root`, `pr-preview` by default, or the `pr-<N>` directories when previews are published at the root), plus the managed directories. `managed_directories` entries with a trailing slash (`pr-preview/`) match too. The publisher action has a new `preview_root` input.
- Root deploys from the reusable workflow also keep `pr-<N>` previews published at the Pages root (`preview_root` empty): the workflow now passes the resolved preview root to the directory publisher, which keeps those directories.

## [0.2.1] - 2026-10-10

### Changed

- `npm run prepare-release` pins the internal actions to the release branch's merge base with `origin/main` instead of its tip, which a squash merge drops, and refuses when the branch's own commits change `src/`, `actions/` or `runner/`. The Unreleased notes become the release's notes; the "Release vX.Y.Z" placeholder is added only when there are none, instead of a second `### Changed` heading.

### Fixed

- A baseline capture that failed without writing any screenshot (the browser did not start, the Storybook build was missing) passed: every story was reported as new, which never blocks, and on a baseline branch the empty baselines were cached for later pull requests. The capture step now fails, so nothing is compared against or cached. A story that fails to render is still reported as new.
- Adding the approval label together with another label could lose the approval: the second label event cancelled the run for the first, the cancelled run failed the checks, and a run for an unrelated label kept them. Every label event now re-gates the commit's results with the approval read live, and a cancelled run that a newer run of the same commit replaced leaves the checks to that run.
- Pages branch writes (PR previews, cleanups, the janitor, visual reports) retry up to 5 times instead of 3, with a growing, randomized pause, so writers that collided in a burst no longer retry in lockstep and fail together.
- The visual gate re-reads the pull request right before publishing its report and skips it when the pull request closed (its cleanup may already have run) or moved to a newer commit since the gate started. The checks are posted as before.

## [0.2.0] - 2026-10-10

### Changed

- Storybook 10.4+ (change detection on): the addon no longer adds the `visual:changed` and `visual:new` tags or the Visual panel's **Sidebar** select, which repeated Storybook's own **New** / **Modified** filter. Saved filters or `--includeTags`/`--excludeTags` that use those two tags no longer match there. `visual:failed` stays, since that filter has no entry for failures. Storybook 8.6, 9 and 10.0–10.3, or change detection off, keep all three tags and the select.

### Fixed

- The Visual panel's **Show changed pixels** stays on while moving between stories; it used to reset on every story.

## [0.1.1] - 2026-10-10

### Added

- The Visual panel has a **Sidebar** select that narrows the sidebar to changed, new or failed stories (Storybook 8.6, 9 and 10). Storybook's own status filter has no entry for failures.
- Every release carries the addon as an npm tarball (`storybook-swiss-knife-X.Y.Z.tgz`), packed from the release's commit in a read-only job: `npm install --save-dev https://github.com/Archetipo95/storybook-github-swiss-knife/releases/download/vX.Y.Z/storybook-swiss-knife-X.Y.Z.tgz` works whether or not that version is on npm.

### Changed

- The release pin check also compares `runner/`: `visual-capture` and `visual-report` run the runner from their pinned commit, so a release could ship runner fixes that its own workflows did not use. `prepare-release` leaves `runner/`'s version alone, and `test/prepare-release.test.js` prepares a release in a throwaway worktree and runs that check on every pull request.
- Release validation also requires `packages/addon`'s version to match the tag.

### Fixed

- Storybook 10.4+: Storybook's sidebar filter showed **New 0 / Modified 0** in a PR preview. The addon marked changed stories with a warning, which that filter does not list, and gave new stories no status. With change detection on (the default), changed stories are now `modified` and new ones `new`, so the filter lists the pull request's visual changes. Older Storybook versions keep the warning.
- A PR preview opened before its visual report was published kept showing "No visual report" in the Visual panel until a reload. The addon now checks again every 30 seconds for 20 minutes, then every 5 minutes, and fills the sidebar and the panel when the report appears; "Check again" fills the sidebar too. Storybook 8.6 also picks up a late report now.
- The runner waits (up to 15 seconds, then captures anyway) for stylesheet links to load before a screenshot: `document.fonts.ready` resolves while a web font stylesheet added at runtime is still loading, so a capture could show the fallback font.
- `visual.fixedTime` starts the page clock at that instant and lets it run, instead of freezing `Date.now()`. A frozen clock made Vue drop the outer handlers of every click, so play functions that click nested components failed. Pages keep drawing frames under the fake clock, so full-page captures no longer flip breakpoints.
- `npx storybook-swiss-knife init`: in a Storybook main file whose `addons` array spans several lines, the addon is now added on its own line, indented like the first entry; it used to land on the bracket line with a trailing space. An empty array (`[ ]`, or `[` and `]` on separate lines) becomes `['storybook-swiss-knife']`.

## [0.1.0] - 2026-10-10

### Added

- `storybook-swiss-knife` Storybook addon (`packages/addon`, Storybook 8.6, 9 and 10): a Visual panel with base/PR screenshots and a changed-pixels overlay, sidebar statuses for changed and failed stories, and `visual:*` tags, from the report published next to the PR preview. The fixture end-to-end test builds it into the head Storybook and checks it in a browser.
- `npx storybook-swiss-knife init`: writes the caller workflows pinned to a ref, the configuration and the addon registration, creates the approval label, and prints the remaining steps.
- The visual gate adds both results to the PR preview comment (a block the preview publisher keeps), creating the comment when there is none yet. `visual.prComment: false` turns it off.

- Visual regression and accessibility pipeline for pull requests:
  - `runner/`: Playwright + axe runner for a built Storybook (8, 9 and 10), configured by `.storybook/swiss-knife.json`; viewports come from each story's own parameters.
  - `.github/workflows/visual.yml` (untrusted, read-only): builds the head Storybook once, builds the base only when cached baselines are missing, screenshots in shards, and uploads a results bundle. Pushes to `visual.baselineBranches` capture baselines; the approval label reuses the commit's results.
  - `.github/workflows/visual-gate.yml` (trusted, from the default branch): posts the required `swiss-knife / visual` and `swiss-knife / accessibility` check runs using the default branch's configuration, withdraws stale approvals (label older than the commit) and publishes the report to `<preview_root>/pr-<N>/visual/`.
  - `actions/visual-capture` and `actions/visual-report` composite actions.
  - End-to-end fixtures (`npm run test:fixture -- test/fixtures/<name>`) for Storybook 8 + Vue (npm), 9 + React (pnpm) and 10 + Vue (yarn).
  - Removed stories (a baseline without a story) need approval like changes; skipped stories and runner errors are reported separately.
  - The gate can require the run to come from the caller workflow, unchanged from the default branch (`caller_workflow`, `protected_paths`). See `docs/visual-regression.md` for setup and the threat model.
  - Local CLI: `runner/cli.js visual [--update] [--docker]`, `a11y --update-baseline`.

- Visual regression and accessibility result processing, ported from kinboo2.0 as zero-dependency modules: `src/visual/results.js` (classifies merged Playwright results), `src/visual/gate.js` (gate decision and summary, with a configurable approval label), `src/visual/manifest.js` (Storybook gallery manifest), `src/visual/shard.js` (story sharding, same assignment as kinboo2.0) and `src/a11y/report.js` (axe report evaluation against the node-count baseline, baseline builder and summary). The accessibility gate recomputes which violations are new from raw node counts instead of trusting the runner.

- `actions/toolkit`: exposes this repository's source to later steps of a job (`SWISS_KNIFE_ROOT`), so trusted scripts never need a checkout of this repository.

- `.storybook/swiss-knife.json` configuration with a JSON schema (`schema/swiss-knife.schema.json`): `pages` (the storybook-github-pages keys), plus validated `visual`, `a11y` and `passcode` sections with defaults. `.storybook-pages.yml` still works for `pages` and logs a deprecation warning; when both files exist the JSON file wins.

### Changed

- The PR preview comment marker is now `<!-- swiss-knife:pr-<N> -->`. An existing storybook-github-pages comment (`<!-- storybook-pages-preview:pr-<N> -->`, including its expiry block) is found and rewritten in place, so upgrading never posts a second comment.
- Composite actions moved under `actions/` (`actions/preview-build`, `actions/preview-publisher`, `actions/publisher`, `actions/preview-cleanup`, `actions/preview-janitor`). The root action stays at the repository root.

### Fixed

- The preview publisher and the visual gate could overwrite each other's part of the shared PR comment when they finished together. Each now reads the comment back and writes again when its part was replaced.
- Addon: a report published while the preview was open never showed sidebar statuses (the missing manifest was cached until reload); it is now asked for again every 30 s. The Storybook 9 manager stops polling once statuses are set, and the changed-pixels overlay no longer throws for a cross-origin gallery without CORS.
- Addon preset: falls back to the Storybook next to the addon when the directory Storybook runs in cannot resolve it (monorepo roots).
- `init`: never overwrites `.storybook/swiss-knife.json`, even with `--force`; installs Yarn 1 projects with `--frozen-lockfile`; keeps an existing approval label instead of restyling it.
- Closing a fork pull request queued a full cleanup in the Pages group although forks never get a preview; the cleanup job now skips them.
- A publish that waited in the Pages queue compared against the PR head read before the wait, so it could overwrite a newer preview or, for a PR closed meanwhile, bring back a removed one. The publish job now re-reads the PR head and state after the wait (`skip-stale`, new `skip-closed`); re-running only the publish job is safe again.
- PR preview publishes, cleanups and janitor runs were dropped when several queued at once: the shared `storybook-pages-<owner>/<repo>` group kept only one pending run and cancelled it when another arrived. Every Pages writer now sets `queue: max`, so up to 100 runs wait their turn (ported from storybook-github-pages PR 180).
- Re-running a visual run failed both checks with "no results": each attempt uploads the results bundle under the same name, and the gate required exactly one. It now uses the latest attempt's bundle.
- A screenshot shard on a different runner image version than the plan job (common during image rollouts) found no baselines and failed. Shards now fall back to the same commit's baselines from another image version, with a warning; the cache key puts the shard before the image version so that fallback stays per shard (existing caches are rebuilt once).
- PR preview builds got a base URL without `preview_root` (`/<repo>/pr-<N>/`) while the publisher writes them to `<preview_root>/pr-<N>/`, so assets 404'd unless `preview_root` was `.`. `computeBaseUrl` now includes the preview root, passed from the resolved configuration by `deploy-storybook.yml` and the root action.
- Reusable workflows ran `./src/*.js` of the checked-out repository, which in a consumer is the consumer's own code: `deploy-storybook.yml` failed outright, and the publish, cleanup and janitor configuration steps imported a consumer's `src/config.js` when one existed, or fell back to a minimal line parser that ignored most settings. They now always run this repository's scripts through `actions/toolkit` and read the full configuration.
- The publish gate no longer checks out this repository to load the run-context resolver; it uses the pinned toolkit, which also works while the repository is private.

- Imported `storybook-github-pages` 1.11.0 as the starting point and renamed every reference to `Archetipo95/storybook-github-swiss-knife`. Internal action pins point at this repository.

## [1.11.0] - 2026-10-01

### Added

- **Bundle Size Audit**: New opt-in `audit_bundle_size` and `bundle_size_max_mb` inputs on the reusable workflow, composite action, `preview-build` action and `.storybook-pages.yml`. The audit (`src/audit-static.js`, no dependencies) reports total and estimated gzip size, a per-type breakdown (JavaScript, CSS, fonts, images and more) and the 10 largest assets in `$GITHUB_STEP_SUMMARY`, saves `audit/bundle-size.json`, and fails the build when the budget is exceeded. PR preview comments show the bundle size, recomputed by the trusted publisher and compared with the base branch.
- `cname` input for directory mode that writes a validated `CNAME` at the Pages branch root. Artifact mode warns instead, because GitHub ignores `CNAME` files in Actions-deployed artifacts; configure the domain in repository Settings → Pages ([#45](https://github.com/Archetipo95/storybook-github-pages/issues/45)).
- CodeQL code scanning for JavaScript and GitHub Actions workflows.
- `Release Tags` workflow that creates the `vX.Y.Z` tag automatically when a version bump lands on `main` (after tests pass and the lockfile and changelog agree) and keeps the major tag on the newest release.
- Test that fails when a `run:` script interpolates `${{ }}` values directly instead of passing them through `env:`.
- Tests that fail when a workflow passes an input its pinned internal action does not declare, and (at release time) when an internal pin runs older action or `src/` code than the release.

### Changed

- **Node.js 24 is now the runtime.** The composite action and the reusable deploy workflow install Node.js 24 (was 20, which reached end of life in April 2026) before running your install and build commands. Storybook builds run by this action must support Node.js 24. `engines.node` is now `>=24.0.0`.
- The reusable deploy, PR preview publish, cleanup, and janitor workflows now pin their internal actions to the v1.11.0 code. Previously they ran code from earlier releases, so the reusable workflows did not yet include the CNAME fix, the PR-comment bundle size, or the janitor and git-argument hardening.
- `npm run prepare-release` moves internal action pins to the release base commit automatically.

### Fixed

- Directory mode root publishes no longer delete the Pages branch's `CNAME` file, which could reset the custom domain and break certificate renewal. Set `preserve_cname: false` to restore the previous behaviour ([#45](https://github.com/Archetipo95/storybook-github-pages/issues/45)).
- Pass the custom install command and deploy-workflow smoke-test/`.nojekyll` paths to shell steps through `env:` instead of interpolating them into the script source.
- Composite actions read their install path from `$GITHUB_ACTION_PATH` instead of interpolating `${{ github.action_path }}` into shell scripts.
- Reject relative directories that normalize to `..` (for example `feature/../..`) in target, preview-root, and base-ref resolution.
- `.storybook-pages.yml` keys `__proto__`, `constructor`, and `prototype` are rejected instead of polluting `Object.prototype`.
- Pages branch names starting with `-` are rejected, and the git branch writer refuses unsafe branch names before running `git`.
- Base-ref slash trimming runs in linear time instead of using a regex that is slow on long runs of `/`.
- Preview janitor no longer fails the sweep when it cannot update a preview comment's expiration note.

## [1.10.0] - 2026-10-01

### Changed

- Update `actions/cache` from v4.2.3 to v6.1.0 in the reusable deploy workflow (requires Actions Runner 2.327.1+ on self-hosted runners).
- Update the reusable deploy workflow's internal `publisher` pin to v1.9.14.
- Update the PR preview janitor workflow's internal `preview-janitor` pin to v1.9.6.
- Update dev dependencies: eslint 10.11.0, prettier 3.9.9.

### Fixed

- **Passcode Gate Unlock Across Frames and Tabs**: Unlocking the manager now also reveals the same-origin story preview iframe (via the `storage` event, with a same-origin `postMessage` fallback), so the canvas no longer stays gated until a reload. The unlock expiry is stored in `localStorage`, so `passcode_session_hours` applies across tabs and browser restarts. The gate form also includes a hidden username field so password managers can save the passcode.

## [1.9.14] - 2026-09-25

### Fixed

- Apply coverage include/ignore filters to stats history so `history.json` and `history.svg` match badge coverage metrics.

## [1.9.13] - 2026-09-24

### Changed

- Update the reusable PR preview publish workflow's internal `preview-publisher` pin so PR preview graphs use the component-only red/green renderer.

## [1.9.12] - 2026-09-24

### Changed

- Plot total components in red and covered components in green in `stats/history.svg`; story counts remain in badges and JSON but are no longer plotted.

## [1.9.11] - 2026-09-24

### Changed

- Update the reusable PR preview publish workflow's internal `preview-publisher` pin so PR preview graphs also use compact stats graph rendering.

## [1.9.10] - 2026-09-24

### Changed

- Render `stats/history.svg` with metric-changing snapshots plus the latest snapshot, while keeping `stats/history.json` as the complete deployment ledger.

## [1.9.9] - 2026-09-24

### Fixed

- Prevent preview metadata test fixtures from leaking synthetic PR numbers and SHAs into real CI job summaries.
- Make reusable PR preview cleanup tolerate missing numeric `pr_number` inputs and optional post-cleanup Pages/comment update failures.
- Update the reusable cleanup workflow's internal `preview-cleanup` pin so consumers receive the resilient cleanup behavior.

## [1.9.8] - 2026-09-24

### Fixed

- **Preview Cleanup Rebuild Resilience**: Closing a PR still removes its preview directory and updates preview metadata, but a transient GitHub Pages rebuild failure for that intermediate cleanup commit is now reported as an explicit warning instead of failing the whole cleanup workflow. This avoids false-negative cleanup runs when a production deploy immediately follows and succeeds.

## [1.9.7] - 2026-09-24

### Added

- **Lean Testing Strategy and Demo Canary Flow**: Documented the native `node:test` testing strategy, added focused smoke-test coverage for Storybook story glob selection and missing-story failures, and added a release checklist that validates candidate refs through the external `storybook-vue-demo` Action Canary workflow before tagging.

## [1.9.6] - 2026-09-23

### Fixed

- **Reference/demo workflows now exercise the smoke-test gate**: `pr-preview-build.yml` enables `smoke_test: 'true'` on both the root composite action and the `preview-build` action so every PR to this repository actually runs the opt-in Playwright smoke test end to end, instead of only shipping the feature unused. The bundled `test/fixtures/sample-storybook` fixture now includes a minimal story-sidebar element so the smoke test's manager/sidebar assertion has something to find. Also fixed a bug where the smoke test's Playwright bootstrap loader imported the CJS entry point by file path, bypassing `package.json` `"exports"` conditions and losing the top-level `chromium` export, causing every real (non-mocked) smoke test run to fail with "Cannot read properties of undefined (reading 'launch')".

## [1.9.5] - 2026-09-23

### Added

- **Optional Playwright Smoke-Test Gate (#48)**: Added `smoke_test`, `smoke_test_stories`, and `smoke_test_timeout_ms` inputs. When enabled, built Storybook output is served on loopback and checked with Playwright for manager/sidebar mounting, canvas loading, browser errors, failed requests, and selected story ids before validation or publishing.

## [1.9.4] - 2026-09-22

### Fixed

- **Stale `preview-publisher` Internal Pin Reintroduced the Pre-#124 Recompute Bug (#126)**: `.github/workflows/pr-preview-publish.yml` pinned the `preview-publisher` composite action to a commit predating #124's stats-snapshot-preservation fix. Because GitHub Actions resolves a SHA-pinned sub-action independently of the reusable workflow's own tag, every v1.9.2/v1.9.3 consumer kept running the old recompute logic and continued to see coverage collapse to 100% on PR previews, even though the fix had already shipped. Repinned `preview-publisher` to a commit that contains the #124 fix, and added a content-level regression test (`test/action-pin-integrity.test.js`) that inspects the pinned commit's actual `src/preview-publish.js`/`src/generate-stats.js` source for the fix markers, rather than only checking the pinned commit exists.

## [1.9.3] - 2026-09-22

### Fixed

- **Preview Stats Snapshot Preservation (#124)**: Trusted preview publishing no longer recomputes current-PR component/coverage metrics from the checked-out (source-less) static output directory, which previously undercounted `totalComponents` and reported inflated coverage. It now reuses the untrusted build's own accurate current-PR snapshot from the artifact's `stats/history.json`, merging it with the trusted base Pages history. Stats regeneration is skipped, rather than fabricated, when the artifact has no snapshot.

## [1.9.2] - 2026-09-22

### Fixed

- **Reusable Workflow Resolver Checkout (#122)**: The `PR Preview Publish` reusable workflow's `gate` job now explicitly checks out this repository (pinned to a commit) before importing its pull-request-identity resolver, instead of relying on an ambient `actions/checkout` that resolves to the _caller's_ repository when invoked via `workflow_call`. This fixes a v1.9.1 regression where any consumer repository failed with `Cannot find module '.../src/resolve-run-context.js'`.

## [1.9.1] - 2026-09-22

### Fixed

- **PR Preview Stats History (#120)**: Trusted preview publishing now regenerates growth statistics only after provenance and digest validation, using the Pages history for the pull request's base ref instead of artifact-provided or unrelated root history. Custom `stats_directory` and `generate_stats_graph` settings are forwarded through the reusable workflow.

### Changed

- **Internal Action Pins (#120)**: Refreshed the reusable deployment, preview cleanup, preview janitor, and preview publisher workflows to reviewed implementation commits containing the v1.9.0 release and stats-history fix.

## [1.9.0] - 2026-09-22

### Fixed

- **Explicit Pages Rebuild Verification (#109)**: Explicit rebuilds now wait for GitHub Pages to successfully build the exact commit pushed to the Pages branch, failing with diagnostics when the build is missing, errored, or cannot be queried.
- **PR Preview Identity Provenance (#115)**: Trusted preview publication now derives the pull request number from the run's exact uploaded artifact and cross-checks it against GitHub's associated pull requests, avoiding ambiguous `pull_requests[0]` resolution when multiple pull requests share a head SHA.

### Added

- **Reusable Workflow Build Caching (#43)**: Added opt-out dependency caching for npm, Yarn, pnpm, and Bun plus Storybook compilation caches, with configurable cache key prefixes. Untrusted PR preview builds remain cache-free.
- **Trusted PR Preview Passcode Gate**: Added optional `enable_passcode_gate`, `passcode_session_hours`, and trusted `passcode_hash` inputs to the reusable PR preview publisher and `preview-publisher` action. The hash stays in the trusted publisher context, while the existing gate injector runs only after provenance and content-digest validation and immediately before publication.

### Changed

- **GitHub Actions Dependency Updates**: Updated the Pages artifact upload and deployment actions to v5 and refreshed the Prettier development dependency to 3.9.7. Internal publisher, preview cleanup, and preview janitor pins were advanced to the reviewed release commit.

## [1.8.3] - 2026-09-15

### Fixed

- **Directory Publisher Release Pin**: Updated the reusable directory deployment workflow to pin the `publisher` action to the reviewed release commit containing the shared Pages branch writer, so directory deployments use the same serialized write, retry, and rebuild behavior as other branch mutations.
- **Release Metadata**: Aligned package metadata and all documented action examples with the current stable release.

## [1.6.1] - 2026-09-15

### Fixed

- **Interaction-Test Badge Action Input**: Exposed the documented `test_results_path` input in the `publisher` and `preview-build` composite actions so consumers can generate `tests.svg` and `tests.json` badges.
- **PR Preview Cleanup Permissions (#90)**: Granted `deployments: write` to the reusable cleanup and janitor workflows and documented the permission for direct composite-action consumers, preventing successful preview removals from failing during deployment deactivation.

## [1.6.0] - 2026-09-14

### Added

- **Optional Storybook Passcode Gate**: Added a zero-dependency browser passcode prompt for published `index.html` and `iframe.html` documents, with configurable session duration, `robots.txt`, and `noindex, nofollow, noarchive` metadata. This is a casual privacy measure, not access control; static assets remain publicly fetchable.
- **Interaction-Test Badges and Preview Results**: Added `test_results_path` support for common JSON test-result shapes, generated `tests.svg`/`tests.json` badges and overview metrics, and included test totals in PR preview comments.
- **Base-Ref Metrics Resolution**: PR preview comments now read baseline metrics from the Pages directory associated with the PR base ref, including explicit ref-to-directory mappings and non-root branch-backed deployments.
- **Dynamic SVG Badges & Endpoints (`src/generate-badges.js`) (#53)**: Automatically extracts Storybook metadata (total stories, unique components, and Storybook version from `index.json` or `stories.json`) and renders pixel-perfect flat Shields.io-style SVG badges (`storybook.svg`, `stories.svg`, `components.svg`, `status.svg`) and Shields.io JSON endpoints into the `<badges_directory>/` folder (`badges/`). Configurable via `generate_badges` (default: `true`) and `badges_directory` (default: `badges`).
- **ESLint & Prettier Tooling**: Added ESLint 10 with flat config (`eslint.config.js`) and Prettier 3 (`.prettierrc`, `.prettierignore`) with `npm run lint`, `npm run format`, and `npm run format:fix` scripts, integrated into CI (`ci.yml`).
- **Node.js Engine Specification**: Defined `"engines": { "node": ">=20.0.0" }` in `package.json` for explicit runtime version compatibility.
- **Reusable Untrusted PR Preview Bundle Action (`preview-build/action.yml`)**: Public, supported composite action for the unprivileged `pull_request` build job. Accepts an already-built static Storybook directory and the job's own pull request event context, validates the output with `validate-artifact.js`, and stages/uploads the deterministic `storybook-preview-pr-<PR>-run-<run>` artifact (`storybook/` + `preview-metadata.json` with SHA-256 digest binding) via `preview-metadata.js` - reusing the same internals the trusted publisher independently re-validates, so consumers never need to copy or reimplement metadata-generation logic. The artifact name is **not configurable**: it is always derived from the validated pull request number and run id, so this untrusted action can never emit outside the exact namespace the trusted publisher expects. Requires only the default `contents: read` build-job permission; never references secrets/tokens, never checks out or writes to the Pages branch, and cannot be repurposed as a trusted publisher component. All nested actions (`actions/upload-artifact`) are pinned to full commit SHAs. The repository's own reference `pr-preview-build.yml` workflow now dogfoods this action instead of calling `src/preview-metadata.js` inline.
- **Reusable Trusted PR Preview Publisher Workflow and Action (`.github/workflows/pr-preview-publish.yml` & `preview-publisher/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action (`preview-publisher`) for trusted `workflow_run` preview publishing with complete provenance validation (workflow identity, completed success event, repository, same-repo PR association, base ref, current live head SHA, artifact name/schema, metadata/digest binding, and trusted target resolution) without requiring consumers to check out PR-controlled source or duplicate internal publishing orchestration.
- **Bun Package-Manager Support**: The reusable deployment workflow accepts `package_manager: bun`, defaults to `bun install --frozen-lockfile` and `bun run build-storybook`, and provisions SHA-pinned `oven-sh/setup-bun` only in its read-only build job. The deploy-capable composite action intentionally excludes Bun.
- **Reusable PR Preview Cleanup Workflow and Action (`.github/workflows/pr-preview-cleanup.yml` & `preview-cleanup/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action for trusted closed-PR preview cleanup without requiring consumers to check out platform source or duplicate internal scripts.
- **Reusable Stale-Preview Janitor Workflow and Action (`.github/workflows/pr-preview-janitor.yml` & `preview-janitor/action.yml`)**: Expose reusable workflow (`workflow_call`) and supported composite action for scheduled and manual reconciliation of stale or orphaned PR previews according to retention configuration.
- **Repository-Root Preview Layout Support (`preview_root: ''`)**: Support empty string `preview_root` across configuration resolution, metadata validation, trusted publication, close cleanup, and janitor pruning, safely managing `pr-<number>` directories directly at the Pages branch root while strictly preserving production root assets and named environments.
- **External Consumer Lifecycle Regression Suite (`test/preview-consumer-lifecycle.test.js`)**: End-to-end regression tests verifying untrusted build artifact creation, trusted artifact transfer in non-git environments, provenance validation, idempotent bot comments, stale-run skipping, PR close cleanup, and root layout lifecycle.

### Fixed

- **Redundant Pages Rebuild Requests**: Directory and preview publishing no longer request an explicit Pages rebuild by default after a successful branch push; `trigger_pages_rebuild` remains available for non-standard Pages configurations.
- **Existing Robots Metadata**: The passcode gate replaces pre-existing robots directives so an indexable `robots` meta tag cannot override the documented noindex behavior.
- **Stale `preview-publisher` Internal Release Pin (#35)**: `.github/workflows/pr-preview-publish.yml` invoked `Archetipo95/storybook-github-pages/preview-publisher@6fdc8e3...` (v1.1.0), a commit that predates the `preview-publisher` action's introduction, causing every trusted preview publication to fail at action resolution (`Can't find action.yml`) before any provenance gates or Pages writes ran. Repinned to the current compatible commit (`d46e4b2...`, `v1.3.0`) which contains `preview-publisher/action.yml` and the `src/preview-publish.js` it depends on. Audited all other internal `Archetipo95/storybook-github-pages/<subaction>@<sha>` pins (`publisher`, `preview-cleanup`, `preview-janitor`) and confirmed they already resolve correctly. Added `test/action-pin-integrity.test.js`, which `git show`s every pinned commit locally to assert the referenced action path actually exists there, so an internal stale pin cannot silently pass CI again; `ci.yml` now checks out full history (`fetch-depth: 0`) so this validation has the commit objects it needs.
- **PR Preview Artifact Download Without Git Checkout**: Clarified and documented artifact download requirements for trusted `workflow_run` preview publishers. When downloading untrusted build artifacts without a local Git checkout (to preserve security invariants), `actions/download-artifact@v4` with `run-id` and `github-token` or `gh run download` with `GH_REPO` / `--repo` prevents `fatal: not a git repository` errors.
- **PR Preview Cleanup Missing Branch Graceful Skip**: When a repository has not initialized or configured a Pages branch, PR preview close cleanup (`pr-preview-cleanup.yml`) safely and noiselessly skips without failing the workflow.

### Documentation

- **Directory Rebuild Behavior**: Documented `trigger_pages_rebuild` and clarified that branch-based Pages normally rebuild automatically after a push.
- **Directory Mode Integration via Dedicated Publisher Action**: Investigated generic `startup_failure` runs when external consumers invoke multi-job reusable workflows in directory mode (#24). Documented the GitHub Actions platform limitation where caller permission validation evaluates all jobs in a reusable workflow graph at startup, causing runs to be rejected when callers only grant mode-specific permissions (`contents: write`, `pages: write`). Clarified and documented the supported two-job architecture for directory deployments using `publisher@v1.0.1` directly.

### Changed

- **CI Branch Triggers**: Push validation now runs only on `main`; feature branches continue to receive validation through pull-request workflows without duplicate push checks.

---

## [1.0.0] - 2026-09-12

### Added

- **Reusable Workflow (`.github/workflows/deploy-storybook.yml`)**: Turnkey pipeline for building, validating, and deploying static Storybook builds to GitHub Pages with minimal caller setup.
- **Composite Action (`action.yml`)**: Flexible composite action for existing CI/CD workflows, fully supporting artifact deployment and validation.
- **Trusted Directory Mode (`mode: directory`)**: Atomically updates specific directories on a branch-backed GitHub Pages repository (e.g., `gh-pages`) with locking, retry logic, and preserved sibling directories.
- **PR Preview Lifecycle**:
  - `pr-preview-build.yml`: Unprivileged PR build workflow (`contents: read` only, no secrets) supporting fork PRs safely.
  - `pr-preview-publish.yml`: Privileged `workflow_run` publisher enforcing strict provenance checks, same-repository validation, and stale-run protection before publishing to `<preview_root>/pr-<number>`.
  - `pr-preview-cleanup.yml`: Metadata-only PR closure cleanup workflow (`pull_request_target`) that removes PR preview directories without checking out PR code.
  - `pr-preview-janitor.yml`: Scheduled and manual workflow for pruning abandoned or aged PR previews according to `preview_retention_days`.
  - **Idempotent Bot Comment**: Single, updated-in-place PR preview comment authored by `github-actions[bot]` identified by a stable hidden HTML marker.
- **Artifact Validation Safeguards**: Built-in verification (`src/validate-artifact.js`) ensuring target directories exist, contain non-empty static assets (`index.html` or `.html`/`.js`), contain no nested `.git` repositories, and do not escape workspace boundaries via symlinks or relative path traversal.
- **Bitovi Compatibility**: 100% input parameter parity with `bitovi/github-actions-storybook-to-github-pages` (`path`, `checkout`, `install_command`, `build_command`, `custom_install_command`, `custom_build_command`).
- **Configuration File Support (`.storybook-pages.yml`)**: Centralized YAML configuration for project-wide deployment settings.
- **Security Hardening**:
  - Full 40-character commit SHA pins for all third-party GitHub Actions.
  - Job-scoped minimal permissions (`contents: read`, `pages: write`, `id-token: write`).
  - Strict isolation for fork pull requests and unprivileged builds.
  - Zero runtime npm dependencies and zero external telemetry or tracking.
