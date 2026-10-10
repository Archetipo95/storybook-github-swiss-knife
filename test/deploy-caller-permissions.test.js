import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// GitHub checks every job of a reusable workflow against the caller's permissions when the run
// starts, skipped jobs included: a caller that grants less fails with startup_failure. So each
// documented caller of deploy-storybook.yml must grant what every one of its jobs asks for.

const WORKFLOW = '.github/workflows/deploy-storybook.yml';
const LEVEL = { none: 0, read: 1, write: 2 };

/** { scope: level } of the `permissions:` map that starts after line `start`, `indent` deep. */
function permissionsAt(lines, start, indent) {
  const permissions = {};
  for (const line of lines.slice(start + 1)) {
    if (!line.trim()) continue;
    if (line.search(/\S/) < indent) break;
    const [scope, level] = line.trim().split(/:\s*/);
    permissions[scope] = level;
  }
  return permissions;
}

function jobPermissions() {
  const lines = fs.readFileSync(path.join(process.cwd(), WORKFLOW), 'utf8').split('\n');
  const jobsStart = lines.indexOf('jobs:');
  const jobs = {};
  let job;
  for (const [index, line] of lines.entries()) {
    if (index <= jobsStart) continue;
    const name = /^ {2}([\w-]+):$/.exec(line);
    if (name) job = name[1];
    if (job && line === '    permissions:') jobs[job] = permissionsAt(lines, index, 6);
  }
  return jobs;
}

/** The top-level permissions of each documented workflow that calls deploy-storybook.yml. */
function documentedCallers() {
  const callers = [];
  for (const file of ['README.md', ...fs.readdirSync('docs').map(name => `docs/${name}`)]) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    for (const [, block] of text.matchAll(/```yaml\n([\s\S]*?)```/g)) {
      if (!block.includes('/.github/workflows/deploy-storybook.yml@')) continue;
      const lines = block.split('\n');
      const start = lines.indexOf('permissions:');
      // A fragment without its own permissions (only the `with:` part) is not a full caller.
      if (start === -1) continue;
      callers.push({ file, permissions: permissionsAt(lines, start, 2) });
    }
  }
  return callers;
}

test('deploy-storybook.yml declares permissions for every job', () => {
  const jobs = jobPermissions();
  assert.deepEqual(Object.keys(jobs).sort(), ['build-and-upload', 'deploy', 'directory-publish']);
});

test('documented callers of deploy-storybook.yml grant every permission its jobs ask for', () => {
  const callers = documentedCallers();
  assert.ok(
    callers.some(caller => caller.file === 'README.md'),
    'the README quickstart is checked'
  );
  assert.ok(
    callers.some(caller => caller.file === 'docs/usage.md'),
    'the usage example is checked'
  );
  for (const { file, permissions } of callers) {
    for (const [job, asked] of Object.entries(jobPermissions())) {
      for (const [scope, level] of Object.entries(asked)) {
        assert.ok(
          LEVEL[permissions[scope] ?? 'none'] >= LEVEL[level],
          `${file}: job ${job} asks for ${scope}: ${level}, the caller grants ${permissions[scope] ?? 'none'}`
        );
      }
    }
  }
});
