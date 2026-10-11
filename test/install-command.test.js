import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { COMPOSITE_PACKAGE_MANAGERS, resolveConfiguration } from '../src/config.js';
import { defaultInstallCommand, resolveInstallCommand } from '../src/install-command.js';
import { compositeInputDefaults, parseCommandFile, stepRun } from './helpers/workflow-step.js';

function project(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-install-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

test('defaultInstallCommand: a frozen install from the lockfile', t => {
  const cases = [
    ['npm', { 'package-lock.json': '{}' }, 'npm ci', 'package-lock.json'],
    ['npm', { 'npm-shrinkwrap.json': '{}' }, 'npm ci', 'npm-shrinkwrap.json'],
    ['pnpm', { 'pnpm-lock.yaml': '' }, 'corepack pnpm install --frozen-lockfile', 'pnpm-lock.yaml'],
    ['yarn', { 'yarn.lock': '', '.yarnrc.yml': '' }, 'corepack yarn install --immutable', 'yarn.lock'],
    ['bun', { 'bun.lock': '' }, 'bun install --frozen-lockfile', 'bun.lock']
  ];
  for (const [manager, files, command, lockfile] of cases) {
    assert.deepEqual(defaultInstallCommand(manager, project(t, files)), { command, lockfile }, manager);
  }
});

test('defaultInstallCommand: Yarn 1 uses --frozen-lockfile, Yarn 2+ --immutable', t => {
  const classic = project(t, { 'yarn.lock': '', 'package.json': '{"packageManager":"yarn@1.22.22"}' });
  assert.equal(defaultInstallCommand('yarn', classic).command, 'yarn install --frozen-lockfile');
  assert.equal(
    defaultInstallCommand('yarn', project(t, { 'yarn.lock': '' })).command,
    'yarn install --frozen-lockfile'
  );
  const berry = project(t, { 'yarn.lock': '', 'package.json': '{"packageManager":"yarn@4.5.0"}' });
  assert.equal(defaultInstallCommand('yarn', berry).command, 'corepack yarn install --immutable');
});

test('defaultInstallCommand: without a lockfile, a plain install', t => {
  const cases = [
    ['npm', {}, 'npm install'],
    ['pnpm', {}, 'corepack pnpm install --no-frozen-lockfile'],
    ['yarn', { '.yarnrc.yml': '' }, 'corepack yarn install --no-immutable'],
    ['yarn', {}, 'yarn install'],
    ['bun', {}, 'bun install'],
    // Another manager's lockfile is not this one's.
    ['npm', { 'pnpm-lock.yaml': '' }, 'npm install']
  ];
  for (const [manager, files, command] of cases) {
    assert.deepEqual(defaultInstallCommand(manager, project(t, files)), { command, lockfile: null }, command);
  }
  assert.throws(() => defaultInstallCommand('deno', project(t, {})), /No default install command/);
});

const PACKAGE = { 'package.json': '{}' };

test('resolveInstallCommand: the configured command, else the default before a build', t => {
  const dir = project(t, { ...PACKAGE, 'package-lock.json': '{}' });
  const build = 'npm run build-storybook';
  assert.deepEqual(
    resolveInstallCommand({ installCommand: 'make deps', buildCommand: build, packageManager: 'npm', dir }),
    { command: 'make deps', warning: '', notice: '' }
  );
  assert.deepEqual(resolveInstallCommand({ buildCommand: build, packageManager: 'npm', dir }), {
    command: 'npm ci',
    warning: '',
    notice: ''
  });
  // No build, no install.
  assert.deepEqual(resolveInstallCommand({ buildCommand: '', packageManager: 'npm', dir }), {
    command: '',
    warning: '',
    notice: ''
  });
});

test('resolveInstallCommand warns when the default runs without a lockfile', t => {
  const { command, warning } = resolveInstallCommand({
    buildCommand: 'npm run build-storybook',
    packageManager: 'npm',
    dir: project(t, PACKAGE)
  });
  assert.equal(command, 'npm install');
  assert.match(warning, /No npm lockfile found.*"npm install".*install_command/);
});

test('resolveInstallCommand skipWhenInstalled: an existing node_modules skips the default only', t => {
  const dir = project(t, { ...PACKAGE, 'package-lock.json': '{}', 'node_modules/.package-lock.json': '{}' });
  const options = { buildCommand: 'npm run build-storybook', packageManager: 'npm', dir, skipWhenInstalled: true };
  assert.equal(resolveInstallCommand(options).command, '');
  assert.equal(resolveInstallCommand({ ...options, installCommand: 'npm ci' }).command, 'npm ci');
  assert.equal(resolveInstallCommand({ ...options, skipWhenInstalled: false }).command, 'npm ci');
  const fresh = project(t, { ...PACKAGE, 'package-lock.json': '{}' });
  assert.equal(resolveInstallCommand({ ...options, dir: fresh }).command, 'npm ci');
});

test('resolveInstallCommand: no package.json (a monorepo building in a subfolder) means no default', t => {
  // The build command installs in apps/ui itself; npm install at the root would exit 254.
  const dir = project(t, { 'apps/ui/package.json': '{}', 'apps/ui/package-lock.json': '{}' });
  const build = 'cd apps/ui && npm ci && npm run build-storybook';
  for (const skipWhenInstalled of [false, true]) {
    const result = resolveInstallCommand({ buildCommand: build, packageManager: 'npm', dir, skipWhenInstalled });
    assert.equal(result.command, '');
    assert.equal(result.warning, '');
    assert.match(result.notice, /No package\.json at the repository root.*install_command/);
  }
  // An explicit install command still runs.
  const explicit = resolveInstallCommand({ installCommand: 'npm ci --prefix apps/ui', buildCommand: build, dir });
  assert.deepEqual(explicit, { command: 'npm ci --prefix apps/ui', warning: '', notice: '' });
});

// A pnpm or Yarn repository that sets no package_manager, with a build command (since 0.3.0 the
// default install runs before it): the default comes from its lockfile, not npm's.
const configured = (dir, inputs = {}, options = {}) =>
  resolveConfiguration({ inputs, configFilePath: path.join(dir, '.storybook-pages.yml'), projectDir: dir, ...options });
const installFor = (dir, packageManager) =>
  resolveInstallCommand({ buildCommand: 'storybook build', packageManager, dir }).command;

test('an unset package_manager comes from the lockfile, and so does the default install', t => {
  const cases = [
    [{ 'pnpm-lock.yaml': '' }, 'pnpm', 'corepack pnpm install --frozen-lockfile'],
    [{ 'yarn.lock': '' }, 'yarn', 'yarn install --frozen-lockfile'],
    [{ 'yarn.lock': '', '.yarnrc.yml': '' }, 'yarn', 'corepack yarn install --immutable'],
    [{ 'bun.lock': '' }, 'bun', 'bun install --frozen-lockfile'],
    [{ 'package-lock.json': '{}' }, 'npm', 'npm ci'],
    [{}, 'npm', 'npm install']
  ];
  for (const [files, manager, command] of cases) {
    const dir = project(t, { ...PACKAGE, ...files });
    const label = Object.keys(files).join(', ') || 'no lockfile';
    assert.equal(configured(dir).package_manager, manager, label);
    assert.equal(installFor(dir, manager), command, label);
  }
});

test('an explicit package_manager, from the input or the config file, is never overridden by the lockfile', t => {
  const dir = project(t, { ...PACKAGE, 'pnpm-lock.yaml': '' });
  assert.equal(configured(dir, { package_manager: 'npm' }).package_manager, 'npm');
  fs.writeFileSync(path.join(dir, '.storybook-pages.yml'), 'package_manager: yarn\n');
  assert.equal(configured(dir).package_manager, 'yarn');
  assert.equal(configured(dir, { package_manager: 'npm' }).package_manager, 'npm');
});

test('a lockfile of a manager the caller does not support keeps the default (the composite action and bun)', t => {
  const dir = project(t, { ...PACKAGE, 'bun.lock': '' });
  assert.equal(configured(dir, {}, { allowedPackageManagers: COMPOSITE_PACKAGE_MANAGERS }).package_manager, 'npm');
});

test("the composite action's configuration step installs a pnpm project with pnpm", t => {
  const dir = project(t, {
    ...PACKAGE,
    'pnpm-lock.yaml': '',
    '.storybook-pages.yml': "build:\n  build_command: 'storybook build'\n"
  });
  const envFile = path.join(dir, 'github-env');
  fs.writeFileSync(envFile, '');
  execFileSync('bash', ['-c', stepRun('action.yml', 'Resolve and validate configuration')], {
    cwd: dir,
    env: {
      ...process.env,
      GITHUB_ACTION_PATH: process.cwd(),
      GITHUB_ENV: envFile,
      CONFIG_INPUTS: JSON.stringify(compositeInputDefaults()),
      PUBLISH_INPUT: 'false',
      ARTIFACT_NAME_INPUT: ''
    },
    stdio: 'pipe'
  });
  const env = parseCommandFile(fs.readFileSync(envFile, 'utf8'));
  assert.equal(env.SB_PACKAGE_MANAGER, 'pnpm');
  assert.equal(env.SB_INSTALL_COMMAND, 'corepack pnpm install --frozen-lockfile');
});
