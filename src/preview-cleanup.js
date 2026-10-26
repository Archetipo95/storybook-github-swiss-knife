import fs from 'node:fs/promises';
import path from 'node:path';
import { resolvePreviewTarget } from './preview-metadata.js';
import { normalizeRelativeDirectory, resolveConfiguration, validateRelativeDirectory } from './config.js';
import { withSerializedBranchWrite, requestPagesRebuild } from './git-branch-writer.js';
import { updatePreviewCommentStatus } from './preview-comment.js';
import { deactivateDeploymentsForPullRequest } from './github-deployments.js';

async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * `additional_paths`: one directory per line, `{pr}` replaced by the PR number. Each must name
 * `{pr}`, so a closed PR never removes a shared directory, and stay inside the Pages branch.
 */
export function resolveAdditionalPaths(additionalPaths, prNumber) {
  return String(additionalPaths ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      if (!line.includes('{pr}')) throw new Error(`additional_paths "${line}" must contain {pr}`);
      // `..` could drop the {pr} segment: `pr-preview/pr-{pr}/..` is the whole preview root.
      if (line.split(/[\\/]/).includes('..')) throw new Error(`additional_paths "${line}" must not contain ..`);
      const target = line.replaceAll('{pr}', String(Number(prNumber)));
      validateRelativeDirectory(target, 'additional_paths');
      return normalizeRelativeDirectory(path.posix.normalize(target.replaceAll('\\', '/')));
    });
}

/**
 * Removes exactly one PR's preview directory, plus any `additionalPaths` for that PR, from a
 * checked-out Pages branch in one commit. This is metadata-only: the caller supplies nothing but a
 * PR number and the (already validated) preview root and paths, never any PR-controlled file
 * content. A missing directory is treated as a successful no-op so cleanup remains idempotent
 * across retries and duplicate close events.
 */
export async function removePreviewDirectory({
  repo,
  branch = 'gh-pages',
  previewRoot = 'pr-preview',
  prNumber,
  additionalPaths = ''
}) {
  const target = resolvePreviewTarget({ previewRoot, prNumber });
  const targets = [target, ...resolveAdditionalPaths(additionalPaths, prNumber)];
  if (!(await pathExists(repo))) {
    return { target, removed: [], changed: false, skipped: true, reason: 'Pages repository directory does not exist' };
  }
  let removed = [];
  const result = await withSerializedBranchWrite({
    repo,
    branch,
    commitMessage: `Remove Storybook preview for closed PR #${Number(prNumber)}`,
    mutate: async repoPath => {
      removed = [];
      for (const relative of targets) {
        const full = path.join(repoPath, relative);
        if (!(await pathExists(full))) continue;
        await fs.rm(full, { recursive: true, force: true });
        removed.push(relative);
      }
      return removed.length > 0;
    }
  });
  return { target, removed: result.changed ? removed : [], ...result };
}

export async function requestCleanupPagesRebuild({
  token,
  repository,
  commitSha,
  triggerPagesRebuild = true,
  requestRebuild = requestPagesRebuild
}) {
  // A push to a branch-built Pages site already starts a build; requesting one more duplicates it.
  if (!triggerPagesRebuild) return { ok: true, skipped: true };
  try {
    await requestRebuild({ token, repository, commitSha });
    return { ok: true };
  } catch (error) {
    const message = `Preview cleanup removed the directory, but the optional Pages rebuild failed: ${error.message}`;
    console.warn(message);
    return { ok: false, message };
  }
}

export async function requestCleanupCommentUpdate({
  token,
  repository,
  prNumber,
  updateStatus = updatePreviewCommentStatus
}) {
  try {
    await updateStatus({ token, repository, prNumber, expired: true });
    return { ok: true };
  } catch (error) {
    const message = `Preview cleanup removed the directory, but the optional preview comment update failed: ${error.message}`;
    console.warn(message);
    return { ok: false, message };
  }
}

if (process.argv[1] && process.argv[1].endsWith('preview-cleanup.js')) {
  const config = resolveConfiguration({
    inputs: {
      preview_root: process.env.PREVIEW_ROOT,
      pages_branch: process.env.PAGES_BRANCH
    }
  });

  removePreviewDirectory({
    repo: process.env.PAGES_REPO || process.cwd(),
    branch: config.pages_branch || process.env.PAGES_BRANCH || 'gh-pages',
    previewRoot: config.preview_root,
    prNumber: process.env.PR_NUMBER,
    additionalPaths: process.env.ADDITIONAL_PATHS
  })
    .then(async result => {
      console.log(JSON.stringify(result));
      const prNumber = Number(process.env.PR_NUMBER || 0);
      if (
        result.changed &&
        process.env.GITHUB_TOKEN &&
        process.env.GITHUB_REPOSITORY &&
        Number.isFinite(prNumber) &&
        prNumber > 0
      ) {
        const deploymentEnvironment =
          process.env.DEPLOYMENT_ENVIRONMENT ||
          process.env.ENVIRONMENT_NAME ||
          process.env.ENVIRONMENT ||
          `pr-preview-${prNumber}`;
        await deactivateDeploymentsForPullRequest({
          token: process.env.GITHUB_TOKEN,
          repository: process.env.GITHUB_REPOSITORY,
          environmentName: deploymentEnvironment,
          prNumber,
          description: `Preview cleanup for PR #${prNumber}`
        });
        await requestCleanupPagesRebuild({
          token: process.env.GITHUB_TOKEN,
          repository: process.env.GITHUB_REPOSITORY,
          commitSha: result.commitSha,
          triggerPagesRebuild: process.env.TRIGGER_PAGES_REBUILD !== 'false'
        });
        await requestCleanupCommentUpdate({
          token: process.env.GITHUB_TOKEN,
          repository: process.env.GITHUB_REPOSITORY,
          prNumber: process.env.PR_NUMBER
        });
      }
      if (process.env.GITHUB_STEP_SUMMARY) {
        const message = result.changed
          ? `### Storybook preview cleanup\n\nRemoved ${result.removed.map(item => `\`${item}\``).join(', ')} for the closed pull request.\n`
          : result.skipped
            ? `### Storybook preview cleanup\n\nPages repository does not exist; skipped preview cleanup.\n`
            : `### Storybook preview cleanup\n\nNo preview directory existed at \`${result.target}\`; nothing to remove.\n`;
        await fs.appendFile(process.env.GITHUB_STEP_SUMMARY, message);
      }
    })
    .catch(error => {
      console.error(error.message);
      process.exit(1);
    });
}
