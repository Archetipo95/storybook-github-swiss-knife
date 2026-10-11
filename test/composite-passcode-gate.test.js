import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { compositeInputDefaults, evaluateIf, parseCommandFile, stepIf, stepRun } from './helpers/workflow-step.js';

// Since the config file's settings win over input defaults (#25), a config file that turns the
// passcode gate on for the publishing workflow also turns it on for the composite action's
// build-only pull request runs, which have no passcode secret. Those skip the gate with a notice;
// a publishing run without a hash still fails.

const INJECT = 'Inject Storybook passcode gate';
const SKIP = 'Skip the passcode gate on a build-only run without a hash';

/** The env the composite's configuration step writes for a project with `config` (.storybook-pages.yml). */
function configureComposite(t, config, { publish }) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-composite-passcode-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  fs.writeFileSync(path.join(project, '.storybook-pages.yml'), config);
  const envFile = path.join(project, 'github-env');
  fs.writeFileSync(envFile, '');
  execFileSync('bash', ['-c', stepRun('action.yml', 'Resolve and validate configuration')], {
    cwd: project,
    env: {
      ...process.env,
      GITHUB_ACTION_PATH: process.cwd(),
      GITHUB_ENV: envFile,
      CONFIG_INPUTS: JSON.stringify({ ...compositeInputDefaults(), publish }),
      PUBLISH_INPUT: publish,
      ARTIFACT_NAME_INPUT: ''
    },
    stdio: 'pipe'
  });
  return parseCommandFile(fs.readFileSync(envFile, 'utf8'));
}

test("a config file's passcode gate is skipped, with a notice, on a build-only run without a hash", t => {
  const env = configureComposite(t, 'enable_passcode_gate: true\n', { publish: 'false' });
  assert.equal(env.SB_ENABLE_PASSCODE_GATE, 'true');
  assert.equal(env.SB_PUBLISH, 'false');
  assert.equal(evaluateIf(stepIf('action.yml', INJECT), { env, inputs: { passcode_hash: '' } }), false);
  assert.equal(evaluateIf(stepIf('action.yml', SKIP), { env, inputs: { passcode_hash: '' } }), true);
  assert.match(stepRun('action.yml', SKIP), /::notice::enable_passcode_gate is on, but this build-only run/);
});

test('a publishing run with the gate on and no hash fails, saying what is missing', t => {
  const env = configureComposite(t, 'enable_passcode_gate: true\n', { publish: 'true' });
  assert.equal(evaluateIf(stepIf('action.yml', INJECT), { env, inputs: { passcode_hash: '' } }), true);
  const site = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-composite-passcode-site-'));
  t.after(() => fs.rmSync(site, { recursive: true, force: true }));
  fs.writeFileSync(path.join(site, 'index.html'), '<html><body></body></html>');
  const result = spawnSync('bash', ['-c', stepRun('action.yml', INJECT)], {
    env: {
      ...process.env,
      GITHUB_ACTION_PATH: process.cwd(),
      SB_PATH: site,
      PASSCODE_HASH: '',
      PASSCODE_SESSION_HOURS: '24'
    },
    encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /enable_passcode_gate is on, but no passcode_hash was given/);
});

test('the gate is injected whenever a hash is given, and exactly one of the two steps runs when it is on', () => {
  const inject = stepIf('action.yml', INJECT);
  const skip = stepIf('action.yml', SKIP);
  for (const gate of ['true', 'false']) {
    for (const publish of ['true', 'false']) {
      for (const hash of ['', 'a'.repeat(64)]) {
        const context = {
          env: { SB_ENABLE_PASSCODE_GATE: gate, SB_PUBLISH: publish },
          inputs: { passcode_hash: hash }
        };
        const runs = [evaluateIf(inject, context), evaluateIf(skip, context)];
        const label = `gate ${gate}, publish ${publish}, hash ${hash ? 'set' : 'empty'}`;
        if (gate === 'false') assert.deepEqual(runs, [false, false], label);
        else assert.deepEqual(runs, [publish === 'true' || hash !== '', publish === 'false' && hash === ''], label);
      }
    }
  }
});
