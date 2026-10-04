# Contributing to storybook-github-pages

Thank you for your interest in contributing to `storybook-github-pages`! This project provides security-hardened GitHub Actions and reusable workflows for publishing Storybook builds to GitHub Pages.

---

## Development & Local Setup

### Requirements

- **Node.js**: v20 or higher (matching GitHub Actions runner runtime).
- **npm**: v10 or higher.
- **Git**: v2.30 or higher.

### Installation

Clone the repository and verify the test environment:

```bash
git clone https://github.com/Archetipo95/storybook-github-pages.git
cd storybook-github-pages
npm test
```

_Note: This repository has zero runtime npm dependencies. All runtime logic uses native Node.js ES modules (`node:fs`, `node:path`, `node:test`, `node:assert`, etc.)._

---

## Testing & Quality Assurance

All contributions must pass the full test suite before being merged.

Run all unit and release validation tests:

```bash
npm test
```

Run specific validation scripts manually:

```bash
npm run validate-config
npm run validate-artifact -- "test/fixtures/sample-storybook" "$PWD"
```

### Test Standards

- All new features or bug fixes must include unit tests in `test/`.
- Tests use Node.js native runner (`node --test test/*.test.js`).
- Ensure no external network requests or third-party dependencies are introduced.

---

## Security & Action Pinning Rules

To maintain our security posture:

1. **Full 40-Character SHA Pinning**: All third-party GitHub Actions referenced in workflows or `action.yml` MUST be pinned to a full 40-character commit SHA, with a version comment attached (e.g. `uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683 # v4.2.2`).
2. **Minimal Permissions**: Workflows must explicitly declare minimal job-level permissions (`contents: read` by default).
3. **No Unsanitized Inputs in Shell Execution**: User inputs must pass through `src/config.js` validation or environment variables rather than direct inline expansion in shell scripts.

---

## Commit & Pull Request Guidelines

1. **Branch Naming**: Use descriptive kebab-case branch names (e.g., `fix-preview-janitor-retention`).
2. **Commit Messages**: Keep commit messages clear and descriptive. Include the co-authorship trailer when applicable:
   ```text
   Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>
   ```
3. **Pull Requests**:
   - Ensure all CI checks pass (`npm test`).
   - Describe what changed and why.
   - Reference related issue numbers (e.g. `Fixes #12`).

Thank you for helping make `storybook-github-pages` secure, reliable, and developer-friendly!
