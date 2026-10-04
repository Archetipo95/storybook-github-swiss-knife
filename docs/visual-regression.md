# Visual regression and accessibility

Every pull request (Storybook 8.6, 9 or 10; any framework) screenshots every story of your Storybook, compares it with the base
branch, scans it with axe, and posts two required checks: `swiss-knife / visual` and
`swiss-knife / accessibility`. Intended visual changes are accepted with a label.

## Setup

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
    uses: Archetipo95/storybook-github-swiss-knife/.github/workflows/visual.yml@v0.1.0
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
    uses: Archetipo95/storybook-github-swiss-knife/.github/workflows/visual-gate.yml@v0.1.0
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

## How a pull request is checked

- **Visual**: changed screenshots and removed stories (a baseline without a story) need the
  approval label; interaction (play function) failures, render errors and incomplete runs always
  fail. The label counts only if it was added after the current commit's first run, so a later
  push withdraws it automatically.
- **Accessibility**: a violation fails when its rule is enforced (`a11y.enforcedRules`), or
  when it has a blocking impact (`a11y.blockingImpacts`) and fails on more nodes than the
  baseline records for that story and rule. Baseline entries a pull request adds or raises are
  listed in the check, so they are reviewed like code.
- Adding or removing the approval label re-evaluates the commit's results in about a minute;
  nothing is screenshotted again.
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
