import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runVisualGate } from '../src/gate/run.js';

const REPO = 'acme/widgets';
const HEAD = 'a'.repeat(40);
const RUN_ID = 555;
const mergedResults = JSON.parse(
  fs.readFileSync(path.join(process.cwd(), 'test/fixtures/visual/merged-results.json'), 'utf8')
);
const changedOnly = {
  suites: [{ specs: mergedResults.suites[0].specs.filter(spec => spec.title === 'Button › Primary') }]
};

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-run-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

function bundle({ results = changedOnly, shardsReported = 1, prNumber = 7 } = {}) {
  return tmp({
    'meta.json': { version: 1, headSha: HEAD, prNumber, shardsExpected: 1, shardsReported },
    'results/visual-results.json': results,
    'results/a11y/card--default.json': {
      id: 'card--default',
      violations: [{ id: 'color-contrast', impact: 'serious', help: 'contrast', nodes: 2 }]
    },
    'visual/index.html': '<html><body>report</body></html>',
    'visual/gallery/manifest.json': { version: 1, approved: false, stories: {} }
  });
}

const project = () =>
  tmp({
    '.storybook/swiss-knife.json': {
      pages: { preview_root: 'pr-preview' },
      visual: { approvalLabel: 'visual-approved' }
    }
  });

function fakeGitHub({
  headRepo = REPO,
  labels = ['visual-approved'],
  labeledAt = '2026-10-04T09:00:00Z',
  firstRunAt = '2026-10-04T10:00:00Z',
  artifactRunId = RUN_ID,
  conclusion = 'failure',
  baseline = { stories: { 'card--default': { 'color-contrast': 2 } } }
} = {}) {
  const calls = [];
  const request = async (apiPath, { method = 'GET', body } = {}) => {
    calls.push({ method, apiPath, body });
    const route = apiPath.split('?')[0];
    if (route === `/repos/${REPO}/actions/runs/${RUN_ID}`) {
      return {
        id: RUN_ID,
        head_sha: HEAD,
        workflow_id: 99,
        conclusion,
        html_url: 'https://github.com/acme/widgets/actions/runs/555',
        head_repository: { full_name: headRepo }
      };
    }
    if (route === `/repos/${REPO}/actions/runs/${RUN_ID}/artifacts`) {
      return { artifacts: [{ name: `swiss-knife-visual-pr-7-run-${artifactRunId}` }] };
    }
    if (route === `/repos/${REPO}/pulls/7`) {
      return {
        number: 7,
        state: 'open',
        head: { sha: HEAD, repo: { full_name: headRepo } },
        labels: labels.map(name => ({ name }))
      };
    }
    if (route.startsWith(`/repos/${REPO}/contents/`)) return JSON.stringify(baseline);
    if (route === `/repos/${REPO}/issues/7/events`) {
      return [{ event: 'labeled', created_at: labeledAt, label: { name: 'visual-approved' } }];
    }
    if (route === `/repos/${REPO}/actions/workflows/99/runs`) return { workflow_runs: [{ created_at: firstRunAt }] };
    if (method === 'POST' || method === 'DELETE') return {};
    throw new Error(`unexpected ${method} ${apiPath}`);
  };
  return { calls, request };
}

const checkRuns = calls =>
  calls.filter(call => call.method === 'POST' && call.apiPath.endsWith('/check-runs')).map(call => call.body);

async function run({ github = fakeGitHub(), bundleDir = bundle(), pagesRepo = tmp({ '.nojekyll': '' }) } = {}) {
  const published = [];
  const output = await runVisualGate({
    env: {
      REPOSITORY: REPO,
      RUN_ID: String(RUN_ID),
      PROJECT_DIR: project(),
      BUNDLE_DIR: bundleDir,
      PAGES_REPO: pagesRepo,
      GITHUB_TOKEN: 't'
    },
    request: github.request,
    publish: async options => {
      published.push({
        ...options,
        manifest: JSON.parse(fs.readFileSync(path.join(options.source, 'gallery/manifest.json'), 'utf8'))
      });
      return {};
    },
    log: () => {}
  });
  return { output, calls: github.calls, published };
}

test('stale approval: checks fail, the label is withdrawn, the report is published unapproved', async () => {
  const { output, calls, published } = await run();
  const checks = checkRuns(calls);
  assert.deepEqual(
    checks.map(check => [check.name, check.conclusion, check.head_sha]),
    [
      ['swiss-knife / visual', 'failure', HEAD],
      ['swiss-knife / accessibility', 'success', HEAD]
    ]
  );
  assert.ok(
    calls.some(call => call.method === 'DELETE' && call.apiPath === `/repos/${REPO}/issues/7/labels/visual-approved`)
  );
  assert.equal(published.length, 1);
  assert.equal(published[0].targetDirectory, 'pr-preview/pr-7/visual');
  assert.equal(published[0].manifest.approved, false);
  assert.equal(output.reportUrl, 'https://acme.github.io/widgets/pr-preview/pr-7/visual/');
  assert.match(checks[0].output.summary, /pr-preview\/pr-7\/visual\//);
});

test('approval given after the commit was built passes and keeps the label', async () => {
  const { calls, published } = await run({ github: fakeGitHub({ labeledAt: '2026-10-04T11:00:00Z' }) });
  assert.equal(checkRuns(calls)[0].conclusion, 'success');
  assert.ok(!calls.some(call => call.method === 'DELETE'));
  assert.equal(published[0].manifest.approved, true);
});

test('a baseline count lowered by the PR still comes from the PR head, and new nodes still block', async () => {
  const { calls } = await run({ github: fakeGitHub({ baseline: { stories: {} } }) });
  assert.equal(checkRuns(calls)[1].conclusion, 'failure');
});

test('no results bundle: both checks are posted as failures, nothing is published', async () => {
  const { calls, published } = await run({ bundleDir: path.join(os.tmpdir(), 'does-not-exist-swiss-knife') });
  assert.deepEqual(
    checkRuns(calls).map(check => check.conclusion),
    ['failure', 'failure']
  );
  assert.equal(published.length, 0);
});

test('fork pull request: checks are posted, nothing is published', async () => {
  const { output, calls, published } = await run({ github: fakeGitHub({ headRepo: 'someone/widgets' }) });
  assert.equal(output.isFork, true);
  assert.equal(checkRuns(calls).length, 2);
  assert.equal(published.length, 0);
});

test('an artifact named for another run does not identify the pull request', async () => {
  const { output, calls } = await run({
    github: fakeGitHub({ artifactRunId: 1 }),
    bundleDir: path.join(os.tmpdir(), 'nope-swiss-knife')
  });
  assert.equal(output.prNumber, 0);
  assert.deepEqual(
    checkRuns(calls).map(check => check.conclusion),
    ['failure', 'failure']
  );
});

test('a cancelled run fails both checks even with a partial bundle', async () => {
  const { calls } = await run({ github: fakeGitHub({ conclusion: 'cancelled' }) });
  assert.deepEqual(
    checkRuns(calls).map(check => check.conclusion),
    ['failure', 'failure']
  );
});

test('a successful run that uploaded no results (unrelated label) posts nothing', async () => {
  const github = fakeGitHub({ conclusion: 'success', artifactRunId: 1 });
  const output = await runVisualGate({
    env: { REPOSITORY: REPO, RUN_ID: String(RUN_ID), PROJECT_DIR: project(), GITHUB_TOKEN: 't' },
    request: github.request,
    log: () => {}
  });
  assert.deepEqual(output, { skipped: true });
  assert.equal(checkRuns(github.calls).length, 0);
});
