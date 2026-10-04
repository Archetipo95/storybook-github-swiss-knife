// Resolves the viewport a story is captured at, from the story's own Storybook parameters.
// Storybook 8: parameters.viewport.{viewports, defaultViewport}. Storybook 9/10:
// parameters.viewport.options plus the viewport global ({ value, isRotated }), which a story
// sets through `globals`. Sizes are strings like "375px"; percentages are not usable sizes.

// Storybook's MINIMAL_VIEWPORTS, the default list when a project defines none.
export const STORYBOOK_DEFAULT_VIEWPORTS = Object.freeze({
  mobile1: { name: 'Small mobile', styles: { width: '320px', height: '568px' } },
  mobile2: { name: 'Large mobile', styles: { width: '414px', height: '896px' } },
  tablet: { name: 'Tablet', styles: { width: '834px', height: '1112px' } }
});

const RESPONSIVE = new Set(['', 'reset', 'responsive']);

/** @param {unknown} value */
function toPixels(value) {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.round(value);
  const match = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/.exec(String(value ?? ''));
  return match ? Math.round(Number(match[1])) : null;
}

/** @param {any} entry */
function sizeOf(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const styles = entry.styles ?? entry;
  const width = toPixels(styles.width);
  const height = toPixels(styles.height);
  return width && height ? { width, height } : null;
}

/**
 * The viewport name a story selects, and whether it is rotated.
 * @param {{ parameters?: any, globals?: any }} story
 */
export function selectedViewport({ parameters = {}, globals = {} } = {}) {
  const global = globals?.viewport;
  if (global && typeof global === 'object' && typeof global.value === 'string') {
    return { name: global.value, isRotated: Boolean(global.isRotated) };
  }
  // Storybook 8's viewport addon sets the global to 'reset' unless a story picks one; the
  // story's own defaultViewport parameter applies then.
  if (typeof global === 'string' && !RESPONSIVE.has(global)) return { name: global, isRotated: false };
  const name = parameters?.viewport?.defaultViewport;
  return {
    name: typeof name === 'string' ? name : '',
    isRotated: Boolean(parameters?.viewport?.defaultOrientation === 'landscape')
  };
}

/**
 * @param {{ parameters?: any, globals?: any }} story
 * @param {{ viewports?: 'storybook' | string[] | Record<string, {width: number, height: number}>,
 *   defaultViewport: {width: number, height: number} }} config
 * @returns {{ width: number, height: number, name: string }}
 */
export function resolveViewport(story, { viewports = 'storybook', defaultViewport }) {
  const fallback = { ...defaultViewport, name: 'default' };
  const { name, isRotated } = selectedViewport(story);
  if (RESPONSIVE.has(name)) return fallback;
  if (Array.isArray(viewports) && !viewports.includes(name)) return fallback;

  const configured =
    viewports && typeof viewports === 'object' && !Array.isArray(viewports) ? viewports[name] : undefined;
  const fromStory = story?.parameters?.viewport?.options?.[name] ?? story?.parameters?.viewport?.viewports?.[name];
  const size = sizeOf(configured) ?? sizeOf(fromStory) ?? sizeOf(STORYBOOK_DEFAULT_VIEWPORTS[name]);
  if (!size) return fallback;
  return isRotated ? { width: size.height, height: size.width, name } : { ...size, name };
}
