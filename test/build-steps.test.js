import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseCommandFile, stepRun } from './helpers/workflow-step.js';

// The deploy workflow and the composite action, through their own config and build step scripts,
// with a multi-line build command: it must reach the build step intact and run line by line, and
// an install command must run before it.

const MULTI_LINE_BUILD = `echo "it's the first line" > first.txt\nbuild-storybook`;

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function project(t, files = {}) {
  const dir = tempDir(t, 'sk-build-steps-');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

/** Runs a step script with bash as the runner does (-e, pipefail); returns { stdout, stderr }. */
function runStep(script, { cwd, env }) {
  const fullEnv = { ...process.env, ...env };
  delete fullEnv.GITHUB_ACTIONS;
  const result = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', script], {
    cwd,
    env: fullEnv,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, `step failed:\n${result.stderr}`);
  return result;
}

/** A `build-storybook` on PATH that records its arguments. */
function fakeStorybook(t) {
  const bin = tempDir(t, 'sk-build-bin-');
  fs.writeFileSync(path.join(bin, 'build-storybook'), '#!/bin/sh\nprintf "%s\\n" "$@" > args.txt\n', { mode: 0o755 });
  return `${bin}${path.delimiter}${process.env.PATH}`;
}

function deployConfig(t, dir, inputs = {}) {
  const output = path.join(tempDir(t, 'sk-output-'), 'output');
  fs.writeFileSync(output, '');
  const { stderr } = runStep(stepRun('.github/workflows/deploy-storybook.yml', 'Resolve and validate configuration'), {
    cwd: dir,
    env: { CONFIG_INPUTS: JSON.stringify(inputs), GITHUB_OUTPUT: output, SWISS_KNIFE_ROOT: process.cwd() }
  });
  return { outputs: parseCommandFile(fs.readFileSync(output, 'utf8')), stderr };
}

function actionConfig(t, dir, inputs = {}) {
  const env = path.join(tempDir(t, 'sk-env-'), 'env');
  fs.writeFileSync(env, '');
  const { stdout } = runStep(stepRun('action.yml', 'Resolve and validate configuration'), {
    cwd: dir,
    env: { CONFIG_INPUTS: JSON.stringify(inputs), GITHUB_ENV: env, GITHUB_ACTION_PATH: process.cwd() }
  });
  return { env: parseCommandFile(fs.readFileSync(env, 'utf8')), stdout };
}

const CONFIG_FILE = `build:\n  build_command: |\n${MULTI_LINE_BUILD.split('\n')
  .map(line => `    ${line}`)
  .join('\n')}\n`;

test('deploy-storybook.yml config step: a multi-line build command from the config file, and npm ci before it', t => {
  const dir = project(t, { 'package-lock.json': '{}', '.storybook-pages.yml': CONFIG_FILE });
  const { outputs } = deployConfig(t, dir);
  assert.equal(outputs.build_command, MULTI_LINE_BUILD);
  assert.equal(outputs.install_command, 'npm ci');
  assert.equal(outputs.package_manager, 'npm');
});

test('deploy-storybook.yml config step: no lockfile installs with npm install and warns', t => {
  const dir = project(t);
  const { outputs, stderr } = deployConfig(t, dir, { build_command: 'npm run build-storybook' });
  assert.equal(outputs.install_command, 'npm install');
  assert.match(stderr, /::warning::No npm lockfile found/);
  // An explicit install command is kept; no build command means no install.
  assert.equal(
    deployConfig(t, dir, { build_command: 'x', install_command: 'make deps' }).outputs.install_command,
    'make deps'
  );
  assert.equal(deployConfig(t, dir).outputs.install_command, '');
});

test('action.yml config step: a multi-line build input reaches GITHUB_ENV intact', t => {
  const dir = project(t, { 'pnpm-lock.yaml': '' });
  const { env } = actionConfig(t, dir, { build_command: MULTI_LINE_BUILD, package_manager: 'pnpm' });
  assert.equal(env.SB_BUILD_COMMAND, MULTI_LINE_BUILD);
  assert.equal(env.SB_INSTALL_COMMAND, 'corepack pnpm install --frozen-lockfile');
  assert.equal(env.SB_PACKAGE_MANAGER, 'pnpm');
});

test('action.yml config step: an existing node_modules (installed by the caller) skips the default install', t => {
  const dir = project(t, { 'package-lock.json': '{}', 'node_modules/.package-lock.json': '{}' });
  assert.equal(actionConfig(t, dir, { build_command: 'npm run build-storybook' }).env.SB_INSTALL_COMMAND, '');
  const explicit = actionConfig(t, dir, { build_command: 'npm run build-storybook', install_command: 'npm ci' });
  assert.equal(explicit.env.SB_INSTALL_COMMAND, 'npm ci');
});

test('deploy-storybook.yml build step runs a multi-line command line by line, with the base URL on the build line', t => {
  const dir = project(t);
  runStep(stepRun('.github/workflows/deploy-storybook.yml', 'Run custom build command'), {
    cwd: dir,
    env: {
      BUILD_COMMAND: MULTI_LINE_BUILD,
      AUTO_BASE_URL: 'true',
      REPOSITORY: 'owner/repo',
      EVENT_NAME: 'push',
      SWISS_KNIFE_ROOT: process.cwd(),
      PATH: fakeStorybook(t)
    }
  });
  assert.equal(fs.readFileSync(path.join(dir, 'first.txt'), 'utf8'), "it's the first line\n");
  assert.equal(fs.readFileSync(path.join(dir, 'args.txt'), 'utf8'), '--base-url\n/repo/\n');
});

test('action.yml build step runs a multi-line command line by line, with the base URL on the build line', t => {
  const dir = project(t);
  runStep(stepRun('action.yml', 'Build Storybook'), {
    cwd: dir,
    env: {
      SB_BUILD_COMMAND: MULTI_LINE_BUILD,
      SB_AUTO_BASE_URL: 'true',
      SB_REPOSITORY: 'owner/repo',
      SB_EVENT_NAME: 'push',
      GITHUB_ACTION_PATH: process.cwd(),
      PATH: fakeStorybook(t)
    }
  });
  assert.equal(fs.readFileSync(path.join(dir, 'first.txt'), 'utf8'), "it's the first line\n");
  assert.equal(fs.readFileSync(path.join(dir, 'args.txt'), 'utf8'), '--base-url\n/repo/\n');
});
