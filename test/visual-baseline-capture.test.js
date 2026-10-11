import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { baselineCaptureProblem, countScreenshots } from '../src/visual/baseline-capture.js';

const script = path.resolve('src/visual/baseline-capture.js');

test('a baseline capture is unusable only when it failed and wrote no screenshot', () => {
  assert.equal(baselineCaptureProblem({ status: 0, screenshots: 12 }), null);
  // A shard whose stories are all skipped writes nothing and exits 0.
  assert.equal(baselineCaptureProblem({ status: 0, screenshots: 0 }), null);
  // Some stories failed to render: they are reported as new, the others compared.
  assert.equal(baselineCaptureProblem({ status: 1, screenshots: 11 }), null);
  assert.match(baselineCaptureProblem({ status: 1, screenshots: 0 }), /exit status 1\) and wrote no screenshot/);
});

test('the CLI fails a crashed capture and counts screenshots in the resolved snapshot dir', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-baseline-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const run = (status, snapshotDir) =>
    spawnSync('node', [script, String(status), project, snapshotDir], { encoding: 'utf8' });

  // No snapshot dir at all: the browser never started.
  const crashed = run(1, '.swiss-knife/snapshots');
  assert.equal(crashed.status, 1);
  assert.match(crashed.stderr, /^::error::The baseline capture failed \(exit status 1\)/);

  const snapshots = path.join(project, '.swiss-knife/snapshots');
  fs.mkdirSync(snapshots, { recursive: true });
  fs.writeFileSync(path.join(snapshots, '.swiss-knife-baseline'), '');
  assert.equal(countScreenshots(snapshots), 0, 'the cache marker is not a screenshot');
  assert.equal(run(1, '.swiss-knife/snapshots').status, 1);

  fs.writeFileSync(path.join(snapshots, 'button--primary.png'), '');
  assert.equal(run(1, '.swiss-knife/snapshots').status, 0);
  // An absolute snapshot dir is used as is.
  assert.equal(run(1, snapshots).status, 0);
  assert.equal(run(0, 'missing').status, 0);
});

// A shard whose stories all fail to render on the base branch (a throwing global decorator, say)
// writes no screenshot either. That is not a crash: those stories are reported as new on pull
// requests, so the one that fixes them can go green (second audit #19). The run's JSON report
// tells the two apart.
const STORY_FAILURE = 'Story render or play function failed: TypeError: boom';
const report = tests => ({
  errors: [],
  suites: [
    {
      specs: tests.map(([id, message]) => ({
        title: id,
        tests: [
          {
            status: message ? 'unexpected' : 'expected',
            annotations: [{ type: 'story', description: id }],
            results: [message ? { error: { message } } : {}]
          }
        ]
      }))
    }
  ]
});

test('a baseline capture whose stories all failed to render is usable; a crash is not', () => {
  const allStoriesFailed = report([
    ['button--primary', STORY_FAILURE],
    ['button--secondary', STORY_FAILURE]
  ]);
  assert.equal(baselineCaptureProblem({ status: 1, screenshots: 0, report: allStoriesFailed }), null);

  // Other failures, run errors, or no test at all: the capture did not work.
  for (const broken of [
    report([['button--primary', 'page.goto: net::ERR_CONNECTION_REFUSED']]),
    report([
      ['button--primary', STORY_FAILURE],
      ['button--secondary', 'browserType.launch: Executable does not exist']
    ]),
    { ...allStoriesFailed, errors: [{ message: 'Error: Cannot find module' }] },
    report([]),
    null
  ]) {
    assert.match(baselineCaptureProblem({ status: 1, screenshots: 0, report: broken }), /wrote no screenshot/);
  }
});

test('the CLI reads the JSON report it is given', t => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-baseline-report-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  const reportFile = path.join(project, 'baseline-results.json');
  const run = () =>
    spawnSync('node', [script, '1', project, '.swiss-knife/snapshots', reportFile], { encoding: 'utf8' });
  fs.writeFileSync(reportFile, JSON.stringify(report([['button--primary', STORY_FAILURE]])));
  assert.equal(run().status, 0);
  fs.writeFileSync(reportFile, JSON.stringify(report([['button--primary', 'page.goto: net::ERR_ABORTED']])));
  assert.equal(run().status, 1);
  fs.rmSync(reportFile);
  assert.equal(run().status, 1, 'no report: as before');
});
