import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// In a reusable workflow, `github.event` and `github.event_name` describe the caller's run. A job
// gated on `github.event.repository.private` meant for this repository's own runs therefore skips
// every private caller: the janitor skipped private callers' scheduled runs that way.

const workflowDir = path.join(process.cwd(), '.github/workflows');

test("reusable workflows do not gate on the repository being private (it is the caller's)", () => {
  const offenders = fs
    .readdirSync(workflowDir)
    .filter(file => /\.ya?ml$/.test(file))
    .filter(file => /\n {2}workflow_call:/.test(fs.readFileSync(path.join(workflowDir, file), 'utf8')))
    .filter(file => /github\.event\.repository\.private/.test(fs.readFileSync(path.join(workflowDir, file), 'utf8')));
  assert.deepEqual(offenders, []);
});
