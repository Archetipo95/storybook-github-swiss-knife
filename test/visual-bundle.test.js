import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { assembleBundle, countShardReports } from '../src/visual/bundle.js';

function tmp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

test('countShardReports counts distinct shards, in nested artifact folders too', () => {
  const blob = tmp({ 'a/report-1-3.zip': '', 'b/report-3-3.zip': '', 'report-3-3.zip': '', 'other.zip': '' });
  assert.equal(countShardReports(blob), 2);
  assert.equal(countShardReports(path.join(blob, 'missing')), 0);
});

test('assembleBundle writes meta, gallery manifest and a11y reports in the published layout', () => {
  const results = fs.readFileSync(path.join(process.cwd(), 'test/fixtures/visual/merged-results.json'), 'utf8');
  const bundleDir = tmp({ 'results/visual-results.json': results, 'visual/index.html': '<html>' });
  const gallery = tmp({
    'button--primary/base.png': 'x',
    'button--primary/pr.png': 'x',
    'button--primary/diff.png': 'x'
  });
  const a11y = tmp({ 'card--default.json': '{"id":"card--default","violations":[]}' });
  const blob = tmp({ 'report-1-2.zip': '', 'report-2-2.zip': '' });
  const meta = assembleBundle({
    BUNDLE_DIR: bundleDir,
    BLOB_DIR: blob,
    GALLERY_DIR: gallery,
    A11Y_DIR: a11y,
    PR_NUMBER: '7',
    HEAD_SHA: 'a'.repeat(40),
    BASE_SHA: 'b'.repeat(40),
    SHARDS_EXPECTED: '2',
    GITHUB_RUN_ID: '555',
    GITHUB_SERVER_URL: 'https://github.com',
    GITHUB_REPOSITORY: 'acme/widgets'
  });
  assert.deepEqual(
    {
      prNumber: meta.prNumber,
      shardsExpected: meta.shardsExpected,
      shardsReported: meta.shardsReported,
      runUrl: meta.runUrl
    },
    { prNumber: 7, shardsExpected: 2, shardsReported: 2, runUrl: 'https://github.com/acme/widgets/actions/runs/555' }
  );
  const manifest = JSON.parse(fs.readFileSync(path.join(bundleDir, 'visual/gallery/manifest.json'), 'utf8'));
  assert.deepEqual(manifest.stories['button--primary'].images, ['base', 'pr', 'diff']);
  assert.equal(manifest.approved, false);
  assert.ok(fs.existsSync(path.join(bundleDir, 'results/a11y/card--default.json')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(bundleDir, 'meta.json'), 'utf8')).version, 1);
});
