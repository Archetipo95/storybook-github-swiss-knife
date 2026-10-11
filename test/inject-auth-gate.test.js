import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { injectAuthGate } from '../src/inject-auth-gate.js';

test('injectAuthGate protects entry documents and is idempotent', async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storybook-gate-'));
  await fs.mkdir(path.join(staticDir, 'nested'));
  await fs.writeFile(
    path.join(staticDir, 'index.html'),
    "<html><head><meta name='robots' content='index, follow'></head><body>index</body></html>"
  );
  await fs.writeFile(path.join(staticDir, 'nested', 'iframe.html'), '<html><body>iframe</body></html>');

  try {
    const hash = 'a'.repeat(64);
    assert.equal((await injectAuthGate(staticDir, { passcodeHash: hash, sessionHours: 12 })).length, 2);
    const index = await fs.readFile(path.join(staticDir, 'index.html'), 'utf8');
    const iframe = await fs.readFile(path.join(staticDir, 'nested', 'iframe.html'), 'utf8');
    assert.match(index, /storybook-passcode-gate-script/);
    assert.match(index, /sessionMs":43200000/);
    assert.match(index, /name="robots" content="noindex, nofollow, noarchive"/);
    assert.match(await fs.readFile(path.join(staticDir, 'robots.txt'), 'utf8'), /Disallow: \//);
    assert.match(index, /localStorage\.setItem\(key/);
    assert.doesNotMatch(index, /sessionStorage/);
    assert.match(index, /storybook-passcode-authenticated:' \+ config\.hash\.slice\(0, 16\)/);
    assert.match(index, /autocomplete="username"/);
    assert.match(iframe, /storybook-passcode-gate-script/);
    assert.match(iframe, /addEventListener\('storage'/);
    assert.match(iframe, /event\.origin === location\.origin/);
    assert.match(iframe, /name="robots" content="noindex, nofollow, noarchive"/);
    await injectAuthGate(staticDir, { passcodeHash: hash });
    assert.equal(
      (await fs.readFile(path.join(staticDir, 'index.html'), 'utf8')).match(/storybook-passcode-gate-script/g).length,
      1
    );
  } finally {
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});

test('injectAuthGate rejects invalid configuration and missing entry files', async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storybook-gate-empty-'));
  try {
    await assert.rejects(injectAuthGate(staticDir, { passcodeHash: 'not-a-hash' }), /64-character SHA-256/);
    // A publish with the gate on and no hash says what is missing.
    await assert.rejects(injectAuthGate(staticDir, { passcodeHash: '' }), /no passcode_hash was given/);
    await assert.rejects(injectAuthGate(staticDir, { passcodeHash: undefined }), /no passcode_hash was given/);
    await assert.rejects(injectAuthGate(staticDir, { passcodeHash: 'a'.repeat(64) }), /No index.html/);
  } finally {
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});

test("injectAuthGate gates a page that only mentions the gate's id", async () => {
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storybook-gate-mention-'));
  await fs.writeFile(
    path.join(staticDir, 'index.html'),
    '<html><head></head><body><p>See storybook-passcode-gate-script.</p></body></html>'
  );
  try {
    await injectAuthGate(staticDir, { passcodeHash: 'a'.repeat(64) });
    assert.match(
      await fs.readFile(path.join(staticDir, 'index.html'), 'utf8'),
      /<script id="storybook-passcode-gate-script">/
    );
  } finally {
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});
