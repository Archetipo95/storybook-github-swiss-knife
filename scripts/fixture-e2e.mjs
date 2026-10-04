// End-to-end check of the visual + accessibility pipeline on a fixture Storybook:
//
//   1. install the fixture with its own package manager
//   2. build the base Storybook, then the head Storybook with `mutate/` copied over `src/`
//   3. capture baseline screenshots and axe reports from the base build; the axe reports become
//      the accessibility baseline
//   4. run the runner on the head build (gallery + axe)
//   5. classify with the trusted modules and compare with the fixture's expected.json
//
// Usage: node scripts/fixture-e2e.mjs test/fixtures/<name> [--skip-install]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

import { buildBaseline, evaluateA11yReports } from '../src/a11y/report.js';
import { evaluateVisualGate } from '../src/visual/gate.js';
import { buildGalleryManifest } from '../src/visual/manifest.js';
import { readVisualResults, storyIdOf } from '../src/visual/results.js';

const repoRoot = path.resolve(import.meta.dirname, '..');
const runnerDir = path.join(repoRoot, 'runner');
const [fixtureArg, ...flags] = process.argv.slice(2);
if (!fixtureArg) {
  console.error('Usage: node scripts/fixture-e2e.mjs test/fixtures/<name> [--skip-install]');
  process.exit(1);
}
const fixtureDir = path.resolve(fixtureArg);
const name = path.basename(fixtureDir);
const work = path.join(fixtureDir, '.swiss-knife');
const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'expected.json'), 'utf8'));
const packageJson = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'package.json'), 'utf8'));
const packageManager = String(packageJson.packageManager ?? 'npm').split('@')[0];

const run = (command, args, options = {}) => {
  console.log(`\n$ ${[command, ...args].join(' ')}`);
  return execFileSync(command, args, { stdio: 'inherit', ...options });
};

function install() {
  if (packageManager === 'npm') run('npm', ['install', '--no-audit', '--no-fund'], { cwd: fixtureDir });
  else run('corepack', [packageManager, 'install'], { cwd: fixtureDir });
}

function buildStorybook(projectDir, outputDir) {
  fs.rmSync(outputDir, { recursive: true, force: true });
  run(path.join(fixtureDir, 'node_modules/.bin/storybook'), ['build', '--quiet', '--output-dir', outputDir], {
    cwd: projectDir,
    env: { ...process.env, STORYBOOK_DISABLE_TELEMETRY: '1' }
  });
}

/** A copy of the fixture with mutate/ applied over src/, sharing the installed node_modules. */
function mutatedCopy() {
  const copy = fs.mkdtempSync(path.join(os.tmpdir(), `swiss-knife-${name}-head-`));
  for (const entry of fs.readdirSync(fixtureDir)) {
    if (['node_modules', '.swiss-knife', 'mutate'].includes(entry) || entry.startsWith('storybook-')) continue;
    fs.cpSync(path.join(fixtureDir, entry), path.join(copy, entry), { recursive: true });
  }
  fs.cpSync(path.join(fixtureDir, 'mutate'), path.join(copy, 'src'), { recursive: true });
  fs.symlinkSync(path.join(fixtureDir, 'node_modules'), path.join(copy, 'node_modules'), 'dir');
  return copy;
}

function runRunner({ storybookDir, update, jsonOutput, galleryDir, a11yDir }) {
  const env = {
    ...process.env,
    CI: '',
    SWISS_KNIFE_PROJECT_DIR: fixtureDir,
    SWISS_KNIFE_STORYBOOK_DIR: storybookDir,
    SWISS_KNIFE_SNAPSHOT_DIR: path.join(work, 'snapshots'),
    SWISS_KNIFE_OUTPUT_DIR: path.join(work, update ? 'results-base' : 'results-head'),
    SWISS_KNIFE_GALLERY_DIR: galleryDir ?? '',
    SWISS_KNIFE_A11Y_DIR: a11yDir ?? '',
    PLAYWRIGHT_JSON_OUTPUT_NAME: jsonOutput
  };
  const args = ['playwright', 'test', '-c', 'playwright.config.js', '--reporter=json'];
  if (update) args.push('--update-snapshots=all');
  try {
    run('npx', args, { cwd: runnerDir, env, stdio: ['ignore', 'ignore', 'inherit'] });
  } catch {
    // Failing tests are expected on the head build; the results file is what gets checked.
  }
  assert.ok(fs.existsSync(jsonOutput), `runner wrote no results to ${jsonOutput}`);
}

const readReports = dir =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .map(file => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')))
    : [];

/** Width and height of a PNG, from its IHDR chunk. */
function pngSize(file) {
  const header = fs.readFileSync(file).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

if (!flags.includes('--skip-install')) install();
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const baseBuild = path.join(work, 'storybook-base');
const headBuild = path.join(work, 'storybook-head');
buildStorybook(fixtureDir, baseBuild);
const head = mutatedCopy();
try {
  buildStorybook(head, headBuild);
} finally {
  fs.rmSync(head, { recursive: true, force: true });
}

const baseA11y = path.join(work, 'a11y-base');
runRunner({ storybookDir: baseBuild, update: true, jsonOutput: path.join(work, 'base.json'), a11yDir: baseA11y });
const config = JSON.parse(fs.readFileSync(path.join(fixtureDir, '.storybook/swiss-knife.json'), 'utf8'));
const enforcedRules = config.a11y?.enforcedRules ?? [];
const baseline = buildBaseline(readReports(baseA11y), enforcedRules);

const gallery = path.join(work, 'gallery');
const headA11y = path.join(work, 'a11y-head');
const headJson = path.join(work, 'head.json');
runRunner({ storybookDir: headBuild, jsonOutput: headJson, galleryDir: gallery, a11yDir: headA11y });

const results = readVisualResults(headJson);
const ids = tests => tests.map(storyIdOf).sort();
const evaluation = evaluateA11yReports(readReports(headA11y), { baseline, enforcedRules });
const manifest = buildGalleryManifest(results, {
  hasImage: (id, image) => fs.existsSync(path.join(gallery, id, `${image}.png`))
});
const viewports = Object.fromEntries(
  Object.keys(expected.viewports ?? {}).map(id => [id, pngSize(path.join(gallery, id, 'pr.png'))])
);
assert.deepEqual(results.runErrors, [], `${name}: the runner reported errors`);
const actual = {
  changed: ids(results.changed),
  removed: results.removed,
  new: ids(results.added),
  interaction: ids(results.interactions),
  error: ids(results.broken),
  flaky: ids(results.flaky),
  skipped: ids(results.skipped),
  unchanged: ids(results.unchanged),
  a11yBlocking: evaluation.blocking.map(({ story, id, nodes }) => `${story}:${id}:${nodes}`).sort(),
  gate: evaluateVisualGate(results).reason,
  changedImages: manifest.stories[expected.changed?.[0]]?.images ?? []
};

const { viewports: expectedViewports = {}, ...expectedRest } = expected;
console.log(`\n${name}:`, JSON.stringify(actual, null, 2));
assert.deepEqual(actual, expectedRest, `${name}: classification differs from expected.json`);
for (const [id, size] of Object.entries(expectedViewports)) {
  // Desktop Chrome renders at device scale factor 1, so the PNG width is the viewport width.
  assert.equal(viewports[id].width, size.width, `${name}: ${id} captured at width ${viewports[id].width}`);
}
console.log(`\n${name}: OK`);
