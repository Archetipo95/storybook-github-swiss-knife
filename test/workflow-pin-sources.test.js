import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { checkWorkflowSources, exportedNames, swissKnifeSources, swissKnifeUses } from '../scripts/workflow-sources.js';

// main's workflows run SWISS_KNIFE_ROOT from the toolkit pin. A workflow that uses a module or
// export newer than the pin breaks on main until the pins move (it did between #26 and v0.3.0:
// ERR_MODULE_NOT_FOUND for src/command-file.js), so CI fails instead. See "Workflows and the
// pinned toolkit" in docs/development.md.

const repoRoot = process.cwd();
const git = args => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: 'pipe' });

// The pins are older commits; a shallow clone (actions/checkout without fetch-depth: 0) lacks them.
try {
  if (git(['rev-parse', '--is-shallow-repository']).trim() === 'true') git(['fetch', '--unshallow']);
} catch {
  // Offline or not a clone: the commit check below reports what is missing.
}

const cache = new Map();
function readAtPin(sha, file) {
  const key = `${sha}:${file}`;
  if (!cache.has(key)) {
    let content = null;
    try {
      content = git(['show', key]);
    } catch {
      // Not at that commit.
    }
    cache.set(key, content);
  }
  return cache.get(key);
}

const workflowDir = path.join(repoRoot, '.github/workflows');
const workflows = fs
  .readdirSync(workflowDir)
  .filter(file => /\.ya?ml$/.test(file))
  .map(file => ({
    file: `.github/workflows/${file}`,
    workflow: fs.readFileSync(path.join(workflowDir, file), 'utf8')
  }));

test('every toolkit pin is a commit in this clone', () => {
  const pins = new Set(
    workflows.flatMap(({ workflow }) =>
      [...workflow.matchAll(/storybook-github-swiss-knife\/actions\/toolkit@([0-9a-f]{40})/g)].map(match => match[1])
    )
  );
  assert.ok(pins.size > 0);
  for (const pin of pins) {
    assert.doesNotThrow(() => git(['cat-file', '-e', `${pin}^{commit}`]), `toolkit pin ${pin} is not in this clone`);
  }
});

test('workflows only use source and exports their toolkit pin has', () => {
  const problems = workflows.flatMap(({ file, workflow }) => checkWorkflowSources({ file, workflow, readAtPin }));
  assert.deepEqual(
    problems,
    [],
    `Move the pins (npm run bump-pins) after the source is on main:\n${problems.join('\n')}`
  );
});

test('the check catches the drift that broke main between #26 and v0.3.0', () => {
  // 89e1e93 (#27's merge): workflows import src/command-file.js, toolkit still pinned at 264fe9f.
  const file = '.github/workflows/pr-preview-publish.yml';
  const workflow = readAtPin('89e1e9300108b2ecef21f8f156cd8e4a96e17991', file);
  assert.ok(workflow, '89e1e93 is not in this clone');
  const problems = checkWorkflowSources({ file, workflow, readAtPin });
  assert.ok(
    problems.some(problem => /src\/command-file\.js is not at toolkit pin 264fe9f/.test(problem)),
    problems.join('\n')
  );
});

const PIN = 'a'.repeat(40);
const fakeRepo = files => (sha, file) => (sha === PIN && file in files ? files[file] : null);
const workflowWith = script => `on: push
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - uses: Archetipo95/storybook-github-swiss-knife/actions/toolkit@${PIN}
      - run: |
${script
  .split('\n')
  .map(line => `          ${line}`)
  .join('\n')}
`;
const check = (script, files) =>
  checkWorkflowSources({ file: 'w.yml', workflow: workflowWith(script), readAtPin: fakeRepo(files) });

test('swissKnifeSources reads every form the workflows use', () => {
  const sources = swissKnifeSources(`
    node -e 'Promise.all(["config.js", "command-file.js"].map(file => import(process.env.SWISS_KNIFE_ROOT + "/src/" + file))).then(([{resolveConfiguration}, {formatCommandFile, appendCommandFile: append}]) => {})'
    node -e 'import(process.env.SWISS_KNIFE_ROOT + "/src/base-url.js").then(({computeBaseUrl, shellQuote}) => {})'
    node -e 'import(process.env.SWISS_KNIFE_ROOT + "/src/generate-badges.js").then(m => { m.generateBadges(); m.writeBadges(m.x); })'
    run: node "$SWISS_KNIFE_ROOT/src/smoke-test.js" "$TARGET_PATH"
  `);
  assert.deepEqual(sources, [
    { path: 'src/config.js', names: ['resolveConfiguration'] },
    { path: 'src/command-file.js', names: ['formatCommandFile', 'appendCommandFile'] },
    { path: 'src/base-url.js', names: ['computeBaseUrl', 'shellQuote'] },
    { path: 'src/generate-badges.js', names: ['generateBadges', 'writeBadges', 'x'] },
    { path: 'src/smoke-test.js', names: [] }
  ]);
});

test('swissKnifeSources reads await import, template literals, any + spacing and ${SWISS_KNIFE_ROOT}', () => {
  const sources = swissKnifeSources(`
    node -e 'const { resolveTrustedPullRequestContext } = await import(process.env.SWISS_KNIFE_ROOT + "/src/resolve-run-context.js");'
    node -e 'const m = await import(process.env.SWISS_KNIFE_ROOT + "/src/a.js"); m.go(); m.stop();'
    node -e 'import(\`\${process.env.SWISS_KNIFE_ROOT}/src/t.js\`).then(({x}) => x())'
    node -e 'import(process.env.SWISS_KNIFE_ROOT+"/src/nospace.js").then(({y}) => y())'
    run: node "\${SWISS_KNIFE_ROOT}/src/brace.js"
  `);
  assert.deepEqual(sources, [
    { path: 'src/t.js', names: ['x'] },
    { path: 'src/nospace.js', names: ['y'] },
    { path: 'src/resolve-run-context.js', names: ['resolveTrustedPullRequestContext'] },
    { path: 'src/a.js', names: ['go', 'stop'] },
    { path: 'src/brace.js', names: [] }
  ]);
});

test('the real pr-preview-publish await import is checked', () => {
  const publish = workflows.find(({ file }) => file.endsWith('/pr-preview-publish.yml')).workflow;
  assert.ok(
    swissKnifeSources(publish).some(
      ({ path: source, names }) =>
        source === 'src/resolve-run-context.js' && names.includes('resolveTrustedPullRequestContext')
    )
  );
});

test('swissKnifeUses fails closed: an unrecognised use is reported, a YAML comment is not', () => {
  const { sources, unrecognised } = swissKnifeUses(`
    # The steps below run swiss-knife's own scripts (SWISS_KNIFE_ROOT).
    run: echo "$SWISS_KNIFE_ROOT"
    node -e 'import(require("node:path").join(process.env.SWISS_KNIFE_ROOT, "src/x.js"))'
  `);
  assert.deepEqual(sources, []);
  assert.deepEqual(unrecognised, [
    'run: echo "$SWISS_KNIFE_ROOT"',
    `node -e 'import(require("node:path").join(process.env.SWISS_KNIFE_ROOT, "src/x.js"))'`
  ]);
  assert.deepEqual(check(`node -e 'import(require("node:path").join(process.env.SWISS_KNIFE_ROOT, "src/x.js"))'`, {}), [
    `w.yml job build: unrecognised use of SWISS_KNIFE_ROOT (teach scripts/workflow-sources.js this form): node -e 'import(require("node:path").join(process.env.SWISS_KNIFE_ROOT, "src/x.js"))'`
  ]);
});

test('exportedNames reads function, const, class, list and default exports', () => {
  const { names, star } = exportedNames(
    [
      'export function a() {}',
      'export async function b() {}',
      'export const c = 1;',
      'export class D {}',
      'const e = 1, f = 2;',
      'export { e, f as g };',
      'export { h } from "./h.js";',
      'export default a;',
      'function hidden() {}'
    ].join('\n')
  );
  assert.deepEqual([...names].sort(), ['D', 'a', 'b', 'c', 'default', 'e', 'g', 'h']);
  assert.equal(star, false);
  assert.equal(exportedNames('export * from "./x.js";').star, true);
});

test('checkWorkflowSources: a module missing at the pin is a problem', () => {
  const script = `node -e 'Promise.all(["config.js", "new.js"].map(file => import(process.env.SWISS_KNIFE_ROOT + "/src/" + file))).then(([{resolveConfiguration}, {build}]) => {})'`;
  assert.deepEqual(check(script, { 'src/config.js': 'export function resolveConfiguration() {}' }), [
    'w.yml job build: src/new.js is not at toolkit pin aaaaaaa'
  ]);
  assert.deepEqual(check('node "$SWISS_KNIFE_ROOT/src/gone.js"', {}), [
    'w.yml job build: src/gone.js is not at toolkit pin aaaaaaa'
  ]);
});

test('checkWorkflowSources: an export missing at the pin is a problem', () => {
  const files = { 'src/install.js': 'export function resolveInstallCommand() {}' };
  const script = `node -e 'Promise.all(["install.js"].map(file => import(process.env.SWISS_KNIFE_ROOT + "/src/" + file))).then(([{findLockfile, resolveInstallCommand}]) => {})'`;
  assert.deepEqual(check(script, files), [
    'w.yml job build: src/install.js at toolkit pin aaaaaaa does not export findLockfile'
  ]);
  const viaModule = `node -e 'import(process.env.SWISS_KNIFE_ROOT + "/src/install.js").then(m => m.newThing())'`;
  assert.deepEqual(check(viaModule, files), [
    'w.yml job build: src/install.js at toolkit pin aaaaaaa does not export newThing'
  ]);
  // Present at the pin: no problem.
  assert.deepEqual(check(script.replace('findLockfile, ', ''), files), []);
});

test('checkWorkflowSources: SWISS_KNIFE_ROOT in a job without the toolkit is a problem', () => {
  const workflow = `on: push
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - run: node "$SWISS_KNIFE_ROOT/src/x.js"
`;
  assert.deepEqual(checkWorkflowSources({ file: 'w.yml', workflow, readAtPin: fakeRepo({}) }), [
    'w.yml job build: uses SWISS_KNIFE_ROOT without the toolkit action'
  ]);
});
