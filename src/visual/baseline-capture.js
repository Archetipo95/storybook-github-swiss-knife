// Checks a baseline capture (visual-capture, mode: baseline). A story that fails to render has no
// baseline and is reported as new, which is fine; a capture that failed and wrote no screenshot at
// all (the browser did not start, the Storybook build is missing) would report every story as new,
// which never blocks, and on a baseline branch would cache those empty baselines for every later
// pull request. That capture fails instead.

import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {{ status: number, screenshots: number }} capture the runner's exit status and the number
 *   of baseline screenshots it left
 * @returns {string | null} why the capture is unusable, or null
 */
export function baselineCaptureProblem({ status, screenshots }) {
  if (status === 0 || screenshots > 0) return null;
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

// node src/visual/baseline-capture.js <runner exit status> <project dir> <snapshot dir>
// The snapshot dir is resolved against the project dir, as the runner does.
if (process.argv[1]?.endsWith('baseline-capture.js')) {
  const [status, projectDir, snapshotDir] = process.argv.slice(2);
  const dir = path.resolve(projectDir, snapshotDir);
  const problem = baselineCaptureProblem({ status: Number(status), screenshots: countScreenshots(dir) });
  if (problem) {
    console.error(`::error::${problem}`);
    process.exit(1);
  }
}
