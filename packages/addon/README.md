# storybook-swiss-knife

Storybook addon and setup CLI for [storybook-github-swiss-knife](https://github.com/Archetipo95/storybook-github-swiss-knife):
Pages deploys, PR previews, and visual regression plus accessibility checks on every pull request.
Storybook 8.6, 9 and 10.

```sh
npx --yes https://github.com/Archetipo95/storybook-github-swiss-knife/releases/download/v0.8.0/storybook-swiss-knife-0.8.0.tgz init
```

The addon isn't on npm yet: run `init`, and install the addon, from the tarball attached to each
release.

`init` writes the caller workflows pinned to this package's release, `.storybook/swiss-knife.json`
and the addon registration, creates the approval label, and prints the remaining steps.

The addon adds a **Visual** panel (a summary of the pull request's report and what it still needs,
base and PR screenshots with a changed-pixels overlay, and a notice when the report is for an older
commit than the preview) and sidebar statuses for changed and failed stories, read from the report
published next to the PR preview.

See [Visual regression and accessibility](https://github.com/Archetipo95/storybook-github-swiss-knife/blob/main/docs/visual-regression.md).

MIT
