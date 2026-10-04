// Storybook 8.6 manager entry.
import { AddonPanel } from '@storybook/components';
import { addons, types, useStorybookApi, useStorybookState } from '@storybook/manager-api';
import { useTheme } from '@storybook/theming';
import React, { useEffect } from 'react';

import { ADDON_ID, createResultsApplier, registerVisualAddon } from './core.jsx';

const apply = createResultsApplier({
  setStatuses: (api, entries) =>
    api.experimental_updateStatus(
      ADDON_ID,
      Object.fromEntries(
        entries.map(({ storyId, level, title, description }) => [storyId, { status: level, title, description }])
      )
    )
});

// Renders nothing: re-applies statuses and tags whenever the index changes.
function Results() {
  const api = useStorybookApi();
  const { internal_index: index } = useStorybookState();
  useEffect(() => {
    apply(api, index);
  });
  return null;
}

registerVisualAddon({
  addons,
  types,
  AddonPanel,
  useStorybookState,
  useTheme,
  registerResults: () => addons.add(`${ADDON_ID}/results`, { type: types.experimental_SIDEBAR_TOP, render: Results })
});
