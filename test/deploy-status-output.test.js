import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseCommandFile } from './helpers/workflow-step.js';

// deploy-storybook.yml's `status` output came from job outputs hard-coded to 'success', so a failed
// deploy or directory publish still reported success to a caller reading it after the failure.
// Each publishing job now ends with a step that always runs and reports the job's own status.

const WORKFLOW = '.github/workflows/deploy-storybook.yml';
const text = fs.readFileSync(WORKFLOW, 'utf8');

/** The lines of a job, by job id. */
function job(id) {
  const lines = text.split('\n');
  const start = lines.indexOf(`  ${id}:`);
  assert.notEqual(start, -1, `${WORKFLOW} has no job ${id}`);
  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:\s*$/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

const STEP = '      - name: Set the status output';

for (const id of ['deploy', 'directory-publish']) {
  test(`${id}: the status output is the job's own outcome, set by its last step`, t => {
    const body = job(id);
    assert.match(body, /\n {6}status: \$\{\{ steps\.status\.outputs\.status \}\}\n/);
    assert.doesNotMatch(body, /status: '?success'?\n/);
    const step = body.slice(body.lastIndexOf('\n      - name: ') + 1);
    assert.ok(step.startsWith(STEP), `the last step of ${id} sets the status`);
    assert.match(step, /\n {8}id: status\n {8}if: \$\{\{ always\(\) \}\}\n/);
    assert.match(step, /\n {10}JOB_STATUS: \$\{\{ job\.status \}\}\n/);

    const script = step
      .slice(step.indexOf('run: |') + 'run: |'.length)
      .split('\n')
      .filter(line => line.trim())
      .map(line => line.replace(/^ {10}/, ''))
      .join('\n');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-deploy-status-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    for (const [jobStatus, status] of [
      ['success', 'success'],
      ['failure', 'failed'],
      ['cancelled', 'failed']
    ]) {
      const output = path.join(dir, `out-${jobStatus}`);
      fs.writeFileSync(output, '');
      execFileSync('bash', ['-c', script], { env: { ...process.env, JOB_STATUS: jobStatus, GITHUB_OUTPUT: output } });
      assert.equal(parseCommandFile(fs.readFileSync(output, 'utf8')).status, status, jobStatus);
    }
  });
}

test("the workflow's status output reads the publishing job that ran", () => {
  assert.match(
    text,
    /\n {6}status:\n {8}description: '[^']+'\n {8}value: \$\{\{ jobs\.directory-publish\.outputs\.status \|\| jobs\.deploy\.outputs\.status \}\}\n/
  );
});
