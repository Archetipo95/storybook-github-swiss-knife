// Assembles the results bundle of an untrusted visual run, after `playwright merge-reports` has
// written the HTML report and visual-results.json:
//
//   <bundle>/meta.json                  run identity and shard counts (checked by the gate)
//   <bundle>/results/visual-results.json
//   <bundle>/results/a11y/<story>.json  axe reports
//   <bundle>/visual/                    HTML report, published to <preview_root>/pr-<N>/visual/
//   <bundle>/visual/gallery/            base/pr/diff images and manifest.json (Storybook panel)
//
// Environment: BUNDLE_DIR, BLOB_DIR, GALLERY_DIR, A11Y_DIR, PR_NUMBER, HEAD_SHA, BASE_SHA,
// SHARDS_EXPECTED, GITHUB_RUN_ID, GITHUB_SERVER_URL, GITHUB_REPOSITORY.

import fs from 'node:fs';
import path from 'node:path';

import { buildGalleryManifest } from './manifest.js';
import { readVisualResults } from './results.js';

/** Number of shard blob reports (report-<index>-<total>.zip) in a directory. */
export function countShardReports(blobDir) {
  if (!blobDir || !fs.existsSync(blobDir)) return 0;
  return new Set(
    fs
      .readdirSync(blobDir, { recursive: true })
      .map(file => /report-(\d+)-\d+\.zip$/.exec(String(file))?.[1])
      .filter(Boolean)
  ).size;
}

/** @param {NodeJS.ProcessEnv} env */
export function assembleBundle(env) {
  const bundleDir = path.resolve(env.BUNDLE_DIR);
  const resultsPath = path.join(bundleDir, 'results', 'visual-results.json');
  const galleryTarget = path.join(bundleDir, 'visual', 'gallery');
  fs.mkdirSync(galleryTarget, { recursive: true });
  if (env.GALLERY_DIR && fs.existsSync(env.GALLERY_DIR)) fs.cpSync(env.GALLERY_DIR, galleryTarget, { recursive: true });
  if (env.A11Y_DIR && fs.existsSync(env.A11Y_DIR)) {
    fs.cpSync(env.A11Y_DIR, path.join(bundleDir, 'results', 'a11y'), { recursive: true });
  }

  const runUrl =
    env.GITHUB_RUN_ID && `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  if (fs.existsSync(resultsPath)) {
    const manifest = buildGalleryManifest(readVisualResults(resultsPath), {
      hasImage: (id, name) => fs.existsSync(path.join(galleryTarget, id, `${name}.png`)),
      headSha: env.HEAD_SHA,
      runId: env.GITHUB_RUN_ID,
      runUrl,
      approved: false
    });
    fs.writeFileSync(path.join(galleryTarget, 'manifest.json'), JSON.stringify(manifest));
  }

  const meta = {
    version: 1,
    prNumber: Number(env.PR_NUMBER) || 0,
    headSha: env.HEAD_SHA,
    baseSha: env.BASE_SHA,
    shardsExpected: Number(env.SHARDS_EXPECTED),
    shardsReported: countShardReports(env.BLOB_DIR),
    runId: env.GITHUB_RUN_ID,
    runUrl
  };
  fs.writeFileSync(path.join(bundleDir, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const meta = assembleBundle(process.env);
  console.log(`Bundle: ${meta.shardsReported}/${meta.shardsExpected} shards reported for PR #${meta.prNumber}.`);
}
