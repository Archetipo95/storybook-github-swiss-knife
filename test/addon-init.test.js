import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { detectPackageManager, planInit, registerAddon, runInit } from '../packages/addon/cli/init.js';

const REF = 'f'.repeat(40);
const defaults = {
  ref: REF,
  branch: 'main',
  workingDirectory: '.',
  packageManager: 'pnpm',
  previews: true,
  approvalLabel: 'visual-approved'
};

function project(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-init-'));
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  execFileSync('git', ['init', '-q'], { cwd: dir });
  return dir;
}

test('planInit writes the caller workflows pinned to the ref, and the configuration', () => {
  const { files } = planInit(defaults);
  assert.deepEqual(Object.keys(files).sort(), [
    '.github/workflows/preview-build.yml',
    '.github/workflows/preview-cleanup.yml',
    '.github/workflows/preview-janitor.yml',
    '.github/workflows/preview-publish.yml',
    '.github/workflows/visual-gate.yml',
    '.github/workflows/visual.yml',
    '.storybook/swiss-knife.json'
  ]);
  for (const [file, content] of Object.entries(files)) {
    if (!file.endsWith('.yml')) continue;
    const swissKnife = content.match(/Archetipo95\/storybook-github-swiss-knife\/\S+/g) ?? [];
    assert.ok(swissKnife.length > 0, file);
    for (const use of swissKnife) assert.ok(use.endsWith(`@${REF}`), `${file}: ${use}`);
    for (const [, ref] of content.matchAll(/uses: (?!Archetipo95)[^@\s]+@(\S+)/g)) assert.match(ref, /^[0-9a-f]{40}$/);
  }
  assert.match(files['.github/workflows/visual.yml'], /branches: \['main'\]/);
  assert.match(files['.github/workflows/visual-gate.yml'], /protected_paths: '\.storybook\/swiss-knife\.json'/);
  assert.match(files['.github/workflows/preview-build.yml'], /corepack pnpm exec storybook build --quiet/);
  assert.deepEqual(JSON.parse(files['.storybook/swiss-knife.json']).visual, {
    baselineBranches: ['main'],
    approvalLabel: 'visual-approved'
  });
});

test('planInit passes a monorepo working directory to every workflow', () => {
  const { files } = planInit({ ...defaults, workingDirectory: 'apps/ui', packageManager: 'npm', previews: false });
  assert.ok(!files['.github/workflows/preview-build.yml']);
  assert.match(files['.github/workflows/visual.yml'], /working_directory: 'apps\/ui'/);
  assert.match(files['.github/workflows/visual-gate.yml'], /working_directory: 'apps\/ui'/);
  assert.match(
    files['.github/workflows/visual-gate.yml'],
    /protected_paths: 'apps\/ui\/\.storybook\/swiss-knife\.json'/
  );
  assert.ok(files['apps/ui/.storybook/swiss-knife.json']);
});

test('the generated workflows pass actionlint', { skip: !hasActionlint() }, () => {
  const dir = project({});
  for (const [file, content] of Object.entries(planInit({ ...defaults, workingDirectory: 'apps/ui' }).files)) {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), content);
  }
  execFileSync('actionlint', [], { cwd: dir, stdio: 'pipe' });
});

function hasActionlint() {
  try {
    execFileSync('actionlint', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

test('registerAddon adds the addon once, and reports a main file without an addons array', () => {
  assert.equal(
    registerAddon("export default { addons: ['@storybook/addon-a11y'] };"),
    "export default { addons: ['storybook-swiss-knife', '@storybook/addon-a11y'] };"
  );
  assert.equal(
    registerAddon('export default { addons: [] };'),
    "export default { addons: ['storybook-swiss-knife'] };"
  );
  const registered = "module.exports = { addons: ['storybook-swiss-knife'] };";
  assert.equal(registerAddon(registered), registered);
  assert.equal(registerAddon('export default { stories: [] };'), null);
});

test('detectPackageManager reads the lockfile, falling back to the repository root and npm', () => {
  const dir = project({ 'yarn.lock': '', 'apps/ui/package.json': '{}' });
  assert.equal(detectPackageManager(path.join(dir, 'apps/ui'), dir), 'yarn');
  assert.equal(detectPackageManager(project({})), 'npm');
});

test('runInit writes the files, registers the addon and keeps existing files', () => {
  const dir = project({
    'package.json': '{}',
    'pnpm-lock.yaml': '',
    '.storybook/main.ts': "export default { addons: ['@storybook/addon-a11y'] };\n",
    '.github/workflows/visual.yml': 'name: mine\n'
  });
  const lines = [];
  runInit({
    argv: ['--no-label', '--ref', REF, '--branch', 'develop'],
    cwd: dir,
    version: '0.1.0',
    log: line => lines.push(line)
  });
  assert.equal(fs.readFileSync(path.join(dir, '.github/workflows/visual.yml'), 'utf8'), 'name: mine\n');
  assert.match(fs.readFileSync(path.join(dir, '.github/workflows/visual-gate.yml'), 'utf8'), new RegExp(`@${REF}`));
  assert.match(fs.readFileSync(path.join(dir, '.storybook/main.ts'), 'utf8'), /addons: \['storybook-swiss-knife', /);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(dir, '.storybook/swiss-knife.json'), 'utf8')).visual.baselineBranches,
    ['develop']
  );
  const output = lines.join('\n');
  assert.match(output, /kept {5}\.github\/workflows\/visual\.yml/);
  assert.match(output, /gh label create visual-approved/);
  assert.match(output, /pnpm add --save-dev storybook-swiss-knife/);
  assert.match(output, /required status checks/);
});

test('runInit --dry-run writes nothing and the default ref is the package version', () => {
  const dir = project({ 'package.json': '{}' });
  const lines = [];
  runInit({ argv: ['--dry-run', '--no-label'], cwd: dir, version: '1.2.3', log: line => lines.push(line) });
  assert.ok(!fs.existsSync(path.join(dir, '.github')));
  assert.match(lines.join('\n'), /visual\.yml@v1\.2\.3/);
  assert.match(lines.join('\n'), /Add 'storybook-swiss-knife' to the addons/);
});

test('runInit refuses a directory without package.json', () => {
  assert.throws(
    () => runInit({ argv: ['--no-label'], cwd: project({}), version: '0.1.0', log: () => {} }),
    /No package\.json/
  );
});
