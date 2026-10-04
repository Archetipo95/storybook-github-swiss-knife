import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { DEFAULT_CONFIG, resolveConfiguration } from '../src/config.js';
import {
  A11Y_DEFAULTS,
  LEGACY_CONFIG_PATH,
  PASSCODE_DEFAULTS,
  SWISS_KNIFE_CONFIG_PATH,
  VISUAL_DEFAULTS,
  loadSwissKnifeConfig,
  validateSwissKnifeConfig
} from '../src/swiss-knife-config.js';

const schema = JSON.parse(fs.readFileSync(new URL('../schema/swiss-knife.schema.json', import.meta.url), 'utf8'));

const LEGACY_YAML = `version: 1
mode: directory
path: dist/storybook
pages_branch: gh-pages
preview_root: previews
preview_retention_days: 14
generate_badges: false
package_manager: pnpm
build:
  install_command: pnpm install --frozen-lockfile
  build_command: pnpm build-storybook
`;

const LEGACY_AS_JSON = {
  version: 1,
  mode: 'directory',
  path: 'dist/storybook',
  pages_branch: 'gh-pages',
  preview_root: 'previews',
  preview_retention_days: 14,
  generate_badges: false,
  package_manager: 'pnpm',
  build: { install_command: 'pnpm install --frozen-lockfile', build_command: 'pnpm build-storybook' }
};

function repo(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swiss-knife-config-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

function inRepo(dir, callback) {
  const previous = process.cwd();
  process.chdir(dir);
  try {
    return callback();
  } finally {
    process.chdir(previous);
  }
}

test('no config file: defaults for every section', () => {
  const config = loadSwissKnifeConfig({ cwd: repo({}) });
  assert.equal(config.source, 'defaults');
  assert.deepEqual(config.warnings, []);
  assert.equal(config.pages, null);
  assert.deepEqual(config.visual, { ...VISUAL_DEFAULTS });
  assert.deepEqual(config.a11y, { ...A11Y_DEFAULTS });
  assert.deepEqual(config.passcode, { ...PASSCODE_DEFAULTS });
});

test('golden: legacy .storybook-pages.yml and the pages section resolve identically', () => {
  const inputs = { site_url: 'https://owner.github.io/repo' };
  const fromYaml = inRepo(repo({ [LEGACY_CONFIG_PATH]: LEGACY_YAML }), () => resolveConfiguration({ inputs }));
  const fromJson = inRepo(repo({ [SWISS_KNIFE_CONFIG_PATH]: { pages: LEGACY_AS_JSON } }), () =>
    resolveConfiguration({ inputs })
  );
  assert.deepEqual(fromJson, fromYaml);
  assert.equal(fromJson.package_manager, 'pnpm');
  assert.equal(fromJson.preview_root, 'previews');
});

test('an explicit configFilePath keeps the storybook-github-pages behaviour', () => {
  const dir = repo({ [SWISS_KNIFE_CONFIG_PATH]: { pages: { preview_root: 'from-json' } } });
  const legacy = path.join(repo({ [LEGACY_CONFIG_PATH]: 'preview_root: from-yaml\n' }), LEGACY_CONFIG_PATH);
  const resolved = inRepo(dir, () => resolveConfiguration({ inputs: {}, configFilePath: legacy }));
  assert.equal(resolved.preview_root, 'from-yaml');
});

test('legacy file alone is used with a deprecation warning', () => {
  const config = loadSwissKnifeConfig({ cwd: repo({ [LEGACY_CONFIG_PATH]: LEGACY_YAML }) });
  assert.equal(config.source, LEGACY_CONFIG_PATH);
  assert.deepEqual(config.pages, LEGACY_AS_JSON);
  assert.match(config.warnings[0], /deprecated/);
});

test('both files: the JSON file wins and the YAML file is reported as ignored', () => {
  const config = loadSwissKnifeConfig({
    cwd: repo({
      [LEGACY_CONFIG_PATH]: 'preview_root: from-yaml\n',
      [SWISS_KNIFE_CONFIG_PATH]: { pages: { preview_root: 'from-json' }, visual: { shards: 2 } }
    })
  });
  assert.equal(config.source, SWISS_KNIFE_CONFIG_PATH);
  assert.equal(config.pages.preview_root, 'from-json');
  assert.equal(config.visual.shards, 2);
  assert.equal(config.visual.approvalLabel, VISUAL_DEFAULTS.approvalLabel);
  assert.match(config.warnings[0], /ignored/);
});

test('a kinboo-like configuration is valid', () => {
  assert.equal(
    validateSwissKnifeConfig({
      $schema: './node_modules/storybook-swiss-knife/schema/swiss-knife.schema.json',
      pages: { preview_root: '.', enable_passcode_gate: true, passcode_session_hours: 24 },
      visual: {
        fixedTime: '2026-01-15T10:00:00+01:00',
        timezone: 'Europe/Rome',
        locale: 'en-GB',
        allowedHosts: ['fonts.googleapis.com', 'fonts.gstatic.com'],
        baselineBranches: ['master', 'preprod'],
        viewports: { desktop: { width: 1280, height: 900 }, mobile: { width: 375, height: 812 } }
      },
      a11y: { enforcedRules: ['button-name', 'label'], baseline: '.storybook/a11y-baseline.json' },
      passcode: { expiryHours: 24 }
    }),
    true
  );
});

for (const [name, config, message] of [
  ['unknown top-level key', { visuals: {} }, /Unknown config key "visuals"/],
  ['unknown visual key', { visual: { shard: 2 } }, /Unknown config key "visual.shard"/],
  ['non-integer shards', { visual: { shards: 1.5 } }, /visual.shards/],
  ['threshold above 1', { visual: { threshold: 2 } }, /visual.threshold/],
  ['invalid fixedTime', { visual: { fixedTime: 'tomorrow' } }, /visual.fixedTime/],
  ['host with a scheme', { visual: { allowedHosts: ['https://fonts.gstatic.com'] } }, /visual.allowedHosts/],
  ['no baseline branch', { visual: { baselineBranches: [] } }, /visual.baselineBranches/],
  ['retention above 90 days', { visual: { reportRetentionDays: 120 } }, /visual.reportRetentionDays/],
  ['non data-* marker', { visual: { ciMarkerAttribute: 'class' } }, /visual.ciMarkerAttribute/],
  ['viewport without height', { visual: { defaultViewport: { width: 800 } } }, /defaultViewport.height/],
  ['unknown impact', { a11y: { blockingImpacts: ['severe'] } }, /a11y.blockingImpacts/],
  ['baseline outside the repo', { a11y: { baseline: '../baseline.json' } }, /a11y.baseline/],
  ['non-positive expiry', { passcode: { expiryHours: 0 } }, /passcode.expiryHours/],
  ['unsafe pages directory', { pages: { preview_root: '../outside' } }, /preview_root/]
]) {
  test(`rejects ${name}`, () => {
    assert.throws(() => validateSwissKnifeConfig(config), message);
  });
}

test('invalid JSON reports the file', () => {
  const cwd = repo({ [SWISS_KNIFE_CONFIG_PATH]: '{ "visual": ' });
  assert.throws(() => loadSwissKnifeConfig({ cwd }), /swiss-knife\.json is not valid JSON/);
});

test('schema lists exactly the validated keys with the same defaults', () => {
  for (const [section, defaults] of [
    ['visual', VISUAL_DEFAULTS],
    ['a11y', A11Y_DEFAULTS],
    ['passcode', PASSCODE_DEFAULTS]
  ]) {
    const properties = schema.properties[section].properties;
    assert.deepEqual(Object.keys(properties).sort(), Object.keys(defaults).sort(), `${section} keys`);
    for (const [key, value] of Object.entries(defaults)) {
      assert.deepEqual(properties[key].default, value, `${section}.${key} default`);
    }
  }
});

test('schema documents every storybook-github-pages default key', () => {
  const documented = Object.keys(schema.properties.pages.properties);
  for (const key of Object.keys(DEFAULT_CONFIG)) assert.ok(documented.includes(key), `pages.${key}`);
});
