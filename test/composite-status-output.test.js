import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The composite action's `status` output: failed when an earlier step failed, skipped without
// publishing, success otherwise. Status functions only work in `if:`, so two steps set it.

const action = fs.readFileSync(path.join(process.cwd(), 'action.yml'), 'utf8');
const step = name => {
  const start = action.indexOf(`- name: ${name}\n`);
  assert.notEqual(start, -1, `action.yml has no step "${name}"`);
  const next = action.indexOf('\n    - name: ', start + 1);
  return action.slice(start, next === -1 ? undefined : next);
};

test('the status output reports failed after a failed step, and success or skipped otherwise', () => {
  assert.match(
    action,
    /\n {2}status:\n[^\n]*\n {4}value: \$\{\{ steps\.set-status\.outputs\.status \|\| steps\.set-status-failed\.outputs\.status \}\}\n/
  );
  const ok = step('Set deployment status output');
  assert.match(ok, /id: set-status\n\s+if: \$\{\{ success\(\) \}\}/);
  assert.match(ok, /status=skipped/);
  assert.match(ok, /status=success/);
  const failed = step('Set failed deployment status output');
  assert.match(failed, /id: set-status-failed\n\s+if: \$\{\{ failure\(\) \}\}/);
  assert.match(failed, /status=failed/);
  // Neither runs on a cancelled run.
  assert.doesNotMatch(ok + failed, /always\(\)/);
});

test('the status steps are the last steps, so every earlier failure is seen', () => {
  const names = [...action.matchAll(/^ {4}- name: (.+)$/gm)].map(match => match[1]);
  assert.deepEqual(names.slice(-2), ['Set deployment status output', 'Set failed deployment status output']);
});
