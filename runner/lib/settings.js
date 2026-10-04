import path from 'node:path';

import { loadSwissKnifeConfig } from '../../src/swiss-knife-config.js';
import { parseShard } from '../../src/visual/shard.js';

/**
 * Runner settings from the environment (set by the CLI or the visual-capture action) and the
 * project's `.storybook/swiss-knife.json`.
 *
 * - SWISS_KNIFE_PROJECT_DIR: project root holding the config (default: cwd)
 * - SWISS_KNIFE_STORYBOOK_DIR: built Storybook (default: <project>/storybook-static)
 * - SWISS_KNIFE_SNAPSHOT_DIR: baseline screenshots (default: <project>/.swiss-knife/snapshots)
 * - SWISS_KNIFE_OUTPUT_DIR: Playwright output (default: <project>/.swiss-knife/test-results)
 * - SWISS_KNIFE_REPORT_DIR: HTML report, local runs (default: <project>/.swiss-knife/report)
 * - SWISS_KNIFE_GALLERY_DIR: base/pr/diff images per story, for the Storybook panel (optional)
 * - SWISS_KNIFE_A11Y_DIR: axe report per story (optional; no scan when unset)
 * - SWISS_KNIFE_SHARD: "<index>/<total>" (default 1/1)
 * - SWISS_KNIFE_PORT: static server port (default 6007)
 * @param {NodeJS.ProcessEnv} env
 */
export function runnerSettings(env = process.env) {
  const projectDir = path.resolve(env.SWISS_KNIFE_PROJECT_DIR || process.cwd());
  const fromProject = (value, fallback) => path.resolve(projectDir, value || fallback);
  const config = loadSwissKnifeConfig({ cwd: projectDir });
  return {
    projectDir,
    config,
    storybookDir: fromProject(env.SWISS_KNIFE_STORYBOOK_DIR, 'storybook-static'),
    snapshotDir: fromProject(env.SWISS_KNIFE_SNAPSHOT_DIR, '.swiss-knife/snapshots'),
    outputDir: fromProject(env.SWISS_KNIFE_OUTPUT_DIR, '.swiss-knife/test-results'),
    reportDir: fromProject(env.SWISS_KNIFE_REPORT_DIR, '.swiss-knife/report'),
    galleryDir: env.SWISS_KNIFE_GALLERY_DIR ? fromProject(env.SWISS_KNIFE_GALLERY_DIR) : null,
    a11yDir: env.SWISS_KNIFE_A11Y_DIR && config.a11y.enabled ? fromProject(env.SWISS_KNIFE_A11Y_DIR) : null,
    shard: parseShard(env.SWISS_KNIFE_SHARD || '1/1'),
    port: Number(env.SWISS_KNIFE_PORT || 6007),
    isCi: Boolean(env.CI)
  };
}

/**
 * Chromium resolver rule: every remote host fails to resolve except the allowed ones, so
 * remote assets cannot flake. A resolver rule keeps the HTTP cache on (page.route disables it).
 * @param {string[]} allowedHosts
 */
export function hostResolverRules(allowedHosts = []) {
  const excluded = ['127.0.0.1', 'localhost', ...allowedHosts].map(host => `EXCLUDE ${host}`);
  return `--host-resolver-rules=MAP * ~NOTFOUND, ${excluded.join(', ')}`;
}
