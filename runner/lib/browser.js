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
        outcome.status = event?.status ?? 'success';
      });
      // Older Storybook 8 builds emit no storyFinished; a finished render phase still means done.
      value?.on?.('storyRenderPhaseChanged', event => {
        if (event?.newPhase === 'completed' || event?.newPhase === 'finished') outcome.status ??= 'success';
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
