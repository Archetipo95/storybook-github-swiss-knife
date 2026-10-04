import { firstErrorLine } from './results.js';

/**
 * Decides whether visual results block the pull request. Interaction failures, render errors
 * and incomplete runs always block; changed screenshots block unless approved.
 * @param {ReturnType<import('./results.js').classifyVisualResults>} results
 * @param {{ approved?: boolean, incomplete?: boolean }} options
 */
export function evaluateVisualGate(results, { approved = false, incomplete = false } = {}) {
  const { interactions, changed, broken, added, flaky, unchanged } = results;
  const skipped = results.skipped ?? [];
  const removed = results.removed ?? [];
  const runErrors = results.runErrors ?? [];
  const reviewable = changed.length + removed.length;
  const errors = broken.length + runErrors.length;
  const blocking = incomplete || interactions.length > 0 || errors > 0 || (reviewable > 0 && !approved);
  const reason = incomplete
    ? 'incomplete'
    : interactions.length > 0
      ? 'interaction'
      : errors > 0
        ? 'error'
        : reviewable > 0
          ? approved
            ? 'approved'
            : 'changed'
          : 'clean';
  return {
    blocking,
    reason,
    counts: {
      changed: changed.length,
      removed: removed.length,
      new: added.length,
      interactions: interactions.length,
      errors,
      flaky: flaky.length,
      skipped: skipped.length,
      unchanged: unchanged.length
    }
  };
}

const STATUS = {
  incomplete: () => ':x: Some screenshot shards did not finish, so this report is incomplete.',
  interaction: () => ':x: Some interaction tests (play functions) failed.',
  error: () => ':x: Some stories failed to render, or the runner failed.',
  changed: label =>
    `:warning: Visual changes detected. Review them, then add the \`${label}\` label to accept (again after every push that changes them).`,
  approved: label => `:white_check_mark: Visual changes approved with the \`${label}\` label.`,
  clean: () => ':white_check_mark: No visual changes.'
};

// Titles and errors come from the pull request's run: keep them on one line inside inline code,
// so they cannot add markdown (links, headings, fake status lines) to the check summary.
const escapeCode = text => String(text).replace(/\s+/g, ' ').replaceAll('`', "'").slice(0, 300);

function list(title, items, detailOf = () => '') {
  if (items.length === 0) return '';
  const lines = items.map(test => `- \`${escapeCode(test.title)}\`${detailOf(test)}`).join('\n');
  return `<details><summary>${title} (${items.length})</summary>\n\n${lines}\n\n</details>\n`;
}

/**
 * Markdown for the job summary and the PR comment.
 * @param {ReturnType<import('./results.js').classifyVisualResults>} results
 * @param {{ approved?: boolean, incomplete?: boolean, approvalLabel?: string, reportUrl?: string }} options
 */
export function renderVisualSummary(
  results,
  { approved = false, incomplete = false, approvalLabel = 'visual-approved', reportUrl = '' } = {}
) {
  const { reason, counts } = evaluateVisualGate(results, { approved, incomplete });
  const interactionError = test => {
    const line = firstErrorLine(test);
    return line ? `: ${escapeCode(line)}` : '';
  };
  return `## Visual regression

${STATUS[reason](approvalLabel)}

| Changed | Removed | New | Interaction failures | Errors | Flaky | Skipped | Unchanged |
| --- | --- | --- | --- | --- | --- | --- | --- |
| ${counts.changed} | ${counts.removed} | ${counts.new} | ${counts.interactions} | ${counts.errors} | ${counts.flaky} | ${counts.skipped} | ${counts.unchanged} |

${list(
  'Runner errors',
  (results.runErrors ?? []).map(message => ({ title: message.split('\n')[0] }))
)}${list('Interaction failures', results.interactions, interactionError)}${list('Changed stories', results.changed)}${list(
    'Removed stories (baseline without a story)',
    (results.removed ?? []).map(id => ({ title: id }))
  )}${list('New stories', results.added)}${list('Render errors', results.broken)}${list('Flaky stories', results.flaky)}${list('Skipped stories', results.skipped ?? [])}
${reportUrl ? `Full report: [open the report](${reportUrl}).\n` : ''}`;
}
