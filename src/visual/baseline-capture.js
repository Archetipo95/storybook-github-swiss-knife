// Checks a baseline capture (visual-capture, mode: baseline). A story that fails to render has no
// baseline and is reported as new, which is fine; a capture that failed and wrote no screenshot at
// all (the browser did not start, the Storybook build is missing) would report every story as new,
// which never blocks, and on a baseline branch would cache those empty baselines for every later
// pull request. That capture fails instead, unless its JSON report shows every story ran and
// failed to render (a throwing global decorator, say): those stories are new on pull requests, so
// the one that fixes them can go green.

import fs from 'node:fs';
import path from 'node:path';

import { classifyVisualResults, storyFailureOf } from './results.js';

/** Whether a Playwright JSON report shows stories that ran and all failed to render, nothing else. */
function onlyStoryFailures(report) {
  if (!report || (report.errors ?? []).length > 0) return false;
  const { tests, failed } = classifyVisualResults(report);
  return tests.length > 0 && failed.length > 0 && failed.every(test => storyFailureOf(test));
}

/**
 * @param {{ status: number, screenshots: number, report?: any }} capture the runner's exit status,
 *   the number of baseline screenshots it left, and its JSON report when there is one
 * @returns {string | null} why the capture is unusable, or null
 */
export function baselineCaptureProblem({ status, screenshots, report = null }) {
  if (status === 0 || screenshots > 0 || onlyStoryFailures(report)) return null;
  return (
    `The baseline capture failed (exit status ${status}) and wrote no screenshot, so every story ` +
    'would be reported as new and nothing compared. See the runner output above.'
  );
}

/** Number of .png files directly in a directory; 0 when it does not exist. */
export function countScreenshots(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter(file => file.endsWith('.png')).length;
}

const readReport = file => {
  try {
    return file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
};

// node src/visual/baseline-capture.js <runner exit status> <project dir> <snapshot dir> [json report]
// The snapshot dir is resolved against the project dir, as the runner does.
if (process.argv[1]?.endsWith('baseline-capture.js')) {
  const [status, projectDir, snapshotDir, reportFile] = process.argv.slice(2);
  const dir = path.resolve(projectDir, snapshotDir);
  const problem = baselineCaptureProblem({
    status: Number(status),
    screenshots: countScreenshots(dir),
    report: readReport(reportFile)
  });
  if (problem) {
    console.error(`::error::${problem}`);
    process.exit(1);
  }
}
