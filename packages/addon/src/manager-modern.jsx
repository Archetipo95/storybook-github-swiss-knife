// Storybook 9 and 10 manager entry: consolidated storybook/* entry points and the status store.
import { AddonPanel } from 'storybook/internal/components';
import { addons, experimental_getStatusStore, types, useStorybookApi, useStorybookState } from 'storybook/manager-api';
import { useTheme } from 'storybook/theming';

import {
  ADDON_ID,
  applyVisualTags,
  hasNativeChangeFilter,
  onManifest,
  registerVisualAddon,
  statusEntries
} from './core.jsx';

const VALUES = {
  new: 'status-value:new',
  modified: 'status-value:modified',
  warn: 'status-value:warning',
  error: 'status-value:error'
};

// Statuses are keyed by story id and need no index. With Storybook's own New/Modified filter
// (10.4+) they are `new`/`modified` and are all the sidebar needs; older versions do not know
// those values, so changes stay warnings there. Storybook 10.0–10.3 also exposes the index, so
// its stories get the `visual:*` tags; the index arrives after registration and is replaced when
// stories change, so the tags are re-checked.
function registerResults(api) {
  let tagTimer;
  onManifest(manifest => {
    const nativeChangeFilter = hasNativeChangeFilter();
    experimental_getStatusStore(ADDON_ID).set(
      statusEntries(manifest, { changeStatuses: nativeChangeFilter }).map(({ storyId, level, title, description }) => ({
        storyId,
        typeId: ADDON_ID,
        value: VALUES[level],
        title,
        description
      }))
    );
    if (nativeChangeFilter || typeof api.getIndex !== 'function' || tagTimer) return;
    let busy = false;
    const tag = async () => {
      if (busy) return;
      busy = true;
      try {
        await applyVisualTags(api, api.getIndex());
      } finally {
        busy = false;
      }
    };
    tagTimer = setInterval(tag, 2000);
    tag();
  });
}

registerVisualAddon({ addons, types, AddonPanel, useStorybookState, useStorybookApi, useTheme, registerResults });
