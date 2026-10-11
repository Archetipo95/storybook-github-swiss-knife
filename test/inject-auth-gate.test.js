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
    await injectAuthGate(staticDir, { passcodeHash: hash, sessionHours: 12 });
    assert.equal(await fs.readFile(path.join(staticDir, 'index.html'), 'utf8'), index);
    assert.equal(await fs.readFile(path.join(staticDir, 'nested', 'iframe.html'), 'utf8'), iframe);
    // New settings replace the gate rather than adding a second one.
    await injectAuthGate(staticDir, { passcodeHash: hash });
    const regated = await fs.readFile(path.join(staticDir, 'index.html'), 'utf8');
    assert.equal(regated.match(/storybook-passcode-gate-script/g).length, 1);
    assert.match(regated, /sessionMs":86400000/);
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

test('injectAuthGate never takes gate markup shipped in the page for a gate', async () => {
  // The preview publisher gates the pull request's own build output, which could ship an empty
  // gate script, or one with a hash of its choosing, to look gated.
  const staticDir = await fs.mkdtemp(path.join(os.tmpdir(), 'storybook-gate-shipped-'));
  const hash = 'b'.repeat(64);
  const pages = {
    'index.html': '<html><head></head><body>x<script id="storybook-passcode-gate-script"></script></body></html>',
    'nested/iframe.html':
      "<html><body><style id='storybook-passcode-gate-style'>body{}</style>" +
      '<div id=storybook-passcode-gate><div>fake</div><form></form></div>' +
      `<script id="storybook-passcode-gate-script">(() => { const config = {"hash":"${'0'.repeat(64)}"}; })();</script>` +
      '<p>storybook-passcode-gate-script</p></body></html>'
  };
  await fs.mkdir(path.join(staticDir, 'nested'));
  for (const [file, html] of Object.entries(pages)) await fs.writeFile(path.join(staticDir, file), html);
  try {
    await injectAuthGate(staticDir, { passcodeHash: hash });
    for (const file of Object.keys(pages)) {
      const html = await fs.readFile(path.join(staticDir, file), 'utf8');
      assert.equal(html.match(/id=["']?storybook-passcode-gate-script/g).length, 1, file);
      assert.equal(html.match(/id=["']?storybook-passcode-gate-style/g).length, 1, file);
      assert.equal(html.match(/id=["']?storybook-passcode-gate["'\s>]/g).length, 1, file);
      assert.ok(html.includes(`"hash":"${hash}"`), `${file} holds the real hash`);
      assert.doesNotMatch(html, /fake|"hash":"0{64}"/, file);
    }
    assert.match(
      await fs.readFile(path.join(staticDir, 'nested/iframe.html'), 'utf8'),
      /<p>storybook-passcode-gate-script<\/p>/
    );

    // A re-run on the same output leaves every page as it was.
    const before = await Promise.all(Object.keys(pages).map(file => fs.readFile(path.join(staticDir, file), 'utf8')));
    await injectAuthGate(staticDir, { passcodeHash: hash });
    const after = await Promise.all(Object.keys(pages).map(file => fs.readFile(path.join(staticDir, file), 'utf8')));
    assert.deepEqual(after, before);
  } finally {
    await fs.rm(staticDir, { recursive: true, force: true });
  }
});
