/** `value` as one single-quoted shell word (safe for eval, including newlines). */
export function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

export function isCustomDomain({ repository = '', siteUrl = '' } = {}) {
  const [owner, repoName] = String(repository).split('/');
  if (repoName && owner && repoName.toLowerCase() === `${owner.toLowerCase()}.github.io`) return true;
  if (!siteUrl) return false;
  try {
    const url = new URL(siteUrl);
    return !owner || url.hostname.toLowerCase() !== `${owner.toLowerCase()}.github.io`;
  } catch {
    throw new Error(`site_url must be a valid URL when auto_base_url is enabled: "${siteUrl}"`);
  }
}

export function normalizePreviewRoot(previewRoot = '') {
  const trimmed = String(previewRoot ?? '')
    .trim()
    .replace(/^\.?\/+|\/+$/g, '');
  return trimmed === '.' ? '' : trimmed;
}

export function computeBaseUrl({
  repository = '',
  siteUrl = '',
  basePath = '',
  eventName = '',
  prNumber = '',
  previewRoot = ''
} = {}) {
  if (basePath) {
    const normalized = String(basePath).startsWith('/') ? String(basePath) : `/${basePath}`;
    return normalized.endsWith('/') ? normalized : `${normalized}/`;
  }
  const [, repoName = ''] = String(repository).split('/');
  const customDomain = isCustomDomain({ repository, siteUrl });
  const isPreview = eventName === 'pull_request' && /^\d+$/.test(String(prNumber)) && Number(prNumber) > 0;
  const root = normalizePreviewRoot(previewRoot);
  const path = isPreview
    ? `${customDomain ? '' : `/${repoName}`}${root ? `/${root}` : ''}/pr-${Number(prNumber)}/`
    : customDomain
      ? '/'
      : `/${repoName}/`;
  if (path.startsWith('//')) return path.slice(1);
  return path;
}

// Storybook has no base URL option (`storybook build --base-url` fails as an unknown option), and
// its builds use relative asset paths, so they load from any Pages path. auto_base_url only sets
// these variables for build tooling that reads them.
export function buildEnvironment(baseUrl) {
  return {
    BASE_URL: baseUrl,
    PUBLIC_URL: baseUrl,
    STORYBOOK_BASE_HREF: baseUrl
  };
}
