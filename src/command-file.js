// Writes GitHub Actions command files (GITHUB_OUTPUT, GITHUB_ENV). A `key=value` line cannot hold
// a newline, so a multi-line value (a multi-line build_command, a `|` block in the config file)
// uses `key<<delimiter`, with a random delimiter per value so the value cannot end the block early
// and add keys of its own.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** The command-file text for `entries` ({ key: value }); null and undefined are written as ''. */
export function formatCommandFile(entries) {
  let text = '';
  for (const [key, raw] of Object.entries(entries)) {
    if (!KEY.test(key)) throw new Error(`Invalid output name: ${JSON.stringify(key)}`);
    const value = raw === undefined || raw === null ? '' : String(raw);
    if (!/[\r\n]/.test(value)) {
      text += `${key}=${value}\n`;
      continue;
    }
    const delimiter = `ghadelimiter_${randomUUID()}`;
    if (value.includes(delimiter)) throw new Error(`The value of ${key} contains its delimiter`);
    text += `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
  }
  return text;
}

/** Appends `entries` to the command file at `file` (process.env.GITHUB_OUTPUT or GITHUB_ENV). */
export function appendCommandFile(file, entries) {
  fs.appendFileSync(file, formatCommandFile(entries));
}
