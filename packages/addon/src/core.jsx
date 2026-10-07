// Visual regression results inside a pull request's Storybook preview: a "Visual" panel with the
// base and PR screenshots of the selected story, and sidebar statuses and tags for changed and
// failed stories. Reads gallery/manifest.json published next to the preview by the swiss-knife
// visual gate (<preview>/visual/gallery/). Shared by the Storybook 8 and 9/10 manager entries.
import React, { useEffect, useRef, useState } from 'react';

import { isTagged, STATUS_LABELS, statusEntries, withVisualTags } from './results.js';

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
let requestedAt = 0;
let found = false;
// Pages caches files for minutes; the timestamp makes a reload see a newer run. A missing report
// is asked for again after 30 s: the gate may publish it while the preview is open.
export function loadManifest(refresh = false) {
  if (refresh || !manifestRequest || (!found && Date.now() - requestedAt > 30_000)) {
    requestedAt = Date.now();
    manifestRequest = fetch(`${galleryUrl()}manifest.json?t=${requestedAt}`, { cache: 'no-store' })
      .then(response => (response.ok ? response.json() : null))
      .then(manifest => (manifest && typeof manifest.stories === 'object' ? manifest : null))
      .catch(() => null)
      .then(manifest => {
        found = Boolean(manifest);
        return manifest;
      });
  }
  return manifestRequest;
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

function Comparison({ manifest, storyId, theme }) {
  const [side, setSide] = useState('pr');
  const [showDiff, setShowDiff] = useState(false);
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

/** The panel body; `useStorybookState` and `useTheme` come from the version's manager API. */
export function createVisualPanel({ useStorybookState, useTheme }) {
  return function VisualPanel() {
    const { storyId } = useStorybookState();
    const theme = useTheme();
    const [manifest, setManifest] = useState();

    useEffect(() => {
      loadManifest().then(setManifest);
    }, []);

    const reload = () => {
      setManifest(undefined);
      loadManifest(true).then(setManifest);
    };

    if (manifest === undefined) return <p style={{ padding: 16 }}>Loading the visual report…</p>;
    if (manifest === null) {
      return (
        <div style={{ padding: 16 }}>
          <p>
            No visual report for this Storybook yet. It is published when the visual check of the pull request finishes.
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
export function registerVisualAddon({ addons, types, AddonPanel, useStorybookState, useTheme, registerResults }) {
  if (typeof navigator !== 'undefined' && navigator.webdriver) return;
  const VisualPanel = createVisualPanel({ useStorybookState, useTheme });
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
