import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// A job output is only useful when a later job reads it (`needs.<job>.outputs.<name>`) or the
// reusable workflow re-exports it (`jobs.<job>.outputs.<name>` under on.workflow_call.outputs,
// which is public API). Unread ones are dead code that looks like a contract.

const workflowDir = path.join(process.cwd(), '.github/workflows');

/** [{ job, output }] declared in a workflow's jobs. */
function jobOutputs(workflow) {
  const lines = workflow.split('\n');
  const declared = [];
  let job = null;
  let inOutputs = false;
  for (const line of lines.slice(lines.indexOf('jobs:') + 1)) {
    const name = /^ {2}([\w-]+):\s*$/.exec(line);
    if (name) {
      job = name[1];
      inOutputs = false;
      continue;
    }
    if (/^ {4}outputs:\s*$/.test(line)) {
      inOutputs = true;
      continue;
    }
    if (inOutputs) {
      const output = /^ {6}([\w-]+):/.exec(line);
      if (output) declared.push({ job, output: output[1] });
      else if (line.trim() && !line.trim().startsWith('#') && line.search(/\S/) <= 4) inOutputs = false;
    }
  }
  return declared;
}

test('every job output is read by a later job or re-exported by the workflow', () => {
  const unread = fs
    .readdirSync(workflowDir)
    .filter(file => /\.ya?ml$/.test(file))
    .flatMap(file => {
      const workflow = fs.readFileSync(path.join(workflowDir, file), 'utf8');
      return jobOutputs(workflow)
        .filter(
          ({ job, output }) =>
            !workflow.includes(`needs.${job}.outputs.${output}`) && !workflow.includes(`jobs.${job}.outputs.${output}`)
        )
        .map(({ job, output }) => `${file} job ${job}: ${output}`);
    });
  assert.deepEqual(unread, []);
});
