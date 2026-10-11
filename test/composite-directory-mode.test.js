import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseCommandFile, stepRun } from './helpers/workflow-step.js';

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

test('the directory-mode settings come only from the config file, which the action still accepts', t => {
  // pages_branch, target_directory and managed_directories are the reusable workflow's: the action
  // never publishes directory mode, so it takes no input for them (0.5.0). A shared config file
  // that sets them must still pass its configuration step.
  for (const name of ['pages_branch', 'target_directory', 'managed_directories']) {
    assert.doesNotMatch(action, new RegExp(`\\n  ${name}:`), `action.yml has a ${name} input`);
  }
  const inputs = {};
  let current;
  for (const line of action.slice(action.indexOf('\ninputs:\n'), action.indexOf('\noutputs:\n')).split('\n')) {
    const name = /^ {2}(\w+):$/.exec(line);
    if (name) inputs[(current = name[1])] = '';
    const value = /^ {4}default: '(.*)'$/.exec(line);
    if (value && current) inputs[current] = value[1];
  }
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-composite-directory-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(project, '.storybook-pages.yml'),
    'mode: directory\npages_branch: pages\ntarget_directory: staging\nmanaged_directories:\n  - docs\n'
  );
  const envFile = path.join(project, 'github-env');
  fs.writeFileSync(envFile, '');
  execFileSync('bash', ['-c', stepRun('action.yml', 'Resolve and validate configuration')], {
    cwd: project,
    env: {
      ...process.env,
      GITHUB_ACTION_PATH: process.cwd(),
      GITHUB_ENV: envFile,
      CONFIG_INPUTS: JSON.stringify({ ...inputs, publish: 'false' }),
      PUBLISH_INPUT: 'false',
      ARTIFACT_NAME_INPUT: ''
    },
    stdio: 'pipe'
  });
  const env = parseCommandFile(fs.readFileSync(envFile, 'utf8'));
  assert.equal(env.SB_MODE, 'directory');
  assert.equal(env.SB_PUBLISH, 'false');
});
