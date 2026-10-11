import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { planInit } from '../packages/addon/cli/init.js';

// GitHub checks every job of a reusable workflow against the caller's permissions when the run
// starts, skipped jobs included: a caller that grants less fails with startup_failure. So each
// documented caller, and each workflow `storybook-swiss-knife init` writes, must grant what every
// job of the workflow it calls asks for.

const LEVEL = { none: 0, read: 1, write: 2 };
const workflowDir = path.join(process.cwd(), '.github/workflows');

/** { scope: level } of the `permissions:` map that starts after line `start`, `indent` deep. */
function permissionsAt(lines, start, indent) {
  const permissions = {};
  for (const line of lines.slice(start + 1)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (line.search(/\S/) < indent) break;
    const [scope, level] = line.trim().split(/:\s*/);
    permissions[scope] = level;
  }
  return permissions;
}

/** The jobs of a workflow as { name, lines }. */
function jobs(lines) {
  const start = lines.indexOf('jobs:');
  const result = [];
  for (const line of lines.slice(start + 1)) {
    const name = /^ {2}([\w-]+):\s*$/.exec(line);
    if (name) result.push({ name: name[1], lines: [] });
    else if (/^\S/.test(line)) break;
    else if (result.length) result.at(-1).lines.push(line);
  }
  return result;
}

/** What each job of a reusable workflow asks for: { job: { scope: level } }. */
function askedPermissions(workflowFile) {
  const lines = fs.readFileSync(path.join(workflowDir, workflowFile), 'utf8').split('\n');
  return Object.fromEntries(
    jobs(lines)
      .map(job => [job.name, job.lines.indexOf('    permissions:')])
      .filter(([, index]) => index !== -1)
      .map(([name, index]) => [name, permissionsAt(jobs(lines).find(job => job.name === name).lines, index, 6)])
  );
}

/** The reusable-workflow calls in a caller workflow: [{ workflow, permissions }]. */
function calls(text) {
  const lines = text.split('\n');
  const topIndex = lines.indexOf('permissions:');
  const top = topIndex === -1 ? {} : permissionsAt(lines, topIndex, 2);
  return jobs(lines).flatMap(job => {
    const uses = job.lines
      .map(line => /^ {4}uses: Archetipo95\/storybook-github-swiss-knife\/\.github\/workflows\/([\w.-]+)@/.exec(line))
      .find(Boolean);
    if (!uses) return [];
    const own = job.lines.indexOf('    permissions:');
    return [{ workflow: uses[1], permissions: own === -1 ? top : permissionsAt(job.lines, own, 6) }];
  });
}

function documentedCallers() {
  const callers = [];
  for (const file of ['README.md', ...fs.readdirSync('docs').map(name => `docs/${name}`)]) {
    if (!file.endsWith('.md')) continue;
    const text = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    for (const [, block] of text.matchAll(/```yaml\n([\s\S]*?)```/g)) {
      // A fragment without permissions (only the `with:` part) is not a full caller.
      if (!/^permissions:|^ {4}permissions:/m.test(block)) continue;
      callers.push(...calls(block).map(call => ({ source: file, ...call })));
    }
  }
  return callers;
}

function initCallers() {
  const { files } = planInit({
    ref: 'v0.0.0',
    branch: 'main',
    workingDirectory: '.',
    packageManager: 'npm',
    previews: true,
    approvalLabel: 'visual-approved'
  });
  return Object.entries(files)
    .filter(([file]) => file.startsWith('.github/workflows/'))
    .flatMap(([file, text]) => calls(text).map(call => ({ source: `init ${file}`, ...call })));
}

/** What a caller grants too little of, as messages. */
function shortfalls({ source, workflow, permissions }) {
  return Object.entries(askedPermissions(workflow)).flatMap(([job, asked]) =>
    Object.entries(asked)
      .filter(([scope, level]) => LEVEL[permissions[scope] ?? 'none'] < LEVEL[level])
      .map(
        ([scope, level]) =>
          `${source}: ${workflow} job ${job} asks for ${scope}: ${level}, the caller grants ${permissions[scope] ?? 'none'}`
      )
  );
}

test('documented callers of the reusable workflows grant every permission their jobs ask for', () => {
  const callers = documentedCallers();
  for (const workflow of ['deploy-storybook.yml', 'pr-preview-cleanup.yml', 'pr-preview-janitor.yml']) {
    assert.ok(
      callers.some(caller => caller.workflow === workflow),
      `a documented caller of ${workflow} is checked`
    );
  }
  assert.ok(
    callers.some(caller => caller.source === 'README.md'),
    'the README quickstart is checked'
  );
  assert.deepEqual(callers.flatMap(shortfalls), []);
});

test('workflows written by storybook-swiss-knife init grant every permission their jobs ask for', () => {
  const callers = initCallers();
  assert.ok(callers.some(caller => caller.workflow === 'pr-preview-janitor.yml'));
  assert.deepEqual(callers.flatMap(shortfalls), []);
});

test('the cleanup and janitor jobs can write the preview comment', () => {
  // Without it the comment edits (removed / expiry warning) fail with 403.
  assert.equal(askedPermissions('pr-preview-cleanup.yml').cleanup['pull-requests'], 'write');
  assert.equal(askedPermissions('pr-preview-janitor.yml').janitor['pull-requests'], 'write');
});
