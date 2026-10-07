// Storybook 9 and 10 manager entry: consolidated storybook/* entry points and the status store.
import { AddonPanel } from 'storybook/internal/components';
import { addons, experimental_getStatusStore, types, useStorybookState } from 'storybook/manager-api';
import { useTheme } from 'storybook/theming';

import { ADDON_ID, applyVisualTags, loadManifest, registerVisualAddon, statusEntries } from './core.jsx';

const VALUES = { warn: 'status-value:warning', error: 'status-value:error' };

// Statuses are keyed by story id and need no index; the sidebar's status filter lists them.
// Storybook 10 also exposes the index, so the stories get the `visual:*` tags too. The index
// arrives after registration and is replaced when stories change, so the tags are re-checked;
// Storybook 9 stops once the statuses are set.
function registerResults(api) {
  let statusesSet = false;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const manifest = await loadManifest();
      if (!manifest) return;
      if (!statusesSet) {
        experimental_getStatusStore(ADDON_ID).set(
          statusEntries(manifest).map(({ storyId, level, title, description }) => ({
            storyId,
            typeId: ADDON_ID,
            value: VALUES[level],
            title,
            description
          }))
        );
        statusesSet = true;
      }
      if (typeof api.getIndex === 'function') await applyVisualTags(api, api.getIndex());
      else clearInterval(timer);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, 2000);
  tick();
}

registerVisualAddon({ addons, types, AddonPanel, useStorybookState, useTheme, registerResults });
