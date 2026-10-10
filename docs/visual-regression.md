# Visual regression and accessibility

Every pull request (Storybook 8.6, 9 or 10; any framework) screenshots every story of your Storybook, compares it with the base
branch, scans it with axe, and posts two required checks: `swiss-knife / visual` and
`swiss-knife / accessibility`. Intended visual changes are accepted with a label.

## Setup

`npx storybook-swiss-knife init` writes all of this (and the PR preview workflows) and creates
the label; see `--help`. By hand:

Two small workflow files. A `workflow_run` trigger cannot live in a reusable workflow, so the
trusted half needs its own caller.

```yaml
# .github/workflows/visual.yml
name: Visual
on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
  push:
    branches: [main] # the branches in visual.baselineBranches
concurrency:
  # Label events get their own group, so a label never cancels a comparison.
  group: >-
    visual-${{ github.event.pull_request.number || github.ref }}-${{
    (github.event.action == 'labeled' || github.event.action == 'unlabeled') && 'label' || 'code' }}
  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
permissions:
  contents: read
jobs:
  visual:
    uses: Archetipo95/storybook-github-swiss-knife/.github/workflows/visual.yml@v0.2.1
    permissions:
      contents: read
      actions: read
    with:
      working_directory: '.' # where package.json and .storybook/ are
```

```yaml
# .github/workflows/visual-gate.yml
name: Visual Gate
on:
  workflow_run:
    workflows: ['Visual']
    types: [completed]
permissions:
  contents: read
jobs:
  gate:
    if: github.event.workflow_run.event == 'pull_request'
    uses: Archetipo95/storybook-github-swiss-knife/.github/workflows/visual-gate.yml@v0.2.1
    permissions:
      actions: read
      checks: write
      contents: write
      issues: write
      pull-requests: write
    with:
      caller_workflow: .github/workflows/visual.yml
      # The capture settings are read from the pull request: keep them as reviewed on the base.
      protected_paths: .storybook/swiss-knife.json
    secrets:
      passcode_hash: ${{ secrets.STORYBOOK_PREVIEW_PASSCODE_HASH }} # optional
```

Then:

1. Create the `visual-approved` label (or the `visual.approvalLabel` you configure).
2. Push to a baseline branch once, so baselines are cached.
3. Make `swiss-knife / visual` and `swiss-knife / accessibility` required checks.
4. Optionally commit `.storybook/a11y-baseline.json` with today's known violations
   (`swiss-knife a11y --update-baseline`, see below).

Settings live in `.storybook/swiss-knife.json` (`visual`, `a11y`); see
`schema/swiss-knife.schema.json`. Per story: `parameters.swissKnife.visual` (`skip`,
`maxDiffPixels`, `delay`), Storybook's own viewport parameters/globals, and the a11y
parameters (`a11y.disable` / `a11y.test: 'off'`, `a11y.config.rules`, `a11y.options.rules`,
`a11y.context` / `a11y.element`). Tag a story `skip-visual` to leave it out entirely.

### How sensitive the comparison is

Two settings decide when a screenshot counts as changed (Playwright's own comparison):

- `visual.threshold` (default `0.2`): how different one pixel's colour must be to count as
  changed, from 0 to 1. The difference weighs brightness most, so a colour swap between shades of
  similar brightness can stay under `0.2`. For example, a background changed from `#1d4ed8` to
  `#6d28d9` is reported as unchanged at `0.2` and as changed at `0.1`. Lower it (`0.1` is a good
  start) when such colour changes matter, as in a design system.
- `visual.maxDiffPixels` (default `100`): how many changed pixels a screenshot may have and still
  pass. A small detail, such as rounder corners on a button, can change fewer. Set
  `parameters.swissKnife.visual.maxDiffPixels` on a story to tighten it there.

Lower values catch smaller changes, but also pick up tiny rendering differences, for example after
a runner image update. Changing either value captures new baselines, since they are part of the
baseline cache key.

## Storybook addon

```bash
npm install --save-dev storybook-swiss-knife
```

Every release also carries the addon as an npm tarball, built from the release's commit:

```bash
npm install --save-dev https://github.com/Archetipo95/storybook-github-swiss-knife/releases/download/v<version>/storybook-swiss-knife-<version>.tgz
```

```js
// .storybook/main.js
export default {
  addons: ['storybook-swiss-knife']
};
```

In the PR preview, the addon reads the report published next to it (`visual/gallery/` under
the preview; `STORYBOOK_SWISS_KNIFE_VISUAL_URL` at build time overrides it):

- a **Visual** panel with the base and PR screenshots of the selected story, a toggle, and the
  changed pixels highlighted (the highlight stays on while moving between stories);
- sidebar statuses. Interaction and render failures are errors on every version; Storybook keeps
  stories with an error status in the sidebar under every filter.

How the sidebar is filtered depends on the Storybook version:

- **Storybook 10.4+** (with change detection on, the default): changed stories are `modified`
  and new ones `new`, so Storybook's own sidebar filter (**New**, **Modified**) lists the pull
  request's visual changes against its base branch. That filter has no entry for failures, so the
  addon adds a `visual:failed` tag to failed stories, in the same menu.
- **Older versions**, or change detection turned off: changed stories get a warning, and the
  addon adds what Storybook lacks there: a **Sidebar** select in the Visual panel that narrows the
  sidebar to changed, new or failed stories (8.6, 9 and 10), and `visual:changed`, `visual:new`
  and `visual:failed` tags in the tag filter (8.6 and 10.0–10.3; Storybook 9 does not expose the
  story index to addons).

It stays off in automated browsers. The preview is usually published a few minutes before its
report: until the report appears, the addon checks again every 30 seconds for 20 minutes, then every 5
minutes, and fills the sidebar and the panel without a reload.

## How a pull request is checked

- **Visual**: changed screenshots and removed stories (a baseline without a story) need the
  approval label; interaction (play function) failures, render errors and incomplete runs always
  fail. The label counts only if it was added after the current commit's first run, so a later
  push withdraws it automatically.
- **Accessibility**: a violation fails when its rule is enforced (`a11y.enforcedRules`), or
  when it has a blocking impact (`a11y.blockingImpacts`) and fails on more nodes than the
  baseline records for that story and rule. Baseline entries a pull request adds or raises are
  listed in the check, so they are reviewed like code.
- Adding or removing any label re-evaluates the commit's results in about a minute, with the
  approval label read from the pull request at that moment; nothing is screenshotted again.
  A label run cancelled by a newer label event leaves the checks to the newer run.
- The report and the Storybook gallery are published to `<preview_root>/pr-<N>/visual/`.
- Both results are added to the pull request's preview comment (created if the preview has not
  posted one yet); set `visual.prComment: false` to keep them in the checks only.

## Local runs

```bash
npm run build-storybook
node <swiss-knife>/runner/cli.js visual --update      # capture baselines (on the base branch)
node <swiss-knife>/runner/cli.js visual               # compare, print the checks' summaries
node <swiss-knife>/runner/cli.js a11y --update-baseline
node <swiss-knife>/runner/cli.js visual --docker      # same rendering as the Linux CI runners
```

Screenshots taken on macOS or Windows differ slightly from Linux; use `--docker` (needs Docker)
when comparing with CI.

## Threat model

- `visual.yml` builds and screenshots pull request code with a read-only token and no secrets.
  The trusted `visual-gate.yml` runs from the default branch, never checks out pull request code,
  reads its configuration from the default branch, and posts the required checks.
- Results come from a run of pull request code, so they are only as honest as that code. The
  checks protect against mistakes and unnoticed changes, **not against a malicious author**:
  - With `caller_workflow` (and `protected_paths`), a pull request that changes the visual
    workflow or the protected files compared with its base branch, or runs another workflow
    under the same name, fails the checks. Land such changes in their own pull request.
  - A pull request can still change what its own Storybook renders, or its build scripts.
    Review those changes as usual.
  - Collaborators with write access can post check runs from their own workflows; required
    checks cannot tell those apart from the gate's. Rely on review and branch protection.
  - For forks, keep GitHub's "Require approval for fork pull request workflows" on; fork runs
    get checks but nothing is published.
- The approval label is accepted when added after the head commit's first workflow run; a
  commit pushed within seconds before the label could still be covered.
- The passcode gate on published reports is client-side only: it hides pages, not files.
