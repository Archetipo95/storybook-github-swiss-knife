# Development & Testing

This repository uses native Node.js tests:

```bash
npm test
npm run test:coverage
```

Keep test coverage focused on the action/workflow surface:

- use unit tests for pure JavaScript logic such as config parsing, artifact validation, preview metadata, publishing decisions, badges/stats, cleanup, and janitor behavior;
- use contract tests for `action.yml`, reusable workflow inputs, permissions, and pinned third-party actions;
- use the lightweight Storybook fixture in `test/fixtures/sample-storybook` for smoke/integration behavior.

Current native Node coverage baseline:

| Metric    | Coverage |
| --------- | -------- |
| Lines     | 85.89%   |
| Branches  | 76.32%   |
| Functions | 83.71%   |

Release-critical feature coverage is tracked as a checklist instead of a fake percentage:

| Surface                        | Coverage signal                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| Root composite action contract | `test/action-contract.test.js`, `test/action-pinning.test.js`                         |
| Reusable workflow permissions  | `test/preview-workflow-security.test.js`                                              |
| Internal action SHA pins       | `test/action-pin-integrity.test.js`                                                   |
| Config resolution/validation   | `test/config.test.js`                                                                 |
| Artifact validation            | `test/validate-artifact.test.js`                                                      |
| Badges and stats generation    | `test/generate-badges.test.js`, `test/generate-stats.test.js`                         |
| PR preview build metadata      | `test/preview-build-action.test.js`, `test/preview-metadata.test.js`                  |
| Trusted preview publishing     | `test/preview-publish*.test.js`, `test/preview-publisher.test.js`                     |
| Preview comments/deployments   | `test/preview-comment.test.js`, `test/github-deployments.test.js`                     |
| Cleanup and janitor lifecycle  | `test/preview-cleanup.test.js`, `test/preview-janitor.test.js`                        |
| End-to-end consumer lifecycle  | `test/preview-consumer-lifecycle.test.js` plus the `storybook-vue-demo` Action Canary |
| CI fixture environment hygiene | `test/ci-env-hygiene.test.js`                                                         |
| Shell-input boundaries         | `test/workflow-hardening.test.js`                                                     |
| Release tag policy             | `test/release-tag.test.js`                                                            |
| Workflow source at its pin     | `test/workflow-pin-sources.test.js`                                                   |

Do not add Jest or Vitest to this action repository unless native `node:test` stops covering a concrete need. Consumer-level validation belongs in [`Archetipo95/storybook-vue-demo`](https://github.com/Archetipo95/storybook-vue-demo), which exercises this action from a real Vue/Vite/Storybook project. Before a release, run this repository's CI and validate the candidate ref in the demo repository.

Release checklist:

1. On a branch from the latest `main`, run `npm run prepare-release -- <version>`. It bumps the version (root and `packages/addon`) and release refs, moves the Unreleased changelog notes under the new version, and moves the reusable workflows' internal action pins to the branch's merge base with `origin/main` (a squash merge drops the branch's own commits, so pins never point at them). It refuses when the branch's own commits change `src/`, `actions/` or `runner/`: merge those to `main` first. Review the changelog section.
2. Confirm this repository's CI and CodeQL checks are green.
3. Run the `storybook-vue-demo` Action Canary workflow against the candidate branch, tag, or SHA.
4. Merge the release PR. The `Release Tags` workflow sees the new `package.json` version on `main`, re-runs the tests, checks `package-lock.json` and `CHANGELOG.md` agree, then creates `vX.Y.Z` and moves the major tag (`v1`) to it. Do not tag by hand. If the checks fail, `main` shows a failed `Release Tags` run and no tag is created. Every later push to `main` also moves `v1` back onto the newest release if it has drifted; it never moves it backwards.
5. The `Release Tags` workflow attaches the addon tarball (`storybook-swiss-knife-X.Y.Z.tgz`, packed from the tagged commit) to the GitHub release. Publish it to npm from the tag too: `git checkout vX.Y.Z && cd packages/addon && npm publish` (`prepack` builds `dist/`). `npx storybook-swiss-knife init` pins workflows to `v<addon version>`, so publish only after the tag exists.
6. Update the demo repository's stable action refs after the tag exists.

### Workflows and the pinned toolkit

The reusable workflows load this repository's source through the `toolkit` action, pinned to a
commit on `main`, so a workflow step runs the source at that pin rather than the source next to
the workflow file. A workflow that starts using a module or an export that is newer than its pin
breaks on `main` (`ERR_MODULE_NOT_FOUND`, or "is not a function") until the pins move. CI fails
on that: `test/workflow-pin-sources.test.js` checks every path and named export each job takes
from `SWISS_KNIFE_ROOT` against that job's toolkit pin.

So a change whose workflows need new source takes two pull requests:

1. The source and its tests, with no workflow using it yet.
2. After that merges, on a branch from the latest `main`: `npm run bump-pins`, then the workflow
   change. `bump-pins` moves the internal action pins to the branch's merge base with
   `origin/main`, like `prepare-release` but without a version or changelog change, and refuses
   the same way when the branch's own commits change `src/`, `actions/` or `runner/`.

A release (`prepare-release`) moves the pins as well, so a workflow change can also wait for one.

---
