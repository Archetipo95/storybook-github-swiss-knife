import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

export const WRITE_LOCK_NAME = '.storybook-pages-write.lock';
const RETRIES = 5;

/**
 * Pause before attempt `attempt + 1` of a rejected write: growing, and randomized so concurrent
 * writers (preview publishes, cleanups, the janitor, visual reports) that collided do not retry in
 * lockstep and collide again.
 */
export const retryDelayMs = attempt => Math.round((attempt + 1) * (500 + Math.random() * 1500));
const PAGES_BUILD_TIMEOUT_MS = 120000;
const PAGES_BUILD_POLL_INTERVAL_MS = 2000;

// Branch names reach `git` as arguments; a leading `-` would be parsed as an
// option and `..` as a revision range, so both are rejected at the sink.
const SAFE_BRANCH_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

export function assertSafeBranchName(branch) {
  if (
    typeof branch !== 'string' ||
    !SAFE_BRANCH_PATTERN.test(branch) ||
    branch.includes('..') ||
    branch.endsWith('/')
  ) {
    throw new Error(`Unsafe Pages branch name: "${branch}"`);
  }
  return branch;
}

export function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', data => {
      stdout += data;
    });
    child.stderr.on('data', data => {
      stderr += data;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) return resolve(stdout.trim());
      // git prints some failures (and every `nothing to commit`) on stdout, so keep both.
      const output = [stderr.trim(), stdout.trim()].filter(Boolean).join('\n');
      const error = new Error(`${command} ${args.join(' ')} failed (exit ${code})${output ? `: ${output}` : ''}`);
      error.exitCode = code;
      reject(error);
    });
  });
}

export async function acquireLock(repo, timeoutMs = 120000) {
  const lock = path.join(repo, WRITE_LOCK_NAME);
  const started = Date.now();
  while (true) {
    try {
      await fs.mkdir(lock);
      return async () => fs.rm(lock, { recursive: true, force: true });
    } catch (error) {
      if (error.code !== 'EEXIST' || Date.now() - started > timeoutMs) {
        throw new Error(`Unable to acquire Pages branch write lock: ${error.message}`);
      }
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
}

function pagesHeaders(token) {
  return {
    authorization: `token ${token}`,
    accept: 'application/vnd.github+json',
    'content-type': 'application/json'
  };
}

async function responseError(response) {
  const text = typeof response.text === 'function' ? await response.text() : '';
  return text ? `: ${text}` : '';
}

export async function requestPagesRebuild({
  token,
  repository,
  commitSha,
  timeoutMs = PAGES_BUILD_TIMEOUT_MS,
  pollIntervalMs = PAGES_BUILD_POLL_INTERVAL_MS
}) {
  if (!token || !repository || !commitSha) {
    throw new Error('Pages rebuild verification requires a GitHub token, repository, and pushed commit SHA');
  }

  const url = `https://api.github.com/repos/${repository}/pages/builds`;
  const headers = pagesHeaders(token);
  const response = await fetch(url, {
    method: 'POST',
    headers
  });
  if (!response.ok) {
    throw new Error(
      `Pages rebuild request failed (${response.status}) after pushing ${commitSha}${await responseError(response)}`
    );
  }

  const started = Date.now();
  while (true) {
    const buildsResponse = await fetch(`${url}?per_page=100`, { headers });
    if (!buildsResponse.ok) {
      throw new Error(
        `Pages build verification failed (${buildsResponse.status}) for pushed commit ${commitSha}${await responseError(buildsResponse)}`
      );
    }
    const builds = await buildsResponse.json();
    if (!Array.isArray(builds)) {
      throw new Error(`Pages build verification returned an invalid response for pushed commit ${commitSha}`);
    }
    const build = builds.find(item => item.commit === commitSha || item.commit?.sha === commitSha);
    if (build?.status === 'errored') {
      const detail = build.error?.message ? `: ${build.error.message}` : '';
      throw new Error(`Pages build for pushed commit ${commitSha} failed${detail}`);
    }
    if (build?.status === 'built') return build;
    if (Date.now() - started >= timeoutMs) {
      const status = build ? `; last status: ${build.status || 'unknown'}` : '';
      throw new Error(`Timed out waiting for a Pages build for pushed commit ${commitSha}${status}`);
    }
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

/**
 * Serializes a mutate-commit-push cycle against a Pages branch, with bounded
 * fetch/rebase/push retries so concurrent writers (publish, cleanup,
 * janitor) never silently clobber each other's changes. `mutate` receives
 * the local repo path and must return `true` if it changed anything.
 */
export async function withSerializedBranchWrite({
  repo,
  branch,
  mutate,
  commitMessage,
  retries = RETRIES,
  retryDelay = retryDelayMs
}) {
  assertSafeBranchName(branch);
  const release = await acquireLock(repo);
  try {
    let lastError;
    for (let attempt = 0; attempt < retries; attempt += 1) {
      try {
        // `--` ends option parsing so the branch can never be read as a
        // `git fetch` option such as `--upload-pack`.
        await run('git', ['fetch', '--', 'origin', branch], repo);
        await run('git', ['checkout', '-B', branch, `origin/${branch}`], repo);
        const changed = await mutate(repo);
        if (!changed) return { changed: false };
        await run('git', ['add', '-A'], repo);
        // mutate can rewrite identical content (a re-run publishing the same build). Ask git
        // whether anything is staged instead of matching its "nothing to commit" text, which is
        // localised: `diff --quiet` exits 1 when there are changes, 0 when there are none.
        const staged = await run('git', ['diff', '--cached', '--quiet'], repo).then(
          () => false,
          error => {
            if (error.exitCode === 1) return true;
            throw error;
          }
        );
        if (!staged) return { changed: false };
        await run(
          'git',
          [
            '-c',
            'user.name=storybook-pages',
            '-c',
            'user.email=storybook-pages@users.noreply.github.com',
            'commit',
            '-m',
            commitMessage
          ],
          repo
        );
        const commitSha = await run('git', ['rev-parse', 'HEAD'], repo);
        await run('git', ['push', 'origin', `HEAD:${branch}`], repo);
        return { changed: true, commitSha };
      } catch (error) {
        lastError = error;
        if (attempt + 1 < retries) {
          await new Promise(resolve => setTimeout(resolve, retryDelay(attempt)));
          await run('git', ['rebase', `origin/${branch}`], repo).catch(() => {});
        }
      }
    }
    throw new Error(`Pages branch write failed after ${retries} attempts: ${lastError.message}`);
  } finally {
    await release();
  }
}
