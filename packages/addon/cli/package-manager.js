// Package manager detection, shared by `storybook-swiss-knife init` and the default install
// command of the deploy workflow and action (src/install-command.js).

import fs from 'node:fs';
import path from 'node:path';

const LOCKFILES = [
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['package-lock.json', 'npm'],
  ['npm-shrinkwrap.json', 'npm']
];

/** The package manager from the project's lockfile (the repository root is checked too). */
export function detectPackageManager(projectDir, rootDir = projectDir) {
  for (const dir of new Set([projectDir, rootDir])) {
    const found = LOCKFILES.find(([file]) => fs.existsSync(path.join(dir, file)));
    if (found) return found[1] === 'yarn' && isYarnClassic(dir) ? 'yarn-classic' : found[1];
  }
  return 'npm';
}

/** The lockfile `packageManager` ('npm', 'pnpm', 'yarn' or 'bun') reads in `dir`, or null. */
export function findLockfile(dir, packageManager) {
  const found = LOCKFILES.find(([file, manager]) => manager === packageManager && fs.existsSync(path.join(dir, file)));
  return found ? found[0] : null;
}

// Yarn 2+ has .yarnrc.yml or declares itself in packageManager; a bare yarn.lock is Yarn 1.
export function isYarnClassic(dir) {
  if (fs.existsSync(path.join(dir, '.yarnrc.yml'))) return false;
  try {
    const { packageManager = '' } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    return !/^yarn@[2-9]/.test(packageManager) && !/^yarn@\d{2,}/.test(packageManager);
  } catch {
    return true;
  }
}
