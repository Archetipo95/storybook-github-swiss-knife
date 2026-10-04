import { evaluateA11yReports, renderA11ySummary } from '../a11y/report.js';
import { evaluateVisualGate, renderVisualSummary } from '../visual/gate.js';
import { classifyVisualResults } from '../visual/results.js';

export const VISUAL_CHECK = 'swiss-knife / visual';
export const A11Y_CHECK = 'swiss-knife / accessibility';
// GitHub truncates check run summaries above 65535 characters.
const MAX_SUMMARY = 60000;

const truncate = text =>
  text.length > MAX_SUMMARY ? `${text.slice(0, MAX_SUMMARY)}\n\n_Summary truncated; see the full report._` : text;

/**
 * Validates the bundle's meta.json against what the trusted side expects.
 * @param {any} meta
 * @param {{ headSha: string, prNumber: number }} expected
 */
export function checkBundleMeta(meta, { headSha, prNumber }) {
  if (!meta || meta.version !== 1) return 'The results bundle has no valid meta.json.';
  if (meta.headSha !== headSha) return `The results are for ${meta.headSha}, not the pull request head ${headSha}.`;
  if (Number(meta.prNumber) !== Number(prNumber)) return `The results are for PR ${meta.prNumber}, not ${prNumber}.`;
  if (!Number.isInteger(meta.shardsExpected) || meta.shardsExpected < 1) return 'meta.json has no shard count.';
  return null;
}

/**
 * Both required checks, computed from the run's bundle and the trusted configuration.
 * @param {{ bundle: null | { meta: any, results: any, a11yReports: any[] }, config: any, baseline: any,
 *   approved: boolean, headSha: string, prNumber: number, reportUrl?: string, problem?: string }} input
 */
export function evaluateGate({ bundle, config, baseline, approved, headSha, prNumber, reportUrl = '', problem }) {
  const missing =
    problem ?? (bundle ? checkBundleMeta(bundle.meta, { headSha, prNumber }) : 'The visual run produced no results.');
  if (missing) {
    const failure = name => ({
      name,
      conclusion: 'failure',
      title: 'No usable results',
      summary: `:x: ${missing}\n\nRe-run the visual workflow for this commit.`
    });
    return { visual: failure(VISUAL_CHECK), a11y: failure(A11Y_CHECK), approvedForManifest: false, changed: 0 };
  }

  const incomplete = !(bundle.meta.shardsReported >= bundle.meta.shardsExpected);
  const results = classifyVisualResults(bundle.results ?? { suites: [] });
  const gate = evaluateVisualGate(results, { approved, incomplete });
  const visual = {
    name: VISUAL_CHECK,
    conclusion: gate.blocking ? 'failure' : 'success',
    title: {
      incomplete: 'Incomplete run',
      interaction: 'Interaction tests failed',
      error: 'Stories failed to render',
      changed: (() => {
        const count = gate.counts.changed + gate.counts.removed;
        return `${count} visual change${count === 1 ? '' : 's'} to review`;
      })(),
      approved: 'Visual changes approved',
      clean: 'No visual changes'
    }[gate.reason],
    summary: truncate(
      renderVisualSummary(results, { approved, incomplete, approvalLabel: config.visual.approvalLabel, reportUrl })
    )
  };

  let a11y;
  if (!config.a11y.enabled) {
    a11y = {
      name: A11Y_CHECK,
      conclusion: 'neutral',
      title: 'Accessibility scan disabled',
      summary: 'Disabled by `a11y.enabled` in the configuration.'
    };
  } else {
    const evaluation = evaluateA11yReports(bundle.a11yReports ?? [], {
      baseline,
      enforcedRules: config.a11y.enforcedRules,
      blockingImpacts: config.a11y.blockingImpacts
    });
    const blocking = incomplete || evaluation.blocking.length > 0;
    a11y = {
      name: A11Y_CHECK,
      conclusion: blocking ? 'failure' : 'success',
      title: incomplete
        ? 'Incomplete run'
        : evaluation.blocking.length > 0
          ? `${evaluation.blocking.length} new violation${evaluation.blocking.length === 1 ? '' : 's'}`
          : 'No new violations',
      summary: truncate(
        `${incomplete ? ':x: Some screenshot shards did not finish, so the scan is incomplete.\n\n' : ''}${renderA11ySummary(
          evaluation,
          {
            baselinePath: config.a11y.baseline,
            blockingImpacts: config.a11y.blockingImpacts
          }
        )}`
      )
    };
  }
  return { visual, a11y, approvedForManifest: approved, changed: gate.counts.changed + gate.counts.removed };
}
