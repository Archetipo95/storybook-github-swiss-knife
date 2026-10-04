// Pure helpers shared by the manager entries; no browser or Storybook APIs, so they are unit tested
// directly (test/addon.test.js).

export const STATUS_LABELS = {
  changed: 'Visual change',
  new: 'New story',
  interaction: 'Interaction failed',
  error: 'Render error',
  flaky: 'Flaky',
  skipped: 'Skipped',
  unchanged: 'No visual change'
};

// Tags added at runtime so Storybook's own tag filter can list the stories in the report.
export const VISUAL_TAGS = {
  changed: 'visual:changed',
  new: 'visual:new',
  interaction: 'visual:failed',
  error: 'visual:failed'
};

/** Sidebar statuses: warning for changes, error for failures. */
export function statusEntries(manifest) {
  const levels = { changed: 'warn', interaction: 'error', error: 'error' };
  return Object.entries(manifest.stories)
    .filter(([, story]) => levels[story.status])
    .map(([storyId, story]) => ({
      storyId,
      level: levels[story.status],
      title: 'Visual regression',
      description: story.error ? `${STATUS_LABELS[story.status]}: ${story.error}` : STATUS_LABELS[story.status]
    }));
}

/** The story index with `visual:*` tags on the stories in the report. */
export function withVisualTags(index, manifest) {
  return {
    ...index,
    entries: Object.fromEntries(
      Object.entries(index.entries).map(([storyId, entry]) => {
        const tag = VISUAL_TAGS[manifest.stories[storyId]?.status];
        return [
          storyId,
          tag && !(entry.tags ?? []).includes(tag) ? { ...entry, tags: [...(entry.tags ?? []), tag] } : entry
        ];
      })
    )
  };
}

export const isTagged = index =>
  Object.values(index?.entries ?? {}).some(entry => entry.tags?.some(tag => tag.startsWith('visual:')));
