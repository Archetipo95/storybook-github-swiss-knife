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
 * Runs axe on the rendered story and writes `<reportDir>/<storyId>.json` when it finds
 * violations. Blocking is decided later, by the trusted gate (src/a11y/report.js).
 * @param {import('@playwright/test').Page} page
 * @param {{ storyId: string, parameters: any, reportDir: string, scope: string, disabledRules: string[] }} options
 */
export async function scanStory(page, { storyId, parameters, reportDir, scope, disabledRules }) {
  const storyRules = (parameters?.a11y?.config?.rules ?? []).filter(rule => rule && typeof rule.id === 'string');
  const disabled = [
    ...new Set([...disabledRules, ...storyRules.filter(rule => rule.enabled === false).map(rule => rule.id)])
  ];
  let builder = new AxeBuilder({ page }).include(scope);
  if (disabled.length > 0) builder = builder.disableRules(disabled);
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
