import fs from 'node:fs';
import { stripVTControlCharacters } from 'node:util';

// Classifies the merged Playwright JSON results of the visual runner. The job summary, the gate
// and the Storybook gallery manifest all use this, so they always agree.

/** Prefix the runner throws when Storybook reports a render or play function error. */
export const STORY_FAILURE_PREFIX = 'Story render or play function failed';

// Only a finished comparison is a reviewable diff; a timeout or closed page inside
// toHaveScreenshot is an operational failure and must stay blocking.
const PIXEL_DIFF =
  /\d+ pixels \(ratio [\d.]+ of all image pixels\) are different|Expected an image \d+px by \d+px, received \d+px by \d+px/;

const collectTests = suite => [
  ...(suite.specs ?? []).flatMap(spec => spec.tests.map(test => ({ title: spec.title, ...test }))),
  ...(suite.suites ?? []).flatMap(collectTests)
];
const annotationsOf = test => [
  ...(test.annotations ?? []),
  ...(test.results ?? []).flatMap(result => result.annotations ?? [])
];
const isNew = test => annotationsOf(test).some(({ type }) => type === 'new');
const errorOf = test => test.results?.at(-1)?.error?.message ?? '';

function isScreenshotDiff(test) {
  const result = test.results?.at(-1);
  const headline = stripVTControlCharacters(errorOf(test)).split('Call log:')[0];
  return (
    headline.includes('toHaveScreenshot') &&
    PIXEL_DIFF.test(headline) &&
    !/timeout|closed/i.test(headline) &&
    (result?.attachments ?? []).some(({ name }) => name.endsWith('-diff.png'))
  );
}

/** The story render/play error message of any attempt, if Storybook reported one. */
export const storyFailureOf = test =>
  (test.results ?? [])
    .map(result => stripVTControlCharacters(result.error?.message ?? ''))
    .find(message => message.includes(STORY_FAILURE_PREFIX));

export const storyIdOf = test => annotationsOf(test).find(({ type }) => type === 'story')?.description;

/** Story ids a shard's "removed stories" check reported: baselines without a story. */
export const removedIdsOf = test => [
  // Playwright repeats annotations on the test and on each result.
  ...new Set(
    annotationsOf(test)
      .filter(({ type }) => type === 'removed')
      .flatMap(({ description }) => String(description ?? '').split(','))
      .filter(Boolean)
  )
];

export function firstErrorLine(test) {
  const failure = storyFailureOf(test);
  return (failure ?? stripVTControlCharacters(errorOf(test)))
    .split('\n')
    .slice(failure ? 1 : 0)
    .find(text => text.trim())
    ?.trim();
}

/**
 * @param {{ suites?: unknown[] }} report Parsed Playwright JSON report.
 */
export function classifyVisualResults(report) {
  const all = (report?.suites ?? []).flatMap(collectTests);
  // The per-shard "removed stories" check is not a story.
  const removedChecks = all.filter(test => removedIdsOf(test).length > 0);
  const tests = all.filter(test => !removedChecks.includes(test));
  // An interaction that failed on any attempt blocks, even when the retry passed.
  const interactions = tests.filter(storyFailureOf);
  const failed = tests.filter(test => test.status === 'unexpected');
  const changed = failed.filter(isScreenshotDiff);
  const broken = failed.filter(test => !isScreenshotDiff(test) && !storyFailureOf(test));
  const added = tests.filter(test => test.status === 'expected' && isNew(test));
  const flaky = tests.filter(test => test.status === 'flaky' && !storyFailureOf(test));
  const skipped = tests.filter(test => test.status === 'skipped');
  const notUnchanged = new Set([...failed, ...interactions, ...added, ...flaky, ...skipped]);
  const unchanged = tests.filter(test => !notUnchanged.has(test));
  const removed = [...new Set(removedChecks.flatMap(removedIdsOf))].sort();
  // Errors outside any test, e.g. the spec failing to load: nothing was compared.
  const runErrors = (report?.errors ?? []).map(error => stripVTControlCharacters(error?.message ?? String(error)));
  return { tests, interactions, failed, changed, broken, added, flaky, skipped, unchanged, removed, runErrors };
}

export const readVisualResults = resultsPath => classifyVisualResults(JSON.parse(fs.readFileSync(resultsPath, 'utf8')));
