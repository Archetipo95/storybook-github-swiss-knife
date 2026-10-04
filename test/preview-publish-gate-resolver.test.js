import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';

// The `gate` job of `pr-preview-publish.yml` imports the trusted pull-request-identity
// resolver (src/resolve-run-context.js). Inside a reusable workflow a plain checkout is the
// *caller's* repository (the storybook-github-pages v1.9.1 bug), and a private swiss-knife
// repository cannot be checked out with the caller's token at all. So the resolver comes
// from the pinned `actions/toolkit` action, which exports SWISS_KNIFE_ROOT.
//
// These tests prove it statically (pinned toolkit, no checkout of this repository, import
// from SWISS_KNIFE_ROOT) and functionally, by running the real step script from a directory
// that, like a consumer's checkout, has no top-level `src/`.

const repoRoot = process.cwd();
const workflowPath = path.join(repoRoot, '.github/workflows/pr-preview-publish.yml');

function gitShowExists(sha, relPath) {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}:${relPath}`], {
      cwd: repoRoot,
      stdio: ['ignore', 'ignore', 'ignore']
    });
    return true;
  } catch {
    return false;
  }
}

function gateJob() {
  const content = fs.readFileSync(workflowPath, 'utf8');
  const match = content.match(/\n {2}gate:\n([\s\S]*?)\n {2}[a-z-]+:\n/);
  assert.ok(match, 'could not locate the gate job in pr-preview-publish.yml');
  return match[1];
}

function extractGateResolverStep() {
  const content = fs.readFileSync(workflowPath, 'utf8');
  const stepMatch = content.match(
    /- name: Extract trusted pull request context[\s\S]*?run: \|\n([\s\S]*?)\n\n {6}- name: Fetch current pull request head SHA/
  );
  assert.ok(stepMatch, 'could not locate the "Extract trusted pull request context" step script');
  return stepMatch[1];
}

function runStep({ cwd, env }) {
  const outputFile = path.join(cwd, 'github_output');
  fs.writeFileSync(outputFile, '');
  const result = spawnSync('bash', ['-c', extractGateResolverStep()], {
    cwd,
    env: {
      ...process.env,
      INPUT_ARTIFACT_NAME: '',
      GITHUB_TOKEN: 'test-token',
      REPOSITORY: 'Archetipo95/storybook-vue-demo',
      GITHUB_OUTPUT: outputFile,
      ...env
    },
    encoding: 'utf8'
  });
  return { result, output: fs.readFileSync(outputFile, 'utf8') };
}

test('gate job loads the resolver through the pinned toolkit action, never a checkout of this repository', () => {
  const job = gateJob();
  const toolkit = job.match(/uses: Archetipo95\/storybook-github-swiss-knife\/actions\/toolkit@([a-f0-9]{40})/);
  assert.ok(toolkit, 'gate job must use actions/toolkit pinned to a full commit SHA');
  assert.ok(job.indexOf('actions/toolkit@') < job.indexOf('Extract trusted pull request context'));
  assert.doesNotMatch(job, /repository:\s*Archetipo95\/storybook-github-swiss-knife/);

  const sha = toolkit[1];
  assert.ok(gitShowExists(sha, 'actions/toolkit/action.yml'), `pinned commit ${sha} has no actions/toolkit`);
  assert.ok(gitShowExists(sha, 'src/resolve-run-context.js'), `pinned commit ${sha} has no resolver`);
});

test('extract-context step imports the resolver from SWISS_KNIFE_ROOT, not the job workspace', () => {
  const script = extractGateResolverStep();
  assert.match(script, /import\(process\.env\.SWISS_KNIFE_ROOT \+ "\/src\/resolve-run-context\.js"\)/);
  assert.doesNotMatch(script, /import\("\.\/[^"]*resolve-run-context\.js"\)/);
});

test('extract-context step resolves the trusted PR context when the workspace has no src/ (consumer checkout)', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-resolver-consumer-checkout-'));
  assert.ok(!fs.existsSync(path.join(workDir, 'src')), 'sanity check: consumer checkout has no top-level src/');

  const runId = 987654321;
  const runData = {
    id: runId,
    conclusion: 'success',
    event: 'pull_request',
    repository: { full_name: 'Archetipo95/storybook-vue-demo' },
    head_repository: { full_name: 'Archetipo95/storybook-vue-demo' },
    head_sha: 'a'.repeat(40),
    pull_requests: [{ number: 42, base: { ref: 'main' } }]
  };
  // Stub fetch (artifacts listing) so the test never hits the network.
  const stubPath = path.join(workDir, 'fetch-stub.cjs');
  fs.writeFileSync(
    stubPath,
    `globalThis.fetch = async (url) => {
      if (String(url).includes('/artifacts')) {
        return { ok: true, json: async () => ({ artifacts: [{ name: 'storybook-preview-pr-42-run-${runId}' }] }) };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    };`
  );

  const { result, output } = runStep({
    cwd: workDir,
    env: {
      SWISS_KNIFE_ROOT: repoRoot,
      NODE_OPTIONS: `--require ${stubPath}`,
      WORKFLOW_RUN_EVENT: JSON.stringify(runData),
      INPUT_RUN_ID: ''
    }
  });

  assert.equal(result.status, 0, `expected script to succeed, got stderr: ${result.stderr}`);
  assert.match(output, /run_id=987654321/);
  assert.match(output, /pr_number=42/);
  assert.match(output, /base_ref=main/);
  assert.match(output, new RegExp(`head_sha=${'a'.repeat(40)}`));
});

test('extract-context step fails loudly when SWISS_KNIFE_ROOT does not hold the resolver', () => {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-resolver-missing-'));
  const { result } = runStep({
    cwd: workDir,
    env: { SWISS_KNIFE_ROOT: workDir, WORKFLOW_RUN_EVENT: '', INPUT_RUN_ID: '999' }
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot find module/);
});
