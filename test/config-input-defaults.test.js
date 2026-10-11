import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveConfiguration } from '../src/config.js';

// Settings that the config file can set and the root action / reusable workflows also take as
// inputs. An input's default reaches resolveConfiguration as a value, so a non-empty default would
// always beat the file: these inputs must default to '' (unset), with the real defaults kept in
// DEFAULT_CONFIG.
const FILE_SETTINGS = {
  create_deployment: false,
  preserve_cname: false,
  generate_badges: false,
  generate_stats_graph: false,
  enable_passcode_gate: true,
  smoke_test: true,
  auto_base_url: false,
  audit_bundle_size: true
};

/**
 * Input specs ({ name: { type, default } }) of the `inputs:` map that starts at `marker` (the
 * `inputs:` line, at any indentation). Enough YAML for the action and workflow files.
 */
function inputSpecs(file, marker) {
  const lines = fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\n');
  const start = lines.findIndex(line => line.trimEnd() === marker);
  assert.notEqual(start, -1, `${file} has no "${marker.trim()}"`);
  const indent = marker.search(/\S/) + 2;
  const specs = {};
  let current;
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const lineIndent = line.search(/\S/);
    if (lineIndent < indent) break;
    if (lineIndent === indent) {
      current = line.trim().replace(/:$/, '');
      specs[current] = { type: 'string', default: undefined };
    } else if (current) {
      const match = /^(type|default):\s*(.*)$/.exec(line.trim());
      if (match) specs[current][match[1]] = match[2].replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
    }
  }
  return specs;
}

/** What a step receives for each input when the caller sets nothing: `toJSON(inputs)`. */
function callerDefaults(specs) {
  return Object.fromEntries(
    Object.entries(specs).map(([name, { type, default: value }]) => [
      name,
      // GitHub sends 0 for a number input without a default, and '' for a string one.
      type === 'boolean' ? value === 'true' : type === 'number' ? Number(value ?? 0) : (value ?? '')
    ])
  );
}

function configFile(t) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sk-input-defaults-')), '.storybook-pages.yml');
  fs.writeFileSync(
    file,
    Object.entries(FILE_SETTINGS)
      .map(([key, value]) => `${key}: ${value}\n`)
      .join('')
  );
  t.after(() => fs.rmSync(path.dirname(file), { recursive: true, force: true }));
  return file;
}

function emptyProject(t) {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-input-defaults-'));
  t.after(() => fs.rmSync(project, { recursive: true, force: true }));
  return project;
}

for (const [file, marker, names] of [
  // The settings each caller takes as inputs.
  ['action.yml', 'inputs:', Object.keys(FILE_SETTINGS).filter(name => name !== 'preserve_cname')],
  [
    '.github/workflows/deploy-storybook.yml',
    '    inputs:',
    Object.keys(FILE_SETTINGS).filter(name => name !== 'generate_stats_graph')
  ]
]) {
  test(`${file}: the config file's settings win over input defaults`, t => {
    const specs = inputSpecs(file, marker);
    for (const name of names) assert.ok(specs[name], `${file} has no ${name} input`);
    const resolved = resolveConfiguration({ inputs: callerDefaults(specs), configFilePath: configFile(t) });
    for (const name of names) {
      assert.equal(resolved[name], FILE_SETTINGS[name], `${name}: the input default overrode the config file`);
    }
  });
}

test('pr-preview-publish.yml: config-file settings reach the publisher', () => {
  const file = '.github/workflows/pr-preview-publish.yml';
  const specs = inputSpecs(file, '    inputs:');
  for (const name of ['generate_stats_graph', 'create_deployment', 'enable_passcode_gate']) {
    assert.equal(specs[name]?.type, 'string', `${name} must be a string input (a boolean is never unset)`);
    assert.equal(specs[name]?.default, '', `${name} must default to '' so the config file applies`);
  }
  const workflow = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  for (const name of ['generate_stats_graph', 'create_deployment', 'enable_passcode_gate']) {
    assert.match(
      workflow,
      new RegExp(`\\n\\s+${name}: \\$\\{\\{ steps\\.config\\.outputs\\.${name} \\}\\}`),
      `the publisher must get the resolved ${name}, not the raw input`
    );
  }
});

/** The `node -e '…'` script of a workflow step, by step name. */
function stepScript(file, stepName) {
  const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
  const start = text.indexOf(`- name: ${stepName}`);
  assert.notEqual(start, -1, `${file} has no step "${stepName}"`);
  const script = /node -e '([\s\S]*?)'\s*>> "\$GITHUB_OUTPUT"/.exec(text.slice(start));
  assert.ok(script, `${file}: "${stepName}" does not run a node -e script into GITHUB_OUTPUT`);
  return script[1];
}

/** Runs a workflow's config step in a project with (or without) the config file; returns its outputs. */
function runConfigStep(t, script, env, { withFile = true } = {}) {
  const project = withFile ? path.dirname(configFile(t)) : emptyProject(t);
  const env2 = { ...process.env, ...env, SWISS_KNIFE_ROOT: process.cwd() };
  delete env2.GITHUB_ACTIONS;
  const output = execFileSync('node', ['-e', script], { cwd: project, env: env2, encoding: 'utf8' });
  return Object.fromEntries(
    output
      .trim()
      .split('\n')
      .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
  );
}

// The real path: what a caller that sets nothing sends, through the workflow's own config step.
test('deploy-storybook.yml: the config step outputs the config file settings for unset inputs', t => {
  const file = '.github/workflows/deploy-storybook.yml';
  const inputs = callerDefaults(inputSpecs(file, '    inputs:'));
  const outputs = runConfigStep(t, stepScript(file, 'Resolve and validate configuration'), {
    CONFIG_INPUTS: JSON.stringify(inputs)
  });
  for (const name of Object.keys(FILE_SETTINGS).filter(name => name !== 'generate_stats_graph')) {
    assert.equal(outputs[name], String(FILE_SETTINGS[name]), `${name} output`);
  }
});

test('pr-preview-publish.yml: the config step gives the publisher resolved, non-empty flags', t => {
  const file = '.github/workflows/pr-preview-publish.yml';
  const script = stepScript(file, 'Resolve trusted base configuration');
  const unset = { INPUT_GENERATE_STATS_GRAPH: '', INPUT_CREATE_DEPLOYMENT: '', INPUT_ENABLE_PASSCODE_GATE: '' };
  const fromFile = runConfigStep(t, script, unset);
  assert.equal(fromFile.generate_stats_graph, 'false');
  assert.equal(fromFile.create_deployment, 'false');
  assert.equal(fromFile.enable_passcode_gate, 'true');
  // An explicit input still wins over the file.
  const explicit = runConfigStep(t, script, { ...unset, INPUT_ENABLE_PASSCODE_GATE: 'false' });
  assert.equal(explicit.enable_passcode_gate, 'false');
});

// The defaults each caller's inputs had before they became '' (unset). With no input and no config
// file, every caller must still resolve to them.
const PREVIOUS_STRINGS = {
  badges_directory: 'badges',
  stats_directory: 'stats',
  passcode_session_hours: 24,
  smoke_test_stories: 'all',
  smoke_test_timeout_ms: 30000,
  artifact_name: 'github-pages'
};
const PREVIOUS_DEFAULTS = {
  'action.yml': {
    ...PREVIOUS_STRINGS,
    create_deployment: false,
    generate_badges: true,
    generate_stats_graph: true,
    enable_passcode_gate: false,
    smoke_test: false,
    auto_base_url: true,
    audit_bundle_size: false
  },
  '.github/workflows/deploy-storybook.yml': {
    ...PREVIOUS_STRINGS,
    create_deployment: true,
    preserve_cname: true,
    auto_base_url: true,
    generate_badges: true,
    enable_passcode_gate: false,
    smoke_test: false,
    audit_bundle_size: false
  },
  '.github/workflows/pr-preview-publish.yml': {
    generate_stats_graph: true,
    create_deployment: true,
    enable_passcode_gate: false
  }
};

test('action.yml: with no input and no config file, the previous defaults apply', t => {
  const inputs = callerDefaults(inputSpecs('action.yml', 'inputs:'));
  const resolved = resolveConfiguration({ inputs, configFilePath: path.join(emptyProject(t), '.storybook-pages.yml') });
  for (const [name, value] of Object.entries(PREVIOUS_DEFAULTS['action.yml'])) {
    assert.equal(resolved[name], value, name);
  }
});

test('deploy-storybook.yml: with no input and no config file, the previous defaults apply', t => {
  const file = '.github/workflows/deploy-storybook.yml';
  const outputs = runConfigStep(
    t,
    stepScript(file, 'Resolve and validate configuration'),
    { CONFIG_INPUTS: JSON.stringify(callerDefaults(inputSpecs(file, '    inputs:'))) },
    { withFile: false }
  );
  for (const [name, value] of Object.entries(PREVIOUS_DEFAULTS[file])) {
    assert.equal(outputs[name], String(value), name);
  }
});

test('pr-preview-publish.yml: with no input and no config file, the previous defaults apply', t => {
  const file = '.github/workflows/pr-preview-publish.yml';
  const outputs = runConfigStep(
    t,
    stepScript(file, 'Resolve trusted base configuration'),
    { INPUT_GENERATE_STATS_GRAPH: '', INPUT_CREATE_DEPLOYMENT: '', INPUT_ENABLE_PASSCODE_GATE: '' },
    { withFile: false }
  );
  for (const [name, value] of Object.entries(PREVIOUS_DEFAULTS[file])) {
    assert.equal(outputs[name], String(value), name);
  }
});

test('resolveConfiguration: caller defaults apply only when neither the input nor the file sets a value', t => {
  const defaults = { create_deployment: true };
  const noFile = path.join(emptyProject(t), '.storybook-pages.yml');
  assert.equal(resolveConfiguration({ inputs: {}, configFilePath: noFile, defaults }).create_deployment, true);
  assert.equal(resolveConfiguration({ inputs: {}, configFilePath: configFile(t), defaults }).create_deployment, false);
  const explicit = resolveConfiguration({ inputs: { create_deployment: 'false' }, configFilePath: noFile, defaults });
  assert.equal(explicit.create_deployment, false);
  // Other settings keep DEFAULT_CONFIG.
  assert.equal(resolveConfiguration({ inputs: {}, configFilePath: noFile, defaults }).smoke_test, false);
});

// The other settings the config file can set (second audit #16): their inputs used to default to the
// real value, so the file never applied when an input was left out.
const FILE_VALUES = {
  artifact_name: 'file-artifact',
  environment_name: 'file-environment',
  badges_directory: 'file-badges',
  stats_directory: 'file-stats',
  passcode_session_hours: 12,
  smoke_test_stories: 'button--primary',
  smoke_test_timeout_ms: 5000
};

function valuesFile(t) {
  const file = path.join(emptyProject(t), '.storybook-pages.yml');
  fs.writeFileSync(
    file,
    Object.entries(FILE_VALUES)
      .map(([key, value]) => `${key}: ${value}\n`)
      .join('')
  );
  return file;
}

for (const [file, marker, names] of [
  ['action.yml', 'inputs:', Object.keys(FILE_VALUES)],
  [
    '.github/workflows/deploy-storybook.yml',
    '    inputs:',
    Object.keys(FILE_VALUES).filter(name => name !== 'stats_directory')
  ],
  [
    '.github/workflows/pr-preview-publish.yml',
    '    inputs:',
    ['badges_directory', 'stats_directory', 'passcode_session_hours']
  ]
]) {
  test(`${file}: the config file's values win over input defaults`, t => {
    const specs = inputSpecs(file, marker);
    for (const name of names) assert.ok(specs[name], `${file} has no ${name} input`);
    const resolved = resolveConfiguration({ inputs: callerDefaults(specs), configFilePath: valuesFile(t) });
    for (const name of names) {
      assert.equal(resolved[name], FILE_VALUES[name], `${name}: the input default overrode the config file`);
    }
  });
}

test('every caller passes the resolved values on, never the raw input', () => {
  const action = fs.readFileSync('action.yml', 'utf8');
  assert.match(action, /SB_ARTIFACT_NAME: c\.artifact_name \|\| "github-pages"/);
  assert.doesNotMatch(action, /ARTIFACT_NAME_INPUT/);
  const publish = fs.readFileSync('.github/workflows/pr-preview-publish.yml', 'utf8');
  assert.match(publish, /\n\s+passcode_session_hours: \$\{\{ steps\.config\.outputs\.passcode_session_hours \}\}/);
  // Only the configuration step reads them, to resolve them (an INPUT_* variable, or toJSON(inputs)).
  for (const [file, names] of [
    ['action.yml', Object.keys(FILE_VALUES)],
    ['.github/workflows/deploy-storybook.yml', Object.keys(FILE_VALUES)],
    // There, artifact_name is the preview build's artifact, not a Pages setting.
    ['.github/workflows/pr-preview-publish.yml', ['badges_directory', 'stats_directory', 'passcode_session_hours']]
  ]) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      for (const name of names) {
        if (!new RegExp(`inputs\\.${name}\\b`).test(line)) continue;
        assert.match(
          line,
          new RegExp(`^\\s+INPUT_[A-Z_]+: \\$\\{\\{ inputs\\.${name} \\}\\}$`),
          `${file} reads inputs.${name} directly: ${line.trim()}`
        );
      }
    }
  }
});

test('pr-preview-publish.yml: the config step resolves the passcode session hours', t => {
  const file = '.github/workflows/pr-preview-publish.yml';
  const script = stepScript(file, 'Resolve trusted base configuration');
  const project = path.dirname(valuesFile(t));
  const run = env =>
    Object.fromEntries(
      execFileSync('node', ['-e', script], {
        cwd: project,
        env: { ...process.env, SWISS_KNIFE_ROOT: process.cwd(), ...env },
        encoding: 'utf8'
      })
        .trim()
        .split('\n')
        .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)])
    );
  // GitHub sends 0 for the omitted number input.
  assert.equal(run({ INPUT_PASSCODE_SESSION_HOURS: '0' }).passcode_session_hours, '12');
  assert.equal(run({ INPUT_PASSCODE_SESSION_HOURS: '6' }).passcode_session_hours, '6');
});

test('passcode.expiryHours in swiss-knife.json is the session length when pages does not set one', t => {
  const project = emptyProject(t);
  fs.mkdirSync(path.join(project, '.storybook'));
  const write = config => fs.writeFileSync(path.join(project, '.storybook/swiss-knife.json'), JSON.stringify(config));
  const resolve = inputs => {
    const previous = process.cwd();
    process.chdir(project);
    try {
      return resolveConfiguration({ inputs }).passcode_session_hours;
    } finally {
      process.chdir(previous);
    }
  };
  write({ passcode: { expiryHours: 8 } });
  assert.equal(resolve({}), 8);
  assert.equal(resolve({ passcode_session_hours: 0 }), 8);
  assert.equal(resolve({ passcode_session_hours: '3' }), 3);
  write({ pages: { passcode_session_hours: 5 }, passcode: { expiryHours: 8 } });
  assert.equal(resolve({}), 5);
  write({});
  assert.equal(resolve({}), 24);
});
