// Helpers for tests that run a workflow or action step's own script.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** The `run: |` script of the step named `name` in a workflow or action file (repo-relative). */
export function stepRun(file, name) {
  const lines = fs.readFileSync(path.join(process.cwd(), file), 'utf8').split('\n');
  const start = lines.findIndex(line => line.trim() === `- name: ${name}`);
  assert.notEqual(start, -1, `${file} has no step "${name}"`);
  const next = lines.findIndex((line, index) => index > start && line.trim().startsWith('- name: '));
  const run = lines.findIndex((line, index) => index > start && /^\s*run: \|$/.test(line));
  assert.ok(run !== -1 && (next === -1 || run < next), `${file}: "${name}" has no run: | block`);
  const indent = lines[run].search(/\S/);
  const body = [];
  for (const line of lines.slice(run + 1)) {
    if (line.trim() && line.search(/\S/) <= indent) break;
    body.push(line);
  }
  const strip = Math.min(...body.filter(line => line.trim()).map(line => line.search(/\S/)));
  return `${body
    .map(line => line.slice(strip))
    .join('\n')
    .trimEnd()}\n`;
}

/**
 * Parses a GITHUB_OUTPUT / GITHUB_ENV file the way the runner does: `key=value` lines, and
 * `key<<delimiter` blocks that end at a line equal to the delimiter. Throws on what the runner
 * rejects. Later keys replace earlier ones.
 */
export function parseCommandFile(text) {
  const lines = text.split('\n');
  if (lines.at(-1) === '') lines.pop();
  const values = {};
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === '') continue;
    const equals = line.indexOf('=');
    const heredoc = line.indexOf('<<');
    if (equals >= 0 && (heredoc < 0 || equals < heredoc)) {
      values[line.slice(0, equals)] = line.slice(equals + 1);
    } else if (heredoc >= 0) {
      const delimiter = line.slice(heredoc + 2);
      const end = lines.indexOf(delimiter, index + 1);
      if (!delimiter || end === -1) throw new Error(`Matching delimiter not found: ${delimiter}`);
      values[line.slice(0, heredoc)] = lines.slice(index + 1, end).join('\n');
      index = end;
    } else {
      throw new Error(`Invalid format: ${line}`);
    }
  }
  return values;
}
