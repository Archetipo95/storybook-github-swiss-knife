import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateRelativeDirectory } from './config.js';

export const PREVIEW_METADATA_SCHEMA_VERSION = 1;
export const PREVIEW_METADATA_FILENAME = 'preview-metadata.json';
export const PREVIEW_CONTENT_DIRNAME = 'storybook';

// Strict, shell/path-safe patterns. Every field that later flows into a git
// command, filesystem path, or API URL is validated against one of these
// before it is trusted, regardless of whether it originated from build-time
// (potentially PR-controlled) metadata or from the trusted workflow_run context.
const SHA_PATTERN = /^[0-9a-f]{40}$/;
const REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?\/[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

function assertPositiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${field} must be a positive integer, got "${value}"`);
  }
  return number;
}

function assertPattern(value, pattern, field) {
  if (typeof value !== 'string' || value === '' || !pattern.test(value)) {
    throw new Error(`${field} "${value}" is invalid or unsafe`);
  }
  return value;
}

export function digestDirectory(directory) {
  const hash = crypto.createHash('sha256');
  const files = [];
  function visit(current, relative = '') {
    for (const entry of fs.readdirSync(current).sort()) {
      const full = path.join(current, entry);
      const rel = path.posix.join(relative, entry);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error(`Preview content must not contain symlinks: "${rel}"`);
      if (stat.isDirectory()) visit(full, rel);
      else if (stat.isFile()) files.push([rel, fs.readFileSync(full)]);
      else throw new Error(`Preview content contains unsupported entry: "${rel}"`);
    }
  }
  visit(directory);
  for (const [relative, content] of files) {
    hash.update(relative);
    hash.update('\0');
    hash.update(content);
    hash.update('\0');
  }
  return hash.digest('hex');
}

/**
 * Computes the safe, configurable preview directory for a pull request.
 * Always relative, always validated, never escapes the Pages branch root
 * or collides with `.git`/`.github`.
 */
export function resolvePreviewTarget({ previewRoot = 'pr-preview', prNumber }) {
  const number = assertPositiveInteger(prNumber, 'prNumber');
  validateRelativeDirectory(previewRoot, 'preview_root', { allowEmpty: true });
  const normalizedRoot = previewRoot === '.' || previewRoot === './' ? '' : previewRoot;
  const target = normalizedRoot ? path.posix.join(normalizedRoot, `pr-${number}`) : `pr-${number}`;
  validateRelativeDirectory(target, 'preview_target');
  return target;
}

/**
 * Builds the metadata bundled with every PR preview build artifact. Called
 * only from the untrusted `pull_request` build workflow. Every trusted
 * consumer (the publisher) re-validates this payload against its own
 * independently-observed context before acting on it.
 */
export function buildPreviewMetadata({
  repository,
  runId,
  runAttempt = 1,
  prNumber,
  baseRef,
  headRepository,
  headSha,
  artifactName,
  contentDigest,
  previewRoot = 'pr-preview',
  eventName = 'pull_request'
}) {
  assertPattern(repository, REPO_PATTERN, 'repository');
  assertPattern(headRepository, REPO_PATTERN, 'headRepository');
  assertPattern(headSha, SHA_PATTERN, 'headSha');
  assertPattern(baseRef, REF_PATTERN, 'baseRef');
  assertPattern(artifactName, ARTIFACT_NAME_PATTERN, 'artifactName');
  assertPattern(contentDigest, DIGEST_PATTERN, 'contentDigest');
  const number = assertPositiveInteger(prNumber, 'prNumber');
  const runIdNumber = assertPositiveInteger(runId, 'runId');
  const runAttemptNumber = assertPositiveInteger(runAttempt, 'runAttempt');
  if (typeof eventName !== 'string' || eventName === '') {
    throw new Error(`eventName "${eventName}" is invalid`);
  }

  const isFork = headRepository !== repository;
  const target = isFork ? null : resolvePreviewTarget({ previewRoot, prNumber: number });

  return {
    schemaVersion: PREVIEW_METADATA_SCHEMA_VERSION,
    repository,
    runId: runIdNumber,
    runAttempt: runAttemptNumber,
    prNumber: number,
    baseRef,
    headRepository,
    headSha,
    artifactName,
    contentDigest,
    isFork,
    target,
    eventName,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Validates a metadata payload's shape and, when a trusted context is
 * supplied, cross-checks every field against it. Any mismatch throws -
 * this is the "strict provenance" gate the trusted publisher relies on
 * before it downloads artifact content or touches the Pages branch.
 */
export function validatePreviewMetadata(metadata, trustedContext) {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) {
    throw new Error('Preview metadata must be a non-null object');
  }
  if (metadata.schemaVersion !== PREVIEW_METADATA_SCHEMA_VERSION) {
    throw new Error(`Unsupported preview metadata schema version: ${metadata.schemaVersion}`);
  }

  assertPattern(metadata.repository, REPO_PATTERN, 'metadata.repository');
  assertPattern(metadata.headRepository, REPO_PATTERN, 'metadata.headRepository');
  assertPattern(metadata.headSha, SHA_PATTERN, 'metadata.headSha');
  assertPattern(metadata.baseRef, REF_PATTERN, 'metadata.baseRef');
  assertPattern(metadata.artifactName, ARTIFACT_NAME_PATTERN, 'metadata.artifactName');
  assertPattern(metadata.contentDigest, DIGEST_PATTERN, 'metadata.contentDigest');
  assertPositiveInteger(metadata.prNumber, 'metadata.prNumber');
  assertPositiveInteger(metadata.runId, 'metadata.runId');
  assertPositiveInteger(metadata.runAttempt, 'metadata.runAttempt');
  if (typeof metadata.isFork !== 'boolean') {
    throw new Error('metadata.isFork must be a boolean');
  }
  if (typeof metadata.eventName !== 'string' || metadata.eventName === '') {
    throw new Error('metadata.eventName must be a non-empty string');
  }

  const declaredIsFork = metadata.headRepository !== metadata.repository;
  if (declaredIsFork !== metadata.isFork) {
    throw new Error('metadata.isFork is inconsistent with metadata.headRepository/repository');
  }

  if (metadata.isFork) {
    if (metadata.target !== null) {
      throw new Error('metadata.target must be null for fork pull requests');
    }
  } else {
    validateRelativeDirectory(metadata.target, 'metadata.target');
  }

  if (trustedContext) {
    let expectedTarget = trustedContext.expectedTarget;
    if (
      expectedTarget === undefined &&
      !metadata.isFork &&
      trustedContext.previewRoot !== undefined &&
      trustedContext.prNumber !== undefined
    ) {
      expectedTarget = resolvePreviewTarget({
        previewRoot: trustedContext.previewRoot,
        prNumber: trustedContext.prNumber
      });
    }

    const checks = [
      ['repository', trustedContext.repository, metadata.repository],
      ['runId', trustedContext.runId, metadata.runId],
      ['prNumber', trustedContext.prNumber, metadata.prNumber],
      ['headSha', trustedContext.headSha, metadata.headSha],
      ['headRepository', trustedContext.headRepository, metadata.headRepository],
      ['baseRef', trustedContext.baseRef, metadata.baseRef],
      ['artifactName', trustedContext.artifactName, metadata.artifactName],
      ['contentDigest', trustedContext.contentDigest, metadata.contentDigest],
      ['target', expectedTarget, metadata.target]
    ];
    const mismatches = checks
      .filter(([, expected]) => expected !== undefined)
      .filter(([, expected, actual]) => normalize(expected) !== normalize(actual))
      .map(([field]) => field);
    if (mismatches.length > 0) {
      throw new Error(
        `Preview metadata does not match trusted workflow_run context for field(s): ${mismatches.join(', ')}`
      );
    }
  }

  return true;
}

function normalize(value) {
  return typeof value === 'number' || typeof value === 'string' ? String(value) : value;
}

/**
 * Decides what the trusted publisher should do for a validated metadata
 * payload: publish, or skip (fork / stale run). Throws only for provenance
 * failures that indicate tampering or a broken invariant - never for the
 * expected "not a same-repo PR" or "no longer the current head" cases,
 * which are reported as an explicit skip so callers can log a clear status
 * without failing the job.
 */
export function decidePreviewAction({ metadata, trustedContext, currentHeadSha }) {
  validatePreviewMetadata(metadata, trustedContext);

  if (metadata.isFork) {
    return {
      action: 'skip-fork',
      reason:
        'Pull request head repository differs from the base repository; forked PRs never receive a published preview.'
    };
  }

  if (typeof currentHeadSha !== 'string' || !SHA_PATTERN.test(currentHeadSha)) {
    throw new Error(`currentHeadSha "${currentHeadSha}" is not a valid commit SHA`);
  }

  if (currentHeadSha !== metadata.headSha) {
    return {
      action: 'skip-stale',
      reason: `Pull request #${metadata.prNumber} head has moved from ${metadata.headSha} to ${currentHeadSha}; this completed run is stale and will not overwrite the current preview.`
    };
  }

  return { action: 'publish', reason: 'Same-repository pull request build matches the current head SHA.' };
}

if (process.argv[1] && process.argv[1].endsWith('preview-metadata.js')) {
  const [, , outputDir] = process.argv;
  if (!outputDir) {
    console.error('Usage: node preview-metadata.js <output-dir>');
    process.exit(1);
  }
  try {
    const metadata = buildPreviewMetadata({
      repository: process.env.REPOSITORY,
      runId: process.env.RUN_ID,
      runAttempt: process.env.RUN_ATTEMPT,
      prNumber: process.env.PR_NUMBER,
      baseRef: process.env.BASE_REF,
      headRepository: process.env.HEAD_REPOSITORY,
      headSha: process.env.HEAD_SHA,
      artifactName: process.env.ARTIFACT_NAME,
      contentDigest: digestDirectory(process.env.SOURCE_PATH),
      previewRoot: process.env.PREVIEW_ROOT !== undefined ? process.env.PREVIEW_ROOT : 'pr-preview',
      eventName: process.env.EVENT_NAME || 'pull_request'
    });

    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, PREVIEW_METADATA_FILENAME), `${JSON.stringify(metadata, null, 2)}\n`);

    const sourcePath = process.env.SOURCE_PATH;
    if (sourcePath) {
      fs.cpSync(sourcePath, path.join(outputDir, PREVIEW_CONTENT_DIRNAME), {
        recursive: true,
        preserveTimestamps: true
      });
    }

    console.log(
      `Preview metadata written for PR #${metadata.prNumber} (fork: ${metadata.isFork}, target: ${metadata.target ?? 'n/a'})`
    );

    const outputPath = process.env.GITHUB_OUTPUT;
    if (outputPath) {
      const lines = [
        `artifact_name=${metadata.artifactName}`,
        `content_digest=${metadata.contentDigest}`,
        `is_fork=${metadata.isFork}`,
        `target=${metadata.target ?? ''}`
      ];
      fs.appendFileSync(outputPath, `${lines.join('\n')}\n`);
    }

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      const summary = metadata.isFork
        ? `### Storybook preview\n\nPull request #${metadata.prNumber} is from a fork (\`${metadata.headRepository}\`). Preview publishing is **explicitly skipped** for forked pull requests; only a read-only build was executed.\n`
        : `### Storybook preview\n\nBuild succeeded for PR #${metadata.prNumber} at \`${metadata.headSha}\`. The trusted publisher will attempt to publish to \`${metadata.target}\` once this workflow run completes.\n`;
      fs.appendFileSync(summaryPath, summary);
    }
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
