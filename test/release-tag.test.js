import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReleaseTag, verifyReleaseTag, planRelease, releaseNotes } from '../scripts/release-tag.js';

test('parseReleaseTag accepts stable tags and derives the major tag', () => {
  assert.deepEqual(parseReleaseTag('v1.10.0'), {
    tag: 'v1.10.0',
    version: '1.10.0',
    major: 1,
    minor: 10,
    patch: 0,
    majorTag: 'v1'
  });
});

test('parseReleaseTag rejects pre-release, unprefixed, and shell-unsafe tags', () => {
  for (const tag of ['1.2.3', 'v1.2', 'v1.2.3-rc.1', 'v1.2.3+build', 'v1', 'v1.2.3;rm -rf /', '', undefined]) {
    assert.throws(() => parseReleaseTag(tag), /stable semver tag/, `expected ${tag} to be rejected`);
  }
});

test('verifyReleaseTag requires package, lockfile, addon, and changelog to agree with the tag', () => {
  const changelog = '# Changelog\n\n## [1.10.0] - 2026-09-30\n';
  assert.deepEqual(
    verifyReleaseTag({
      tag: 'v1.10.0',
      packageVersion: '1.10.0',
      lockVersion: '1.10.0',
      addonVersion: '1.10.0',
      changelog
    }),
    []
  );
  const problems = verifyReleaseTag({
    tag: 'v1.10.1',
    packageVersion: '1.10.0',
    lockVersion: '1.9.0',
    addonVersion: '1.10.0',
    changelog
  });
  assert.equal(problems.length, 4);
  assert.match(problems[0], /package\.json version 1\.10\.0/);
  assert.match(problems[1], /package-lock\.json version 1\.9\.0/);
  assert.match(problems[2], /packages\/addon\/package\.json version 1\.10\.0/);
  assert.match(problems[3], /## \[1\.10\.1\]/);
});

const TAGS = ['v1', 'v0.9.0', 'v1.9.14', 'v1.10.0'];

test('planRelease creates the tag when a merged version bump on main has none', () => {
  assert.deepEqual(planRelease({ ref: 'refs/heads/main', packageVersion: '1.10.1', existingTags: TAGS }), {
    releaseTag: 'v1.10.1',
    createTag: true,
    verify: true,
    majorTag: 'v1',
    majorTarget: 'v1.10.1',
    latest: true
  });
});

test('planRelease only re-syncs the major tag when the version is already tagged', () => {
  assert.deepEqual(planRelease({ ref: 'refs/heads/main', packageVersion: '1.10.0', existingTags: TAGS }), {
    releaseTag: 'v1.10.0',
    createTag: false,
    verify: false,
    majorTag: 'v1',
    majorTarget: 'v1.10.0',
    latest: true
  });
});

test('planRelease validates a manually pushed tag without creating another one', () => {
  const plan = planRelease({ ref: 'refs/tags/v1.10.0', packageVersion: '1.10.0', existingTags: TAGS });
  assert.equal(plan.createTag, false);
  assert.equal(plan.verify, true);
  assert.equal(plan.releaseTag, 'v1.10.0');
});

test('planRelease compares versions numerically, not lexically', () => {
  assert.equal(
    planRelease({ ref: 'refs/heads/main', packageVersion: '1.10.0', existingTags: ['v1.9.99'] }).majorTarget,
    'v1.10.0'
  );
  assert.equal(
    planRelease({ ref: 'refs/heads/main', packageVersion: '1.9.99', existingTags: ['v1.10.0'] }).majorTarget,
    'v1.10.0'
  );
});

test('planRelease keeps the major tag on the newest release when a backport is tagged', () => {
  const plan = planRelease({
    ref: 'refs/tags/v1.4.3',
    packageVersion: '1.4.3',
    existingTags: ['v1.4.3', 'v1.10.0', 'v2.0.0']
  });
  assert.equal(plan.majorTag, 'v1');
  assert.equal(plan.majorTarget, 'v1.10.0');
});

test('planRelease ignores other major lines and non-release tags', () => {
  const plan = planRelease({
    ref: 'refs/heads/main',
    packageVersion: '2.0.0',
    existingTags: ['v1.99.0', 'v2', 'v2.1.0-rc.1', 'latest']
  });
  assert.equal(plan.majorTag, 'v2');
  assert.equal(plan.majorTarget, 'v2.0.0');
});

test('planRelease refuses to release a non-stable package version', () => {
  assert.throws(() => planRelease({ ref: 'refs/heads/main', packageVersion: '1.11.0-rc.1' }), /stable semver tag/);
});

test('planRelease marks only the newest release overall as latest', () => {
  assert.equal(
    planRelease({ ref: 'refs/tags/v1.4.3', packageVersion: '1.4.3', existingTags: ['v1.10.0'] }).latest,
    false
  );
  assert.equal(
    planRelease({ ref: 'refs/tags/v1.99.0', packageVersion: '1.99.0', existingTags: ['v2.0.0'] }).latest,
    false
  );
  assert.equal(
    planRelease({ ref: 'refs/heads/main', packageVersion: '2.1.0', existingTags: ['v2.0.0', 'v1.99.0'] }).latest,
    true
  );
});

const CHANGELOG = `# Changelog

---

## [Unreleased]

## [1.2.0] - 2026-10-01

### Added

- New thing.

### Fixed

- Old bug.

## [1.1.0] - 2026-09-01

### Changed

- Earlier change.
`;

test('releaseNotes returns only that version section with promoted headings', () => {
  assert.equal(releaseNotes(CHANGELOG, '1.2.0'), '## Added\n\n- New thing.\n\n## Fixed\n\n- Old bug.\n');
  assert.equal(releaseNotes(CHANGELOG, '1.1.0'), '## Changed\n\n- Earlier change.\n');
});

test('releaseNotes fails for a missing or empty section', () => {
  assert.throws(() => releaseNotes(CHANGELOG, '9.9.9'), /no "## \[9\.9\.9\]" section/);
  assert.throws(() => releaseNotes('## [Unreleased]\n\n## [1.0.0] - x\n\n## [0.9.0] - y\n', '1.0.0'), /is empty/);
});

// A stray version tag pushed off main (a branch, a fork's commit) must not become the major tag's
// target or the latest release (second audit #14): the plan only sees tags reachable from the
// commit being released.
test('the release plan only counts version tags merged into the released commit', async () => {
  const { execFileSync } = await import('node:child_process');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const workflow = fs.readFileSync('.github/workflows/release-tags.yml', 'utf8');
  const listing = /EXISTING_TAGS="\$\((git tag [^)]*)\)"/.exec(workflow)?.[1];
  assert.equal(listing, "git tag --list --merged HEAD 'v*.*.*'");

  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-release-tags-'));
  const git = (...args) =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], {
      cwd: repo,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: process.env.HOME }
    });
  try {
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'one');
    git('tag', 'v0.5.0');
    git('checkout', '-q', '-b', 'stray');
    git('commit', '-q', '--allow-empty', '-m', 'off main');
    git('tag', 'v0.9.0');
    git('checkout', '-q', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'release');
    const existingTags = execFileSync('bash', ['-c', listing], { cwd: repo, encoding: 'utf8' })
      .split(/\s+/)
      .filter(Boolean);
    assert.deepEqual(existingTags, ['v0.5.0']);
    const plan = planRelease({ ref: 'refs/heads/main', packageVersion: '0.6.0', existingTags });
    assert.equal(plan.majorTarget, 'v0.6.0');
    assert.equal(plan.latest, true);
    // Every tag, as before, would have moved v0 to the stray v0.9.0.
    assert.equal(
      planRelease({ ref: 'refs/heads/main', packageVersion: '0.6.0', existingTags: ['v0.5.0', 'v0.9.0'] }).majorTarget,
      'v0.9.0'
    );
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
