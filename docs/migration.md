# Migration

## From storybook-github-pages

storybook-github-swiss-knife is its successor: the same inputs and configuration, plus visual
regression and accessibility checks. Pages deploys and PR previews need three changes:

1. Replace `Archetipo95/storybook-github-pages` with `Archetipo95/storybook-github-swiss-knife`
   in your workflows, at a swiss-knife ref.
2. Composite actions moved under `actions/`: `preview-build`, `preview-publisher`,
   `publisher`, `preview-cleanup` and `preview-janitor` become
   `actions/preview-build` and so on. The root action and the reusable workflows keep their
   paths.
3. Optional: move `.storybook-pages.yml` into the `pages` key of `.storybook/swiss-knife.json`
   (see `schema/swiss-knife.schema.json`). The YAML file still works and logs a deprecation
   warning; when both exist, the JSON file wins.

The existing PR comment is taken over (rewritten with the new marker) on the next publish, so no
second comment appears. Preview URLs now include `preview_root` in their base URL; previews
published under a non-default `preview_root` stop 404ing on assets.

To add the visual and accessibility checks, run `npx storybook-swiss-knife init` (it keeps your
existing workflow files unless `--force`), or follow
[Visual regression and accessibility](visual-regression.md).

## From a hand-written visual regression setup

- Required checks are named `swiss-knife / visual` and `swiss-knife / accessibility`: update
  your branch ruleset when you switch.
- An existing axe baseline keeps working if it has the `{ enforcedRules, stories: { <story>: { <rule>: <nodes> } } }`
  shape; point `a11y.baseline` at it.
- Run both setups side by side for a few pull requests, with different approval labels, before
  removing the old one.

## From bitovi/github-actions-storybook-to-github-pages

`storybook-github-swiss-knife` maintains input compatibility with `bitovi/github-actions-storybook-to-github-pages`:

| Bitovi Input      | `storybook-github-swiss-knife` Equivalent    | Notes                                  |
| ----------------- | -------------------------------------------- | -------------------------------------- |
| `path`            | `path`                                       | Identical default (`storybook-static`) |
| `checkout`        | `checkout`                                   | Identical boolean string behavior      |
| `install_command` | `install_command` / `custom_install_command` | Fully supported                        |
| `build_command`   | `build_command` / `custom_build_command`     | Fully supported                        |

**Migrating to `storybook-github-swiss-knife`:**
Simply replace `bitovi/github-actions-storybook-to-github-pages@v1.0.3` with `Archetipo95/storybook-github-swiss-knife@v0.1.0` in your workflow.

---
