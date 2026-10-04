import { firstErrorLine } from './results.js';

/**
 * Decides whether visual results block the pull request. Interaction failures, render errors
 * and incomplete runs always block; changed screenshots block unless approved.
 * @param {ReturnType<import('./results.js').classifyVisualResults>} results
 * @param {{ approved?: boolean, incomplete?: boolean }} options
 */
export function evaluateVisualGate(results, { approved = false, incomplete = false } = {}) {
  const { interactions, changed, broken, added, flaky, unchanged } = results;
  const blocking = incomplete || interactions.length > 0 || broken.length > 0 || (changed.length > 0 && !approved);
  const reason = incomplete
    ? 'incomplete'
    : interactions.length > 0
      ? 'interaction'
      : broken.length > 0
        ? 'error'
        : changed.length > 0
          ? approved
            ? 'approved'
            : 'changed'
          : 'clean';
  return {
    blocking,
    reason,
    counts: {
      changed: changed.length,
      new: added.length,
      interactions: interactions.length,
      errors: broken.length,
      flaky: flaky.length,
      unchanged: unchanged.length
    }
  };
}

const STATUS = {
  incomplete: () => ':x: Some screenshot shards did not finish, so this report is incomplete.',
  interaction: () => ':x: Some interaction tests (play functions) failed.',
  error: () => ':x: Some stories failed to render.',
  changed: label =>
    `:warning: Visual changes detected. Review them, then add the \`${label}\` label to accept (again after every push that changes them).`,
  approved: label => `:white_check_mark: Visual changes approved with the \`${label}\` label.`,
  clean: () => ':white_check_mark: No visual changes.'
};

const escapeCode = text => String(text).replaceAll('`', "'");

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

| Changed | New | Interaction failures | Render errors | Flaky | Unchanged |
| --- | --- | --- | --- | --- | --- |
| ${counts.changed} | ${counts.new} | ${counts.interactions} | ${counts.errors} | ${counts.flaky} | ${counts.unchanged} |

${list('Interaction failures', results.interactions, interactionError)}${list('Changed stories', results.changed)}${list('New stories', results.added)}${list('Render errors', results.broken)}${list('Flaky stories', results.flaky)}
${reportUrl ? `Full report: [open the report](${reportUrl}).\n` : ''}`;
}
