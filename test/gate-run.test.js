import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { runVisualGate } from '../src/gate/run.js';

const REPO = 'acme/widgets';
const HEAD = 'a'.repeat(40);
const RUN_ID = 555;
const BASE = 'b'.repeat(40);
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
  conclusion = 'success',
  baseline = { stories: { 'card--default': { 'color-contrast': 2 } } },
  baseBaseline = baseline,
  existingChecks = 0,
  runPath = '.github/workflows/visual-caller.yml',
  callerAtHead = 'caller workflow',
  prHead = HEAD,
  comments = [],
  readBack = []
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
        path: runPath,
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
        head: { sha: prHead, repo: { full_name: headRepo } },
        base: { sha: BASE },
        labels: labels.map(name => ({ name }))
      };
    }
    if (route === `/repos/${REPO}`) return { default_branch: 'main' };
    if (route.startsWith(`/repos/${REPO}/contents/.github/`)) {
      if (apiPath.includes(`ref=${HEAD}`)) return callerAtHead;
      return apiPath.includes(`ref=${BASE}`) ? 'caller workflow' : 'default branch version';
    }
    if (route.startsWith(`/repos/${REPO}/contents/`)) {
      return JSON.stringify(apiPath.includes(`ref=${BASE}`) ? baseBaseline : baseline);
    }
    if (route === `/repos/${REPO}/issues/7/events`) {
      return [{ event: 'labeled', created_at: labeledAt, label: { name: 'visual-approved' } }];
    }
    if (route === `/repos/${REPO}/actions/workflows/99/runs`) return { workflow_runs: [{ created_at: firstRunAt }] };
    if (route === `/repos/${REPO}/commits/${HEAD}/check-runs`) return { total_count: existingChecks };
    if (route === `/repos/${REPO}/issues/7/comments` && method === 'GET') return comments;
    if (route.startsWith(`/repos/${REPO}/issues/comments/`) && method === 'GET') return readBack.shift() ?? null;
    if (method === 'POST' || method === 'DELETE' || method === 'PATCH') return {};
    throw new Error(`unexpected ${method} ${apiPath}`);
  };
  return { calls, request };
}

const checkRuns = calls =>
  calls.filter(call => call.method === 'POST' && call.apiPath.endsWith('/check-runs')).map(call => call.body);

async function run({
  commentVerifyMs = 0,
  github = fakeGitHub(),
  bundleDir = bundle(),
  pagesRepo = tmp({ '.nojekyll': '' }),
  env = {}
} = {}) {
  const published = [];
  const output = await runVisualGate({
    env: {
      REPOSITORY: REPO,
      RUN_ID: String(RUN_ID),
      PROJECT_DIR: project(),
      BUNDLE_DIR: bundleDir,
      PAGES_REPO: pagesRepo,
      GITHUB_TOKEN: 't',
      ...env
    },
    request: github.request,
    publish: async options => {
      published.push({
        ...options,
        manifest: JSON.parse(fs.readFileSync(path.join(options.source, 'gallery/manifest.json'), 'utf8'))
      });
      return {};
    },
    log: () => {},
    commentVerifyMs
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

test('a successful run that uploaded no results posts nothing when the commit is already gated', async () => {
  const github = fakeGitHub({ conclusion: 'success', artifactRunId: 1, existingChecks: 2 });
  const output = await runVisualGate({
    env: { REPOSITORY: REPO, RUN_ID: String(RUN_ID), PROJECT_DIR: project(), GITHUB_TOKEN: 't' },
    request: github.request,
    log: () => {}
  });
  assert.deepEqual(output, { skipped: true });
  assert.equal(checkRuns(github.calls).length, 0);
});

test('the a11y baseline is read from the project directory at the PR head', async () => {
  const github = fakeGitHub();
  await runVisualGate({
    env: {
      REPOSITORY: REPO,
      RUN_ID: String(RUN_ID),
      PROJECT_DIR: project(),
      WORKING_DIRECTORY: 'packages/ui',
      BUNDLE_DIR: bundle(),
      GITHUB_TOKEN: 't'
    },
    request: github.request,
    log: () => {}
  });
  assert.ok(
    github.calls.some(
      call => call.apiPath === `/repos/${REPO}/contents/packages/ui/.storybook/a11y-baseline.json?ref=${HEAD}`
    )
  );
  await assert.rejects(
    runVisualGate({
      env: { REPOSITORY: REPO, RUN_ID: String(RUN_ID), PROJECT_DIR: project(), WORKING_DIRECTORY: '../x' },
      request: github.request,
      log: () => {}
    }),
    /WORKING_DIRECTORY must stay inside the repository/
  );
});

test('a successful run without results on an ungated commit fails both checks (caller tampering)', async () => {
  const github = fakeGitHub({ conclusion: 'success', artifactRunId: 1, existingChecks: 0 });
  await runVisualGate({
    env: { REPOSITORY: REPO, RUN_ID: String(RUN_ID), PROJECT_DIR: project(), GITHUB_TOKEN: 't' },
    request: github.request,
    log: () => {}
  });
  assert.deepEqual(
    checkRuns(github.calls).map(check => check.conclusion),
    ['failure', 'failure']
  );
});

test('a run that ended in failure fails both checks even with a bundle', async () => {
  const { calls, published } = await run({ github: fakeGitHub({ conclusion: 'failure' }) });
  assert.deepEqual(
    checkRuns(calls).map(check => check.conclusion),
    ['failure', 'failure']
  );
  assert.match(checkRuns(calls)[0].output.summary, /ended with "failure"/);
  assert.equal(published.length, 0);
});

test('caller verification: the run must come from the visual workflow, unchanged from the default branch', async () => {
  const env = {
    CALLER_WORKFLOW: '.github/workflows/visual-caller.yml',
    PROTECTED_PATHS: '.github/workflows/visual.yml'
  };
  const good = await run({ github: fakeGitHub({ conclusion: 'success', labeledAt: '2026-10-04T11:00:00Z' }), env });
  assert.equal(checkRuns(good.calls)[0].conclusion, 'success');

  const renamed = await run({
    github: fakeGitHub({ conclusion: 'success', runPath: '.github/workflows/evil.yml' }),
    env
  });
  assert.match(checkRuns(renamed.calls)[0].output.summary, /not the visual workflow/);
  assert.equal(checkRuns(renamed.calls)[1].conclusion, 'failure');

  const edited = await run({
    github: fakeGitHub({ conclusion: 'success', callerAtHead: 'uploads fake results' }),
    env
  });
  assert.match(checkRuns(edited.calls)[0].output.summary, /differs from the base branch/);
  assert.equal(edited.published.length, 0);
});

test('approval is not borrowed from a pull request whose head is another commit', async () => {
  const { calls } = await run({
    github: fakeGitHub({ conclusion: 'success', labeledAt: '2026-10-04T11:00:00Z', prHead: 'c'.repeat(40) })
  });
  assert.equal(checkRuns(calls)[0].conclusion, 'failure');
});

test('a bundle with a symlink is rejected and nothing is published', async () => {
  const bundleDir = bundle();
  fs.symlinkSync('/etc/passwd', path.join(bundleDir, 'visual', 'leak'));
  const { calls, published } = await run({ github: fakeGitHub({ conclusion: 'success' }), bundleDir });
  assert.match(checkRuns(calls)[0].output.summary, /contains visual\/leak/);
  assert.equal(published.length, 0);
});

test('baseline entries raised by the pull request are listed in the accessibility check', async () => {
  const { calls } = await run({
    github: fakeGitHub({
      conclusion: 'success',
      baseBaseline: { stories: { 'card--default': { 'color-contrast': 1 } } }
    })
  });
  const a11y = checkRuns(calls)[1];
  assert.equal(a11y.conclusion, 'success');
  assert.match(
    a11y.output.summary,
    /Baseline raised in this pull request[\s\S]*`card--default`: `color-contrast` 1 → 2/
  );
});

const commentWrites = calls =>
  calls.filter(call => call.apiPath.includes('/comments') && (call.method === 'POST' || call.method === 'PATCH'));

test('the results are added to a new pull request comment when the preview has not posted one', async () => {
  const { calls } = await run();
  const [write] = commentWrites(calls);
  assert.equal(write.method, 'POST');
  assert.equal(write.apiPath, `/repos/${REPO}/issues/7/comments`);
  assert.ok(write.body.body.startsWith('<!-- swiss-knife:pr-7 -->'));
  assert.match(write.body.body, /\| swiss-knife \/ visual \| :x: 1 visual change to review \|/);
  assert.match(write.body.body, /\| swiss-knife \/ accessibility \| :white_check_mark: No new violations \|/);
  assert.match(write.body.body, /\[visual report\]\(https:\/\/acme\.github\.io\/widgets\/pr-preview\/pr-7\/visual\/\)/);
  assert.ok(!write.body.body.includes('<!-- swiss-knife:a11y -->'));
});

test('the results replace their block in the preview comment and keep the preview part', async () => {
  const preview =
    '<!-- swiss-knife:pr-7 -->\n## Storybook preview\n\n<!-- swiss-knife-checks -->\nold\n<!-- /swiss-knife-checks -->\n<sub>footer</sub>';
  const github = fakeGitHub({
    comments: [{ id: 9, body: preview, user: { login: 'github-actions[bot]', type: 'Bot' } }]
  });
  const { calls } = await run({ github });
  const writes = commentWrites(calls);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, 'PATCH');
  assert.equal(writes[0].apiPath, `/repos/${REPO}/issues/comments/9`);
  assert.match(writes[0].body.body, /^<!-- swiss-knife:pr-7 -->\n## Storybook preview/);
  assert.ok(!writes[0].body.body.includes('\nold\n'));
  assert.match(writes[0].body.body, /<\/details>\n<!-- \/swiss-knife-checks -->\n<sub>footer<\/sub>$/);
});

test('a marker in a comment the bot did not write is left alone and the checks still post', async () => {
  const github = fakeGitHub({
    comments: [{ id: 3, body: '<!-- swiss-knife:pr-7 -->', user: { login: 'mallory', type: 'User' } }]
  });
  const { calls } = await run({ github });
  assert.equal(commentWrites(calls).length, 0);
  assert.equal(checkRuns(calls).length, 2);
});

test('results for a commit that is no longer the head do not touch the comment', async () => {
  const { calls } = await run({ github: fakeGitHub({ prHead: 'c'.repeat(40) }) });
  assert.equal(commentWrites(calls).length, 0);
});

test('the results block is written again when the preview publisher put an older one back', async () => {
  const preview = '<!-- swiss-knife:pr-7 -->\n## Storybook preview\n<sub>footer</sub>';
  const stale =
    '<!-- swiss-knife:pr-7 -->\n## Storybook preview\n\n<!-- swiss-knife-checks -->\nold\n<!-- /swiss-knife-checks -->\n<sub>footer</sub>';
  const bot = { user: { login: 'github-actions[bot]', type: 'Bot' } };
  const github = fakeGitHub({ comments: [{ id: 9, body: preview, ...bot }] });
  const { calls } = await run({
    commentVerifyMs: 1,
    github: {
      ...github,
      request: async (apiPath, options = {}) => {
        if ((options.method ?? 'GET') === 'GET' && apiPath === `/repos/${REPO}/issues/comments/9`) {
          const writes = commentWrites(github.calls);
          // First read-back: the publisher overwrote the block; second: the gate's block stuck.
          return { id: 9, body: writes.length === 1 ? stale : writes.at(-1).body.body };
        }
        return github.request(apiPath, options);
      }
    }
  });
  const writes = commentWrites(calls);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(write => write.method === 'PATCH' && write.body.body.includes('swiss-knife / visual')));
});
