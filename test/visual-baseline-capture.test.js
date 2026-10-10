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
