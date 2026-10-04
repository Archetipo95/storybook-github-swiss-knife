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
import { buildMarker, pickPreviewComment, previewCommentMarkers, withChecksSection } from '../preview-comment.js';
import { loadSwissKnifeConfig } from '../swiss-knife-config.js';
import { evaluateApproval } from './approval.js';
import { evaluateGate, renderChecksComment } from './core.js';

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

/**
 * The bundle is produced by the pull request's run: refuse anything that could make the gate
 * write outside it (symlinks) or publish repository internals (.git, .github).
 * @param {string} dir
 * @returns {string | null} the first offending path, or null
 */
export function unsafeBundleEntry(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const full = path.join(entry.parentPath ?? entry.path, entry.name);
    if (entry.isSymbolicLink() || entry.name === '.git' || entry.name === '.github') return path.relative(dir, full);
  }
  return null;
}

/** Story/rule counts a pull request added to or raised in the a11y baseline. */
export function raisedBaselineEntries(base = {}, head = {}) {
  const raised = [];
  for (const [story, rules] of Object.entries(head.stories ?? {})) {
    for (const [rule, count] of Object.entries(rules ?? {})) {
      const before = base.stories?.[story]?.[rule] ?? 0;
      if (Number(count) > before) raised.push({ story, rule, before, after: Number(count) });
    }
  }
  return raised;
}

/** @param {string | undefined} dir */
export function readBundle(dir) {
  if (!dir || !fs.existsSync(path.join(dir, 'meta.json'))) return null;
  const unsafe = unsafeBundleEntry(dir);
  if (unsafe) return { unsafe };
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
 * When the caller names its visual workflow (CALLER_WORKFLOW) and the files that define the
 * capture (PROTECTED_PATHS), the run must come from that workflow and those files must be
 * unchanged from the default branch: a pull request cannot then replace the capture with one
 * that uploads made-up results.
 */
async function verifyCaller(request, { repository, run, env, baseSha }) {
  const caller = String(env.CALLER_WORKFLOW || '').trim();
  if (caller && run.path !== caller) return `The run came from ${run.path}, not the visual workflow ${caller}.`;
  const protectedPaths = String(env.PROTECTED_PATHS || '')
    .split(/\r?\n|,/)
    .map(file => file.trim())
    .filter(Boolean);
  if (caller) protectedPaths.push(caller);
  // Compared with the pull request's base (the branch it merges into); the default branch when
  // the pull request is unknown.
  const reference =
    baseSha || (protectedPaths.length > 0 ? (await request(`/repos/${repository}`)).default_branch : '');
  for (const file of new Set(protectedPaths)) {
    const encoded = file.split('/').map(encodeURIComponent).join('/');
    const [atHead, atDefault] = await Promise.all([
      request(`/repos/${repository}/contents/${encoded}?ref=${run.head_sha}`, { raw: true }),
      request(`/repos/${repository}/contents/${encoded}?ref=${encodeURIComponent(reference)}`, { raw: true })
    ]);
    if (atHead !== atDefault) {
      return `${file} differs from the base branch in this pull request, so its visual results cannot be trusted. Merge the workflow change separately first.`;
    }
  }
  return null;
}

/**
 * Sets the gate's block in the pull request's preview comment, creating the comment when the
 * preview has not posted one yet (the preview publisher keeps the block when it rewrites it).
 */
async function upsertChecksComment(request, { repository, prNumber, markdown }) {
  const comments = await paginate(request, `/repos/${repository}/issues/${prNumber}/comments`);
  const existing = pickPreviewComment(comments, previewCommentMarkers(prNumber));
  if (existing) {
    const body = withChecksSection(existing.body, markdown);
    if (body !== existing.body) {
      await request(`/repos/${repository}/issues/comments/${existing.id}`, { method: 'PATCH', body: { body } });
    }
    return existing.id;
  }
  const created = await request(`/repos/${repository}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: { body: withChecksSection(buildMarker(prNumber), markdown) }
  });
  return created?.id;
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
  const callerProblem = await verifyCaller(request, { repository, run, env, baseSha: pr?.base?.sha });

  const baselinePath = path.posix.join(workingDirectory, config.a11y.baseline);
  const readBaseline = async ref => {
    const content = await request(
      `/repos/${repository}/contents/${baselinePath.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`,
      { raw: true }
    );
    if (!content) return {};
    try {
      return JSON.parse(content);
    } catch {
      log(`::warning::${config.a11y.baseline} at ${ref} is not valid JSON; using an empty baseline.`);
      return {};
    }
  };
  // The baseline comes from the pull request (its changes are reviewed with the code); entries it
  // raises over the base branch are listed in the check, so they cannot slip by unnoticed.
  const baseline = pr ? await readBaseline(headSha) : {};
  const raised = pr && pr.base?.sha ? raisedBaselineEntries(await readBaseline(pr.base.sha), baseline) : [];

  let approval = { approved: false, stale: false };
  // Approval is read only from the pull request whose head is this very commit.
  if (pr && pr.head.sha === headSha) {
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

  const read = readBundle(env.BUNDLE_DIR);
  const bundle = read?.unsafe ? null : read;
  const runProblem =
    callerProblem ??
    (read?.unsafe ? `The results bundle contains ${read.unsafe}, which is not allowed.` : null) ??
    (run.conclusion !== 'success' ? `The visual run ended with "${run.conclusion}".` : null) ??
    (bundle ? null : prProblem);
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

  if (raised.length > 0 && result.a11y.conclusion !== 'neutral') {
    const inline = value => `\`${String(value).replace(/\s+/g, ' ').replaceAll('`', "'").slice(0, 200)}\``;
    result.a11y.summary += `\n\n### Baseline raised in this pull request\n\nThese known violations were added to or raised in \`${config.a11y.baseline}\`; review them like code.\n\n${raised
      .slice(0, 100)
      .map(({ story, rule, before, after }) => `- ${inline(story)}: ${inline(rule)} ${before} → ${after}`)
      .join('\n')}\n`;
  }

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

  // Results for an older commit would overwrite the current ones.
  if (pr && isCurrentHead && config.visual.prComment) {
    try {
      await upsertChecksComment(request, {
        repository,
        prNumber,
        markdown: renderChecksComment(result, { headSha, reportUrl, runUrl: run.html_url })
      });
    } catch (error) {
      log(`::warning::The pull request comment was not updated: ${error.message}`);
    }
  }

  if (pr && approval.stale && result.changed > 0 && isCurrentHead) {
    await request(`/repos/${repository}/issues/${prNumber}/labels/${encodeURIComponent(config.visual.approvalLabel)}`, {
      method: 'DELETE'
    });
    log(`Withdrew the stale "${config.visual.approvalLabel}" label: it was added before the current commit.`);
  }

  let published = false;
  const reportDir = bundle && env.BUNDLE_DIR ? path.join(env.BUNDLE_DIR, 'visual') : '';
  if (canPublish && !runProblem && reportDir && fs.existsSync(path.join(reportDir, 'index.html'))) {
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
