import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  assertSafeBranchName,
  requestPagesRebuild,
  retryDelayMs,
  withSerializedBranchWrite
} from '../src/git-branch-writer.js';

const COMMIT_SHA = 'a'.repeat(40);

function response({ ok = true, status = 200, body = '' } = {}) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body))
  };
}

test('requestPagesRebuild waits for a successful build of the pushed commit', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url, method: options.method || 'GET' });
    if (options.method === 'POST') return response({ status: 201, body: { status: 'queued' } });
    if (requests.length === 2) return response({ body: [{ commit: 'b'.repeat(40), status: 'built' }] });
    return response({ body: [{ commit: COMMIT_SHA, status: 'built' }] });
  };

  try {
    const build = await requestPagesRebuild({
      token: 'token',
      repository: 'octo/widgets',
      commitSha: COMMIT_SHA,
      pollIntervalMs: 0
    });
    assert.equal(build.commit, COMMIT_SHA);
    assert.deepEqual(
      requests.map(({ method }) => method),
      ['POST', 'GET', 'GET']
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestPagesRebuild fails when no build appears for the pushed commit', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) =>
    options.method === 'POST'
      ? response({ status: 201, body: { status: 'queued' } })
      : response({ body: [{ commit: 'b'.repeat(40), status: 'built' }] });

  try {
    await assert.rejects(
      requestPagesRebuild({
        token: 'token',
        repository: 'octo/widgets',
        commitSha: COMMIT_SHA,
        timeoutMs: 0
      }),
      new RegExp(`Timed out waiting for a Pages build for pushed commit ${COMMIT_SHA}`)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestPagesRebuild surfaces Pages builds API failures', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) =>
    options.method === 'POST'
      ? response({ status: 201, body: { status: 'queued' } })
      : response({ ok: false, status: 503, body: 'service unavailable' });

  try {
    await assert.rejects(
      requestPagesRebuild({
        token: 'token',
        repository: 'octo/widgets',
        commitSha: COMMIT_SHA
      }),
      new RegExp(`Pages build verification failed \\(503\\) for pushed commit ${COMMIT_SHA}: service unavailable`)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('requestPagesRebuild surfaces a failed build for the pushed commit', async () => {
  const originalFetch = global.fetch;
  global.fetch = async (_url, options = {}) =>
    options.method === 'POST'
      ? response({ status: 201, body: { status: 'queued' } })
      : response({ body: [{ commit: { sha: COMMIT_SHA }, status: 'errored', error: { message: 'Jekyll failed' } }] });

  try {
    await assert.rejects(
      requestPagesRebuild({
        token: 'token',
        repository: 'octo/widgets',
        commitSha: COMMIT_SHA
      }),
      new RegExp(`Pages build for pushed commit ${COMMIT_SHA} failed: Jekyll failed`)
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('assertSafeBranchName accepts normal Pages branch names', () => {
  for (const branch of ['gh-pages', 'pages', 'release/1.x', 'docs_site']) {
    assert.equal(assertSafeBranchName(branch), branch);
  }
});

test('assertSafeBranchName rejects names git would parse as options or ranges', () => {
  for (const branch of ['--upload-pack=touch pwned', '-b', 'main..evil', 'a/', '', 'a b', 'a;b', undefined]) {
    assert.throws(() => assertSafeBranchName(branch), /Unsafe Pages branch name/, String(branch));
  }
});

test('withSerializedBranchWrite refuses an unsafe branch before running git', async () => {
  let mutated = false;
  await assert.rejects(
    withSerializedBranchWrite({
      repo: '/nonexistent',
      branch: '--exec=id',
      mutate: async () => {
        mutated = true;
        return true;
      }
    }),
    /Unsafe Pages branch name/
  );
  assert.equal(mutated, false);
});

test('withSerializedBranchWrite re-runs mutate on the new branch tip when a concurrent writer pushes first', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-race-'));
  const origin = path.join(tmp, 'origin.git');
  const rival = path.join(tmp, 'rival');
  const writer = path.join(tmp, 'writer');
  const git = (cwd, ...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=test', '-c', 'user.email=test@test.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8' }
    ).trim();
  const writePreview = (repo, name) => {
    fs.mkdirSync(path.join(repo, name), { recursive: true });
    fs.writeFileSync(path.join(repo, name, 'index.html'), name);
  };

  try {
    git(tmp, 'init', '-q', '--bare', origin);
    git(tmp, 'init', '-q', '-b', 'gh-pages', rival);
    fs.writeFileSync(path.join(rival, '.nojekyll'), '');
    git(rival, 'add', '-A');
    git(rival, 'commit', '-q', '-m', 'init');
    git(rival, 'remote', 'add', 'origin', origin);
    git(rival, 'push', '-q', 'origin', 'gh-pages');
    git(tmp, 'clone', '-q', '-b', 'gh-pages', origin, writer);

    const sawRivalPreview = [];
    const delays = [];
    const result = await withSerializedBranchWrite({
      repo: writer,
      branch: 'gh-pages',
      commitMessage: 'Publish pr-1',
      retryDelay: attempt => {
        delays.push(attempt);
        return 0;
      },
      mutate: async repo => {
        sawRivalPreview.push(fs.existsSync(path.join(repo, 'pr-2')));
        if (sawRivalPreview.length === 1) {
          writePreview(rival, 'pr-2');
          git(rival, 'add', '-A');
          git(rival, 'commit', '-q', '-m', 'Publish pr-2');
          git(rival, 'push', '-q', 'origin', 'gh-pages');
        }
        writePreview(repo, 'pr-1');
        return true;
      }
    });

    assert.deepEqual(sawRivalPreview, [false, true], 'the retry must start from the tip that contains pr-2');
    assert.deepEqual(delays, [0], 'one pause before the second attempt');
    assert.equal(result.changed, true);
    assert.equal(git(origin, 'rev-parse', 'gh-pages'), result.commitSha);
    assert.deepEqual(git(origin, 'ls-tree', '-r', '--name-only', 'gh-pages').split('\n'), [
      '.nojekyll',
      'pr-1/index.html',
      'pr-2/index.html'
    ]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('retryDelayMs grows with each attempt and is randomized within its window', () => {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    for (let sample = 0; sample < 50; sample += 1) {
      const delay = retryDelayMs(attempt);
      assert.ok(delay >= (attempt + 1) * 500 && delay <= (attempt + 1) * 2000, `attempt ${attempt}: ${delay}`);
    }
  }
  const spread = new Set(Array.from({ length: 20 }, () => retryDelayMs(0)));
  assert.ok(spread.size > 1, 'concurrent writers must not retry in lockstep');
});

test('withSerializedBranchWrite reports no change when mutate rewrites identical content', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-noop-'));
  const origin = path.join(tmp, 'origin.git');
  const seed = path.join(tmp, 'seed');
  const writer = path.join(tmp, 'writer');
  const git = (cwd, ...args) =>
    execFileSync(
      'git',
      ['-c', 'user.name=test', '-c', 'user.email=test@test.com', '-c', 'commit.gpgsign=false', ...args],
      { cwd, encoding: 'utf8' }
    ).trim();
  const writePreview = repo => {
    fs.mkdirSync(path.join(repo, 'pr-1'), { recursive: true });
    fs.writeFileSync(path.join(repo, 'pr-1', 'index.html'), 'same content');
  };

  try {
    git(tmp, 'init', '-q', '--bare', origin);
    git(tmp, 'init', '-q', '-b', 'gh-pages', seed);
    writePreview(seed);
    git(seed, 'add', '-A');
    git(seed, 'commit', '-q', '-m', 'Publish pr-1');
    git(seed, 'remote', 'add', 'origin', origin);
    git(seed, 'push', '-q', 'origin', 'gh-pages');
    git(tmp, 'clone', '-q', '-b', 'gh-pages', origin, writer);
    const before = git(origin, 'rev-parse', 'gh-pages');

    // A re-run publishes the same build: mutate reports a change, but the tree is identical.
    let attempts = 0;
    const result = await withSerializedBranchWrite({
      repo: writer,
      branch: 'gh-pages',
      commitMessage: 'Publish pr-1 again',
      retryDelay: () => 0,
      mutate: async repo => {
        attempts += 1;
        writePreview(repo);
        return true;
      }
    });

    assert.deepEqual(result, { changed: false });
    assert.equal(attempts, 1, 'an unchanged tree is not an error to retry');
    assert.equal(git(origin, 'rev-parse', 'gh-pages'), before, 'nothing is pushed');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
