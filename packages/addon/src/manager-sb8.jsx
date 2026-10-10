// Storybook 8.6 manager entry.
import { AddonPanel } from '@storybook/components';
import { addons, types, useStorybookApi, useStorybookState } from '@storybook/manager-api';
import { useTheme } from '@storybook/theming';
import React, { useEffect, useState } from 'react';

import { ADDON_ID, createResultsApplier, onManifest, registerVisualAddon } from './core.jsx';

const apply = createResultsApplier({
  setStatuses: (api, entries) =>
    api.experimental_updateStatus(
      ADDON_ID,
      Object.fromEntries(
        entries.map(({ storyId, level, title, description }) => [storyId, { status: level, title, description }])
      )
    )
});

// Renders nothing: applies statuses and tags once the report is found (it may be published after
// the page opened), and again whenever the index changes.
function Results() {
  const api = useStorybookApi();
  const { internal_index: index } = useStorybookState();
  const [manifest, setManifest] = useState(null);
  useEffect(() => onManifest(setManifest), []);
  useEffect(() => {
    if (manifest) apply(api, index);
  });
  return null;
}

registerVisualAddon({
  addons,
  types,
  AddonPanel,
  useStorybookState,
  useStorybookApi,
  useTheme,
  registerResults: () => addons.add(`${ADDON_ID}/results`, { type: types.experimental_SIDEBAR_TOP, render: Results })
});
