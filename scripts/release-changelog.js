/**
 * Adds a `## [<version>] - <date>` section to a Keep a Changelog file. The Unreleased notes become
 * that version's notes; only when there are none does the section get a placeholder entry, so a
 * release never ends up with two `### Changed` headings. A changelog that already has the version
 * is returned unchanged.
 * @param {string} changelog
 * @param {string} version
 * @param {string} date YYYY-MM-DD
 */
export function addReleaseSection(changelog, version, date) {
  if (changelog.includes(`## [${version}]`)) return changelog;
  const unreleased = '## [Unreleased]\n';
  const start = changelog.indexOf(unreleased);
  if (start === -1) throw new Error('CHANGELOG.md has no "## [Unreleased]" section');
  const afterHeading = start + unreleased.length;
  const next = changelog.indexOf('\n## [', afterHeading);
  const notes = changelog.slice(afterHeading, next === -1 ? changelog.length : next);
  const heading = `## [${version}] - ${date}\n`;
  const placeholder = notes.trim() ? '' : `\n### Changed\n\n- Release v${version}.\n`;
  return `${changelog.slice(0, afterHeading)}\n${heading}${placeholder}${changelog.slice(afterHeading)}`;
}
