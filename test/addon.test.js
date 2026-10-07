import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { isTagged, statusEntries, withVisualTags } from '../packages/addon/src/results.js';

const { managerEntries, storybookMajor } = createRequire(import.meta.url)('../packages/addon/preset.cjs');

const manifest = {
  stories: {
    'a--changed': { status: 'changed', images: ['base', 'pr', 'diff'] },
    'a--broken': { status: 'error', images: [], error: 'boom' },
    'a--play': { status: 'interaction', images: ['pr'] },
    'a--same': { status: 'unchanged', images: ['pr'] },
    'a--new': { status: 'new', images: ['pr'] }
  }
};

test('statusEntries flags changed stories as warnings and failures as errors', () => {
  assert.deepEqual(statusEntries(manifest), [
    { storyId: 'a--changed', level: 'warn', title: 'Visual regression', description: 'Visual change' },
    { storyId: 'a--broken', level: 'error', title: 'Visual regression', description: 'Render error: boom' },
    { storyId: 'a--play', level: 'error', title: 'Visual regression', description: 'Interaction failed' }
  ]);
});

test('withVisualTags tags the stories in the report once and keeps the others', () => {
  const index = {
    v: 5,
    entries: {
      'a--changed': { id: 'a--changed', tags: ['dev'] },
      'a--play': { id: 'a--play' },
      'a--new': { id: 'a--new', tags: ['visual:new'] },
      'a--same': { id: 'a--same', tags: ['dev'] },
      'a--docs': { id: 'a--docs', type: 'docs' }
    }
  };
  const tagged = withVisualTags(index, manifest);
  assert.equal(tagged.v, 5);
  assert.deepEqual(tagged.entries['a--changed'].tags, ['dev', 'visual:changed']);
  assert.deepEqual(tagged.entries['a--play'].tags, ['visual:failed']);
  assert.deepEqual(tagged.entries['a--new'].tags, ['visual:new']);
  assert.equal(tagged.entries['a--same'], index.entries['a--same']);
  assert.equal(tagged.entries['a--docs'], index.entries['a--docs']);
  assert.equal(isTagged(index), true);
  assert.equal(isTagged({ entries: { 'a--same': { tags: ['dev'] } } }), false);
  assert.equal(isTagged(undefined), false);
});

function projectWithStorybook(version) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-addon-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{}');
  fs.mkdirSync(path.join(dir, 'node_modules/storybook'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'node_modules/storybook/package.json'),
    JSON.stringify({ name: 'storybook', version })
  );
  return dir;
}

test('the preset falls back to the Storybook next to the addon when the directory has none', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-addon-empty-'));
  let found;
  try {
    found = storybookMajor(dir);
  } catch (error) {
    found = error;
  }
  // Either the addon's own peer (when one is installed above it) or a clear error, never a crash.
  assert.ok(Number.isInteger(found) || /storybook package was not found/.test(found.message));
});

test('the preset registers the manager entry for the installed Storybook', t => {
  const cwd = process.cwd();
  t.after(() => process.chdir(cwd));
  for (const [version, entry] of [
    ['8.6.14', 'manager-sb8.js'],
    ['9.1.20', 'manager-modern.js'],
    ['10.0.0', 'manager-modern.js']
  ]) {
    const dir = projectWithStorybook(version);
    assert.equal(storybookMajor(dir), Number(version.split('.')[0]));
    process.chdir(dir);
    const entries = managerEntries(['existing']);
    assert.equal(entries[0], 'existing');
    assert.equal(path.basename(entries[1]), entry);
    assert.ok(path.isAbsolute(entries[1]));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
