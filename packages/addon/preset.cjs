// CommonJS: Storybook 8 and 9 load presets through a CJS transpiler, where import.meta is empty.
const { createRequire } = require('node:module');
const path = require('node:path');

// Registers the manager entry matching the project's Storybook: 8.6 imports @storybook/*
// packages, 9 and 10 the consolidated storybook/* entry points.
function storybookMajor(projectDir = process.cwd()) {
  const projectRequire = createRequire(path.join(projectDir, 'package.json'));
  return Number(projectRequire('storybook/package.json').version.split('.')[0]);
}

const managerEntries = (entries = []) => [
  ...entries,
  path.join(__dirname, 'dist', storybookMajor() >= 9 ? 'manager-modern.js' : 'manager-sb8.js')
];

module.exports = { storybookMajor, managerEntries };
