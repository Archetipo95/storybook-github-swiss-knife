import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = process.cwd();
const toolkitYml = fs.readFileSync(path.join(repoRoot, 'actions/toolkit/action.yml'), 'utf8');
const REUSABLE_WORKFLOWS = [
  'deploy-storybook.yml',
  'pr-preview-publish.yml',
  'pr-preview-cleanup.yml',
  'pr-preview-janitor.yml'
];

function toolkitScript() {
  const match = toolkitYml.match(/run: \|\n([\s\S]*)$/);
  assert.ok(match, 'toolkit run script not found');
  return match[1].replace(/^ {8}/gm, '');
}

function runToolkit(actionPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-'));
  const output = path.join(dir, 'output');
  const env = path.join(dir, 'env');
  fs.writeFileSync(output, '');
  fs.writeFileSync(env, '');
  const result = spawnSync('bash', ['-c', toolkitScript()], {
    env: { ...process.env, GITHUB_ACTION_PATH: actionPath, GITHUB_OUTPUT: output, GITHUB_ENV: env },
    encoding: 'utf8'
  });
  return { result, output: fs.readFileSync(output, 'utf8'), env: fs.readFileSync(env, 'utf8') };
}

test('toolkit exposes the repository root as an output and SWISS_KNIFE_ROOT', () => {
  const { result, output, env } = runToolkit(path.join(repoRoot, 'actions/toolkit'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(output.trim(), `root=${repoRoot}`);
  assert.equal(env.trim(), `SWISS_KNIFE_ROOT=${repoRoot}`);
});

test('toolkit fails when the action is not inside a swiss-knife checkout', () => {
  const stray = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-stray-'));
  fs.mkdirSync(path.join(stray, 'actions/toolkit'), { recursive: true });
  const { result, env } = runToolkit(path.join(stray, 'actions/toolkit'));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /swiss-knife source not found/);
  assert.equal(env, '');
});

test('toolkit is a composite action with no inputs and no secrets', () => {
  assert.match(toolkitYml, /using: 'composite'/);
  assert.doesNotMatch(toolkitYml, /^inputs:/m);
  assert.doesNotMatch(toolkitYml, /secrets\./);
});

for (const workflow of REUSABLE_WORKFLOWS) {
  test(`${workflow} never runs ./src of the checked-out (caller) repository`, () => {
    const content = fs.readFileSync(path.join(repoRoot, '.github/workflows', workflow), 'utf8');
    assert.doesNotMatch(content, /import\("\.\/src\//, 'imports must use SWISS_KNIFE_ROOT');
    assert.doesNotMatch(content, /run: node (\.\/)?src\//, 'scripts must use SWISS_KNIFE_ROOT');
    assert.doesNotMatch(content, /existsSync\("\.\/src\//, 'no fallback that depends on the caller having ./src');
    if (/SWISS_KNIFE_ROOT/.test(content)) {
      assert.match(content, /actions\/toolkit@[a-f0-9]{40}/, 'SWISS_KNIFE_ROOT comes from the pinned toolkit');
    }
  });
}
