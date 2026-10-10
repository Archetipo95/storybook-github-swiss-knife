import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { defaultInstallCommand, resolveInstallCommand } from '../src/install-command.js';

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

test('resolveInstallCommand: the configured command, else the default before a build', t => {
  const dir = project(t, { 'package-lock.json': '{}' });
  const build = 'npm run build-storybook';
  assert.deepEqual(
    resolveInstallCommand({ installCommand: 'make deps', buildCommand: build, packageManager: 'npm', dir }),
    {
      command: 'make deps',
      warning: ''
    }
  );
  assert.deepEqual(resolveInstallCommand({ buildCommand: build, packageManager: 'npm', dir }), {
    command: 'npm ci',
    warning: ''
  });
  // No build, no install.
  assert.deepEqual(resolveInstallCommand({ buildCommand: '', packageManager: 'npm', dir }), {
    command: '',
    warning: ''
  });
});

test('resolveInstallCommand warns when the default runs without a lockfile', t => {
  const { command, warning } = resolveInstallCommand({
    buildCommand: 'npm run build-storybook',
    packageManager: 'npm',
    dir: project(t, {})
  });
  assert.equal(command, 'npm install');
  assert.match(warning, /No npm lockfile found.*"npm install".*install_command/);
});

test('resolveInstallCommand skipWhenInstalled: an existing node_modules skips the default only', t => {
  const dir = project(t, { 'package-lock.json': '{}', 'node_modules/.package-lock.json': '{}' });
  const options = { buildCommand: 'npm run build-storybook', packageManager: 'npm', dir, skipWhenInstalled: true };
  assert.equal(resolveInstallCommand(options).command, '');
  assert.equal(resolveInstallCommand({ ...options, installCommand: 'npm ci' }).command, 'npm ci');
  assert.equal(resolveInstallCommand({ ...options, skipWhenInstalled: false }).command, 'npm ci');
  const fresh = project(t, { 'package-lock.json': '{}' });
  assert.equal(resolveInstallCommand({ ...options, dir: fresh }).command, 'npm ci');
});
