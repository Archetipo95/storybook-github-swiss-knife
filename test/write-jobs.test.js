import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Jobs that can write contents (push branches or tags, publish releases) install nothing and run
// no test suite: both execute code (package install scripts, the commit's own tests) next to a
// token that can push. That work runs in a read-only job instead, as the Release Tags workflow's
// addon pack and validation suite do.

const RUNS_CODE =
  /\b(?:npm (?:ci|install|i|test|run|exec)|npx|pnpm (?:install|i|run|exec|dlx)|yarn(?: install| run| dlx)?|bun (?:install|run|x)|bunx|corepack)\b/;

const workflowDir = path.join(process.cwd(), '.github/workflows');

/** The jobs of a workflow as { name, text }, YAML comment lines dropped. */
function jobs(workflow) {
  const lines = workflow.split('\n');
  const result = [];
  for (const line of lines.slice(lines.indexOf('jobs:') + 1)) {
    const name = /^ {2}([\w-]+):\s*$/.exec(line);
    if (name) result.push({ name: name[1], lines: [] });
    else if (/^\S/.test(line)) break;
    else if (result.length && !line.trim().startsWith('#')) result.at(-1).lines.push(line);
  }
  return result.map(({ name, lines: body }) => ({ name, text: body.join('\n') }));
}

const internalActions = text =>
  [...text.matchAll(/uses: (?:\.\/actions\/|Archetipo95\/storybook-github-swiss-knife\/actions\/)([\w-]+)/g)].map(
    match => match[1]
  );

function writeJobs() {
  return fs
    .readdirSync(workflowDir)
    .filter(file => /\.ya?ml$/.test(file))
    .flatMap(file =>
      jobs(fs.readFileSync(path.join(workflowDir, file), 'utf8'))
        .filter(job => /^\s+contents: write\s*$/m.test(job.text))
        .map(job => ({ file, ...job }))
    );
}

test('jobs that can write contents run no installs, package runners or test suites', () => {
  const jobsFound = writeJobs();
  assert.ok(jobsFound.some(job => job.file === 'release-tags.yml' && job.name === 'tag'));
  for (const { file, name, text } of jobsFound) {
    const runLines = text.split('\n').filter(line => !/^\s*(?:uses|name|if|with|env):/.test(line));
    const offending = runLines.find(line => RUNS_CODE.test(line));
    assert.equal(offending, undefined, `${file} job ${name} runs code next to its write token: ${offending?.trim()}`);
    // The internal actions those jobs use count too.
    for (const action of internalActions(text)) {
      const actionYml = fs.readFileSync(path.join(process.cwd(), 'actions', action, 'action.yml'), 'utf8');
      const actionLine = actionYml
        .split('\n')
        .filter(line => !line.trim().startsWith('#') && !/^\s*(?:description|name):/.test(line))
        .find(line => RUNS_CODE.test(line));
      assert.equal(
        actionLine,
        undefined,
        `${file} job ${name} uses actions/${action}, which runs: ${actionLine?.trim()}`
      );
    }
  }
});

test('release-tags.yml: the validation suite runs in the read-only verify job; tag uses its plan', () => {
  const [verify, tag] = ['verify', 'tag'].map(
    name =>
      jobs(fs.readFileSync(path.join(workflowDir, 'release-tags.yml'), 'utf8')).find(job => job.name === name).text
  );
  assert.match(verify, /^\s+contents: read\s*$/m);
  assert.match(verify, /persist-credentials: false/);
  assert.match(verify, /RELEASE_PIN_CHECK: '1'\n\s+run: npm test/);
  assert.match(tag, /needs: \[addon, verify\]/);
  assert.doesNotMatch(tag, /steps\.plan\./, 'the tag job has no plan step of its own');
  for (const output of tag.matchAll(/needs\.verify\.outputs\.(\w+)/g)) {
    assert.match(
      verify,
      new RegExp(`\\n {6}${output[1]}: \\$\\{\\{ steps\\.plan\\.outputs\\.${output[1]} \\}\\}`),
      output[1]
    );
  }
});

test('Pages-branch checkouts fetch only the tip, except the janitor, which reads the history', () => {
  const depths = {};
  for (const file of fs.readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name))) {
    const steps = fs.readFileSync(path.join(workflowDir, file), 'utf8').split(/\n\s+- name: /);
    for (const step of steps.filter(text => text.startsWith('Checkout Pages branch'))) {
      depths[file] = /fetch-depth: (\d+)/.exec(step)?.[1] ?? '1';
    }
  }
  assert.deepEqual(depths, {
    'deploy-storybook.yml': '1',
    'pr-preview-cleanup.yml': '1',
    'pr-preview-janitor.yml': '0',
    'pr-preview-publish.yml': '1',
    'visual-gate.yml': '1'
  });
});
