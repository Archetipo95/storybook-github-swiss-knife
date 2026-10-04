// Trusted visual + accessibility gate, run by the `visual-gate` workflow after an untrusted
// visual run completes. It reads the configuration from the default-branch checkout, the a11y
// baseline from the pull request head (as data, through the API), the run's results bundle,
// and posts the two required check runs on the head commit. It never runs pull request code.
//
// Environment: GITHUB_TOKEN, REPOSITORY, RUN_ID, PROJECT_DIR (trusted checkout of the project
// directory), WORKING_DIRECTORY (that directory, relative to the repository root), BUNDLE_DIR
// (downloaded results bundle, may be missing), PAGES_REPO (optional checkout of the Pages
// branch), PASSCODE_HASH (optional), GITHUB_STEP_SUMMARY.

import fs from 'node:fs';
import path from 'node:path';

import { resolveConfiguration } from '../config.js';
import { injectAuthGate } from '../inject-auth-gate.js';
import { publishDirectory } from '../publish-directory.js';
import { loadSwissKnifeConfig } from '../swiss-knife-config.js';
import { evaluateApproval } from './approval.js';
import { evaluateGate } from './core.js';

export const VISUAL_ARTIFACT_PATTERN = /^swiss-knife-visual-pr-(\d+)-run-(\d+)$/;

/** @param {string} token */
export function githubClient(token) {
  return async function request(apiPath, { method = 'GET', body, raw = false } = {}) {
    const response = await fetch(`https://api.github.com${apiPath}`, {
      method,
      headers: {
        authorization: `token ${token}`,
        accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
        'content-type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(
        `GitHub API ${method} ${apiPath} failed (${response.status}): ${await response.text().catch(() => '')}`
      );
    }
    if (response.status === 204) return null;
    return raw ? response.text() : response.json();
  };
}

async function paginate(request, apiPath, key) {
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    const separator = apiPath.includes('?') ? '&' : '?';
    const data = await request(`${apiPath}${separator}per_page=100&page=${page}`);
    const list = key ? (data?.[key] ?? []) : (data ?? []);
    items.push(...list);
    if (list.length < 100) break;
  }
  return items;
}

const readJson = file => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null);

/** @param {string | undefined} dir */
export function readBundle(dir) {
  if (!dir || !fs.existsSync(path.join(dir, 'meta.json'))) return null;
  const a11yDir = path.join(dir, 'results', 'a11y');
  return {
    meta: readJson(path.join(dir, 'meta.json')),
    results: readJson(path.join(dir, 'results', 'visual-results.json')),
    a11yReports: fs.existsSync(a11yDir)
      ? fs
          .readdirSync(a11yDir)
          .filter(file => file.endsWith('.json'))
          .map(file => readJson(path.join(a11yDir, file)))
      : []
  };
}

/**
 * The pull request a visual run belongs to: the number comes from the artifact name the run
 * uploaded, and is accepted only if GitHub confirms that pull request has this head repository.
 */
async function resolvePullRequest(request, repository, run) {
  const artifacts = await paginate(request, `/repos/${repository}/actions/runs/${run.id}/artifacts`, 'artifacts');
  const numbers = new Set(
    artifacts
      .map(artifact => VISUAL_ARTIFACT_PATTERN.exec(artifact.name ?? ''))
      .filter(match => match && Number(match[2]) === run.id)
      .map(match => Number(match[1]))
  );
  if (numbers.size !== 1) {
    return { pr: null, found: numbers.size, problem: 'The visual run uploaded no results for a single pull request.' };
  }
  const [number] = numbers;
  const pr = await request(`/repos/${repository}/pulls/${number}`);
  if (!pr || pr.head?.repo?.full_name !== run.head_repository?.full_name) {
    return { pr: null, found: 1, problem: `Pull request #${number} does not match the run's head repository.` };
  }
  return { pr, found: 1, problem: null };
}

/**
 * @param {{ env: NodeJS.ProcessEnv, request: ReturnType<typeof githubClient>,
 *   publish?: typeof publishDirectory, log?: (line: string) => void }} options
 */
export async function runVisualGate({ env, request, publish = publishDirectory, log = console.log }) {
  const repository = env.REPOSITORY;
  const runId = Number(env.RUN_ID);
  const projectDir = path.resolve(env.PROJECT_DIR || process.cwd());
  const workingDirectory = path.posix.normalize(env.WORKING_DIRECTORY || '.');
  if (workingDirectory.startsWith('..') || path.posix.isAbsolute(workingDirectory)) {
    throw new Error(`WORKING_DIRECTORY must stay inside the repository, got "${env.WORKING_DIRECTORY}"`);
  }
  const run = await request(`/repos/${repository}/actions/runs/${runId}`);
  if (!run) throw new Error(`Workflow run ${runId} not found`);
  const headSha = run.head_sha;

  const config = loadSwissKnifeConfig({ cwd: projectDir });
  const { pr, found, problem: prProblem } = await resolvePullRequest(request, repository, run);
  // A successful run without results did nothing on purpose (an unrelated label event): keep
  // the checks already posted for this commit. A commit without swiss-knife checks yet gets
  // failing ones, so editing the caller to skip the capture cannot produce a green PR.
  if (found === 0 && run.conclusion === 'success') {
    const existing = await request(
      `/repos/${repository}/commits/${headSha}/check-runs?check_name=${encodeURIComponent('swiss-knife / visual')}`
    );
    if ((existing?.total_count ?? 0) > 0) {
      log('The visual run produced no results to gate; this commit is already gated, so the checks stay.');
      return { skipped: true };
    }
  }
  const prNumber = pr?.number ?? 0;
  const isFork = Boolean(pr && pr.head.repo.full_name !== repository);
  const isCurrentHead = Boolean(pr && pr.state === 'open' && pr.head.sha === headSha);

  let baseline = {};
  if (pr) {
    const baselinePath = path.posix.join(workingDirectory, config.a11y.baseline);
    const content = await request(
      `/repos/${repository}/contents/${baselinePath.split('/').map(encodeURIComponent).join('/')}?ref=${headSha}`,
      { raw: true }
    );
    if (content) {
      try {
        baseline = JSON.parse(content);
      } catch {
        baseline = {};
        log(`::warning::${config.a11y.baseline} at ${headSha} is not valid JSON; using an empty baseline.`);
      }
    }
  }

  let approval = { approved: false, stale: false };
  if (pr) {
    const labelName = config.visual.approvalLabel;
    const [events, runs] = await Promise.all([
      paginate(request, `/repos/${repository}/issues/${prNumber}/events`),
      paginate(
        request,
        `/repos/${repository}/actions/workflows/${run.workflow_id}/runs?head_sha=${headSha}`,
        'workflow_runs'
      )
    ]);
    approval = evaluateApproval({
      labelName,
      labelPresent: (pr.labels ?? []).some(label => label.name === labelName),
      labelEvents: events,
      headRunTimes: runs.map(item => item.created_at)
    });
  }

  const pages = (() => {
    const previous = process.cwd();
    process.chdir(projectDir);
    try {
      return resolveConfiguration({ inputs: { site_url: env.SITE_URL, base_path: env.BASE_PATH } });
    } finally {
      process.chdir(previous);
    }
  })();
  const [owner, repoName] = repository.split('/');
  const siteUrl = (pages.site_url || `https://${owner}.github.io/${repoName}`).replace(/\/$/, '');
  const visualDir = [pages.preview_root, `pr-${prNumber}`, 'visual'].filter(Boolean).join('/');
  const canPublish = Boolean(pr && !isFork && isCurrentHead && env.PAGES_REPO);
  const reportUrl = canPublish ? `${siteUrl}/${visualDir}/` : '';

  const bundle = readBundle(env.BUNDLE_DIR);
  const runProblem = run.conclusion === 'cancelled' ? 'The visual run was cancelled.' : bundle ? null : prProblem;
  const result = evaluateGate({
    bundle,
    config,
    baseline,
    approved: approval.approved,
    headSha,
    prNumber,
    reportUrl,
    problem: runProblem ?? undefined
  });

  for (const check of [result.visual, result.a11y]) {
    await request(`/repos/${repository}/check-runs`, {
      method: 'POST',
      body: {
        name: check.name,
        head_sha: headSha,
        status: 'completed',
        conclusion: check.conclusion,
        details_url: run.html_url,
        output: { title: check.title, summary: check.summary }
      }
    });
    log(`${check.name}: ${check.conclusion} (${check.title})`);
  }

  if (pr && approval.stale && result.changed > 0 && isCurrentHead) {
    await request(`/repos/${repository}/issues/${prNumber}/labels/${encodeURIComponent(config.visual.approvalLabel)}`, {
      method: 'DELETE'
    });
    log(`Withdrew the stale "${config.visual.approvalLabel}" label: it was added before the current commit.`);
  }

  let published = false;
  const reportDir = env.BUNDLE_DIR ? path.join(env.BUNDLE_DIR, 'visual') : '';
  if (canPublish && reportDir && fs.existsSync(path.join(reportDir, 'index.html'))) {
    const manifestPath = path.join(reportDir, 'gallery', 'manifest.json');
    const manifest = readJson(manifestPath);
    if (manifest) fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, approved: result.approvedForManifest }));
    if (env.PASSCODE_HASH && pages.enable_passcode_gate !== false) {
      await injectAuthGate(reportDir, {
        passcodeHash: env.PASSCODE_HASH,
        sessionHours: pages.passcode_session_hours ?? 24
      });
    }
    await publish({
      repo: env.PAGES_REPO,
      source: reportDir,
      branch: pages.pages_branch,
      targetDirectory: visualDir,
      commitMessage: `Publish visual report for PR #${prNumber}`,
      token: env.GITHUB_TOKEN,
      repository
    });
    published = true;
    log(`Published the visual report to ${reportUrl}`);
  }

  if (env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, `${result.visual.summary}\n\n${result.a11y.summary}\n`);
  }
  return { ...result, prNumber, isFork, approval, published, reportUrl };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  runVisualGate({ env: process.env, request: githubClient(process.env.GITHUB_TOKEN) }).catch(error => {
    console.error(`::error::${error.message}`);
    process.exit(1);
  });
}
