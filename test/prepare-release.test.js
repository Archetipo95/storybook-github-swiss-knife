import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();
const IDENTITY = ['-c', 'user.name=release-test', '-c', 'user.email=release-test@example.invalid'];

const git = (args, cwd = repoRoot) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' }).trim();

/** A throwaway worktree of the current commit, removed after the test. */
function worktreeOfHead(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-release-'));
  const worktree = path.join(dir, 'repo');
  git(['worktree', 'add', '--detach', worktree, 'HEAD']);
  t.after(() => {
    git(['worktree', 'remove', '--force', worktree]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return worktree;
}

/** Runs this checkout's prepare-release.js in the worktree, pinning to `base`. */
const prepareRelease = (worktree, base) =>
  spawnSync('node', [path.join(repoRoot, 'scripts/prepare-release.js'), '99.0.0'], {
    cwd: worktree,
    encoding: 'utf8',
    env: { ...process.env, SWISS_KNIFE_RELEASE_BASE: base }
  });

/** Runs this checkout's release pin check against the worktree's HEAD. */
function releasePinCheck(worktree) {
  // Without NODE_TEST_CONTEXT the nested run reports on its own stdout instead of to this runner.
  const env = { ...process.env, RELEASE_PIN_CHECK: '1' };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(
    'node',
    ['--test', '--test-reporter=tap', path.join(repoRoot, 'test/action-pin-integrity.test.js')],
    {
      cwd: worktree,
      encoding: 'utf8',
      env
    }
  );
}

const internalPins = worktree =>
  new Set(
    fs
      .readdirSync(path.join(worktree, '.github/workflows'))
      .flatMap(file => [
        ...fs
          .readFileSync(path.join(worktree, '.github/workflows', file), 'utf8')
          .matchAll(/storybook-github-swiss-knife\/actions\/[A-Za-z0-9_-]+@([0-9a-f]{40})/g)
      ])
      .map(match => match[1])
  );

// The release pin check (RELEASE_PIN_CHECK) only runs in the Release Tags workflow, so a change
// to prepare-release.js or to the check can pass every PR and still block the release. Prepare a
// release of the current commit in a throwaway worktree, with this checkout's scripts, and run
// the check against it.
test('a release made by prepare-release passes the release pin check', t => {
  const worktree = worktreeOfHead(t);
  const prepared = prepareRelease(worktree, 'HEAD');
  assert.equal(prepared.status, 0, prepared.stderr);
  git([...IDENTITY, 'commit', '-qam', 'release'], worktree);

  const check = releasePinCheck(worktree);
  assert.equal(check.status, 0, `the release pin check failed on a prepared release:\n${check.stdout}${check.stderr}`);
  assert.match(check.stdout, /# skipped 0/, 'the release pin check was skipped');
});

// A release branch can carry its own commits (workflow or docs changes) before the prepare
// commit. Its tip disappears in a squash merge, so the pins go to the base on main instead.
test('prepare-release pins to the release base, not to the branch tip', t => {
  const worktree = worktreeOfHead(t);
  const base = git(['rev-parse', 'HEAD'], worktree);
  fs.appendFileSync(path.join(worktree, 'docs/development.md'), '\nA release-branch commit.\n');
  git([...IDENTITY, 'commit', '-qam', 'docs on the release branch'], worktree);

  const prepared = prepareRelease(worktree, base);
  assert.equal(prepared.status, 0, prepared.stderr);
  assert.deepEqual([...internalPins(worktree)], [base]);
  git([...IDENTITY, 'commit', '-qam', 'release'], worktree);
  const check = releasePinCheck(worktree);
  assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
});

test('prepare-release refuses when the branch changes code its pins would not run', t => {
  const worktree = worktreeOfHead(t);
  const base = git(['rev-parse', 'HEAD'], worktree);
  fs.appendFileSync(path.join(worktree, 'src/config.js'), '\n// A release-branch change.\n');
  git([...IDENTITY, 'commit', '-qam', 'code on the release branch'], worktree);

  const prepared = prepareRelease(worktree, base);
  assert.notEqual(prepared.status, 0);
  assert.match(prepared.stderr, /change code the internal pins would not run:\nsrc\/config\.js/);
  assert.equal(git(['status', '--porcelain'], worktree), '', 'nothing may be written before refusing');
});
