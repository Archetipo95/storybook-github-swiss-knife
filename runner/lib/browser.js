// Functions that run inside the Storybook preview iframe. They must be self-contained: Playwright
// serializes them, so they cannot use imports or closures.

/** Prefix of the error thrown for a story render or play function failure (see src/visual/results.js). */
export const STORY_FAILURE_PREFIX = 'Story render or play function failed';

/**
 * Init script. Storybook reports a failed play function only through channel events (the render
 * phase still ends as finished), so listen from the moment the preview creates its channel.
 * @param {string} markerAttribute data-* attribute set on <html> so stories can detect CI runs.
 */
export function recordStoryOutcome(markerAttribute) {
  const outcome = { status: undefined, errors: [] };
  window.__swissKnifeStoryOutcome = outcome;
  let channel;
  Object.defineProperty(window, '__STORYBOOK_ADDONS_CHANNEL__', {
    configurable: true,
    get: () => channel,
    set(value) {
      channel = value;
      const pushError = error => {
        const { stack, message, title, description } = error ?? {};
        outcome.errors.push(stack ?? message ?? ([title, description].filter(Boolean).join('\n') || String(error)));
      };
      value?.on?.('playFunctionThrewException', pushError);
      value?.on?.('storyThrewException', pushError);
      value?.on?.('storyErrored', pushError);
      value?.on?.('unhandledErrorsWhilePlaying', errors =>
        (Array.isArray(errors) ? errors : [errors]).forEach(pushError)
      );
      value?.on?.('storyFinished', event => {
        // Storybook 9+ also fails a story when a reporter fails, e.g. the a11y addon on any axe
        // violation. Accessibility is judged by the baseline, so only other reporters count.
        const failed = (event?.reporters ?? []).filter(reporter => reporter?.status === 'failed');
        const failedReporters = failed.filter(reporter => reporter?.type !== 'a11y');
        const onlyA11yFailed =
          event?.status === 'error' && outcome.errors.length === 0 && failed.length > 0 && failedReporters.length === 0;
        outcome.status = onlyA11yFailed ? 'success' : (event?.status ?? 'success');
        if (failedReporters.length > 0 && outcome.errors.length === 0) {
          outcome.errors.push(
            `Storybook reporters failed: ${failedReporters.map(reporter => reporter.type).join(', ')}`
          );
        }
      });
      // Storybook 8 builds before storyFinished: the 'finished' phase (after afterEach) means done.
      // 'completed' is not used: afterEach hooks still run after it.
      value?.on?.('storyRenderPhaseChanged', event => {
        if (event?.newPhase === 'finished') outcome.status ??= 'success';
      });
    }
  });
  // Init scripts run before <html> exists, so set the marker as soon as it does.
  if (markerAttribute) {
    const mark = () => document.documentElement?.setAttribute(markerAttribute, 'true');
    if (document.documentElement) mark();
    else {
      new MutationObserver((_, observer) => {
        if (!document.documentElement) return;
        mark();
        observer.disconnect();
      }).observe(document, { childList: true });
    }
  }
}

/**
 * Init script. document.fonts.ready does not wait for a stylesheet that is still loading, such as
 * a web font stylesheet a component adds at runtime, so a capture could show the fallback font.
 * Record every element that finished loading or failed, from the first script on.
 */
export function recordSettledElements() {
  const settled = new WeakSet();
  window.__swissKnifeSettled = settled;
  const markSettled = ({ target }) => {
    if (target) settled.add(target);
  };
  document.addEventListener('load', markSettled, true);
  document.addEventListener('error', markSettled, true);
}

/**
 * True once every stylesheet link on the page has loaded or failed. Links that never fire either
 * event count as settled: disabled ones (a theme switcher's), ones without an href, and ones of a
 * non-CSS type.
 */
export function stylesheetsSettled() {
  return [...document.querySelectorAll('link[rel="stylesheet"]')].every(
    link =>
      window.__swissKnifeSettled?.has(link) ||
      Boolean(link.sheet) ||
      link.disabled ||
      !link.getAttribute('href') ||
      (Boolean(link.type) && !/^text\/css$/i.test(link.type))
  );
}

/**
 * Init script, registered before the fake clock replaces requestAnimationFrame. A full-page
 * screenshot of a page taller than the viewport briefly shrinks it to 1x1, and a page that has
 * drawn no frame for a while sees that: breakpoints flip and, for example, an open date picker
 * closes. Keep it drawing with the native requestAnimationFrame.
 */
export function keepRendering() {
  const requestFrame = window.requestAnimationFrame.bind(window);
  const loop = () => requestFrame(loop);
  loop();
}

/** True once the story finished rendering (including its play function) or showed an error. */
export function storyHasSettled() {
  const outcome = window.__swissKnifeStoryOutcome;
  return Boolean(
    outcome?.status || outcome?.errors.length || document.body?.classList.contains('sb-show-errordisplay')
  );
}

/** Errors of the current story render; [] when it succeeded. */
export function storyErrors() {
  const outcome = window.__swissKnifeStoryOutcome;
  const errorDisplay = document.body.classList.contains('sb-show-errordisplay')
    ? ['#error-message', '#error-stack']
        .map(selector => document.querySelector(selector)?.textContent?.trim())
        .filter(Boolean)
        .join('\n')
    : '';
  const errors = outcome?.errors.length ? outcome.errors : [errorDisplay].filter(Boolean);
  if (outcome?.status === 'success' && errors.length === 0) return [];
  return errors.length > 0 ? errors : ['Storybook reported an error without details'];
}

/**
 * JSON-safe parts of the current story's parameters and globals the runner needs. Storybook 8.3+
 * keeps story-level globals on the prepared story (`storyGlobals`); project and user globals live
 * in the story store.
 */
export function readStoryContext() {
  const preview = window.__STORYBOOK_PREVIEW__;
  const story = preview?.currentRender?.story;
  const store = preview?.storyStoreValue ?? preview?.storyStore;
  let userGlobals = {};
  try {
    userGlobals = store?.userGlobals?.get?.() ?? store?.globals?.get?.() ?? {};
  } catch {
    userGlobals = {};
  }
  const globals = { ...userGlobals, ...(story?.storyGlobals ?? story?.globals ?? {}) };
  const parameters = story?.parameters ?? {};
  return JSON.parse(
    JSON.stringify({
      parameters: { viewport: parameters.viewport, a11y: parameters.a11y, swissKnife: parameters.swissKnife },
      globals: { viewport: globals.viewport },
      tags: story?.tags ?? []
    })
  );
}

/** Loads lazy images eagerly and resolves when web fonts are ready. */
export function prepareAssets() {
  document.querySelectorAll('img[loading="lazy"]').forEach(image => {
    image.loading = 'eager';
  });
  return document.fonts.ready;
}

export function imagesComplete() {
  return [...document.images].every(image => image.complete);
}

/**
 * No visible loading indicator: an element with a running infinite animation (a spinner) or
 * marked aria-busy.
 */
export function noLoadingIndicators() {
  const spinning = document
    .getAnimations()
    .some(
      animation =>
        animation.playState === 'running' &&
        animation.effect?.getComputedTiming().iterations === Infinity &&
        animation.effect instanceof KeyframeEffect &&
        animation.effect.target?.checkVisibility?.()
    );
  const busy = [...document.querySelectorAll('[aria-busy="true"]')].some(element => element.checkVisibility?.());
  return !spinning && !busy;
}

/**
 * Clears what a previous story may have left in this origin's storage, so stories do not depend
 * on the order the worker runs them in.
 */
export async function clearStorage() {
  try {
    localStorage.clear();
    sessionStorage.clear();
  } catch {
    // Not available on about:blank.
  }
  const databases = (await indexedDB.databases?.().catch(() => [])) ?? [];
  await Promise.all(
    databases.map(
      ({ name }) =>
        new Promise(resolve => {
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        })
    )
  );
}
