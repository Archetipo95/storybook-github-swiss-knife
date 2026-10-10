// Visual regression results inside a pull request's Storybook preview: a "Visual" panel with the
// base and PR screenshots of the selected story and a sidebar filter, and sidebar statuses and
// tags for changed, new and failed stories. Reads gallery/manifest.json published next to the
// preview by the swiss-knife visual gate (<preview>/visual/gallery/). Shared by the Storybook 8
// and 9/10 manager entries.
import React, { useEffect, useRef, useState } from 'react';

import {
  isTagged,
  matchesSidebarFilter,
  SIDEBAR_FILTERS,
  STATUS_LABELS,
  statusEntries,
  withVisualTags
} from './results.js';

export { statusEntries } from './results.js';

export const ADDON_ID = 'storybook-swiss-knife';
export const PANEL_ID = `${ADDON_ID}/visual`;

// Storybook replaces `process.env` with the STORYBOOK_* variables when it bundles the manager;
// `process` itself does not exist there, so read the expression as written.
function envOverride() {
  try {
    return process.env.STORYBOOK_SWISS_KNIFE_VISUAL_URL;
  } catch {
    return undefined;
  }
}

/** The gallery directory: env override, else `visual/gallery/` next to this Storybook. */
export function galleryUrl() {
  return new URL(envOverride() || 'visual/gallery/', document.baseURI).href;
}

let manifestRequest;
// Pages caches files for minutes; the timestamp makes every request see the latest run.
export function loadManifest(refresh = false) {
  if (refresh || !manifestRequest) {
    manifestRequest = fetch(`${galleryUrl()}manifest.json?t=${Date.now()}`, { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then(manifest => (manifest && typeof manifest.stories === 'object' ? manifest : null))
      .catch(() => null);
  }
  return manifestRequest;
}

// The preview is published minutes before the gate publishes its report. While the report is
// missing, ask again every 30 s for 20 minutes, then every 5 minutes; when it appears, every
// listener (the sidebar statuses, an open Visual panel) gets it without a reload.
const RETRY_MS = 30_000;
const FAST_RETRIES = 40;
const SLOW_RETRY_MS = 300_000;
const manifestListeners = new Set();
let currentManifest = null;
let watching = false;

/** Hands a report to every listener: the watcher's, or one the user fetched with "Check again". */
export function publishManifest(manifest) {
  currentManifest = manifest;
  manifestListeners.forEach(listener => listener(manifest));
}

function watchManifest(attempt = 0) {
  loadManifest(attempt > 0).then(manifest => {
    if (manifest) publishManifest(manifest);
    else setTimeout(() => watchManifest(attempt + 1), attempt < FAST_RETRIES ? RETRY_MS : SLOW_RETRY_MS);
  });
}

/** Calls `listener` with the report now when it is loaded, and whenever one is found. */
export function onManifest(listener) {
  manifestListeners.add(listener);
  if (currentManifest) listener(currentManifest);
  if (!watching) {
    watching = true;
    watchManifest();
  }
  return () => manifestListeners.delete(listener);
}

// Storybook 8.6, 9 and 10 can filter the sidebar from an addon; 10.6 adds a plural form.
/**
 * Storybook 10.4+ lists `new` and `modified` statuses in its own sidebar filter (New, Modified)
 * while change detection is on, which it is by default, also in a built Storybook. There the
 * addon uses that filter and adds neither its `visual:*` tags nor the panel's Sidebar select,
 * which would repeat it; older versions get both.
 */
export const hasNativeChangeFilter = () => Boolean(globalThis.FEATURES?.changeDetection);

const canFilterSidebar = api =>
  typeof api?.experimental_setFilter === 'function' || typeof api?.experimental_setFilters === 'function';
const setSidebarFilter = (api, filterFunction) =>
  typeof api.experimental_setFilter === 'function'
    ? api.experimental_setFilter(ADDON_ID, filterFunction)
    : api.experimental_setFilters({ [ADDON_ID]: filterFunction });

// Module state, so the selection survives the panel unmounting when another tab is opened.
let sidebarFilter = 'all';

function SidebarFilterSelect({ api, manifest }) {
  const [selected, setSelected] = useState(sidebarFilter);
  const apply = filter => setSidebarFilter(api, item => matchesSidebarFilter(filter, manifest, item));
  // A newer report (after "Check again") changes which stories match.
  useEffect(() => {
    if (sidebarFilter !== 'all') apply(sidebarFilter);
  }, [manifest]);
  const select = filter => {
    sidebarFilter = filter;
    setSelected(filter);
    apply(filter);
  };
  return (
    <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
      Sidebar:
      <select value={selected} onChange={event => select(event.target.value)}>
        {Object.entries(SIDEBAR_FILTERS).map(([value, { label }]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

const imageUrl = (manifest, storyId, image) =>
  `${galleryUrl()}${encodeURIComponent(storyId)}/${image}.png?v=${encodeURIComponent(manifest.runId ?? '')}`;

// Playwright's diff image is the whole screenshot, faded, with changed pixels in red. Keep only
// the red pixels, as a mask that can be laid over either side.
function useChangedPixels(src, enabled) {
  const [overlay, setOverlay] = useState();
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.addEventListener('load', () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.drawImage(image, 0, 0);
      let pixels;
      try {
        pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      } catch {
        return; // A gallery on another origin without CORS headers cannot be read.
      }
      const { data } = pixels;
      for (let index = 0; index < data.length; index += 4) {
        const changed = data[index] > 200 && data[index + 1] < 90 && data[index + 2] < 90;
        data[index + 3] = changed ? 255 : 0;
      }
      context.putImageData(pixels, 0, 0);
      if (!cancelled) setOverlay({ url: canvas.toDataURL(), width: canvas.width, height: canvas.height });
    });
    image.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, enabled]);
  return enabled ? overlay : undefined;
}

// Pink easing into acid green and back, so changed pixels stand out on any background without
// flashing. Solid pink when the user asks for reduced motion.
const PULSE_COLOURS = ['#ff2d95', '#b0ff00'];

function PulsingPixels({ mask }) {
  const layer = useRef(null);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const animation = layer.current?.animate(
      PULSE_COLOURS.map(backgroundColor => ({ backgroundColor })),
      { duration: 1200, iterations: Infinity, direction: 'alternate', easing: 'ease-in-out' }
    );
    return () => animation?.cancel();
  }, []);
  return (
    <div
      ref={layer}
      role="img"
      aria-label="Changed pixels"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        aspectRatio: `${mask.width} / ${mask.height}`,
        pointerEvents: 'none',
        backgroundColor: PULSE_COLOURS[0],
        maskImage: `url(${mask.url})`,
        maskSize: '100% 100%',
        WebkitMaskImage: `url(${mask.url})`,
        WebkitMaskSize: '100% 100%'
      }}
    />
  );
}

const SIDE_LABELS = { base: 'Base', pr: 'PR' };

// Module state, so "Show changed pixels" stays on while moving between stories: every story
// mounts a new Comparison.
let showChangedPixels = false;

function Comparison({ manifest, storyId, theme }) {
  const [side, setSide] = useState('pr');
  const [showDiff, setShowDiffState] = useState(showChangedPixels);
  const setShowDiff = value => {
    showChangedPixels = value;
    setShowDiffState(value);
  };
  const changedPixels = useChangedPixels(imageUrl(manifest, storyId, 'diff'), showDiff);
  const toggle = () => setSide(current => (current === 'pr' ? 'base' : 'pr'));
  return (
    <div>
      {/* Sticky, so the controls stay reachable while scrolling a long screenshot. */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 1,
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
          alignItems: 'center',
          padding: '8px 0',
          marginBottom: 8,
          background: theme?.background?.content,
          borderBottom: `1px solid ${theme?.appBorderColor ?? '#ddd'}`
        }}
      >
        <button
          type="button"
          role="switch"
          aria-checked={side === 'pr'}
          aria-label="Show the PR screenshot (off shows the base)"
          onClick={toggle}
          style={{
            display: 'inline-flex',
            padding: 2,
            borderRadius: 999,
            border: `1px solid ${theme?.appBorderColor ?? '#ddd'}`,
            background: theme?.background?.app,
            cursor: 'pointer'
          }}
        >
          {['base', 'pr'].map(option => (
            <span
              key={option}
              style={{
                padding: '3px 12px',
                borderRadius: 999,
                fontWeight: 700,
                background: side === option ? theme?.color?.secondary : 'transparent',
                color: side === option ? theme?.color?.lightest : theme?.color?.defaultText
              }}
            >
              {SIDE_LABELS[option]}
            </span>
          ))}
        </button>
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
          <input type="checkbox" checked={showDiff} onChange={event => setShowDiff(event.target.checked)} />
          Show changed pixels
        </label>
        <span style={{ fontSize: 12, opacity: 0.7 }}>Click the screenshot to switch.</span>
      </div>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${SIDE_LABELS[side]} screenshot, click to switch`}
        onClick={toggle}
        onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggle();
          }
        }}
        style={{ position: 'relative', cursor: 'pointer' }}
      >
        <img
          src={imageUrl(manifest, storyId, side)}
          alt={`${SIDE_LABELS[side]} screenshot`}
          style={{ display: 'block', width: '100%' }}
        />
        {changedPixels && <PulsingPixels mask={changedPixels} />}
      </div>
    </div>
  );
}

/** The panel body; the hooks come from the version's manager API. */
export function createVisualPanel({ useStorybookState, useStorybookApi, useTheme }) {
  return function VisualPanel() {
    const { storyId } = useStorybookState();
    const api = useStorybookApi();
    const theme = useTheme();
    const [manifest, setManifest] = useState();

    useEffect(() => {
      let mounted = true;
      // null ("not published yet") only until the watcher finds the report.
      loadManifest().then(found => mounted && setManifest(previous => previous ?? found));
      const unsubscribe = onManifest(setManifest);
      return () => {
        mounted = false;
        unsubscribe();
      };
    }, []);

    const reload = () => {
      setManifest(undefined);
      loadManifest(true).then(found => (found ? publishManifest(found) : setManifest(null)));
    };

    if (manifest === undefined) return <p style={{ padding: 16 }}>Loading the visual report…</p>;
    if (manifest === null) {
      return (
        <div style={{ padding: 16 }}>
          <p>
            No visual report for this Storybook yet. It is published when the visual check of the pull request finishes;
            this panel and the sidebar update by themselves when it does.
          </p>
          <button type="button" onClick={reload}>
            Check again
          </button>
        </div>
      );
    }

    // The browser's default link blue is unreadable on the dark theme.
    const linkStyle = { color: theme?.color?.secondary };
    const story = manifest.stories[storyId];
    const showComparison =
      story && story.images.includes('base') && story.images.includes('pr') && story.status !== 'unchanged';
    return (
      <div style={{ padding: 16 }}>
        <p style={{ marginTop: 0 }}>
          <strong>{story ? (STATUS_LABELS[story.status] ?? story.status) : 'Not in the visual report'}</strong>
          {story?.status === 'changed' && manifest.approved && ' (approved)'}
          {' · '}
          {manifest.headSha && <>commit {String(manifest.headSha).slice(0, 7)} · </>}
          <a href={new URL('..', galleryUrl()).href} target="_blank" rel="noreferrer" style={linkStyle}>
            Full report
          </a>
          {manifest.runUrl && (
            <>
              {' · '}
              <a href={manifest.runUrl} target="_blank" rel="noreferrer" style={linkStyle}>
                CI run
              </a>
            </>
          )}
          {canFilterSidebar(api) && !hasNativeChangeFilter() && (
            <>
              {' · '}
              <SidebarFilterSelect api={api} manifest={manifest} />
            </>
          )}
        </p>
        {!story && <p>Docs pages, skipped stories and stories added after the run have no screenshot.</p>}
        {story?.error && <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{story.error}</pre>}
        {showComparison ? (
          <Comparison key={storyId} manifest={manifest} storyId={storyId} theme={theme} />
        ) : (
          story?.images.includes('pr') && (
            <img
              src={imageUrl(manifest, storyId, 'pr')}
              alt="PR screenshot"
              style={{ display: 'block', maxWidth: '100%' }}
            />
          )
        )}
      </div>
    );
  };
}

/** Adds the `visual:*` tags to the index, unless it already has them. */
export async function applyVisualTags(api, index) {
  const manifest = await loadManifest();
  if (!manifest || !index || isTagged(index) || typeof api.setIndex !== 'function') return;
  await api.setIndex(withVisualTags(index, manifest));
}

/**
 * Applies statuses and tags once the manifest and the story index are available. Applying
 * statuses re-saves the index, so the tags go last, and every call re-checks them in case the
 * index was reloaded without them.
 */
export function createResultsApplier({ setStatuses }) {
  let applying = false;
  return async function apply(api, index) {
    const manifest = await loadManifest();
    if (!manifest || !index || applying || isTagged(index)) return;
    applying = true;
    try {
      await setStatuses(api, statusEntries(manifest));
      await applyVisualTags(api, index);
    } finally {
      applying = false;
    }
  };
}

/**
 * Registers the addon. Automated browsers (smoke tests, the visual runner) skip it: the report
 * never exists while a preview is being built and checked.
 */
export function registerVisualAddon({
  addons,
  types,
  AddonPanel,
  useStorybookState,
  useStorybookApi,
  useTheme,
  registerResults
}) {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return;
  const VisualPanel = createVisualPanel({ useStorybookState, useStorybookApi, useTheme });
  addons.register(ADDON_ID, api => {
    addons.add(PANEL_ID, {
      type: types.PANEL,
      title: 'Visual',
      render: ({ active }) => (
        <AddonPanel active={Boolean(active)}>
          <VisualPanel />
        </AddonPanel>
      )
    });
    registerResults(api);
  });
}
