import { firstErrorLine, storyIdOf } from './results.js';

// Most severe first: a story keeps the first status it matches.
const STATUS_ORDER = [
  ['interaction', 'interactions'],
  ['error', 'broken'],
  ['changed', 'changed'],
  ['flaky', 'flaky'],
  ['new', 'added'],
  ['unchanged', 'unchanged']
];

/**
 * Builds gallery/manifest.json, read by the Storybook addon's Visual panel.
 * @param {ReturnType<import('./results.js').classifyVisualResults>} results
 * @param {{ hasImage: (storyId: string, name: string) => boolean, headSha?: string, runId?: string,
 *   runUrl?: string, approved?: boolean }} options
 */
export function buildGalleryManifest(results, { hasImage, headSha, runId, runUrl, approved = false }) {
  const stories = {};
  for (const [status, key] of STATUS_ORDER) {
    for (const test of results[key]) {
      const id = storyIdOf(test);
      if (!id || stories[id]) continue;
      const images = ['base', 'pr', 'diff'].filter(name => hasImage(id, name));
      const error = status === 'interaction' || status === 'error' ? firstErrorLine(test) : undefined;
      stories[id] = { status, title: test.title, images, ...(error && { error }) };
    }
  }
  return { version: 1, headSha, runId, runUrl, approved, stories };
}
