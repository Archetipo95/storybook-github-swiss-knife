# Bitovi Migration Guide

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
