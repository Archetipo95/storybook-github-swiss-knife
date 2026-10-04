// Storybook 9 and 10 manager entry: consolidated storybook/* entry points and the status store.
import { AddonPanel } from 'storybook/internal/components';
import { addons, experimental_getStatusStore, types, useStorybookState } from 'storybook/manager-api';
import { useTheme } from 'storybook/theming';

import { ADDON_ID, applyVisualTags, loadManifest, registerVisualAddon, statusEntries } from './core.jsx';

const VALUES = { warn: 'status-value:warning', error: 'status-value:error' };

// Statuses are keyed by story id and need no index; the sidebar's status filter lists them.
// Storybook 10 also exposes the index, so the stories get the `visual:*` tags too.
function registerResults(api) {
  loadManifest().then(manifest => {
    if (!manifest) return;
    experimental_getStatusStore(ADDON_ID).set(
      statusEntries(manifest).map(({ storyId, level, title, description }) => ({
        storyId,
        typeId: ADDON_ID,
        value: VALUES[level],
        title,
        description
      }))
    );
  });
  if (typeof api.getIndex !== 'function') return;
  let applying = false;
  const tag = async () => {
    if (applying) return;
    applying = true;
    try {
      await applyVisualTags(api, api.getIndex());
    } finally {
      applying = false;
    }
  };
  // The index arrives after registration and is replaced when stories change: keep checking.
  setInterval(tag, 1000);
}

registerVisualAddon({ addons, types, AddonPanel, useStorybookState, useTheme, registerResults });
