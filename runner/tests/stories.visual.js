import fs from 'node:fs';
import path from 'node:path';

import { expect, test as base } from '@playwright/test';

import { scanStory, isA11yDisabled } from '../lib/a11y.js';
import {
  STORY_FAILURE_PREFIX,
  imagesComplete,
  noLoadingIndicators,
  prepareAssets,
  readStoryContext,
  recordStoryOutcome,
  storyErrors,
  storyHasSettled
} from '../lib/browser.js';
import { runnerSettings } from '../lib/settings.js';
import { resolveViewport } from '../lib/viewport.js';
import { shardOf } from '../../src/visual/shard.js';

const settings = runnerSettings();
const { visual, a11y } = settings.config;
const SCREENSHOT_OPTIONS = { fullPage: visual.fullPage, animations: 'disabled', caret: 'hide' };

const indexPath = path.join(settings.storybookDir, 'index.json');
if (!fs.existsSync(indexPath)) {
  throw new Error(`No Storybook build at ${settings.storybookDir} (index.json missing). Build Storybook first.`);
}
const { entries } = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const stories = Object.values(entries).filter(
  entry =>
    entry.type === 'story' &&
    !entry.tags?.includes(visual.skipTag) &&
    shardOf(entry.id, settings.shard.total) === settings.shard.index
);

/** Writes an image of the story to the gallery read by the Storybook Visual panel. */
function saveToGallery(storyId, image, source) {
  if (!settings.galleryDir || !source) return;
  const target = path.join(settings.galleryDir, storyId, `${image}.png`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  if (typeof source !== 'string') fs.writeFileSync(target, new Uint8Array(source));
  else if (fs.existsSync(source)) fs.copyFileSync(source, target);
}

async function renderStory(page, url) {
  await page.goto(url);
  await page.waitForFunction(storyHasSettled, undefined, { polling: 100, timeout: 30_000 });
  return page.evaluate(storyErrors);
}

// One page per worker, reused across stories: Storybook's preview bundle stays in the HTTP cache
// instead of being downloaded and parsed for every story. Each story still loads with a full
// navigation.
const test = base.extend({
  storyPage: [
    async ({ browser }, use, workerInfo) => {
      const { baseURL, locale, timezoneId, viewport, deviceScaleFactor, userAgent, hasTouch, isMobile } =
        workerInfo.project.use;
      const context = await browser.newContext({
        baseURL,
        locale,
        timezoneId,
        viewport,
        deviceScaleFactor,
        userAgent,
        hasTouch,
        isMobile
      });
      const page = await context.newPage();
      await page.addInitScript(recordStoryOutcome, visual.ciMarkerAttribute);
      if (visual.fixedTime) await page.clock.setFixedTime(new Date(visual.fixedTime));
      await use(page);
      await context.close();
    },
    { scope: 'worker' }
  ]
});

for (const story of stories) {
  test(`${story.title} › ${story.name}`, async ({ storyPage: page }, testInfo) => {
    testInfo.annotations.push({ type: 'story', description: story.id });

    await page.setViewportSize(visual.defaultViewport);
    const url = `/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
    let errors = await renderStory(page, url);

    // The play function must run at the story's own viewport, so reload when it differs. A
    // mobile-only play can fail at the default size, so only the final render counts.
    const context = await page.evaluate(readStoryContext);
    const viewport = resolveViewport(context, visual);
    const current = page.viewportSize();
    if (current?.width !== viewport.width || current?.height !== viewport.height) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      errors = await renderStory(page, url);
    }
    if (errors.length > 0) throw new Error(`${STORY_FAILURE_PREFIX}:\n${errors.join('\n\n')}`);

    const overrides = context.parameters?.swissKnife?.visual ?? {};
    test.skip(Boolean(overrides.skip), 'parameters.swissKnife.visual.skip');

    await page.evaluate(prepareAssets);
    await page.waitForFunction(imagesComplete, undefined, { polling: 100, timeout: 15_000 });
    // A visible spinner means the story is still loading: wait for it, up to the cap. Stories
    // that show a spinner on purpose just wait out the cap.
    await page
      .waitForFunction(noLoadingIndicators, undefined, { polling: 100, timeout: visual.loadingTimeoutMs })
      .catch(() => undefined);
    if (Number.isInteger(overrides.delay) && overrides.delay > 0) await page.waitForTimeout(overrides.delay);

    const scanA11y = async () => {
      if (!settings.a11yDir || isA11yDisabled(context.parameters)) return;
      await scanStory(page, {
        storyId: story.id,
        parameters: context.parameters,
        reportDir: settings.a11yDir,
        scope: a11y.scope,
        disabledRules: a11y.disabledRules
      });
    };

    const snapshotName = `${story.id}.png`;
    const isNewStory = testInfo.config.updateSnapshots !== 'all' && !fs.existsSync(testInfo.snapshotPath(snapshotName));
    if (isNewStory) {
      testInfo.annotations.push({ type: 'new', description: story.id });
      const screenshot = await page.screenshot(SCREENSHOT_OPTIONS);
      saveToGallery(story.id, 'pr', screenshot);
      await testInfo.attach('screenshot', { body: screenshot, contentType: 'image/png' });
      await scanA11y();
      return;
    }

    const maxDiffPixels = Number.isInteger(overrides.maxDiffPixels) ? overrides.maxDiffPixels : undefined;
    try {
      await expect(page).toHaveScreenshot(snapshotName, {
        fullPage: visual.fullPage,
        ...(maxDiffPixels !== undefined && { maxDiffPixels })
      });
    } catch (error) {
      // Playwright shortens the file names of long story ids, so take the compared images from
      // its own attachments instead of guessing the output path.
      const comparedImage = suffix =>
        testInfo.attachments.find(({ name, path }) => path && name.endsWith(suffix))?.path;
      saveToGallery(story.id, 'base', testInfo.snapshotPath(snapshotName));
      saveToGallery(story.id, 'pr', comparedImage('-actual.png'));
      saveToGallery(story.id, 'diff', comparedImage('-diff.png'));
      // Changed stories still get their accessibility scan before the diff fails the test.
      await scanA11y();
      throw error;
    }
    // Every story shows its PR rendering, so the report doubles as a gallery.
    const screenshot = await page.screenshot(SCREENSHOT_OPTIONS);
    saveToGallery(story.id, 'pr', screenshot);
    await testInfo.attach('screenshot', { body: screenshot, contentType: 'image/png' });
    await scanA11y();
  });
}
