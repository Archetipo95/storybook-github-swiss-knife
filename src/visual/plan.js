// Plans an untrusted visual run: what to do for this event, the shards, and the baseline cache
// key prefix. Runs in the `plan` job of visual.yml (PR checkout, read-only); it only decides
// how to capture, never whether the result passes.
//
// Environment: SWISS_KNIFE_ROOT, PROJECT_DIR, EVENT_NAME, EVENT_ACTION, LABEL_NAME, REF_NAME,
// BASE_SHA, HEAD_SHA, GITHUB_OUTPUT.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { loadSwissKnifeConfig } from '../swiss-knife-config.js';

/** Hash of everything that changes how screenshots are taken: runner code, lockfile, config. */
export function captureFingerprint(runnerRoot, visualConfig) {
  const hash = crypto.createHash('sha256');
  const files = [
    'package-lock.json',
    'playwright.config.js',
    ...fs.readdirSync(path.join(runnerRoot, 'lib')).map(file => `lib/${file}`),
    ...fs.readdirSync(path.join(runnerRoot, 'tests')).map(file => `tests/${file}`)
  ]
    .filter(file => file === 'package-lock.json' || file.endsWith('.js'))
    .sort();
  for (const file of files) {
    hash.update(file);
    hash.update(fs.readFileSync(path.join(runnerRoot, file)));
  }
  hash.update(JSON.stringify(visualConfig));
  return hash.digest('hex').slice(0, 20);
}

/**
 * @param {{ visual: any }} config
 * @param {{ eventName: string, eventAction?: string, labelName?: string, refName?: string }} event
 * @returns {{ mode: 'compare' | 'baseline' | 'reuse' | 'skip', reason: string }}
 */
export function planMode(config, { eventName, eventAction = '', labelName = '', refName = '' }) {
  if (!config.visual.enabled) return { mode: 'skip', reason: 'visual.enabled is false' };
  if (eventName === 'push' || eventName === 'workflow_dispatch') {
    return config.visual.baselineBranches.includes(refName)
      ? { mode: 'baseline', reason: `capture baselines for ${refName}` }
      : { mode: 'skip', reason: `${refName} is not in visual.baselineBranches` };
  }
  if (eventName !== 'pull_request') return { mode: 'skip', reason: `unsupported event ${eventName}` };
  // Every label event re-gates the commit's results, with the approval label read live by the
  // gate: when two label events arrive together, the concurrency group cancels the first run, and
  // the run that remains must still see the approval whichever label it was for.
  if (eventAction === 'labeled' || eventAction === 'unlabeled') {
    return {
      mode: 'reuse',
      reason:
        labelName === config.visual.approvalLabel
          ? 'approval label changed: reuse the results of this commit'
          : `label ${labelName} changed: re-gate the results of this commit`
    };
  }
  return { mode: 'compare', reason: 'compare against the base branch' };
}

/** @param {NodeJS.ProcessEnv} env */
export function plan(env) {
  const config = loadSwissKnifeConfig({ cwd: path.resolve(env.PROJECT_DIR || '.') });
  const { mode, reason } = planMode(config, {
    eventName: env.EVENT_NAME,
    eventAction: env.EVENT_ACTION,
    labelName: env.LABEL_NAME,
    refName: env.REF_NAME
  });
  const total = config.visual.shards;
  const baselineCommit = mode === 'baseline' ? env.HEAD_SHA : env.BASE_SHA;
  return {
    mode,
    reason,
    shards: JSON.stringify(Array.from({ length: total }, (_, index) => `${index + 1}/${total}`)),
    shard_total: String(total),
    key_prefix: `sk-visual-v1-${baselineCommit}-${captureFingerprint(path.join(env.SWISS_KNIFE_ROOT, 'runner'), config.visual)}`,
    retention_days: String(config.visual.reportRetentionDays)
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const outputs = plan(process.env);
  console.log(`Visual run: ${outputs.mode} (${outputs.reason}), ${outputs.shard_total} shard(s).`);
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(outputs)
        .map(([key, value]) => `${key}=${value}\n`)
        .join('')
    );
  }
}
