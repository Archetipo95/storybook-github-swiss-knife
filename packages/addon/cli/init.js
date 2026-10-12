// `storybook-swiss-knife init`: the caller workflows, the configuration and the addon
// registration for a repository, then the steps only a person can do. Existing files are kept
// unless --force; nothing is installed.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { detectPackageManager, lockfileDirectory } from './package-manager.js';
import { parseSimpleYaml } from './simple-yaml.js';

export { detectPackageManager };

export const REPOSITORY = 'Archetipo95/storybook-github-swiss-knife';
export const ADDON = 'storybook-swiss-knife';

/**
 * The addon tarball attached to a release. The addon is not on npm yet, so the bare package name
 * would install whatever an unrelated package of that name holds.
 */
export const addonTarballUrl = version =>
  `https://github.com/${REPOSITORY}/releases/download/v${version}/${ADDON}-${version}.tgz`;

// The Storybook binary, never `<pm> storybook`: Yarn runs a package.json `storybook` script before
// a binary of that name, and `storybook init` adds one (`storybook dev -p 6006`). Yarn 2+ has
// `run -B` (binaries only); Yarn 1 installs node_modules/.bin, which npx runs.
const COMMANDS = {
  npm: { install: 'npm ci', build: 'npx storybook build', add: 'npm install --save-dev' },
  pnpm: {
    install: 'corepack pnpm install --frozen-lockfile',
    build: 'corepack pnpm exec storybook build',
    add: 'pnpm add --save-dev'
  },
  yarn: {
    install: 'corepack yarn install --immutable',
    build: 'corepack yarn run -B storybook build',
    add: 'yarn add --dev'
  },
  'yarn-classic': {
    install: 'yarn install --frozen-lockfile',
    build: 'npx --no-install storybook build',
    add: 'yarn add --dev'
  },
  bun: { install: 'bun install --frozen-lockfile', build: 'bunx storybook build', add: 'bun add --dev' }
};

/** The default Storybook build command for a package manager (`detectPackageManager`'s names). */
export const storybookBuildCommand = packageManager => COMMANDS[packageManager].build;

const ROOT_CONFIG = '.storybook/swiss-knife.json';
export const LEGACY_CONFIG = '.storybook-pages.yml';

const yamlString = value => `'${String(value).replaceAll("'", "''")}'`;

/**
 * The frozen install, run from `installDirectory` (relative to the working directory) when the
 * lockfile is there: a monorepo package without its own lockfile installs from the root's.
 */
const installCommand = ({ packageManager, installDirectory = '' }) =>
  installDirectory
    ? `(cd ${installDirectory} && ${COMMANDS[packageManager].install})`
    : COMMANDS[packageManager].install;

function visualWorkflow({ ref, branch, workingDirectory, packageManager, installDirectory }) {
  const withInputs = [
    workingDirectory === '.' ? null : `      working_directory: ${yamlString(workingDirectory)}`,
    installDirectory
      ? `      install_command: ${yamlString(installCommand({ packageManager, installDirectory }))}`
      : null
  ].filter(Boolean);
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
${withInputs.length ? `    with:\n${withInputs.join('\n')}\n` : ''}`;
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

function previewBuildWorkflow({ ref, workingDirectory, packageManager, installDirectory }) {
  const { build } = COMMANDS[packageManager];
  const install = installCommand({ packageManager, installDirectory });
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
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
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
      pull-requests: write
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
      pull-requests: write
`;

/** Adds the addon to the `addons` array of a Storybook main file; null when it cannot. */
export function registerAddon(source) {
  if (source.includes(`'${ADDON}'`) || source.includes(`"${ADDON}"`)) return source;
  // An empty array becomes ['storybook-swiss-knife']; in an array that spans several lines the
  // addon gets its own line, indented like the first entry, with the file's line ending.
  const withAddon = source.replace(
    /(addons\s*:\s*\[)(?:(?:[ \t]*(\r?\n))+([ \t]*))?(\s*\])?/,
    (match, open, newline, indent, close) => {
      if (close) return `${open}'${ADDON}']`;
      return newline ? `${match}'${ADDON}',${newline}${indent}` : `${match}'${ADDON}', `;
    }
  );
  return withAddon === source ? null : withAddon;
}

/**
 * Everything `init` would write, as { path: content } relative to the repository root.
 * @param {{ ref: string, branch: string, workingDirectory: string, packageManager: string,
 *   previews: boolean, approvalLabel: string, main?: { path: string, source: string } }} options
 */
export function planInit({
  ref,
  branch,
  workingDirectory,
  packageManager,
  installDirectory = '',
  previews,
  approvalLabel,
  main,
  pages = null
}) {
  const options = { ref, branch, workingDirectory, packageManager, installDirectory };
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
  const configFile = sections =>
    `${JSON.stringify(
      { $schema: `https://raw.githubusercontent.com/${REPOSITORY}/${ref}/schema/swiss-knife.schema.json`, ...sections },
      null,
      2
    )}\n`;
  const checks = {
    visual: { baselineBranches: [branch], approvalLabel },
    a11y: { blockingImpacts: ['critical', 'serious'] }
  };
  // The Pages settings are the repository's, read at its root: in a monorepo they go to the root's
  // configuration, the checks' to the project's.
  const pagesFile = pages ? ROOT_CONFIG : null;
  if (workingDirectory === '.') {
    files[ROOT_CONFIG] = configFile(pages ? { pages, ...checks } : checks);
  } else {
    files[path.posix.join(workingDirectory, ROOT_CONFIG)] = configFile(checks);
    if (pages) files[ROOT_CONFIG] = configFile({ pages });
  }
  const updated = main ? registerAddon(main.source) : null;
  if (main && updated && updated !== main.source) files[main.path] = updated;
  return { files, addonRegistered: Boolean(main && updated), mainPath: main?.path ?? null, pagesFile };
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
  const packageManager = detectPackageManager(projectDir, root);
  const lockDir = lockfileDirectory(projectDir, root);
  const installDirectory =
    lockDir && lockDir !== projectDir ? path.relative(projectDir, lockDir).split(path.sep).join('/') : '';
  // The legacy Pages configuration moves under "pages" in the root's .storybook/swiss-knife.json.
  const legacyPath = path.join(root, LEGACY_CONFIG);
  let pages = null;
  let legacyProblem = '';
  if (fs.existsSync(legacyPath)) {
    try {
      const parsed = parseSimpleYaml(fs.readFileSync(legacyPath, 'utf8'));
      if (Object.keys(parsed).length > 0) pages = parsed;
    } catch (error) {
      legacyProblem = error.message;
    }
  }
  const plan = planInit({
    pages,
    ref: options.ref ?? `v${version}`,
    branch,
    workingDirectory,
    packageManager,
    installDirectory,
    previews: options.previews,
    approvalLabel,
    main: mainPath ? { path: mainPath, source: fs.readFileSync(path.join(root, mainPath), 'utf8') } : undefined
  });

  const written = new Set();
  for (const [file, content] of Object.entries(plan.files)) {
    const target = path.join(root, file);
    const exists = fs.existsSync(target);
    const isMain = file === plan.mainPath;
    // The configuration holds the project's own settings: never replaced, even with --force.
    if (exists && file.endsWith('.storybook/swiss-knife.json')) {
      log(`kept     ${file} (the configuration is never overwritten)`);
      continue;
    }
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
    written.add(file);
    log(`${exists ? 'updated ' : 'wrote   '} ${file}`);
  }

  let labelCreated = false;
  if (options.label && !options.dryRun) {
    const gh = args => execFileSync('gh', args, { cwd: root, stdio: 'ignore' });
    try {
      gh(['api', `repos/{owner}/{repo}/labels/${encodeURIComponent(approvalLabel)}`]);
      labelCreated = true;
      log(`kept     label ${approvalLabel} (exists)`);
    } catch {
      try {
        gh([
          'label',
          'create',
          approvalLabel,
          '--color',
          'FBCA04',
          '--description',
          'Accepts the visual changes of this pull request'
        ]);
        labelCreated = true;
        log(`created  label ${approvalLabel}`);
      } catch {
        log(`Could not create the "${approvalLabel}" label with the GitHub CLI.`);
      }
    }
  }

  const legacyStep = (() => {
    if (legacyProblem)
      return `Move the settings of ${LEGACY_CONFIG} under "pages" in ${ROOT_CONFIG} (${legacyProblem}).`;
    if (!plan.pagesFile) return null;
    if (written.has(plan.pagesFile)) {
      return `The settings of ${LEGACY_CONFIG} are now under "pages" in ${plan.pagesFile}: delete ${LEGACY_CONFIG}.`;
    }
    return `Move the settings of ${LEGACY_CONFIG} under "pages" in ${plan.pagesFile}, which init left as it was.`;
  })();
  const steps = [
    `Install the addon in ${workingDirectory}: ${COMMANDS[packageManager].add} ${addonTarballUrl(version)}`,
    legacyStep,
    plan.addonRegistered
      ? null
      : `Add '${ADDON}' to the addons of ${mainPath ?? '.storybook/main.js'} (no addons array was found).`,
    labelCreated ? null : `Create the "${approvalLabel}" label: gh label create ${approvalLabel}`,
    options.previews ? 'Settings → Pages: deploy from the gh-pages branch (it is created by the first preview).' : null,
    'Optional: a STORYBOOK_PREVIEW_PASSCODE_HASH secret puts previews and reports behind a passcode.',
    `Push to ${branch} once, so the baseline screenshots are cached.`,
    'Make "swiss-knife / visual" and "swiss-knife / accessibility" required status checks.'
  ].filter(Boolean);
  log(`\nNext steps:\n${steps.map((step, index) => `  ${index + 1}. ${step}`).join('\n')}`);
  return plan;
}
