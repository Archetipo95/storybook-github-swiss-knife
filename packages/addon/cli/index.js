#!/usr/bin/env node
import fs from 'node:fs';

import { INIT_HELP, runInit } from './init.js';

const [command, ...argv] = process.argv.slice(2);
const { version } = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

if (command === 'init' && !argv.includes('--help')) {
  try {
    runInit({ argv, version });
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else {
  console.log(`storybook-swiss-knife ${version}\n\n${INIT_HELP}`);
  process.exit(command === 'init' || command === '--help' || command === undefined ? 0 : 1);
}
