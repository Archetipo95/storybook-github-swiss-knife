import path from 'node:path';

import { defineConfig, devices } from '@playwright/test';

import { hostResolverRules, runnerSettings } from './lib/settings.js';

const settings = runnerSettings();
const { visual } = settings.config;
// Shards upload their blob reports into one folder, so each needs its own file name.
const blobFileName = `report-${settings.shard.index}-${settings.shard.total}.zip`;

export default defineConfig({
  testDir: path.join(import.meta.dirname, 'tests'),
  testMatch: '*.visual.js',
  snapshotPathTemplate: `${settings.snapshotDir}/{arg}{ext}`,
  outputDir: settings.outputDir,
  fullyParallel: true,
  forbidOnly: settings.isCi,
  retries: settings.isCi ? visual.retries : 0,
  // Stories mostly wait on rendering, so CI runners (2 vCPUs) handle more than one per core.
  workers: settings.isCi ? visual.workers : undefined,
  reporter: settings.isCi
    ? [['dot'], ['blob', { fileName: blobFileName }]]
    : [['list'], ['html', { open: 'never', outputFolder: settings.reportDir }]],
  timeout: 60_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      maxDiffPixels: visual.maxDiffPixels,
      threshold: visual.threshold
    }
  },
  use: {
    ...devices['Desktop Chrome'],
    viewport: visual.defaultViewport,
    launchOptions: { args: [hostResolverRules(visual.allowedHosts)] },
    baseURL: `http://127.0.0.1:${settings.port}`,
    locale: visual.locale,
    timezoneId: visual.timezone,
    trace: 'off'
  },
  webServer: {
    command: `node "${path.join(import.meta.dirname, 'lib/serve.js')}" "${settings.storybookDir}" ${settings.port}`,
    url: `http://127.0.0.1:${settings.port}/index.json`,
    reuseExistingServer: !settings.isCi
  }
});
