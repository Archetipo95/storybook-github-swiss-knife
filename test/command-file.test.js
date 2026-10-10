import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { appendCommandFile, formatCommandFile } from '../src/command-file.js';
import { parseCommandFile } from './helpers/workflow-step.js';

test('formatCommandFile writes single-line values as key=value, null and undefined as empty', () => {
  assert.equal(formatCommandFile({ a: 'x', b: 1, c: true, d: null, e: undefined }), 'a=x\nb=1\nc=true\nd=\ne=\n');
});

test('formatCommandFile: a multi-line value round-trips through a key<<delimiter block', () => {
  const build = 'npm run lint\n\nnpm run build-storybook -- --quiet\n';
  const text = formatCommandFile({ before: '1', build_command: build, after: '2' });
  assert.match(text, /^build_command<<ghadelimiter_[0-9a-f-]{36}$/m);
  assert.deepEqual(parseCommandFile(text), { before: '1', build_command: build, after: '2' });
});

test('formatCommandFile: a value cannot end its block early or add keys', () => {
  const value = 'first\nEOF\nghadelimiter_00000000-0000-0000-0000-000000000000\ninjected=yes\nother<<EOF\nx\nEOF';
  const parsed = parseCommandFile(formatCommandFile({ build_command: value }));
  assert.deepEqual(Object.keys(parsed), ['build_command']);
  assert.equal(parsed.build_command, value);
});

test('formatCommandFile uses a new random delimiter for each multi-line value', () => {
  const text = formatCommandFile({ a: '1\n2', b: '3\n4' });
  const [a, b] = [/^a<<(.+)$/m.exec(text)[1], /^b<<(.+)$/m.exec(text)[1]];
  assert.notEqual(a, b);
  // A carriage return alone also ends a line for the runner.
  assert.match(formatCommandFile({ c: '1\r2' }), /^c<<ghadelimiter_/);
});

test('formatCommandFile refuses names that would change the file format', () => {
  for (const key of ['', 'a=b', 'a<<b', 'a\nb', '1a']) {
    assert.throws(() => formatCommandFile({ [key]: 'x' }), /Invalid output name/);
  }
});

test('appendCommandFile appends to the existing file', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-command-file-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'output');
  fs.writeFileSync(file, 'existing=1\n');
  appendCommandFile(file, { added: 'a\nb' });
  assert.deepEqual(parseCommandFile(fs.readFileSync(file, 'utf8')), { existing: '1', added: 'a\nb' });
});
