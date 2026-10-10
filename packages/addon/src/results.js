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

/**
 * Sidebar statuses: errors for failures, and for changes either `modified`/`new` or a warning.
 * Storybook 10.4+ with change detection on lists `modified` and `new` in its own sidebar filter
 * (New, Modified), so `changeStatuses` maps the report there; older versions only know warnings,
 * and their filter has no entry for new stories.
 * @param {{ stories: Record<string, { status: string, error?: string }> }} manifest
 * @param {{ changeStatuses?: boolean }} [options]
 */
export function statusEntries(manifest, { changeStatuses = false } = {}) {
  const levels = changeStatuses
    ? { changed: 'modified', new: 'new', interaction: 'error', error: 'error' }
    : { changed: 'warn', interaction: 'error', error: 'error' };
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

// The Visual panel's own sidebar filter: Storybook's status filter has no entry for failures,
// and before 10.4 none for new or changed stories either.
export const SIDEBAR_FILTERS = {
  all: { label: 'All stories', statuses: [] },
  report: { label: 'Changed, new or failed', statuses: ['changed', 'new', 'interaction', 'error'] },
  changed: { label: 'Visual changes', statuses: ['changed'] },
  new: { label: 'New stories', statuses: ['new'] },
  failed: { label: 'Interaction or render failures', statuses: ['interaction', 'error'] }
};

/**
 * Whether a sidebar entry stays visible under a panel filter. While filtering, docs entries are
 * hidden too: autodocs pages would otherwise keep every component in the sidebar.
 */
export function matchesSidebarFilter(filter, manifest, item) {
  const { statuses } = SIDEBAR_FILTERS[filter] ?? SIDEBAR_FILTERS.all;
  return statuses.length === 0 || (item?.type === 'story' && statuses.includes(manifest.stories[item.id]?.status));
}

export const isTagged = index =>
  Object.values(index?.entries ?? {}).some(entry => entry.tags?.some(tag => tag.startsWith('visual:')));
