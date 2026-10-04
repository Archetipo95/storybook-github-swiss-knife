import fs from 'node:fs';
import path from 'node:path';

import { AxeBuilder } from '@axe-core/playwright';

/**
 * Whether a story opted out of the accessibility scan. Storybook 8: `a11y.disable`; Storybook 9+:
 * `a11y.test: 'off'`; any version: `swissKnife.a11y.skip`.
 * @param {any} parameters
 */
export function isA11yDisabled(parameters = {}) {
  return Boolean(parameters?.a11y?.disable || parameters?.a11y?.test === 'off' || parameters?.swissKnife?.a11y?.skip);
}

/**
 * Rules a story turns on or off: `a11y.config.rules` ([{ id, enabled }]) and the axe run-options
 * form `a11y.options.rules` ({ id: { enabled } }).
 * @param {any} parameters
 */
export function storyRuleSettings(parameters = {}) {
  const enabled = new Set();
  const disabled = new Set();
  const apply = (id, on) => {
    if (typeof id !== 'string') return;
    (on === false ? disabled : enabled).add(id);
    (on === false ? enabled : disabled).delete(id);
  };
  for (const rule of parameters?.a11y?.config?.rules ?? []) {
    if (rule && 'enabled' in rule) apply(rule.id, rule.enabled);
  }
  for (const [id, rule] of Object.entries(parameters?.a11y?.options?.rules ?? {})) {
    if (rule && typeof rule === 'object' && 'enabled' in rule) apply(id, rule.enabled);
  }
  return { enabled, disabled };
}

/**
 * Runs axe on the rendered story and writes `<reportDir>/<storyId>.json` when it finds
 * violations. Blocking is decided later, by the trusted gate (src/a11y/report.js).
 * @param {import('@playwright/test').Page} page
 * @param {{ storyId: string, parameters: any, reportDir: string, scope: string, disabledRules: string[] }} options
 */
export async function scanStory(page, { storyId, parameters, reportDir, scope, disabledRules }) {
  const { enabled, disabled } = storyRuleSettings(parameters);
  const off = [...new Set([...disabledRules.filter(rule => !enabled.has(rule)), ...disabled])];
  // Storybook 8 `a11y.element`, Storybook 9+ `a11y.context` (selector form only).
  const storyScope = [parameters?.a11y?.context, parameters?.a11y?.element].find(value => typeof value === 'string');
  let builder = new AxeBuilder({ page }).include(storyScope || scope);
  if (off.length > 0) builder = builder.disableRules(off);
  if (enabled.size > 0) {
    builder = builder.options({ rules: Object.fromEntries([...enabled].map(rule => [rule, { enabled: true }])) });
  }
  const { violations } = await builder.analyze();
  if (violations.length === 0) return [];
  const report = {
    id: storyId,
    violations: violations.map(({ id, impact, help, helpUrl, nodes }) => ({
      id,
      impact,
      help,
      helpUrl,
      nodes: nodes.length,
      targets: nodes.map(({ target }) => target.join(' '))
    }))
  };
  fs.mkdirSync(reportDir, { recursive: true });
  fs.writeFileSync(path.join(reportDir, `${storyId}.json`), JSON.stringify(report));
  return report.violations;
}
