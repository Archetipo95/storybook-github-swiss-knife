import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addReleaseSection } from '../scripts/release-changelog.js';

const HEAD = '# Changelog\n\n---\n\n## [Unreleased]\n';
const PREVIOUS = '## [0.2.0] - 2026-10-10\n\n### Fixed\n\n- Something.\n';

test('addReleaseSection turns the Unreleased notes into the release section', () => {
  const changelog = `${HEAD}\n### Changed\n\n- A change.\n\n### Fixed\n\n- A fix.\n\n${PREVIOUS}`;
  assert.equal(
    addReleaseSection(changelog, '0.3.0', '2026-10-11'),
    `${HEAD}\n## [0.3.0] - 2026-10-11\n\n### Changed\n\n- A change.\n\n### Fixed\n\n- A fix.\n\n${PREVIOUS}`
  );
});

test('addReleaseSection adds a placeholder only when Unreleased is empty', () => {
  assert.equal(
    addReleaseSection(`${HEAD}\n${PREVIOUS}`, '0.3.0', '2026-10-11'),
    `${HEAD}\n## [0.3.0] - 2026-10-11\n\n### Changed\n\n- Release v0.3.0.\n\n${PREVIOUS}`
  );
});

test('addReleaseSection leaves a changelog that already has the version alone', () => {
  const changelog = `${HEAD}\n${PREVIOUS}`;
  assert.equal(addReleaseSection(changelog, '0.2.0', '2026-10-11'), changelog);
  assert.throws(() => addReleaseSection('# Changelog\n', '0.3.0', '2026-10-11'), /no "## \[Unreleased\]"/);
});
