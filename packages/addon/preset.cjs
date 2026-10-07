// CommonJS: Storybook 8 and 9 load presets through a CJS transpiler, where import.meta is empty.
const { createRequire } = require('node:module');
const path = require('node:path');

// Registers the manager entry matching the project's Storybook: 8.6 imports @storybook/*
// packages, 9 and 10 the consolidated storybook/* entry points.
// Resolved from the directory Storybook runs in, then next to the addon (its peer dependency), so a
// build started elsewhere, such as from a monorepo root, still finds the project's Storybook.
function storybookMajor(projectDir = process.cwd()) {
  for (const from of [path.join(projectDir, 'package.json'), __filename]) {
    try {
      return Number(createRequire(from)('storybook/package.json').version.split('.')[0]);
    } catch {
      // Not resolvable from here; try the next location.
    }
  }
  throw new Error('storybook-swiss-knife: the storybook package was not found');
}

const managerEntries = (entries = []) => [
  ...entries,
  path.join(__dirname, 'dist', storybookMajor() >= 9 ? 'manager-modern.js' : 'manager-sb8.js')
];

module.exports = { storybookMajor, managerEntries };
