import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { replaceDirectory } from '../src/publish-directory.js';

function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preserve-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}
const read = (dir, file) => fs.readFileSync(path.join(dir, file), 'utf8');

test('a preview republish keeps the visual report published into the same PR directory', async () => {
  const repo = tree({
    'pr-preview/pr-7/index.html': 'old preview',
    'pr-preview/pr-7/stale.js': 'old',
    'pr-preview/pr-7/visual/index.html': 'report',
    'pr-preview/pr-7/visual/gallery/manifest.json': '{}'
  });
  const source = tree({ 'index.html': 'new preview' });
  await replaceDirectory(repo, 'pr-preview/pr-7', source, [], { preserveEntries: ['visual'] });
  assert.equal(read(repo, 'pr-preview/pr-7/index.html'), 'new preview');
  assert.equal(fs.existsSync(path.join(repo, 'pr-preview/pr-7/stale.js')), false, 'old preview files are removed');
  assert.equal(read(repo, 'pr-preview/pr-7/visual/index.html'), 'report');
  assert.equal(read(repo, 'pr-preview/pr-7/visual/gallery/manifest.json'), '{}');
});

test('new content that ships the preserved entry replaces it', async () => {
  const repo = tree({ 'pr-preview/pr-7/visual/index.html': 'old report' });
  const source = tree({ 'index.html': 'preview', 'visual/index.html': 'new report' });
  await replaceDirectory(repo, 'pr-preview/pr-7', source, [], { preserveEntries: ['visual'] });
  assert.equal(read(repo, 'pr-preview/pr-7/visual/index.html'), 'new report');
});

test('without preserveEntries the directory is replaced wholesale, as before', async () => {
  const repo = tree({ 'pr-preview/pr-7/visual/index.html': 'report' });
  await replaceDirectory(repo, 'pr-preview/pr-7', tree({ 'index.html': 'preview' }));
  assert.equal(fs.existsSync(path.join(repo, 'pr-preview/pr-7/visual')), false);
});

test('preserveEntries only accepts plain entry names', async () => {
  const repo = tree({ 'pr-preview/pr-7/index.html': 'x' });
  for (const entry of ['../escape', 'a/b', '..', '']) {
    await assert.rejects(
      replaceDirectory(repo, 'pr-preview/pr-7', tree({ 'index.html': 'y' }), [], { preserveEntries: [entry] }),
      /preserveEntries must be plain entry names/
    );
  }
});
