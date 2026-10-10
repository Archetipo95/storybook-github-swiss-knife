import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { captureFingerprint, plan, planMode } from '../src/visual/plan.js';
import { VISUAL_DEFAULTS } from '../src/swiss-knife-config.js';

const config = { visual: { ...VISUAL_DEFAULTS, baselineBranches: ['main', 'preprod'] } };

test('planMode: pull requests compare, baseline branches capture, others skip', () => {
  assert.equal(planMode(config, { eventName: 'pull_request', eventAction: 'synchronize' }).mode, 'compare');
  assert.equal(planMode(config, { eventName: 'push', refName: 'preprod' }).mode, 'baseline');
  assert.equal(planMode(config, { eventName: 'push', refName: 'feature/x' }).mode, 'skip');
  assert.equal(planMode({ visual: { ...config.visual, enabled: false } }, { eventName: 'pull_request' }).mode, 'skip');
});

test('planMode: every label event re-gates the results of the commit', () => {
  assert.equal(
    planMode(config, { eventName: 'pull_request', eventAction: 'labeled', labelName: 'visual-approved' }).mode,
    'reuse'
  );
  assert.equal(
    planMode(config, { eventName: 'pull_request', eventAction: 'unlabeled', labelName: 'visual-approved' }).mode,
    'reuse'
  );
  // Another label re-gates too: if it cancelled a run for the approval label, it must still see it.
  const other = planMode(config, { eventName: 'pull_request', eventAction: 'labeled', labelName: 'bug' });
  assert.equal(other.mode, 'reuse');
  assert.match(other.reason, /label bug changed/);
});

test('captureFingerprint changes with the runner code and the visual config', () => {
  const runner = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-'));
  fs.mkdirSync(path.join(runner, 'lib'));
  fs.mkdirSync(path.join(runner, 'tests'));
  fs.writeFileSync(path.join(runner, 'package-lock.json'), '{}');
  fs.writeFileSync(path.join(runner, 'playwright.config.js'), 'a');
  fs.writeFileSync(path.join(runner, 'lib/x.js'), 'x');
  fs.writeFileSync(path.join(runner, 'tests/t.js'), 't');
  const first = captureFingerprint(runner, config.visual);
  assert.equal(captureFingerprint(runner, config.visual), first);
  assert.notEqual(captureFingerprint(runner, { ...config.visual, threshold: 0.3 }), first);
  fs.writeFileSync(path.join(runner, 'lib/x.js'), 'changed');
  assert.notEqual(captureFingerprint(runner, config.visual), first);
});

test('plan: shards, baseline commit in the cache key and retention', () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-'));
  fs.mkdirSync(path.join(project, '.storybook'));
  fs.writeFileSync(
    path.join(project, '.storybook/swiss-knife.json'),
    JSON.stringify({ visual: { shards: 3, reportRetentionDays: 7 } })
  );
  const common = {
    SWISS_KNIFE_ROOT: process.cwd(),
    PROJECT_DIR: project,
    BASE_SHA: 'b'.repeat(40),
    HEAD_SHA: 'h'.repeat(40)
  };
  const pr = plan({ ...common, EVENT_NAME: 'pull_request', EVENT_ACTION: 'opened' });
  assert.equal(pr.mode, 'compare');
  assert.deepEqual(JSON.parse(pr.shards), ['1/3', '2/3', '3/3']);
  assert.match(pr.key_prefix, /^sk-visual-v1-b{40}-[0-9a-f]{20}$/);
  assert.equal(pr.retention_days, '7');
  const push = plan({ ...common, EVENT_NAME: 'push', REF_NAME: 'main' });
  assert.equal(push.mode, 'baseline');
  assert.match(push.key_prefix, /^sk-visual-v1-h{40}-/);
});
