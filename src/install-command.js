// The install command a Storybook build runs when the caller sets none. The same commands as
// `storybook-swiss-knife init` and the visual workflow: a frozen install from the lockfile, through
// corepack for pnpm and Yarn 2+. A project without a lockfile gets a plain install and a warning,
// since the frozen commands fail without one.

import fs from 'node:fs';
import path from 'node:path';

import { findLockfile, isYarnClassic } from '../packages/addon/cli/package-manager.js';

export { findLockfile };

const COMMANDS = {
  npm: { frozen: 'npm ci', plain: 'npm install' },
  pnpm: { frozen: 'corepack pnpm install --frozen-lockfile', plain: 'corepack pnpm install --no-frozen-lockfile' },
  yarn: { frozen: 'corepack yarn install --immutable', plain: 'corepack yarn install --no-immutable' },
  'yarn-classic': { frozen: 'yarn install --frozen-lockfile', plain: 'yarn install' },
  bun: { frozen: 'bun install --frozen-lockfile', plain: 'bun install' }
};

/** `{ command, lockfile }` for `packageManager` in `dir`; lockfile is null when there is none. */
export function defaultInstallCommand(packageManager, dir = process.cwd()) {
  const variant = packageManager === 'yarn' && isYarnClassic(dir) ? 'yarn-classic' : packageManager;
  const commands = COMMANDS[variant];
  if (!commands) throw new Error(`No default install command for package_manager "${packageManager}"`);
  const lockfile = findLockfile(dir, packageManager);
  return { command: lockfile ? commands.frozen : commands.plain, lockfile };
}

/**
 * The install command to run before `buildCommand`: `installCommand` when set, otherwise the
 * default, and nothing when no build runs. With `skipWhenInstalled` (the composite action, which
 * runs after the caller's own steps) an existing node_modules means the caller already installed,
 * so the default is skipped rather than reinstalling over it.
 * Returns `{ command, warning }`; warning is set when the default ran without a lockfile.
 */
export function resolveInstallCommand({
  installCommand,
  buildCommand,
  packageManager,
  dir = process.cwd(),
  skipWhenInstalled = false
}) {
  if (installCommand) return { command: installCommand, warning: '' };
  if (!buildCommand) return { command: '', warning: '' };
  if (skipWhenInstalled && fs.existsSync(path.join(dir, 'node_modules'))) return { command: '', warning: '' };
  const { command, lockfile } = defaultInstallCommand(packageManager, dir);
  const warning = lockfile
    ? ''
    : `No ${packageManager} lockfile found, so dependencies are installed with "${command}". Commit a lockfile for reproducible builds, or set install_command.`;
  return { command, warning };
}
