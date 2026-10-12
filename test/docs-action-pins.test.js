import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Dependabot updates the pins in the workflows and actions, never the examples in the docs, which
// went on pinning v4 majors. Every third-party action a doc example pins must use the same commit
// and version as this repository's own files.

const PIN = /uses: ([\w.-]+\/[\w./-]+)@([0-9a-f]{40}) # (v[\w.-]+)/g;
const pins = text => [...text.matchAll(PIN)].map(([, action, sha, version]) => ({ action, sha, version }));
const files = dir =>
  fs
    .readdirSync(dir, { recursive: true })
    .map(file => path.join(dir, String(file)))
    .filter(file => /\.(ya?ml|md)$/.test(file));

const own = new Map();
const ownPins = [];
for (const file of ['action.yml', ...files('.github/workflows'), ...files('actions')]) {
  for (const pin of pins(fs.readFileSync(file, 'utf8'))) {
    if (pin.action.startsWith('Archetipo95/')) continue;
    own.set(pin.action, pin);
    ownPins.push({ file, ...pin });
  }
}

// Dependabot's own pull requests updated the workflows but not the internal actions.
test("this repository's own files pin each third-party action to one commit", () => {
  const split = [...own.keys()].filter(
    action => new Set(ownPins.filter(pin => pin.action === action).map(pin => `${pin.sha} # ${pin.version}`)).size > 1
  );
  assert.deepEqual(
    split.map(
      action =>
        `${action}: ${[...new Set(ownPins.filter(pin => pin.action === action).map(pin => `${pin.file} ${pin.version}`))].join(', ')}`
    ),
    []
  );
});

// The workflows `storybook-swiss-knife init` writes count as examples too.
test('the docs and init templates pin third-party actions to the same commits as the workflows', () => {
  assert.ok(own.size > 0);
  const stale = [];
  for (const file of ['README.md', ...files('docs'), 'packages/addon/cli/init.js']) {
    for (const pin of pins(fs.readFileSync(file, 'utf8'))) {
      const current = own.get(pin.action);
      if (current && (current.sha !== pin.sha || current.version !== pin.version)) {
        stale.push(
          `${file}: ${pin.action}@${pin.sha.slice(0, 7)} # ${pin.version}, not ${current.sha.slice(0, 7)} # ${current.version}`
        );
      }
    }
  }
  assert.deepEqual(stale, []);
});
