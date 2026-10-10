import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeManagedDirectories } from '../src/config.js';
import { replaceDirectory } from '../src/publish-directory.js';

test('replaceDirectory replaces only the selected target and preserves siblings', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-publish-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-source-'));
  await fs.mkdir(path.join(repo, 'staging'), { recursive: true });
  await fs.mkdir(path.join(repo, 'other'), { recursive: true });
  await fs.writeFile(path.join(repo, 'staging', 'old.html'), 'old');
  await fs.writeFile(path.join(repo, 'other', 'keep.html'), 'keep');
  await fs.writeFile(path.join(source, 'index.html'), 'new');

  await replaceDirectory(repo, 'staging', source);

  assert.equal(await fs.readFile(path.join(repo, 'staging', 'index.html'), 'utf8'), 'new');
  await assert.rejects(fs.readFile(path.join(repo, 'staging', 'old.html')));
  assert.equal(await fs.readFile(path.join(repo, 'other', 'keep.html'), 'utf8'), 'keep');
  assert.equal(await fs.readFile(path.join(repo, '.nojekyll'), 'utf8'), '');
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true });
});

test('replaceDirectory preserves the shared writer lock during a root publish', async () => {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-publish-root-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-source-root-'));
  await fs.mkdir(path.join(repo, '.storybook-pages-write.lock'));
  await fs.writeFile(path.join(repo, 'old.html'), 'old');
  await fs.writeFile(path.join(source, 'index.html'), 'new');

  await replaceDirectory(repo, '', source);

  assert.equal(await fs.readFile(path.join(repo, 'index.html'), 'utf8'), 'new');
  await fs.access(path.join(repo, '.storybook-pages-write.lock'));
  await assert.rejects(fs.readFile(path.join(repo, 'old.html')));
  await fs.rm(repo, { recursive: true, force: true });
  await fs.rm(source, { recursive: true, force: true });
});

test('publishDirectory sends an opt-in authenticated Pages rebuild request with proper headers', async () => {
  const { publishDirectory } = await import('../src/publish-directory.js');
  const repoBare = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-bare-'));
  const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-clone-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-src-'));

  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '--bare', '-q', repoBare]);

  const seed = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-seed-'));
  execFileSync('git', ['init', '-q', seed]);
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: seed });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: seed });
  await fs.writeFile(path.join(seed, 'init.txt'), 'init');
  execFileSync('git', ['add', '-A'], { cwd: seed });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: seed });
  execFileSync('git', ['branch', '-M', 'gh-pages'], { cwd: seed });
  execFileSync('git', ['remote', 'add', 'origin', repoBare], { cwd: seed });
  execFileSync('git', ['push', '-q', 'origin', 'gh-pages'], { cwd: seed });

  execFileSync('git', ['clone', '-q', repoBare, repoClone]);
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoClone });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoClone });
  execFileSync('git', ['checkout', '-q', 'gh-pages'], { cwd: repoClone });

  await fs.writeFile(path.join(source, 'index.html'), '<html>deployed</html>');

  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url, options });
    if (url.includes('/pages/builds') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ status: 'queued' }) };
    }
    if (url.includes('/pages/builds')) {
      const commitSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoClone }).toString().trim();
      return { ok: true, status: 200, json: async () => [{ commit: commitSha, status: 'built' }] };
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  try {
    const result = await publishDirectory({
      repo: repoClone,
      source,
      branch: 'gh-pages',
      targetDirectory: 'storybook',
      triggerPagesRebuild: true,
      token: 'ghp_secret_token_123',
      repository: 'my-org/my-repo',
      siteUrl: 'https://my-org.github.io/my-repo'
    });

    assert.equal(result.directory, 'storybook');
    assert.match(result.commitSha, /^[0-9a-f]{40}$/);
    assert.equal(requests.length, 2);
    const rebuildReq = requests[0];
    assert.equal(rebuildReq.url, 'https://api.github.com/repos/my-org/my-repo/pages/builds');
    assert.equal(rebuildReq.options.method, 'POST');
    assert.deepEqual(rebuildReq.options.headers, {
      authorization: 'token ghp_secret_token_123',
      accept: 'application/vnd.github+json',
      'content-type': 'application/json'
    });
  } finally {
    global.fetch = originalFetch;
    await fs.rm(repoBare, { recursive: true, force: true });
    await fs.rm(repoClone, { recursive: true, force: true });
    await fs.rm(seed, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
  }
});

test('publishDirectory does not request a Pages rebuild by default', async () => {
  const { publishDirectory } = await import('../src/publish-directory.js');
  const repoBare = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-bare-default-'));
  const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-clone-default-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-src-default-'));

  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '--bare', '-q', repoBare]);
  const seed = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-seed-default-'));
  execFileSync('git', ['init', '-q', seed]);
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: seed });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: seed });
  await fs.writeFile(path.join(seed, 'init.txt'), 'init');
  execFileSync('git', ['add', '-A'], { cwd: seed });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: seed });
  execFileSync('git', ['branch', '-M', 'gh-pages'], { cwd: seed });
  execFileSync('git', ['remote', 'add', 'origin', repoBare], { cwd: seed });
  execFileSync('git', ['push', '-q', 'origin', 'gh-pages'], { cwd: seed });
  execFileSync('git', ['clone', '-q', repoBare, repoClone]);
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoClone });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoClone });
  execFileSync('git', ['checkout', '-q', 'gh-pages'], { cwd: repoClone });
  await fs.writeFile(path.join(source, 'index.html'), '<html>deployed</html>');

  const originalFetch = global.fetch;
  let requestCount = 0;
  global.fetch = async () => {
    requestCount += 1;
    throw new Error('Pages rebuild should not be requested by default');
  };

  try {
    await publishDirectory({
      repo: repoClone,
      source,
      branch: 'gh-pages',
      targetDirectory: 'storybook',
      token: 'ghp_secret_token_123',
      repository: 'my-org/my-repo'
    });
    assert.equal(requestCount, 0);
  } finally {
    global.fetch = originalFetch;
    await fs.rm(repoBare, { recursive: true, force: true });
    await fs.rm(repoClone, { recursive: true, force: true });
    await fs.rm(seed, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
  }
});

test('publishDirectory surfaces opt-in Pages rebuild failures after push', async () => {
  const { publishDirectory } = await import('../src/publish-directory.js');
  const repoBare = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-bare-fail-'));
  const repoClone = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-clone-fail-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-src-fail-'));

  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['init', '--bare', '-q', repoBare]);

  const seed = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-seed-fail-'));
  execFileSync('git', ['init', '-q', seed]);
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: seed });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: seed });
  await fs.writeFile(path.join(seed, 'init.txt'), 'init');
  execFileSync('git', ['add', '-A'], { cwd: seed });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: seed });
  execFileSync('git', ['branch', '-M', 'gh-pages'], { cwd: seed });
  execFileSync('git', ['remote', 'add', 'origin', repoBare], { cwd: seed });
  execFileSync('git', ['push', '-q', 'origin', 'gh-pages'], { cwd: seed });

  execFileSync('git', ['clone', '-q', repoBare, repoClone]);
  execFileSync('git', ['config', 'user.name', 'test'], { cwd: repoClone });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: repoClone });
  execFileSync('git', ['checkout', '-q', 'gh-pages'], { cwd: repoClone });

  await fs.writeFile(path.join(source, 'index.html'), '<html>deployed</html>');

  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (url.includes('/pages/builds')) {
      return { ok: false, status: 403 };
    }
    throw new Error(`Unexpected url: ${url}`);
  };

  try {
    await assert.rejects(
      publishDirectory({
        repo: repoClone,
        source,
        branch: 'gh-pages',
        targetDirectory: 'storybook',
        triggerPagesRebuild: true,
        token: 'ghp_secret_token_123',
        repository: 'my-org/my-repo'
      }),
      /Pages rebuild request failed \(403\) after pushing [0-9a-f]{40}/
    );
  } finally {
    global.fetch = originalFetch;
    await fs.rm(repoBare, { recursive: true, force: true });
    await fs.rm(repoClone, { recursive: true, force: true });
    await fs.rm(seed, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
  }
});

/** A Pages branch with a published preview and a stale root file, and a new root build. */
async function rootPublishFixture(previewDir = 'pr-preview/pr-1') {
  const repo = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-root-previews-'));
  const source = await fs.mkdtemp(path.join(os.tmpdir(), 'pages-root-source-'));
  await fs.mkdir(path.join(repo, previewDir), { recursive: true });
  await fs.writeFile(path.join(repo, previewDir, 'index.html'), 'preview');
  await fs.writeFile(path.join(repo, 'old.html'), 'old');
  await fs.writeFile(path.join(source, 'index.html'), 'new');
  const cleanup = async () => {
    await fs.rm(repo, { recursive: true, force: true });
    await fs.rm(source, { recursive: true, force: true });
  };
  return { repo, source, cleanup };
}

test('a root publish keeps the PR previews under the default preview root', async () => {
  const { repo, source, cleanup } = await rootPublishFixture();
  try {
    await replaceDirectory(repo, '', source);
    assert.equal(await fs.readFile(path.join(repo, 'pr-preview', 'pr-1', 'index.html'), 'utf8'), 'preview');
    assert.equal(await fs.readFile(path.join(repo, 'index.html'), 'utf8'), 'new');
    await assert.rejects(fs.readFile(path.join(repo, 'old.html')));
  } finally {
    await cleanup();
  }
});

test('a root publish keeps managed directories written with a trailing slash', async () => {
  const { repo, source, cleanup } = await rootPublishFixture('legacy-previews/pr-1');
  try {
    await replaceDirectory(repo, '', source, ['legacy-previews/']);
    assert.equal(await fs.readFile(path.join(repo, 'legacy-previews', 'pr-1', 'index.html'), 'utf8'), 'preview');
  } finally {
    await cleanup();
  }
});

test('a root publish keeps a custom, nested preview root', async () => {
  const { repo, source, cleanup } = await rootPublishFixture('previews/storybook/pr-1');
  try {
    await replaceDirectory(repo, '', source, [], { previewRoot: 'previews/storybook' });
    assert.equal(await fs.readFile(path.join(repo, 'previews', 'storybook', 'pr-1', 'index.html'), 'utf8'), 'preview');
  } finally {
    await cleanup();
  }
});

test('with previews at the branch root, a root publish keeps the pr-<N> directories only', async () => {
  const { repo, source, cleanup } = await rootPublishFixture('pr-12');
  try {
    await fs.mkdir(path.join(repo, 'pr-preview-notes'), { recursive: true });
    await replaceDirectory(repo, '', source, [], { previewRoot: '' });
    assert.equal(await fs.readFile(path.join(repo, 'pr-12', 'index.html'), 'utf8'), 'preview');
    await assert.rejects(fs.access(path.join(repo, 'pr-preview-notes')));
    await assert.rejects(fs.readFile(path.join(repo, 'old.html')));
  } finally {
    await cleanup();
  }
});

test('normalizeManagedDirectories trims, drops ./ and trailing slashes, and dedupes', () => {
  assert.deepEqual(normalizeManagedDirectories(' pr-preview/ , ./docs//, docs ,,'), ['pr-preview', 'docs']);
  assert.deepEqual(normalizeManagedDirectories(['a/b/', 'c']), ['a/b', 'c']);
  assert.deepEqual(normalizeManagedDirectories('one\ntwo/'), ['one', 'two']);
  assert.deepEqual(normalizeManagedDirectories(''), []);
  assert.deepEqual(normalizeManagedDirectories(undefined), []);
});
