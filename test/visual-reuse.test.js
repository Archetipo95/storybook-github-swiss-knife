import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseCommandFile, stepRun } from './helpers/workflow-step.js';

// A label event reuses the commit's results instead of capturing them again (second audit #12).
// After a re-run of the capture, label runs kept reusing an older copy: the lookup took the run
// created last (an earlier label run, whose bundle copies the first results), and download-artifact
// keeps one artifact per name, not always the re-run's newer one.

const WORKFLOW = '.github/workflows/visual.yml';
const REPO = 'acme/widgets';

/** Runs the lookup step against a fake `gh api` that answers from `responses` (by API path) with jq. */
function findResults(t, responses) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-visual-reuse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const fixtures = path.join(dir, 'fixtures');
  fs.mkdirSync(fixtures);
  const key = apiPath => apiPath.replace(/[^A-Za-z0-9]/g, '_');
  for (const [apiPath, body] of Object.entries(responses)) {
    fs.writeFileSync(path.join(fixtures, `${key(apiPath)}.json`), JSON.stringify(body));
  }
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(
    path.join(bin, 'gh'),
    `#!/bin/sh\n# gh api <path> --jq <expr>\nfile="${fixtures}/$(printf '%s' "$2" | sed 's/[^A-Za-z0-9]/_/g').json"\njq -r "$4" "$file"\n`,
    { mode: 0o755 }
  );
  const output = path.join(dir, 'output');
  fs.writeFileSync(output, '');
  execFileSync('bash', ['-c', stepRun(WORKFLOW, 'Find results to reuse')], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_REPOSITORY: REPO,
      GITHUB_OUTPUT: output,
      HEAD_SHA: 'a'.repeat(40),
      PR_NUMBER: '7',
      CURRENT_RUN: '300'
    },
    stdio: 'pipe'
  });
  return parseCommandFile(fs.readFileSync(output, 'utf8'));
}

const runsPath = `repos/${REPO}/actions/workflows/9/runs?head_sha=${'a'.repeat(40)}&status=completed&per_page=50`;
const artifactsPath = run => `repos/${REPO}/actions/runs/${run}/artifacts?name=swiss-knife-visual-pr-7-run-${run}`;

test('a label run reuses the newest bundle of the run that captured last, even after a re-run', t => {
  const found = findResults(t, {
    [`repos/${REPO}/actions/runs/300`]: { workflow_id: 9 },
    // The capture (100) was re-run at 12:00, after a label run (200) copied its first results.
    [runsPath]: {
      workflow_runs: [
        { id: 200, created_at: '2026-10-04T11:00:00Z', run_started_at: '2026-10-04T11:00:00Z' },
        { id: 100, created_at: '2026-10-04T10:00:00Z', run_started_at: '2026-10-04T12:00:00Z' }
      ]
    },
    [artifactsPath(100)]: {
      artifacts: [
        { id: 1, created_at: '2026-10-04T10:05:00Z', expired: false },
        { id: 3, created_at: '2026-10-04T12:05:00Z', expired: false }
      ]
    },
    [artifactsPath(200)]: { artifacts: [{ id: 2, created_at: '2026-10-04T11:01:00Z', expired: false }] }
  });
  assert.deepEqual(found, { run_id: '100', artifact_id: '3' });
});

test('an expired bundle is skipped for the next run that still has one', t => {
  const found = findResults(t, {
    [`repos/${REPO}/actions/runs/300`]: { workflow_id: 9 },
    [runsPath]: {
      workflow_runs: [
        { id: 100, run_started_at: '2026-10-04T12:00:00Z' },
        { id: 200, run_started_at: '2026-10-04T11:00:00Z' }
      ]
    },
    [artifactsPath(100)]: { artifacts: [{ id: 3, created_at: '2026-10-04T12:05:00Z', expired: true }] },
    [artifactsPath(200)]: { artifacts: [{ id: 2, created_at: '2026-10-04T11:01:00Z', expired: false }] }
  });
  assert.deepEqual(found, { run_id: '200', artifact_id: '2' });
});

test('the reuse job downloads the chosen bundle by id', () => {
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  assert.match(text, /if: needs\.plan\.outputs\.mode == 'reuse' && needs\.plan\.outputs\.reuse_artifact_id != ''/);
  assert.match(text, /ARTIFACT_ID: \$\{\{ needs\.plan\.outputs\.reuse_artifact_id \}\}/);
  assert.match(text, /gh api "repos\/\$GITHUB_REPOSITORY\/actions\/artifacts\/\$ARTIFACT_ID\/zip"/);
  assert.doesNotMatch(text, /run-id: \$\{\{ needs\.plan\.outputs\.reuse_run_id \}\}/);
});
