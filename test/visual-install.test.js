import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stepRun } from './helpers/workflow-step.js';

// visual.yml installs before building, from the lockfile when the caller passes no
// install_command. A monorepo package without its own lockfile installs from the repository
// root's, as the workflows `storybook-swiss-knife init` writes do.

const WORKFLOW = '.github/workflows/visual.yml';

test('both Storybook builds (head and base) run the same install and build script', () => {
  const text = fs.readFileSync(WORKFLOW, 'utf8');
  const blocks = text
    .split('      - name: Install and build\n')
    .slice(1)
    .map(block => block.slice(0, block.indexOf('\n      - name: ')));
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0], blocks[1]);
});

/** Runs the step in `workspace/<workingDirectory>` with stub package managers; returns their calls. */
function runInstall(t, files, workingDirectory, { buildCommand } = {}) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-visual-install-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(workspace, file)), { recursive: true });
    fs.writeFileSync(path.join(workspace, file), content);
  }
  const bin = path.join(workspace, '.stub-bin');
  const log = path.join(workspace, '.stub-calls');
  fs.mkdirSync(bin);
  for (const tool of ['corepack', 'npm', 'bun']) {
    // A build (`--output-dir <dir>`) leaves the index.json the step checks for.
    fs.writeFileSync(
      path.join(bin, tool),
      `#!/bin/sh\necho "$PWD ${tool} $*" >> "${log}"\n` +
        'while [ $# -gt 0 ]; do [ "$1" = --output-dir ] && mkdir -p "$2" && echo "{}" > "$2/index.json"; shift; done\n',
      { mode: 0o755 }
    );
  }
  const cwd = path.join(workspace, workingDirectory);
  execFileSync('bash', ['-c', stepRun(WORKFLOW, 'Install and build')], {
    cwd,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_WORKSPACE: workspace,
      INSTALL_COMMAND: '',
      BUILD_COMMAND: buildCommand ?? 'mkdir -p "$STORYBOOK_DIR" && echo "{}" > "$STORYBOOK_DIR/index.json"',
      STORYBOOK_DIR: 'storybook-static'
    },
    stdio: 'pipe'
  });
  return fs
    .readFileSync(log, 'utf8')
    .trim()
    .split('\n')
    .map(line => line.replace(fs.realpathSync(workspace), '<workspace>').replace(workspace, '<workspace>'));
}

test('a package without its own lockfile installs from the root lockfile', t => {
  const calls = runInstall(t, { 'pnpm-lock.yaml': '', 'package.json': '{}', 'apps/ui/package.json': '{}' }, 'apps/ui');
  assert.deepEqual(calls, ['<workspace> corepack pnpm install --frozen-lockfile']);
});

test('a package with its own lockfile, or a repository without one, installs in the working directory', t => {
  assert.deepEqual(
    runInstall(t, { 'pnpm-lock.yaml': '', 'apps/ui/package.json': '{}', 'apps/ui/package-lock.json': '{}' }, 'apps/ui'),
    ['<workspace>/apps/ui npm ci']
  );
  assert.deepEqual(runInstall(t, { 'apps/ui/package.json': '{}' }, 'apps/ui'), ['<workspace>/apps/ui npm ci']);
  assert.deepEqual(runInstall(t, { 'package.json': '{}', 'yarn.lock': '' }, '.'), [
    '<workspace> corepack yarn install --immutable'
  ]);
});

test('the default build follows the same lockfile and runs in the package', t => {
  const files = { 'package.json': '{}', 'apps/ui/package.json': '{}' };
  assert.deepEqual(runInstall(t, { ...files, 'pnpm-lock.yaml': '' }, 'apps/ui', { buildCommand: '' }), [
    '<workspace> corepack pnpm install --frozen-lockfile',
    '<workspace>/apps/ui corepack pnpm exec storybook build --quiet --output-dir storybook-static'
  ]);
  assert.deepEqual(runInstall(t, { ...files, 'yarn.lock': '' }, 'apps/ui', { buildCommand: '' }), [
    '<workspace> corepack yarn install --immutable',
    '<workspace>/apps/ui corepack yarn storybook build --quiet --output-dir storybook-static'
  ]);
});
