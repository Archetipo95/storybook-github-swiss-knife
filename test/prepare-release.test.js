import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const repoRoot = process.cwd();

// The release pin check (RELEASE_PIN_CHECK) only runs in the Release Tags workflow, so a change
// to prepare-release.js or to the check can pass every PR and still block the release. Prepare a
// release of the current commit in a throwaway worktree, with this checkout's scripts, and run
// the check against it.
test('a release made by prepare-release passes the release pin check', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-release-'));
  const worktree = path.join(dir, 'repo');
  const git = (args, cwd = repoRoot) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: 'pipe' });
  git(['worktree', 'add', '--detach', worktree, 'HEAD']);
  t.after(() => {
    git(['worktree', 'remove', '--force', worktree]);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  execFileSync('node', [path.join(repoRoot, 'scripts/prepare-release.js'), '99.0.0'], { cwd: worktree, stdio: 'pipe' });
  git(
    ['-c', 'user.name=release-test', '-c', 'user.email=release-test@example.invalid', 'commit', '-qam', 'release'],
    worktree
  );

  // Without NODE_TEST_CONTEXT the nested run reports on its own stdout instead of to this runner.
  const env = { ...process.env, RELEASE_PIN_CHECK: '1' };
  delete env.NODE_TEST_CONTEXT;
  const check = spawnSync(
    'node',
    ['--test', '--test-reporter=tap', path.join(repoRoot, 'test/action-pin-integrity.test.js')],
    { cwd: worktree, encoding: 'utf8', env }
  );
  assert.equal(check.status, 0, `the release pin check failed on a prepared release:\n${check.stdout}${check.stderr}`);
  assert.match(check.stdout, /# skipped 0/, 'the release pin check was skipped');
});
