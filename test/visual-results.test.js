import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { evaluateVisualGate, renderVisualSummary } from '../src/visual/gate.js';
import { buildGalleryManifest } from '../src/visual/manifest.js';
import { classifyVisualResults, firstErrorLine, readVisualResults, storyIdOf } from '../src/visual/results.js';
import { fnv1a, parseShard, shardOf } from '../src/visual/shard.js';

const results = readVisualResults(path.join(process.cwd(), 'test/fixtures/visual/merged-results.json'));
const ids = tests => tests.map(storyIdOf).sort();
const emptyResults = {
  interactions: [],
  changed: [],
  broken: [],
  added: [],
  flaky: [],
  skipped: [],
  unchanged: [],
  removed: [],
  runErrors: []
};

test('classifies every outcome of a merged Playwright report', () => {
  assert.deepEqual(ids(results.changed), ['button--primary']);
  assert.deepEqual(ids(results.added), ['button--large']);
  assert.deepEqual(ids(results.interactions), ['form--interaction-flow-submit']);
  assert.deepEqual(ids(results.broken), ['card--broken', 'card--slow']);
  assert.deepEqual(ids(results.flaky), ['card--wobbly']);
  assert.deepEqual(ids(results.unchanged), ['card--default']);
  assert.equal(results.tests.length, 7);
});

test('a screenshot timeout is a render error, never a reviewable change', () => {
  assert.ok(ids(results.broken).includes('card--slow'));
  assert.ok(!ids(results.changed).includes('card--slow'));
});

test('an interaction that failed once blocks even though the retry passed', () => {
  const gate = evaluateVisualGate(results, { approved: true });
  assert.equal(gate.blocking, true);
  assert.equal(gate.reason, 'interaction');
});

test('firstErrorLine reports the failed assertion, not the wrapper prefix', () => {
  assert.equal(firstErrorLine(results.interactions[0]), 'expected button to be enabled');
});

test('gate: changes block until approved; incomplete runs always block', () => {
  const changedOnly = { ...emptyResults, changed: results.changed };
  assert.deepEqual(
    [evaluateVisualGate(changedOnly).blocking, evaluateVisualGate(changedOnly).reason],
    [true, 'changed']
  );
  assert.deepEqual(
    [
      evaluateVisualGate(changedOnly, { approved: true }).blocking,
      evaluateVisualGate(changedOnly, { approved: true }).reason
    ],
    [false, 'approved']
  );
  assert.equal(evaluateVisualGate(emptyResults, { approved: true, incomplete: true }).blocking, true);
  assert.deepEqual(evaluateVisualGate(emptyResults), {
    blocking: false,
    reason: 'clean',
    counts: { changed: 0, removed: 0, new: 0, interactions: 0, errors: 0, flaky: 0, skipped: 0, unchanged: 0 }
  });
});

test('summary names the configured approval label and lists every group', () => {
  const markdown = renderVisualSummary(
    { ...emptyResults, changed: results.changed, added: results.added },
    { approvalLabel: 'looks-good', reportUrl: 'https://example.test/report/' }
  );
  assert.match(markdown, /add the `looks-good` label/);
  assert.match(markdown, /<summary>Changed stories \(1\)<\/summary>/);
  assert.match(markdown, /<summary>New stories \(1\)<\/summary>/);
  assert.match(markdown, /\| 1 \| 0 \| 1 \| 0 \| 0 \| 0 \| 0 \| 0 \|/);
  assert.match(markdown, /\[open the report\]\(https:\/\/example\.test\/report\/\)/);
});

test('summary escapes backticks from story titles and errors', () => {
  const markdown = renderVisualSummary(results);
  assert.doesNotMatch(markdown, /`[^`\n]*`[^`\n]*`[^`\n]*` \(/);
  assert.match(markdown, /: expected button to be enabled/);
});

test('gallery manifest: most severe status wins, only existing images are listed', () => {
  const images = new Set(['button--primary/base', 'button--primary/pr', 'button--primary/diff', 'card--default/pr']);
  const manifest = buildGalleryManifest(results, {
    hasImage: (id, name) => images.has(`${id}/${name}`),
    headSha: 'abc',
    runId: '42',
    runUrl: 'https://example.test/runs/42',
    approved: false
  });
  assert.equal(manifest.version, 1);
  assert.deepEqual(manifest.stories['button--primary'], {
    status: 'changed',
    title: 'Button › Primary',
    images: ['base', 'pr', 'diff']
  });
  assert.equal(manifest.stories['form--interaction-flow-submit'].status, 'interaction');
  assert.equal(manifest.stories['form--interaction-flow-submit'].error, 'expected button to be enabled');
  assert.equal(manifest.stories['card--slow'].status, 'error');
  assert.equal(manifest.stories['card--wobbly'].status, 'flaky');
  assert.equal(manifest.stories['button--large'].status, 'new');
  assert.deepEqual(manifest.stories['card--default'], {
    status: 'unchanged',
    title: 'Card › Default',
    images: ['pr']
  });
  assert.equal(Object.keys(manifest.stories).length, 7);
});

test('fnv1a matches the reference 32-bit test vectors', () => {
  assert.equal(fnv1a(''), 0x811c9dc5);
  assert.equal(fnv1a('a'), 0xe40c292c);
  assert.equal(fnv1a('foobar'), 0xbf9cf968);
});

// Values match kinboo2.0's tests/visual/stories.visual.ts fnv1a, so stories keep their shard after migrating.
test('shard assignment is stable (golden list)', () => {
  const golden = {
    'button--primary': 4,
    'button--large': 3,
    'card--default': 3,
    'form--interaction-flow-submit': 2,
    'icons-all-icons--gallery': 1
  };
  for (const [id, shard] of Object.entries(golden)) assert.equal(shardOf(id, 4), shard, id);
});

test('parseShard validates <index>/<total>', () => {
  assert.deepEqual(parseShard('2/4'), { index: 2, total: 4 });
  assert.deepEqual(parseShard(), { index: 1, total: 1 });
  for (const bad of ['0/4', '5/4', '1/0', 'two/4', '1-4']) assert.throws(() => parseShard(bad), /Invalid shard/);
});

const story = (title, id, status, extra = {}) => ({
  title,
  tests: [{ status, annotations: [{ type: 'story', description: id }], results: [{}], ...extra }]
});

test('skipped stories, removed baselines and runner errors are classified', () => {
  const report = {
    errors: [{ message: 'Error: No Storybook build at /x (index.json missing).' }],
    suites: [
      {
        specs: [
          story('Card › Opted out', 'card--opted-out', 'skipped'),
          {
            title: 'Removed stories',
            tests: [
              {
                status: 'unexpected',
                annotations: [{ type: 'removed', description: 'old--one,old--two' }],
                results: [{ error: { message: 'Removed stories: old--one, old--two' } }]
              }
            ]
          }
        ]
      }
    ]
  };
  const classified = classifyVisualResults(report);
  assert.deepEqual(ids(classified.skipped), ['card--opted-out']);
  assert.deepEqual(classified.unchanged, []);
  assert.deepEqual(classified.removed, ['old--one', 'old--two']);
  assert.equal(classified.broken.length, 0, 'the removed check is not a render error');
  assert.equal(classified.runErrors.length, 1);
  assert.equal(
    evaluateVisualGate(classified, { approved: true }).reason,
    'error',
    'runner errors block even when approved'
  );
  const withoutErrors = { ...classified, runErrors: [] };
  assert.equal(evaluateVisualGate(withoutErrors).reason, 'changed', 'removed stories need approval');
  assert.equal(evaluateVisualGate(withoutErrors, { approved: true }).blocking, false);
});

test('titles from the run cannot add markdown to the summary', () => {
  const malicious = {
    ...emptyResults,
    changed: [{ title: 'Ok`\n\n:white_check_mark: Approved\n[link](https://evil)', results: [{}] }]
  };
  const markdown = renderVisualSummary(malicious);
  assert.doesNotMatch(markdown, /\n:white_check_mark: Approved/);
  assert.match(markdown, /- `Ok' :white_check_mark: Approved \[link\]\(https:\/\/evil\)`/);
});

test('the removed-stories check is never counted as a story, even when it skipped itself', () => {
  const classified = classifyVisualResults({
    suites: [
      {
        specs: [
          {
            title: 'Removed stories',
            tests: [{ status: 'skipped', annotations: [{ type: 'removed-check' }], results: [{}] }]
          }
        ]
      }
    ]
  });
  assert.deepEqual([classified.tests.length, classified.skipped.length, classified.removed.length], [0, 0, 0]);
});
