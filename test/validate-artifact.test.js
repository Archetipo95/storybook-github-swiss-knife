import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateArtifactDirectory } from '../src/validate-artifact.js';

test('validateArtifactDirectory - succeeds on valid static directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-art-test-'));
  const targetDir = path.join(tmpDir, 'storybook-static');
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(targetDir, 'index.html'), '<html><body>Storybook</body></html>');
  fs.writeFileSync(path.join(targetDir, 'iframe.html'), '<html><body>Iframe</body></html>');

  const res = validateArtifactDirectory('storybook-static', tmpDir);
  assert.equal(res.valid, true);
  assert.equal(res.fileCount, 2);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateArtifactDirectory - fails when directory does not exist', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-art-test-'));
  assert.throws(() => {
    validateArtifactDirectory('non-existent', tmpDir);
  }, /Directory "non-existent" does not exist/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateArtifactDirectory - fails when directory is empty', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-art-test-'));
  const targetDir = path.join(tmpDir, 'empty-dir');
  fs.mkdirSync(targetDir);

  assert.throws(() => {
    validateArtifactDirectory('empty-dir', tmpDir);
  }, /Directory "empty-dir" is empty/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateArtifactDirectory - fails when path escapes workspace root', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-art-test-'));
  assert.throws(() => {
    validateArtifactDirectory('../outside', tmpDir);
  }, /escapes workspace root/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateArtifactDirectory - fails when nested .git is found', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-art-test-'));
  const targetDir = path.join(tmpDir, 'storybook-static');
  fs.mkdirSync(targetDir);
  fs.mkdirSync(path.join(targetDir, '.git'));
  fs.writeFileSync(path.join(targetDir, 'index.html'), '<html></html>');

  assert.throws(() => {
    validateArtifactDirectory('storybook-static', tmpDir);
  }, /contains a nested \.git directory/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateArtifactDirectory - fails when no static content is present', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-art-test-'));
  const targetDir = path.join(tmpDir, 'storybook-static');
  fs.mkdirSync(targetDir);
  fs.writeFileSync(path.join(targetDir, 'random.exe'), 'binary content');

  assert.throws(() => {
    validateArtifactDirectory('storybook-static', tmpDir);
  }, /does not appear to contain valid static web content/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('validateArtifactDirectory - fails when artifact root is a symlink pointing outside workspace root', () => {
  const workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-ws-test-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sb-outside-test-'));
  fs.writeFileSync(path.join(outsideDir, 'index.html'), '<html><body>Outside</body></html>');

  const symlinkPath = path.join(workspaceDir, 'symlink-artifact');
  fs.symlinkSync(outsideDir, symlinkPath, 'dir');

  assert.throws(() => {
    validateArtifactDirectory('symlink-artifact', workspaceDir);
  }, /escapes workspace root/);

  fs.rmSync(workspaceDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});
