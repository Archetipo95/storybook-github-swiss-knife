import fs from 'node:fs';
import path from 'node:path';

import { parseSimpleYaml, validateConfig } from './config.js';

export const SWISS_KNIFE_CONFIG_PATH = '.storybook/swiss-knife.json';
export const LEGACY_CONFIG_PATH = '.storybook-pages.yml';

export const VISUAL_DEFAULTS = Object.freeze({
  enabled: true,
  shards: 4,
  workers: 2,
  retries: 1,
  skipTag: 'skip-visual',
  approvalLabel: 'visual-approved',
  prComment: true,
  fixedTime: null,
  timezone: 'UTC',
  locale: 'en-US',
  allowedHosts: Object.freeze([]),
  maxDiffPixels: 100,
  threshold: 0.2,
  fullPage: true,
  viewports: 'storybook',
  defaultViewport: Object.freeze({ width: 1280, height: 720 }),
  loadingTimeoutMs: 3000,
  ciMarkerAttribute: 'data-storybook-ci',
  baselineBranches: Object.freeze(['main']),
  reportRetentionDays: 14
});

export const A11Y_DEFAULTS = Object.freeze({
  enabled: true,
  blockingImpacts: Object.freeze(['critical', 'serious']),
  enforcedRules: Object.freeze([]),
  disabledRules: Object.freeze(['region']),
  baseline: '.storybook/a11y-baseline.json',
  scope: 'body'
});

export const PASSCODE_DEFAULTS = Object.freeze({
  expiryHours: 24
});

const TOP_LEVEL_KEYS = new Set(['$schema', 'pages', 'visual', 'a11y', 'passcode']);
const AXE_IMPACTS = new Set(['minor', 'moderate', 'serious', 'critical']);
const HOST_PATTERN = /^(?=.{1,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*$/i;
const BRANCH_PATTERN = /^[A-Za-z0-9._/-]+$/;

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

function fail(section, key, message) {
  throw new Error(`Config ${section}.${key} ${message}`);
}

function rejectUnknownKeys(section, value, defaults) {
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(defaults, key)) {
      throw new Error(`Unknown config key "${section}.${key}"`);
    }
  }
}

function checkBoolean(section, key, value) {
  if (typeof value !== 'boolean') fail(section, key, 'must be a boolean');
}

function checkInteger(section, key, value, { min }) {
  if (!Number.isInteger(value) || value < min) fail(section, key, `must be an integer >= ${min}`);
}

function checkString(section, key, value) {
  if (typeof value !== 'string' || value.trim() === '') fail(section, key, 'must be a non-empty string');
}

function checkStringList(section, key, value, isValid = () => true) {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !isValid(item))) {
    fail(section, key, 'must be an array of valid strings');
  }
}

function checkViewportSize(section, key, value) {
  if (!isPlainObject(value)) fail(section, key, 'must be an object with width and height');
  for (const dimension of ['width', 'height']) {
    if (!Number.isInteger(value[dimension]) || value[dimension] < 1) {
      fail(section, `${key}.${dimension}`, 'must be a positive integer');
    }
  }
  rejectUnknownKeys(`${section}.${key}`, value, { width: 0, height: 0 });
}

/** @param {Record<string, unknown>} visual */
export function validateVisualConfig(visual) {
  if (!isPlainObject(visual)) throw new Error('Config visual must be an object');
  rejectUnknownKeys('visual', visual, VISUAL_DEFAULTS);
  const s = 'visual';
  const v = visual;
  if (v.enabled !== undefined) checkBoolean(s, 'enabled', v.enabled);
  if (v.fullPage !== undefined) checkBoolean(s, 'fullPage', v.fullPage);
  if (v.prComment !== undefined) checkBoolean(s, 'prComment', v.prComment);
  if (v.shards !== undefined) checkInteger(s, 'shards', v.shards, { min: 1 });
  if (v.workers !== undefined) checkInteger(s, 'workers', v.workers, { min: 1 });
  if (v.retries !== undefined) checkInteger(s, 'retries', v.retries, { min: 0 });
  if (v.maxDiffPixels !== undefined) checkInteger(s, 'maxDiffPixels', v.maxDiffPixels, { min: 0 });
  if (v.loadingTimeoutMs !== undefined) checkInteger(s, 'loadingTimeoutMs', v.loadingTimeoutMs, { min: 0 });
  if (v.reportRetentionDays !== undefined) {
    checkInteger(s, 'reportRetentionDays', v.reportRetentionDays, { min: 1 });
    if (v.reportRetentionDays > 90) fail(s, 'reportRetentionDays', 'must be at most 90 (GitHub artifact limit)');
  }
  for (const key of ['skipTag', 'approvalLabel', 'timezone', 'locale']) {
    if (v[key] !== undefined) checkString(s, key, v[key]);
  }
  if (v.ciMarkerAttribute !== undefined) {
    if (typeof v.ciMarkerAttribute !== 'string' || !/^data-[a-z0-9-]+$/.test(v.ciMarkerAttribute)) {
      fail(s, 'ciMarkerAttribute', 'must be a data-* attribute name');
    }
  }
  if (v.threshold !== undefined) {
    if (typeof v.threshold !== 'number' || v.threshold < 0 || v.threshold > 1) {
      fail(s, 'threshold', 'must be a number between 0 and 1');
    }
  }
  if (v.fixedTime !== undefined && v.fixedTime !== null) {
    if (typeof v.fixedTime !== 'string' || Number.isNaN(Date.parse(v.fixedTime))) {
      fail(s, 'fixedTime', 'must be null or an ISO 8601 date-time');
    }
  }
  if (v.allowedHosts !== undefined) {
    checkStringList(s, 'allowedHosts', v.allowedHosts, host => HOST_PATTERN.test(host));
  }
  if (v.baselineBranches !== undefined) {
    checkStringList(
      s,
      'baselineBranches',
      v.baselineBranches,
      branch => BRANCH_PATTERN.test(branch) && !branch.startsWith('-') && !branch.includes('..')
    );
    if (v.baselineBranches.length === 0) fail(s, 'baselineBranches', 'must list at least one branch');
  }
  if (v.defaultViewport !== undefined) checkViewportSize(s, 'defaultViewport', v.defaultViewport);
  if (v.viewports !== undefined && v.viewports !== 'storybook') {
    if (Array.isArray(v.viewports)) {
      checkStringList(s, 'viewports', v.viewports, name => name.trim() !== '');
    } else if (isPlainObject(v.viewports)) {
      for (const [name, size] of Object.entries(v.viewports)) checkViewportSize(s, `viewports.${name}`, size);
    } else {
      fail(s, 'viewports', 'must be "storybook", a list of viewport names or a map of name to {width, height}');
    }
  }
  return true;
}

/** @param {Record<string, unknown>} a11y */
export function validateA11yConfig(a11y) {
  if (!isPlainObject(a11y)) throw new Error('Config a11y must be an object');
  rejectUnknownKeys('a11y', a11y, A11Y_DEFAULTS);
  const s = 'a11y';
  if (a11y.enabled !== undefined) checkBoolean(s, 'enabled', a11y.enabled);
  if (a11y.blockingImpacts !== undefined) {
    checkStringList(s, 'blockingImpacts', a11y.blockingImpacts, impact => AXE_IMPACTS.has(impact));
  }
  for (const key of ['enforcedRules', 'disabledRules']) {
    if (a11y[key] !== undefined) checkStringList(s, key, a11y[key], rule => /^[a-z0-9-]+$/.test(rule));
  }
  if (a11y.baseline !== undefined) {
    checkString(s, 'baseline', a11y.baseline);
    const normalized = path.posix.normalize(String(a11y.baseline).replaceAll('\\', '/'));
    if (normalized.startsWith('../') || normalized.startsWith('/') || !normalized.endsWith('.json')) {
      fail(s, 'baseline', 'must be a repository-relative .json path');
    }
  }
  if (a11y.scope !== undefined) checkString(s, 'scope', a11y.scope);
  return true;
}

/** @param {Record<string, unknown>} passcode */
export function validatePasscodeConfig(passcode) {
  if (!isPlainObject(passcode)) throw new Error('Config passcode must be an object');
  rejectUnknownKeys('passcode', passcode, PASSCODE_DEFAULTS);
  if (passcode.expiryHours !== undefined) {
    if (typeof passcode.expiryHours !== 'number' || !(passcode.expiryHours > 0)) {
      fail('passcode', 'expiryHours', 'must be a positive number');
    }
  }
  return true;
}

/**
 * Validates a parsed `.storybook/swiss-knife.json`. The `pages` section uses the
 * storybook-github-pages keys and validator unchanged.
 * @param {unknown} config
 */
export function validateSwissKnifeConfig(config) {
  if (!isPlainObject(config)) throw new Error(`${SWISS_KNIFE_CONFIG_PATH} must contain a JSON object`);
  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new Error(`Unknown config key "${key}" in ${SWISS_KNIFE_CONFIG_PATH}`);
  }
  if (config.pages !== undefined) {
    if (!isPlainObject(config.pages)) throw new Error('Config pages must be an object');
    validateConfig(config.pages);
  }
  if (config.visual !== undefined) validateVisualConfig(config.visual);
  if (config.a11y !== undefined) validateA11yConfig(config.a11y);
  if (config.passcode !== undefined) validatePasscodeConfig(config.passcode);
  return true;
}

function readJson(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  try {
    // A reviver-free parse never assigns __proto__ as a prototype; unknown keys are rejected above.
    return JSON.parse(content);
  } catch (error) {
    throw new Error(`${filePath} is not valid JSON: ${error.message}`);
  }
}

/**
 * Loads the repository configuration. `.storybook/swiss-knife.json` wins; the legacy
 * `.storybook-pages.yml` still works for the `pages` section, with a deprecation warning.
 * @param {{ cwd?: string }} [options]
 */
export function loadSwissKnifeConfig({ cwd = process.cwd() } = {}) {
  const jsonPath = path.join(cwd, SWISS_KNIFE_CONFIG_PATH);
  const legacyPath = path.join(cwd, LEGACY_CONFIG_PATH);
  const warnings = [];
  let source = 'defaults';
  let raw = {};

  if (fs.existsSync(jsonPath)) {
    raw = readJson(jsonPath);
    validateSwissKnifeConfig(raw);
    source = SWISS_KNIFE_CONFIG_PATH;
    if (fs.existsSync(legacyPath)) {
      warnings.push(`${LEGACY_CONFIG_PATH} is ignored because ${SWISS_KNIFE_CONFIG_PATH} exists. Delete it.`);
    }
  } else if (fs.existsSync(legacyPath)) {
    const pages = parseSimpleYaml(fs.readFileSync(legacyPath, 'utf8'));
    validateConfig(pages);
    raw = { pages };
    source = LEGACY_CONFIG_PATH;
    warnings.push(
      `${LEGACY_CONFIG_PATH} is deprecated. Move its settings under "pages" in ${SWISS_KNIFE_CONFIG_PATH}.`
    );
  }

  return {
    source,
    warnings,
    pages: raw.pages ?? null,
    visual: { ...VISUAL_DEFAULTS, ...raw.visual },
    a11y: { ...A11Y_DEFAULTS, ...raw.a11y },
    passcode: { ...PASSCODE_DEFAULTS, ...raw.passcode }
  };
}
