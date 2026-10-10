// Moves the reusable workflows' pins of this repository's own composite actions, shared by
// `npm run prepare-release` and `npm run bump-pins`.
//
// The pins move to the commit on main the branch is prepared from, so the workflows run the code
// they were written against (the Release Tags workflow refuses to tag when they differ). That is
// the branch's merge base with origin/main, not HEAD: a squash merge drops the branch's own
// commits, and a pin must stay reachable. SWISS_KNIFE_RELEASE_BASE overrides it (tests, or a
// clone without origin/main, where HEAD is used).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const PIN = /(Archetipo95\/storybook-github-swiss-knife\/actions\/[A-Za-z0-9_-]+@)[0-9a-f]{40}/g;

/**
 * Moves every internal action pin under `.github/workflows` to the release base and returns its
 * SHA. Throws, changing nothing, when src, actions or runner have uncommitted changes, or when the
 * branch's own commits change them: the pins would not run that code.
 */
export function moveInternalPins({ root = process.cwd(), purpose = 'moving the pins' } = {}) {
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const tryGit = (...args) => {
    try {
      return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    } catch {
      return '';
    }
  };
  const uncommitted = git('status', '--porcelain', '--', 'src', 'actions', 'runner');
  if (uncommitted) {
    throw new Error(
      `Commit action, src and runner changes before ${purpose}; internal pins must point at committed code:\n${uncommitted}`
    );
  }
  const baseRef = process.env.SWISS_KNIFE_RELEASE_BASE;
  const pinSha = baseRef
    ? git('rev-parse', '--verify', `${baseRef}^{commit}`)
    : tryGit('merge-base', 'HEAD', 'origin/main') || git('rev-parse', 'HEAD');
  // The branch's own commits are not pinned, so they must not change code the pins run.
  const unpinned = git('diff', '--name-only', pinSha, 'HEAD', '--', 'src', 'actions', 'runner');
  if (unpinned) {
    throw new Error(
      `Commits since ${pinSha.slice(0, 7)} change code the internal pins would not run:\n${unpinned}\n` +
        'Merge them to main first, then branch from main. If they are already on main, ' +
        'origin/main is out of date here: run `git fetch origin main` and try again.'
    );
  }
  const workflows = path.join(root, '.github/workflows');
  for (const name of fs.readdirSync(workflows).filter(file => /\.ya?ml$/.test(file))) {
    const file = path.join(workflows, name);
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(PIN, `$1${pinSha}`));
  }
  return pinSha;
}
