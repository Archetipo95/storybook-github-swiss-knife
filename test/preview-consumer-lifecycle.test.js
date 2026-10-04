import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { validateArtifactDirectory } from '../src/validate-artifact.js';
import { buildPreviewMetadata, digestDirectory } from '../src/preview-metadata.js';
import { publishPreview } from '../src/preview-publish.js';
import { removePreviewDirectory } from '../src/preview-cleanup.js';
import { buildMarker } from '../src/preview-comment.js';

const SHA_INITIAL = '1'.repeat(40);
const SHA_UPDATED = '2'.repeat(40);

function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

function initConsumerPagesRepo() {
  const bareDir = makeTempDir('consumer-pages-bare-');
  git(bareDir, 'init', '--bare', '-q', '.');

  const seedDir = makeTempDir('consumer-pages-seed-');
  git(seedDir, 'init', '-q', '.');
  git(seedDir, 'config', 'user.email', 'seed@example.com');
  git(seedDir, 'config', 'user.name', 'seed');
  fs.writeFileSync(path.join(seedDir, 'index.html'), '<html>consumer production root</html>');
  git(seedDir, 'add', '-A');
  git(seedDir, 'commit', '-q', '-m', 'seed pages');
  git(seedDir, 'branch', '-M', 'gh-pages');
  git(seedDir, 'remote', 'add', 'origin', bareDir);
  git(seedDir, 'push', '-q', 'origin', 'gh-pages');

  const cloneDir = makeTempDir('consumer-pages-clone-');
  git(cloneDir, 'clone', '-q', bareDir, '.');
  git(cloneDir, 'config', 'user.email', 'clone@example.com');
  git(cloneDir, 'config', 'user.name', 'clone');
  git(cloneDir, 'checkout', '-q', 'gh-pages');
  return { bareDir, cloneDir };
}

test('external consumer full lifecycle: untrusted build, artifact transfer without git checkout, trusted publish, comment, and cleanup', async () => {
  const consumerRepoName = 'consumer-org/consumer-storybook-app';
  const prNumber = 101;
  const runId = 987654;

  // --- Step 1: Untrusted PR Build (in PR workspace) ---
  const prWorkspace = makeTempDir('consumer-pr-workspace-');
  const storybookStaticDir = path.join(prWorkspace, 'storybook-static');
  fs.mkdirSync(storybookStaticDir, { recursive: true });
  fs.writeFileSync(
    path.join(storybookStaticDir, 'index.html'),
    '<!DOCTYPE html><html><body>Consumer Storybook PR 101</body></html>'
  );
  fs.writeFileSync(
    path.join(storybookStaticDir, 'iframe.html'),
    '<!DOCTYPE html><html><body>Stories Iframe</body></html>'
  );
  fs.writeFileSync(
    path.join(storybookStaticDir, 'stories.json'),
    '{"stories": {"button--primary": {"id": "button--primary"}}}'
  );

  const validationResult = validateArtifactDirectory('storybook-static', prWorkspace);
  assert.equal(validationResult.valid, true);
  assert.equal(validationResult.fileCount, 3);

  // Stage preview bundle (as done by preview-metadata.js in build workflow)
  const bundleDir = makeTempDir('consumer-preview-bundle-stage-');
  const metadata = buildPreviewMetadata({
    repository: consumerRepoName,
    runId,
    runAttempt: 1,
    prNumber,
    baseRef: 'main',
    headRepository: consumerRepoName,
    headSha: SHA_INITIAL,
    artifactName: `storybook-preview-pr-${prNumber}-run-${runId}`,
    contentDigest: digestDirectory(storybookStaticDir),
    previewRoot: 'pr-preview'
  });

  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  const bundleContentDir = path.join(bundleDir, 'storybook');
  fs.cpSync(storybookStaticDir, bundleContentDir, { recursive: true });

  // --- Step 2: Artifact download simulation in non-git directory ---
  // In a trusted workflow_run job without checking out untrusted PR code,
  // the workspace or temp directory is NOT a git repository.
  const uncheckoutTempDir = makeTempDir('consumer-trusted-runner-temp-');
  assert.ok(
    !fs.existsSync(path.join(uncheckoutTempDir, '.git')),
    'trusted download directory must not require a git checkout'
  );

  // Verify that running a simulated `gh` command without GH_REPO in a non-git dir fails with "not a git repository"
  const gitCheck = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: uncheckoutTempDir, encoding: 'utf8' });
  assert.notEqual(gitCheck.status, 0);
  assert.match(gitCheck.stderr, /not a git repository/i);

  // Simulate downloaded bundle placement (like actions/download-artifact or gh run download with GH_REPO)
  const downloadedBundleDir = path.join(uncheckoutTempDir, 'downloaded-bundle');
  fs.cpSync(bundleDir, downloadedBundleDir, { recursive: true });

  // --- Step 3: Trusted Preview Publication ---
  const { cloneDir: pagesRepo } = initConsumerPagesRepo();

  const originalFetch = global.fetch;
  const apiCalls = [];
  global.fetch = async (url, options = {}) => {
    apiCalls.push({ url, method: options.method || 'GET', body: options.body });
    if (url.includes('/comments') && (!options.method || options.method === 'GET')) {
      return { ok: true, status: 200, json: async () => [] };
    }
    if (url.includes('/comments') && options.method === 'POST') {
      return { ok: true, status: 201, json: async () => ({ id: 5001 }) };
    }
    if (url.includes('/pages/builds')) {
      return { ok: true, status: 201, json: async () => ({ status: 'queued' }) };
    }
    throw new Error(`Unexpected API URL in test: ${url}`);
  };

  try {
    const trustedContext = {
      repository: consumerRepoName,
      runId,
      prNumber,
      headSha: SHA_INITIAL,
      headRepository: consumerRepoName,
      baseRef: 'main',
      artifactName: `storybook-preview-pr-${prNumber}-run-${runId}`,
      previewRoot: 'pr-preview'
    };

    const publishResult = await publishPreview({
      bundleDir: downloadedBundleDir,
      pagesRepo,
      trustedContext,
      currentHeadSha: SHA_INITIAL,
      pagesBranch: 'gh-pages',
      siteUrl: 'https://consumer-org.github.io/consumer-storybook-app',
      token: 'fake-token-trusted',
      repository: consumerRepoName
    });

    assert.equal(publishResult.action, 'published');
    assert.equal(publishResult.commentError, null);
    assert.equal(publishResult.commentResult.action, 'created');

    // Verify published content on gh-pages
    const publishedPath = path.join(pagesRepo, 'pr-preview', `pr-${prNumber}`, 'index.html');
    assert.ok(fs.existsSync(publishedPath), 'published preview index.html must exist on Pages branch');
    const publishedContent = fs.readFileSync(publishedPath, 'utf8');
    assert.match(publishedContent, /Consumer Storybook PR 101/);

    // Verify production root remains untouched
    assert.ok(fs.existsSync(path.join(pagesRepo, 'index.html')));
    assert.match(fs.readFileSync(path.join(pagesRepo, 'index.html'), 'utf8'), /consumer production root/);

    // Verify bot comment contains the stable marker
    const marker = buildMarker(prNumber);
    const commentPost = apiCalls.find(c => c.method === 'POST' && c.url.includes('/comments'));
    assert.ok(commentPost, 'must post preview comment');
    assert.ok(commentPost.body.includes(marker), 'comment must contain stable hidden marker');

    // --- Step 4: Stale run protection ---
    // If PR head moves to SHA_UPDATED, attempting to publish older run SHA_INITIAL is skipped
    const staleResult = await publishPreview({
      bundleDir: downloadedBundleDir,
      pagesRepo,
      trustedContext,
      currentHeadSha: SHA_UPDATED,
      pagesBranch: 'gh-pages',
      token: 'fake-token-trusted',
      repository: consumerRepoName
    });
    assert.equal(staleResult.action, 'skip-stale');

    // --- Step 5: Trusted PR Close Cleanup ---
    const cleanupResult = await removePreviewDirectory({
      repo: pagesRepo,
      branch: 'gh-pages',
      previewRoot: 'pr-preview',
      prNumber
    });

    assert.equal(cleanupResult.changed, true);
    assert.equal(cleanupResult.target, `pr-preview/pr-${prNumber}`);
    assert.ok(
      !fs.existsSync(path.join(pagesRepo, 'pr-preview', `pr-${prNumber}`)),
      'preview directory must be removed on close'
    );
    assert.ok(fs.existsSync(path.join(pagesRepo, 'index.html')), 'production root must remain untouched after cleanup');
  } finally {
    global.fetch = originalFetch;
  }
});

test('external consumer full lifecycle with repository-root layout (preview_root: ""): publish, janitor pruning, and close cleanup', async () => {
  const consumerRepoName = 'consumer-org/consumer-root-layout-app';
  const prNumber = 201;
  const runId = 112233;

  // Untrusted PR Build
  const prWorkspace = makeTempDir('consumer-root-workspace-');
  const storybookStaticDir = path.join(prWorkspace, 'storybook-static');
  fs.mkdirSync(storybookStaticDir, { recursive: true });
  fs.writeFileSync(
    path.join(storybookStaticDir, 'index.html'),
    '<!DOCTYPE html><html><body>Root Layout Storybook PR 201</body></html>'
  );
  fs.writeFileSync(
    path.join(storybookStaticDir, 'iframe.html'),
    '<!DOCTYPE html><html><body>Stories Iframe</body></html>'
  );

  const bundleDir = makeTempDir('consumer-root-bundle-');
  const metadata = buildPreviewMetadata({
    repository: consumerRepoName,
    runId,
    runAttempt: 1,
    prNumber,
    baseRef: 'main',
    headRepository: consumerRepoName,
    headSha: SHA_INITIAL,
    artifactName: `storybook-preview-pr-${prNumber}-run-${runId}`,
    contentDigest: digestDirectory(storybookStaticDir),
    previewRoot: ''
  });

  assert.equal(metadata.target, `pr-${prNumber}`);
  fs.writeFileSync(path.join(bundleDir, 'preview-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  fs.cpSync(storybookStaticDir, path.join(bundleDir, 'storybook'), { recursive: true });

  const { cloneDir: pagesRepo } = initConsumerPagesRepo();

  const originalFetch = global.fetch;
  global.fetch = async url => {
    if (url.includes('/comments')) return { ok: true, status: 201, json: async () => ({ id: 6001 }) };
    if (url.includes('/pages/builds')) return { ok: true, status: 201, json: async () => ({ status: 'queued' }) };
    if (url.includes('/pulls?state=open')) return { ok: true, status: 200, json: async () => [{ number: 999 }] }; // PR 201 is closed
    throw new Error(`Unexpected fetch: ${url}`);
  };

  try {
    const trustedContext = {
      repository: consumerRepoName,
      runId,
      prNumber,
      headSha: SHA_INITIAL,
      headRepository: consumerRepoName,
      baseRef: 'main',
      artifactName: `storybook-preview-pr-${prNumber}-run-${runId}`,
      previewRoot: ''
    };

    // Publish to root layout
    const publishResult = await publishPreview({
      bundleDir,
      pagesRepo,
      trustedContext,
      currentHeadSha: SHA_INITIAL,
      pagesBranch: 'gh-pages',
      siteUrl: 'https://consumer-org.github.io/consumer-root-layout-app',
      token: 'fake-token-trusted',
      repository: consumerRepoName
    });

    assert.equal(publishResult.action, 'published');
    const publishedPath = path.join(pagesRepo, `pr-${prNumber}`, 'index.html');
    assert.ok(fs.existsSync(publishedPath), 'preview must be published at root pr-201/index.html');
    assert.ok(fs.existsSync(path.join(pagesRepo, 'index.html')), 'root index.html must be preserved');

    // Run janitor to prune closed PR 201
    const { runJanitor } = await import('../src/preview-janitor.js');
    const janitorResult = await runJanitor({
      repo: pagesRepo,
      branch: 'gh-pages',
      previewRoot: '',
      retentionDays: 0,
      token: 'fake-token-trusted',
      repository: consumerRepoName
    });

    assert.equal(janitorResult.changed, true);
    assert.deepEqual(
      janitorResult.removed.map(r => r.entry),
      [`pr-${prNumber}`]
    );
    assert.ok(!fs.existsSync(path.join(pagesRepo, `pr-${prNumber}`)), 'janitor must prune root pr-201 directory');
    assert.ok(fs.existsSync(path.join(pagesRepo, 'index.html')), 'production root index.html must remain intact');
  } finally {
    global.fetch = originalFetch;
  }
});
