import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { stepRun } from './helpers/workflow-step.js';

// Badges and the stats snapshot need the source (coverage, the Storybook version). A publisher
// that only has the static output keeps the badges and the stats snapshot a build made with the
// source; one that runs where the source is (the demo's single job) still makes its own.

function tempDir(t, files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-badges-stats-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

// One of the workspace's two components has stories: 50% coverage, Storybook v9.1.20.
const WORKSPACE = {
  'package.json': { devDependencies: { storybook: '^9.1.20' } },
  'src/Button.vue': '<template><button /></template>',
  'src/Card.vue': '<template><div /></template>'
};
const STATIC = {
  'index.json': {
    v: 5,
    entries: {
      'button--primary': { id: 'button--primary', title: 'Button', type: 'story' },
      'button--secondary': { id: 'button--secondary', title: 'Button', type: 'story' }
    }
  }
};

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

const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));

function publisherBadges(t, { staticFiles = STATIC, workspace = WORKSPACE } = {}) {
  const staticDir = tempDir(t, staticFiles);
  const workspaceRoot = tempDir(t, workspace);
  const result = runStep(stepRun('actions/publisher/action.yml', 'Generate Storybook badges'), {
    cwd: workspaceRoot,
    env: {
      GITHUB_ACTION_PATH: path.join(process.cwd(), 'actions/publisher'),
      SOURCE_PATH: staticDir,
      SB_BADGES_DIRECTORY: 'badges',
      WORKSPACE_ROOT: workspaceRoot,
      GITHUB_SHA: 'abc1234def'
    }
  });
  return { result, staticDir };
}

test('publisher: badges the build already made are kept', t => {
  const built = {
    ...STATIC,
    'badges/overview.json': { commit: 'abc1234', coveragePercent: 50, storybookVersion: 'v9.1.20' }
  };
  // No source in this job: regenerating would give 100% and "deployed".
  const { result, staticDir } = publisherBadges(t, { staticFiles: built, workspace: {} });
  assert.match(result.stdout, /Keeping the badges the build generated/);
  assert.deepEqual(readJson(path.join(staticDir, 'badges/overview.json')), {
    commit: 'abc1234',
    coveragePercent: 50,
    storybookVersion: 'v9.1.20'
  });
  assert.equal(fs.existsSync(path.join(staticDir, 'badges/coverage.svg')), false);
});

test('publisher: badges for another commit (a leftover, e.g. from public/) are regenerated', t => {
  const stale = { ...STATIC, 'badges/overview.json': { commit: '1111111', coveragePercent: 10 } };
  const { result, staticDir } = publisherBadges(t, { staticFiles: stale });
  assert.match(result.stdout, /::warning::Regenerating the badges: .*overview\.json is for another commit/);
  const overview = readJson(path.join(staticDir, 'badges/overview.json'));
  assert.equal(overview.commit, 'abc1234');
  assert.equal(overview.coveragePercent, 50);
});

test('publisher: with the source checked out (one job), it makes the badges itself', t => {
  const { result, staticDir } = publisherBadges(t);
  assert.doesNotMatch(result.stdout, /::warning::/);
  const overview = readJson(path.join(staticDir, 'badges/overview.json'));
  assert.equal(overview.coveragePercent, 50);
  assert.equal(overview.storybookVersion, 'v9.1.20');
});

test('publisher: without the source and without the build badges, it warns', t => {
  const { result } = publisherBadges(t, { workspace: {} });
  assert.match(result.stdout, /::warning::No package\.json in .*coverage and Storybook version badges need the source/);
});

// The build and publish jobs of one run see the same commit.
function stats(t, { staticFiles, pagesFiles = null, sha = 'abc1234def' }) {
  const staticDir = tempDir(t, staticFiles);
  const env = { GITHUB_SHA: sha, SB_STATS_DIRECTORY: 'stats' };
  const args = [path.join(process.cwd(), 'src/generate-stats.js'), staticDir, tempDir(t, {})];
  if (pagesFiles) env.PAGES_REPO = tempDir(t, pagesFiles);
  const fullEnv = { ...process.env, ...env };
  delete fullEnv.GITHUB_ACTIONS;
  delete fullEnv.GITHUB_STEP_SUMMARY;
  const result = spawnSync('node', args, { env: fullEnv, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return { result, history: readJson(path.join(staticDir, 'stats/history.json')) };
}

const BUILD_SNAPSHOT = {
  timestamp: '2026-10-10T20:00:00.000Z',
  date: '2026-10-10',
  commit: 'abc1234',
  version: 'v9.1.20',
  components: 1,
  totalComponents: 2,
  coveragePercent: 50,
  stories: 2,
  docs: 0
};

test('stats at publish time use the snapshot the build wrote, not a recount', t => {
  const older = { ...BUILD_SNAPSHOT, commit: '0000001', date: '2026-10-01', coveragePercent: 40 };
  const { result, history } = stats(t, {
    staticFiles: { ...STATIC, 'stats/history.json': [BUILD_SNAPSHOT] },
    pagesFiles: { 'stats/history.json': [older] }
  });
  assert.match(result.stdout, /Using the snapshot the build wrote/);
  assert.equal(history.length, 2);
  assert.equal(history[0].commit, '0000001');
  // A recount here (no source) would say 100% and "deployed".
  assert.equal(history[1].commit, 'abc1234');
  assert.equal(history[1].coveragePercent, 50);
  assert.equal(history[1].version, 'v9.1.20');
});

test('stats on a first publish (no Pages history yet) keep the build snapshot once', t => {
  const { history } = stats(t, {
    staticFiles: { ...STATIC, 'stats/history.json': [BUILD_SNAPSHOT] },
    pagesFiles: {}
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].coveragePercent, 50);
});

test('stats ignore a snapshot for another commit (a leftover) and compute instead', t => {
  const { result, history } = stats(t, {
    staticFiles: { ...STATIC, 'stats/history.json': [{ ...BUILD_SNAPSHOT, commit: '1111111' }] },
    pagesFiles: { 'stats/history.json': [{ ...BUILD_SNAPSHOT, commit: '0000001' }] }
  });
  assert.match(
    result.stdout,
    /::warning::Ignoring the stats snapshot in the output: it is for commit 1111111, not abc1234/
  );
  assert.doesNotMatch(result.stdout, /Using the snapshot the build wrote/);
  assert.equal(history.at(-1).commit, 'abc1234');
});

test('stats without a build snapshot are computed as before', t => {
  const { result } = stats(t, { staticFiles: STATIC, pagesFiles: {} });
  assert.doesNotMatch(result.stdout, /Using the snapshot the build wrote/);
});

test('deploy-storybook.yml: the build job makes badges and the stats snapshot, the publisher gets the settings', () => {
  const workflow = fs.readFileSync(path.join(process.cwd(), '.github/workflows/deploy-storybook.yml'), 'utf8');
  const badges = stepRun('.github/workflows/deploy-storybook.yml', 'Generate Storybook badges');
  assert.match(badges, /node "\$SWISS_KNIFE_ROOT\/src\/generate-badges\.js" "\$TARGET_PATH" "\$WORKSPACE_ROOT"/);
  assert.match(workflow, /SB_COVERAGE_INCLUDE_PATHS: \$\{\{ steps\.config\.outputs\.coverage_include_paths \}\}/);
  assert.match(
    workflow,
    /- name: Generate Storybook stats snapshot\n\s+if: \$\{\{ steps\.config\.outputs\.generate_stats_graph == 'true' && steps\.config\.outputs\.mode == 'directory' \}\}/
  );
  for (const name of ['generate_badges', 'badges_directory', 'generate_stats_graph', 'stats_directory']) {
    assert.match(workflow, new RegExp(`\\n {6}${name}: \\$\\{\\{ steps\\.config\\.outputs\\.${name} \\}\\}\\n`), name);
    assert.match(
      workflow,
      new RegExp(`\\n {10}${name}: \\$\\{\\{ needs\\.build-and-upload\\.outputs\\.${name} \\}\\}\\n`),
      name
    );
  }
});

test('deploy-storybook.yml: the build job stats step writes the snapshot with the source', t => {
  const staticDir = tempDir(t, STATIC);
  const workspaceRoot = tempDir(t, WORKSPACE);
  runStep(stepRun('.github/workflows/deploy-storybook.yml', 'Generate Storybook stats snapshot'), {
    cwd: workspaceRoot,
    env: {
      SWISS_KNIFE_ROOT: process.cwd(),
      TARGET_PATH: staticDir,
      WORKSPACE_ROOT: workspaceRoot,
      SB_STATS_DIRECTORY: 'stats',
      GITHUB_SHA: 'abc1234def'
    }
  });
  const [snapshot, ...rest] = readJson(path.join(staticDir, 'stats/history.json'));
  assert.equal(rest.length, 0);
  assert.equal(snapshot.coveragePercent, 50);
  assert.equal(snapshot.version, 'v9.1.20');
  assert.equal(snapshot.commit, 'abc1234');
});
