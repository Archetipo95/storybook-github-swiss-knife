#!/usr/bin/env node
// Local entry point of the visual + accessibility runner (the CI path uses the same runner).
//
//   swiss-knife visual [--update] [--storybook <dir>] [--shard <i/n>] [--docker]
//       Screenshot every story of a built Storybook and compare with the local baselines
//       (.swiss-knife/snapshots); --update captures them instead. Also scans with axe.
//   swiss-knife a11y --update-baseline
//       Rewrite the a11y baseline from the last scan's reports.
//
// --docker runs the same command inside the Playwright image matching the runner's version, so
// fonts and rendering match the Linux CI runners instead of the local OS.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

import { buildBaseline, evaluateA11yReports, renderA11ySummary } from '../src/a11y/report.js';
import { evaluateVisualGate, renderVisualSummary } from '../src/visual/gate.js';
import { readVisualResults } from '../src/visual/results.js';
import { loadSwissKnifeConfig } from '../src/swiss-knife-config.js';

const runnerDir = import.meta.dirname;
const repoRoot = path.dirname(runnerDir);
const LOCAL = {
  a11y: '.swiss-knife/a11y',
  results: '.swiss-knife/results.json',
  report: '.swiss-knife/report'
};

/** @param {string[]} argv */
export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const options = {
    command,
    update: false,
    updateBaseline: false,
    docker: false,
    storybook: 'storybook-static',
    shard: '1/1'
  };
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === '--update') options.update = true;
    else if (arg === '--update-baseline') options.updateBaseline = true;
    else if (arg === '--docker') options.docker = true;
    else if (arg === '--storybook') options.storybook = rest[++index];
    else if (arg === '--shard') options.shard = rest[++index];
    else throw new Error(`Unknown option: ${arg}`);
  }
  if (!['visual', 'a11y'].includes(command)) throw new Error('Usage: swiss-knife <visual|a11y> [options]');
  if (command === 'a11y' && !options.updateBaseline) throw new Error('Usage: swiss-knife a11y --update-baseline');
  return options;
}

function playwrightVersion() {
  const require = createRequire(path.join(runnerDir, 'package.json'));
  return require('@playwright/test/package.json').version;
}

/**
 * docker run arguments for the same command inside mcr.microsoft.com/playwright. The project is
 * mounted at /project and swiss-knife at /swiss-knife.
 * @param {{ projectDir: string, args: string[], version: string, uid?: number, gid?: number }} options
 */
export function dockerArgs({ projectDir, args, version, uid, gid }) {
  return [
    'run',
    '--rm',
    '--init',
    '--ipc=host',
    ...(uid !== undefined ? ['--user', `${uid}:${gid}`] : []),
    '-e',
    'HOME=/tmp',
    '-v',
    `${projectDir}:/project`,
    '-v',
    `${repoRoot}:/swiss-knife:ro`,
    '-w',
    '/project',
    `mcr.microsoft.com/playwright:v${version}-noble`,
    'node',
    '/swiss-knife/runner/cli.js',
    ...args.filter(arg => arg !== '--docker')
  ];
}

function runVisual(options, projectDir) {
  const env = {
    ...process.env,
    SWISS_KNIFE_PROJECT_DIR: projectDir,
    SWISS_KNIFE_STORYBOOK_DIR: options.storybook,
    SWISS_KNIFE_A11Y_DIR: options.update ? '' : LOCAL.a11y,
    SWISS_KNIFE_SHARD: options.shard,
    SWISS_KNIFE_REPORT_DIR: LOCAL.report,
    PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(projectDir, LOCAL.results)
  };
  if (!options.update) fs.rmSync(path.join(projectDir, LOCAL.a11y), { recursive: true, force: true });
  const args = ['playwright', 'test', '-c', 'playwright.config.js', '--reporter=list,json'];
  if (options.update) args.push('--update-snapshots=all');
  const result = spawnSync('npx', args, { cwd: runnerDir, env, stdio: 'inherit' });
  if (options.update) {
    console.log(`\nBaselines written to ${path.join(projectDir, '.swiss-knife/snapshots')}.`);
    return result.status ?? 1;
  }

  const config = loadSwissKnifeConfig({ cwd: projectDir });
  const results = readVisualResults(path.join(projectDir, LOCAL.results));
  console.log(`\n${renderVisualSummary(results, { approvalLabel: config.visual.approvalLabel })}`);
  const evaluation = evaluateA11yReports(readReports(path.join(projectDir, LOCAL.a11y)), {
    baseline: readJson(path.join(projectDir, config.a11y.baseline)) ?? {},
    enforcedRules: config.a11y.enforcedRules,
    blockingImpacts: config.a11y.blockingImpacts
  });
  console.log(
    renderA11ySummary(evaluation, { baselinePath: config.a11y.baseline, blockingImpacts: config.a11y.blockingImpacts })
  );
  console.log(`\nHTML report: ${path.join(projectDir, LOCAL.report, 'index.html')}`);
  const blocking = evaluateVisualGate(results).blocking || evaluation.blocking.length > 0;
  return blocking ? 1 : 0;
}

function updateBaseline(projectDir) {
  const config = loadSwissKnifeConfig({ cwd: projectDir });
  const reports = readReports(path.join(projectDir, LOCAL.a11y));
  if (reports.length === 0 && !fs.existsSync(path.join(projectDir, LOCAL.a11y))) {
    throw new Error('No scan to build the baseline from: run `swiss-knife visual` first.');
  }
  const existing = readJson(path.join(projectDir, config.a11y.baseline)) ?? {};
  // Enforced rules are never baselined; the file keeps only its own list (the configuration's
  // a11y.enforcedRules is applied by the gate either way).
  const enforced = [...new Set([...(existing.enforcedRules ?? []), ...config.a11y.enforcedRules])];
  const baseline = { ...buildBaseline(reports, enforced), enforcedRules: existing.enforcedRules ?? [] };
  fs.mkdirSync(path.dirname(path.join(projectDir, config.a11y.baseline)), { recursive: true });
  fs.writeFileSync(path.join(projectDir, config.a11y.baseline), `${JSON.stringify(baseline, null, 2)}\n`);
  const count = Object.keys(baseline.stories).length;
  console.log(`Wrote ${count} ${count === 1 ? 'story' : 'stories'} to ${config.a11y.baseline}.`);
  return 0;
}

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);
const readReports = dir =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter(file => file.endsWith('.json'))
        .map(file => readJson(path.join(dir, file)))
    : [];

function main(argv) {
  const options = parseArgs(argv);
  const projectDir = process.cwd();
  if (options.docker) {
    const args = dockerArgs({
      projectDir,
      args: argv,
      version: playwrightVersion(),
      uid: process.getuid?.(),
      gid: process.getgid?.()
    });
    return spawnSync('docker', args, { stdio: 'inherit' }).status ?? 1;
  }
  return options.command === 'visual' ? runVisual(options, projectDir) : updateBaseline(projectDir);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
