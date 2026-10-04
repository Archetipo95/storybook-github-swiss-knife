# Security Policy

## Supported Versions

| Version    | Supported          |
| ---------- | ------------------ |
| latest 0.x | :white_check_mark: |
| older 0.x  | :x:                |

Until 1.0, only the latest release gets fixes.

---

## Security Model & Design Principles

`storybook-github-swiss-knife` is designed with defense-in-depth principles to safely build and deploy static sites in GitHub Actions environments.

### 1. Least Privilege Permissions

Job permissions are explicitly set to the absolute minimum required for each task:

- **Primary Reusable Workflow & Composite Action**:
  - `contents: read`: Access repository source code.
  - `pages: write`: Upload and publish GitHub Pages deployment artifacts.
  - `id-token: write`: Generate short-lived OpenID Connect (OIDC) JWT tokens for GitHub Pages authentication.
- **Unprivileged PR Build Jobs** (`pr-preview-build.yml`):
  - `contents: read` only.
  - No access to secrets, OIDC tokens, or write permissions.
- **Trusted Publisher Jobs** (`pr-preview-publish.yml`):
  - `contents: write` & `pages: write`.
  - Runs in a separate `workflow_run` context that **never checks out PR code**.

### 2. Fork Pull Request Isolation

Pull requests from external forks execute user-supplied build scripts in an unprivileged runner environment (`contents: read`, no secrets).

The trusted publisher (`pr-preview-publish.yml`) enforces a hard gate:

- `workflow_run.pull_requests[0]` must be non-empty (GitHub populates this array **only for same-repository pull requests**).
- Forked PRs are excluded at the gate before any privileged step executes. Fork builds produce signed-shape artifact metadata, but never gain access to write tokens, Pages deployments, or PR comments.

### 3. Provenance & Stale-Run Verification

Before publishing any preview:

- Metadata from the build run is re-validated against the trusted GitHub Actions context (repository, run ID, event type).
- The target head SHA is checked against the live pull request's current head SHA via the GitHub REST API.
- If a newer commit has been pushed to the PR, older build runs are skipped (`skip-stale`) to prevent out-of-order race conditions.

### 4. Input & Artifact Validation

All user-supplied paths, directory inputs, and built artifacts undergo rigorous path-containment validation:

- Rejects path traversal attempts (e.g. `../`, absolute paths outside workspace).
- Prevents symlinks pointing outside the workspace root.
- Rejects target directories containing nested `.git` or `.github` folders.
- Requires static content (`index.html` or valid HTML/JS/CSS assets) to prevent publishing empty or invalid builds.

### 5. Visual Regression & Accessibility Checks

- The capture (`visual.yml`) runs pull request code with `contents: read`, no secrets, and saves baseline caches only on pushes to the baseline branches.
- The gate (`visual-gate.yml`) runs from the default branch on `workflow_run`, never checks out pull request code, reads its configuration from the default branch, and decides blocking itself from raw results (for example axe node counts against the baseline).
- Results bundles containing symlinks, `.git` or `.github` are rejected, and summaries written from them are escaped.
- With `caller_workflow` and `protected_paths`, a pull request that changes the capture workflow or its configuration gets failing checks.
- The results are produced by pull request code, so they protect against mistakes, not against a malicious author who can change what their Storybook renders. Collaborators with write access can also post check runs. See the threat model in [docs/visual-regression.md](docs/visual-regression.md).
- The Storybook addon only reads the published manifest and screenshots; it sends nothing anywhere.

### 6. Dependency Pinning & No Telemetry

- All third-party GitHub Actions are pinned to full **40-character commit SHAs**, and internal actions to commits of this repository.
- The workflow scripts use Node.js standard modules only. The runner's Playwright and axe versions are pinned by its lockfile, which is part of the baseline cache key; the addon has no runtime dependencies.
- No external tracking, telemetry, or third-party analytics. Only authenticated GitHub API HTTP requests required for the deployment lifecycle (such as Pages deployments, PR head SHA verification, and bot comment updates) are executed.

---

## Reporting a Vulnerability

If you discover a security vulnerability in `storybook-github-swiss-knife`, please report it responsibly:

1. **Do NOT open a public GitHub issue** for security vulnerabilities.
2. Email the maintainer or submit a **Private Security Advisory** via the GitHub repository (`Security > Advisories > Report a vulnerability`).
3. Include details of the vulnerability, steps to reproduce, and affected workflows or configurations.

You will receive an acknowledgment within 48 hours, and security advisories will be published alongside patches in accordance with responsible disclosure practices.
