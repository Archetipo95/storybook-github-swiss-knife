import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { generateBadges } from '../src/generate-badges.js';

// Byte-for-byte output of generateBadges for fixed inputs. The SVGs and the shields.io JSON
// endpoints are public URLs on users' Pages sites, so a refactor must not change them. To update
// after an intended change: GOLDEN_UPDATE=1 node --test test/badges-golden.test.js

const GOLDEN = path.join(process.cwd(), 'test/fixtures/badges-golden');

function write(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
}

const CASES = {
  // Stories and docs, a coverage gap, a Storybook version, passing tests, a site URL.
  'with-stories': {
    staticFiles: {
      'index.json': {
        v: 5,
        entries: {
          'button--primary': { type: 'story', id: 'button--primary', title: 'Components/Button' },
          'button--docs': { type: 'docs', id: 'button--docs', title: 'Components/Button' },
          'card--default': { type: 'story', id: 'card--default', title: 'Components/Card' }
        }
      }
    },
    workspace: {
      'package.json': { devDependencies: { storybook: '^9.1.20' } },
      'src/Button.vue': '<template />',
      'src/Card.vue': '<template />',
      'src/Modal.vue': '<template />',
      'test-results.json': { numTotalTests: 4, numPassedTests: 4, numFailedTests: 0 }
    },
    options: { siteUrl: 'https://octo.github.io/widgets/', basePath: 'preprod', testResultsPath: 'test-results.json' }
  },
  // No stories data, no package.json, failing tests, no site URL.
  'no-stories': {
    staticFiles: { 'index.html': '<html></html>' },
    workspace: { 'results.json': { numTotalTests: 5, numPassedTests: 3, numFailedTests: 2 } },
    options: { testResultsPath: 'results.json' }
  }
};

function generate(t, { staticFiles, workspace, options }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-badges-golden-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const staticDir = path.join(root, 'static');
  const workspaceRoot = path.join(root, 'workspace');
  write(staticDir, staticFiles);
  write(workspaceRoot, workspace);
  const result = generateBadges({ staticDir, workspaceRoot, commitSha: 'abcdef1234567890', ...options });
  const outputs = Object.fromEntries(
    fs
      .readdirSync(result.outDir)
      .sort()
      .map(file => [file, fs.readFileSync(path.join(result.outDir, file), 'utf8')])
  );
  // The one moving part.
  outputs['overview.json'] = outputs['overview.json'].replace(
    /"generatedAt": "[^"]+"/,
    '"generatedAt": "<generatedAt>"'
  );
  outputs['result.json'] = `${JSON.stringify(
    {
      filesGenerated: result.filesGenerated,
      markdownSnippets: result.markdownSnippets,
      derivedBadgesUrl: result.derivedBadgesUrl
    },
    null,
    2
  )}\n`;
  return outputs;
}

for (const [name, spec] of Object.entries(CASES)) {
  test(`generateBadges output is unchanged: ${name}`, t => {
    const outputs = generate(t, spec);
    const dir = path.join(GOLDEN, name);
    if (process.env.GOLDEN_UPDATE) {
      fs.rmSync(dir, { recursive: true, force: true });
      write(dir, outputs);
    }
    const expected = fs.readdirSync(dir).sort();
    assert.deepEqual(Object.keys(outputs).sort(), expected, 'the same files');
    for (const file of expected) {
      assert.equal(outputs[file], fs.readFileSync(path.join(dir, file), 'utf8'), file);
    }
  });
}
