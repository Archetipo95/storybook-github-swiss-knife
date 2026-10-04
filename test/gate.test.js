import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { evaluateApproval } from '../src/gate/approval.js';
import { A11Y_CHECK, VISUAL_CHECK, evaluateGate } from '../src/gate/core.js';
import { A11Y_DEFAULTS, VISUAL_DEFAULTS } from '../src/swiss-knife-config.js';

const results = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'test/fixtures/visual/merged-results.json'), 'utf8')
);
const config = { visual: { ...VISUAL_DEFAULTS }, a11y: { ...A11Y_DEFAULTS } };
const HEAD = 'a'.repeat(40);
const meta = { version: 1, headSha: HEAD, prNumber: 7, shardsExpected: 2, shardsReported: 2 };
const passing = {
  suites: [
    {
      specs: [
        {
          title: 'Card › Default',
          tests: [{ status: 'expected', annotations: [{ type: 'story', description: 'card--default' }], results: [{}] }]
        }
      ]
    }
  ]
};
const changedOnly = {
  suites: [{ specs: results.suites[0].specs.filter(spec => spec.title === 'Button › Primary') }]
};
const contrast = nodes => ({ id: 'color-contrast', impact: 'serious', help: 'contrast', nodes });
const gate = overrides =>
  evaluateGate({
    bundle: { meta, results: passing, a11yReports: [] },
    config,
    baseline: {},
    approved: false,
    headSha: HEAD,
    prNumber: 7,
    ...overrides
  });

test('a clean run passes both checks', () => {
  const { visual, a11y } = gate({});
  assert.deepEqual(
    [visual.name, visual.conclusion, a11y.name, a11y.conclusion],
    [VISUAL_CHECK, 'success', A11Y_CHECK, 'success']
  );
});

test('no bundle, or a bundle for another commit or PR, fails both checks instead of skipping them', () => {
  for (const overrides of [
    { bundle: null },
    { bundle: { meta: { ...meta, headSha: 'b'.repeat(40) }, results: passing, a11yReports: [] } },
    { bundle: { meta: { ...meta, prNumber: 8 }, results: passing, a11yReports: [] } },
    { bundle: { meta: { version: 1 }, results: passing, a11yReports: [] } },
    { problem: 'The visual run was cancelled.' }
  ]) {
    const { visual, a11y } = gate(overrides);
    assert.equal(visual.conclusion, 'failure');
    assert.equal(a11y.conclusion, 'failure');
  }
});

test('an incomplete run fails both checks even without differences', () => {
  const { visual, a11y } = gate({
    bundle: { meta: { ...meta, shardsReported: 1 }, results: passing, a11yReports: [] }
  });
  assert.equal(visual.conclusion, 'failure');
  assert.equal(visual.title, 'Incomplete run');
  assert.equal(a11y.conclusion, 'failure');
});

test('visual changes fail until approved, and the approval label comes from the trusted config', () => {
  const blocked = gate({
    bundle: { meta, results: changedOnly, a11yReports: [] },
    config: { ...config, visual: { ...config.visual, approvalLabel: 'ok-visual' } }
  });
  assert.equal(blocked.visual.conclusion, 'failure');
  assert.match(blocked.visual.summary, /`ok-visual` label/);
  const approved = gate({ bundle: { meta, results: changedOnly, a11yReports: [] }, approved: true });
  assert.equal(approved.visual.conclusion, 'success');
  assert.equal(approved.approvedForManifest, true);
});

test('interaction failures fail the visual check even when approved', () => {
  assert.equal(gate({ bundle: { meta, results, a11yReports: [] }, approved: true }).visual.conclusion, 'failure');
});

test('accessibility: blocking from raw counts against the baseline, enforced rules from the trusted config', () => {
  const reports = [{ id: 'card--default', violations: [contrast(3)] }];
  const baseline = { stories: { 'card--default': { 'color-contrast': 3 } } };
  assert.equal(gate({ bundle: { meta, results: passing, a11yReports: reports }, baseline }).a11y.conclusion, 'success');
  const enforced = { ...config, a11y: { ...config.a11y, enforcedRules: ['color-contrast'] } };
  // A pull request's baseline cannot exempt an enforced rule.
  assert.equal(
    gate({ bundle: { meta, results: passing, a11yReports: reports }, baseline, config: enforced }).a11y.conclusion,
    'failure'
  );
});

test('accessibility disabled in the trusted config gives a neutral check', () => {
  const disabled = { ...config, a11y: { ...config.a11y, enabled: false } };
  assert.equal(gate({ config: disabled }).a11y.conclusion, 'neutral');
});

const labeled = at => ({ event: 'labeled', created_at: at, label: { name: 'visual-approved' } });

test('approval: the label must be added after the current commit was first built', () => {
  const runs = ['2026-10-04T10:00:00Z', '2026-10-04T10:05:00Z'];
  assert.deepEqual(
    evaluateApproval({
      labelName: 'visual-approved',
      labelPresent: true,
      labelEvents: [labeled('2026-10-04T10:03:00Z')],
      headRunTimes: runs
    }),
    { approved: true, stale: false }
  );
  // Approved an earlier commit, then a new commit was pushed: stale, must be withdrawn.
  assert.deepEqual(
    evaluateApproval({
      labelName: 'visual-approved',
      labelPresent: true,
      labelEvents: [labeled('2026-10-04T09:00:00Z')],
      headRunTimes: runs
    }),
    { approved: false, stale: true }
  );
});

test('approval: the most recent labeled event counts; other labels and missing data never approve', () => {
  const runs = ['2026-10-04T10:00:00Z'];
  const events = [
    labeled('2026-10-04T09:00:00Z'),
    labeled('2026-10-04T11:00:00Z'),
    { event: 'labeled', created_at: '2026-10-04T12:00:00Z', label: { name: 'other' } }
  ];
  assert.equal(
    evaluateApproval({ labelName: 'visual-approved', labelPresent: true, labelEvents: events, headRunTimes: runs })
      .approved,
    true
  );
  assert.equal(
    evaluateApproval({ labelName: 'visual-approved', labelPresent: false, labelEvents: events, headRunTimes: runs })
      .approved,
    false
  );
  assert.equal(
    evaluateApproval({ labelName: 'visual-approved', labelPresent: true, labelEvents: [], headRunTimes: runs })
      .approved,
    false
  );
  assert.equal(
    evaluateApproval({ labelName: 'visual-approved', labelPresent: true, labelEvents: events, headRunTimes: [] })
      .approved,
    false
  );
});
