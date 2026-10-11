import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// The composite action cannot publish directory mode (the reusable workflow serializes Pages
// writes), but it can build for a directory-mode project when it does not publish (#19).

const action = fs.readFileSync(path.join(process.cwd(), 'action.yml'), 'utf8');
const stepNames = [...action.matchAll(/^ {4}- name: (.+)$/gm)].map(match => match[1]);
const REJECT = 'Reject directory-mode publishing in the composite action';

test('directory mode is refused only when the action publishes', () => {
  const step = action.slice(action.indexOf(`- name: ${REJECT}`));
  assert.match(step, /^- name: .+\n\s+if: \$\{\{ env\.SB_MODE == 'directory' && env\.SB_PUBLISH == 'true' \}\}\n/);
  assert.match(step, /::error::Directory mode publishes through the reusable workflow/);
});

test('the refusal comes before anything is installed or built', () => {
  const at = name => {
    const index = stepNames.indexOf(name);
    assert.notEqual(index, -1, `action.yml has no step "${name}"`);
    return index;
  };
  assert.ok(at('Resolve and validate configuration') < at(REJECT));
  for (const later of ['Set up Node.js', 'Install dependencies', 'Build Storybook']) {
    assert.ok(at(REJECT) < at(later), `${REJECT} runs before ${later}`);
  }
});
