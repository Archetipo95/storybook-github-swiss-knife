// `storybook-swiss-knife init`: the caller workflows, the configuration and the addon
// registration for a repository, then the steps only a person can do. Existing files are kept
// unless --force; nothing is installed.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const REPOSITORY = 'Archetipo95/storybook-github-swiss-knife';
export const ADDON = 'storybook-swiss-knife';

const COMMANDS = {
  npm: { install: 'npm ci', build: 'npx storybook build' },
  pnpm: { install: 'corepack pnpm install --frozen-lockfile', build: 'corepack pnpm exec storybook build' },
  yarn: { install: 'corepack yarn install --immutable', build: 'corepack yarn storybook build' },
  bun: { install: 'bun install --frozen-lockfile', build: 'bunx storybook build' }
};

/** The package manager from the project's lockfile (the repository root is checked too). */
export function detectPackageManager(projectDir, rootDir = projectDir) {
  const locks = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['yarn.lock', 'yarn'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['package-lock.json', 'npm']
  ];
  for (const dir of new Set([projectDir, rootDir])) {
    const found = locks.find(([file]) => fs.existsSync(path.join(dir, file)));
    if (found) return found[1];
  }
  return 'npm';
}

const yamlString = value => `'${String(value).replaceAll("'", "''")}'`;

function visualWorkflow({ ref, branch, workingDirectory }) {
  return `name: Visual

on:
  pull_request:
    types: [opened, synchronize, reopened, labeled, unlabeled]
  push:
    branches: [${yamlString(branch)}]

# Label events get their own group, so a label never cancels a comparison.
concurrency:
  group: >-
    visual-\${{ github.event.pull_request.number || github.ref }}-\${{
    (github.event.action == 'labeled' || github.event.action == 'unlabeled') && 'label' || 'code' }}
  cancel-in-progress: \${{ github.event_name == 'pull_request' }}

permissions:
  contents: read

jobs:
  visual:
    uses: ${REPOSITORY}/.github/workflows/visual.yml@${ref}
    permissions:
      contents: read
      actions: read
${workingDirectory === '.' ? '' : `    with:\n      working_directory: ${yamlString(workingDirectory)}\n`}`;
}

function gateWorkflow({ ref, workingDirectory }) {
  const config = path.posix.join(workingDirectory, '.storybook/swiss-knife.json');
  return `name: Visual Gate

on:
  workflow_run:
    workflows: ['Visual']
    types: [completed]

permissions:
  contents: read

jobs:
  gate:
    if: github.event.workflow_run.event == 'pull_request'
    uses: ${REPOSITORY}/.github/workflows/visual-gate.yml@${ref}
    permissions:
      actions: read
      checks: write
      contents: write
      issues: write
      pull-requests: write
    with:
      caller_workflow: .github/workflows/visual.yml
      # The capture settings are read from the pull request: keep them as reviewed on the base.
      protected_paths: ${yamlString(config)}
${workingDirectory === '.' ? '' : `      working_directory: ${yamlString(workingDirectory)}\n`}    secrets:
      passcode_hash: \${{ secrets.STORYBOOK_PREVIEW_PASSCODE_HASH }}
`;
}

function previewBuildWorkflow({ ref, workingDirectory, packageManager }) {
  const { install, build } = COMMANDS[packageManager];
  const output = path.posix.join(workingDirectory, 'storybook-static');
  return `name: PR Preview Build

on:
  pull_request:
    types: [opened, synchronize, reopened]

concurrency:
  group: preview-build-\${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-24.04
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: '24'
      - name: Install and build Storybook
${workingDirectory === '.' ? '' : `        working-directory: ${yamlString(workingDirectory)}\n`}        run: |
          ${install}
          ${build} --quiet --output-dir storybook-static
      - name: Package and upload preview bundle
        uses: ${REPOSITORY}/actions/preview-build@${ref}
        with:
          source_path: ${yamlString(output)}
`;
}

const previewPublishWorkflow = ({ ref }) => `name: PR Preview Publish

on:
  workflow_run:
    workflows: ['PR Preview Build']
    types: [completed]

permissions:
  contents: read

jobs:
  publish:
    uses: ${REPOSITORY}/.github/workflows/pr-preview-publish.yml@${ref}
    permissions:
      actions: read
      contents: write
      deployments: write
      pages: write
      pull-requests: write
    secrets:
      passcode_hash: \${{ secrets.STORYBOOK_PREVIEW_PASSCODE_HASH }}
`;

const previewCleanupWorkflow = ({ ref }) => `name: PR Preview Cleanup

on:
  pull_request_target:
    types: [closed]

permissions:
  contents: read

jobs:
  cleanup:
    uses: ${REPOSITORY}/.github/workflows/pr-preview-cleanup.yml@${ref}
    permissions:
      contents: write
      deployments: write
      pages: write
`;

const previewJanitorWorkflow = ({ ref }) => `name: PR Preview Janitor

on:
  schedule:
    - cron: '17 3 * * *'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  janitor:
    uses: ${REPOSITORY}/.github/workflows/pr-preview-janitor.yml@${ref}
    permissions:
      contents: write
      deployments: write
      pages: write
      pull-requests: read
`;

/** Adds the addon to the `addons` array of a Storybook main file; null when it cannot. */
export function registerAddon(source) {
  if (source.includes(`'${ADDON}'`) || source.includes(`"${ADDON}"`)) return source;
  const withAddon = source.replace(/addons\s*:\s*\[/, match => `${match}'${ADDON}', `);
  return withAddon === source ? null : withAddon.replace(`'${ADDON}', ]`, `'${ADDON}']`);
}

/**
 * Everything `init` would write, as { path: content } relative to the repository root.
 * @param {{ ref: string, branch: string, workingDirectory: string, packageManager: string,
 *   previews: boolean, approvalLabel: string, main?: { path: string, source: string } }} options
 */
export function planInit({ ref, branch, workingDirectory, packageManager, previews, approvalLabel, main }) {
  const options = { ref, branch, workingDirectory, packageManager };
  const files = {
    '.github/workflows/visual.yml': visualWorkflow(options),
    '.github/workflows/visual-gate.yml': gateWorkflow(options)
  };
  if (previews) {
    Object.assign(files, {
      '.github/workflows/preview-build.yml': previewBuildWorkflow(options),
      '.github/workflows/preview-publish.yml': previewPublishWorkflow(options),
      '.github/workflows/preview-cleanup.yml': previewCleanupWorkflow(options),
      '.github/workflows/preview-janitor.yml': previewJanitorWorkflow(options)
    });
  }
  files[path.posix.join(workingDirectory, '.storybook/swiss-knife.json')] = `${JSON.stringify(
    {
      $schema: `https://raw.githubusercontent.com/${REPOSITORY}/${ref}/schema/swiss-knife.schema.json`,
      visual: { baselineBranches: [branch], approvalLabel },
      a11y: { blockingImpacts: ['critical', 'serious'] }
    },
    null,
    2
  )}\n`;
  const updated = main ? registerAddon(main.source) : null;
  if (main && updated && updated !== main.source) files[main.path] = updated;
  return { files, addonRegistered: Boolean(main && updated), mainPath: main?.path ?? null };
}

const git = (args, cwd) => {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
};

function parseArgs(argv) {
  const options = { previews: true, label: true, force: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '--ref') options.ref = value();
    else if (arg === '--branch') options.branch = value();
    else if (arg === '--working-directory') options.workingDirectory = value();
    else if (arg === '--approval-label') options.approvalLabel = value();
    else if (arg === '--no-previews') options.previews = false;
    else if (arg === '--no-label') options.label = false;
    else if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Unknown option ${arg}`);
  }
  return options;
}

export const INIT_HELP = `Usage: storybook-swiss-knife init [options]

Run from the repository root.

  --working-directory <dir>  where package.json and .storybook/ are (default: .)
  --branch <name>            baseline branch (default: the remote's default branch, else main)
  --ref <tag|sha>            swiss-knife version the workflows use (default: v<this version>)
  --approval-label <name>    label that accepts visual changes (default: visual-approved)
  --no-previews              only the visual and accessibility checks, no PR previews
  --no-label                 do not create the label with the GitHub CLI
  --force                    overwrite existing files
  --dry-run                  print what would be written`;

/** @param {{ argv: string[], cwd?: string, version: string, log?: (line: string) => void }} options */
export function runInit({ argv, cwd = process.cwd(), version, log = console.log }) {
  const options = parseArgs(argv);
  const here = fs.realpathSync(cwd);
  const top = git(['rev-parse', '--show-toplevel'], here);
  const root = top ? fs.realpathSync(top) : here;
  const workingDirectory = path.posix.normalize(
    options.workingDirectory ?? (path.relative(root, here).split(path.sep).join('/') || '.')
  );
  if (workingDirectory.startsWith('..') || path.posix.isAbsolute(workingDirectory)) {
    throw new Error('--working-directory must be inside the repository');
  }
  const projectDir = path.join(root, workingDirectory);
  if (!fs.existsSync(path.join(projectDir, 'package.json'))) {
    throw new Error(`No package.json in ${projectDir}; pass --working-directory`);
  }
  const branch =
    options.branch ??
    (git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], root).replace(/^origin\//, '') || 'main');
  const approvalLabel = options.approvalLabel ?? 'visual-approved';
  const mainFile = fs.existsSync(path.join(projectDir, '.storybook'))
    ? fs.readdirSync(path.join(projectDir, '.storybook')).find(file => /^main\.(c|m)?(j|t)s$/.test(file))
    : undefined;
  const mainPath = mainFile ? path.posix.join(workingDirectory, '.storybook', mainFile) : undefined;
  const plan = planInit({
    ref: options.ref ?? `v${version}`,
    branch,
    workingDirectory,
    packageManager: detectPackageManager(projectDir, root),
    previews: options.previews,
    approvalLabel,
    main: mainPath ? { path: mainPath, source: fs.readFileSync(path.join(root, mainPath), 'utf8') } : undefined
  });

  for (const [file, content] of Object.entries(plan.files)) {
    const target = path.join(root, file);
    const exists = fs.existsSync(target);
    const isMain = file === plan.mainPath;
    if (exists && !isMain && !options.force) {
      log(`kept     ${file} (exists; --force overwrites it)`);
      continue;
    }
    if (options.dryRun) {
      log(`would ${exists ? 'update' : 'write'} ${file}\n${content}`);
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    log(`${exists ? 'updated ' : 'wrote   '} ${file}`);
  }

  let labelCreated = false;
  if (options.label && !options.dryRun) {
    try {
      execFileSync(
        'gh',
        [
          'label',
          'create',
          approvalLabel,
          '--color',
          'FBCA04',
          '--description',
          'Accepts the visual changes of this pull request',
          '--force'
        ],
        {
          cwd: root,
          stdio: 'ignore'
        }
      );
      labelCreated = true;
      log(`created  label ${approvalLabel}`);
    } catch {
      log(`Could not create the "${approvalLabel}" label with the GitHub CLI.`);
    }
  }

  const steps = [
    `Install the addon in ${workingDirectory}: npm install --save-dev ${ADDON}`,
    plan.addonRegistered
      ? null
      : `Add '${ADDON}' to the addons of ${mainPath ?? '.storybook/main.js'} (no addons array was found).`,
    labelCreated ? null : `Create the "${approvalLabel}" label: gh label create ${approvalLabel}`,
    options.previews ? 'Settings → Pages: deploy from the gh-pages branch (it is created by the first preview).' : null,
    'Optional: a STORYBOOK_PREVIEW_PASSCODE_HASH secret puts previews and reports behind a passcode.',
    `Push to ${branch} once, so the baseline screenshots are cached.`,
    'Make "swiss-knife / visual" and "swiss-knife / accessibility" required status checks.',
    'While storybook-github-swiss-knife is private: in its Settings → Actions → Access, allow repositories owned by Archetipo95.'
  ].filter(Boolean);
  log(`\nNext steps:\n${steps.map((step, index) => `  ${index + 1}. ${step}`).join('\n')}`);
  return plan;
}
