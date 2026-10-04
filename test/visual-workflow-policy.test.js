import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const read = file => fs.readFileSync(path.join(process.cwd(), '.github/workflows', file), 'utf8');
const visual = read('visual.yml');
const gate = read('visual-gate.yml');

/** Job name -> job body (text), for the top-level jobs of a workflow. */
function jobs(content) {
  const body = content.slice(content.indexOf('\njobs:\n') + 7);
  return Object.fromEntries(
    body
      .split(/\n(?= {2}[a-z][a-z0-9-]*:\n)/)
      .map(chunk => [chunk.match(/^ {2}([a-z][a-z0-9-]*):/)?.[1], chunk])
      .filter(([name]) => name)
  );
}

test('visual.yml (untrusted) never gets write permissions or secrets', () => {
  assert.doesNotMatch(visual, /:\s*write\b/, 'no write permission anywhere');
  assert.doesNotMatch(visual, /secrets\./, 'no secrets');
  assert.doesNotMatch(visual, /persist-credentials:\s*true/);
  for (const [name, job] of Object.entries(jobs(visual))) {
    assert.match(job, /permissions:\n\s+contents: read/, `${name} declares read-only permissions`);
  }
});

test('visual.yml uploads results but never posts checks or comments', () => {
  assert.doesNotMatch(visual, /check-runs|issues\/\d|\/comments/);
});

test('visual-gate.yml is the only workflow that can write check runs', () => {
  const writers = fs
    .readdirSync(path.join(process.cwd(), '.github/workflows'))
    .filter(file => /checks:\s*write/.test(read(file)));
  assert.deepEqual(writers.sort(), ['dogfood-visual-gate.yml', 'visual-gate.yml']);
});

test('visual-gate.yml never checks out or runs pull request code', () => {
  assert.doesNotMatch(gate, /pull_request\.head|head_sha|head\.sha|ref:\s*\$\{\{\s*github\.event\.workflow_run/);
  const checkouts = gate.match(/uses: actions\/checkout@[^\n]+\n(?:\s+with:\n(?:\s{10}.+\n)+)?/g) ?? [];
  for (const checkout of checkouts) {
    assert.ok(!/ref:/.test(checkout) || /ref: \$\{\{ steps\.pages\.outputs\.branch \}\}/.test(checkout), checkout);
  }
  assert.match(gate, /node "\$SWISS_KNIFE_ROOT\/src\/gate\/run\.js"/, 'gate logic comes from the pinned toolkit');
});

test('the gate trigger runs only for pull_request visual runs', () => {
  assert.match(read('dogfood-visual-gate.yml'), /if: github\.event\.workflow_run\.event == 'pull_request'/);
});
