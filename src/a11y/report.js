// Evaluates the per-story axe reports written by the runner against the baseline. Runs in the
// trusted gate: blocking is recomputed here from raw node counts, never taken from the runner.

/**
 * @typedef {{ id: string, impact?: string, help?: string, helpUrl?: string, nodes: number, targets?: string[] }} Violation
 * @typedef {{ id: string, violations: Violation[] }} StoryReport
 * @typedef {{ enforcedRules?: string[], stories?: Record<string, Record<string, number>> }} Baseline
 */

export const A11Y_COMMENT_MARKER = '<!-- swiss-knife:a11y -->';

/**
 * Marks each violation `isNew` (blocking) and returns the blocking ones.
 * A violation blocks when its rule is enforced (any impact), or when its impact is blocking and
 * it fails on more nodes than the baseline records for that story and rule.
 * @param {StoryReport[]} reports
 * @param {{ baseline?: Baseline, enforcedRules?: string[], blockingImpacts?: string[] }} options
 */
export function evaluateA11yReports(
  reports,
  { baseline = {}, enforcedRules = [], blockingImpacts = ['critical', 'serious'] } = {}
) {
  // Rules enforced by the (trusted) configuration or by the baseline file; both only add rules.
  const enforced = new Set([...enforcedRules, ...(baseline.enforcedRules ?? [])]);
  const impacts = new Set(blockingImpacts);
  const evaluated = reports
    .map(({ id, violations }) => ({
      id,
      violations: violations.map(violation => {
        const known = baseline.stories?.[id]?.[violation.id] ?? 0;
        const isNew = enforced.has(violation.id) || (impacts.has(violation.impact) && Number(violation.nodes) > known);
        return { ...violation, isNew };
      })
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const blocking = evaluated.flatMap(({ id, violations }) =>
    violations.filter(violation => violation.isNew).map(violation => ({ story: id, ...violation }))
  );
  return { reports: evaluated, blocking, enforcedRules: [...enforced].sort() };
}

/**
 * A baseline recording every non-enforced violation's node count.
 * @param {StoryReport[]} reports
 * @param {string[]} enforcedRules
 */
export function buildBaseline(reports, enforcedRules = []) {
  const enforced = new Set(enforcedRules);
  const stories = {};
  for (const { id, violations } of [...reports].sort((left, right) => left.id.localeCompare(right.id))) {
    const counts = violations
      .filter(violation => !enforced.has(violation.id))
      .map(violation => [violation.id, Number(violation.nodes)])
      .sort(([left], [right]) => left.localeCompare(right));
    if (counts.length > 0) stories[id] = Object.fromEntries(counts);
  }
  return { enforcedRules: [...enforced].sort(), stories };
}

/**
 * Markdown summary (job summary and PR comment) of evaluated reports.
 * @param {ReturnType<typeof evaluateA11yReports>} evaluation
 * @param {{ baselinePath?: string, blockingImpacts?: string[] }} options
 */
export function renderA11ySummary(
  { reports, blocking, enforcedRules },
  { baselinePath = '.storybook/a11y-baseline.json', blockingImpacts = ['critical', 'serious'] } = {}
) {
  const rules = new Map();
  for (const { violations } of reports) {
    for (const { id, impact, help, helpUrl, nodes, isNew } of violations) {
      const rule = rules.get(id) ?? { impact, help, helpUrl, stories: 0, nodes: 0, newStories: 0 };
      rule.stories += 1;
      rule.nodes += Number(nodes);
      if (isNew) rule.newStories += 1;
      rules.set(id, rule);
    }
  }
  const rows = [...rules.entries()]
    .sort(([leftId, left], [rightId, right]) => right.stories - left.stories || leftId.localeCompare(rightId))
    .map(
      ([id, { impact, help, helpUrl, stories, nodes, newStories }]) =>
        `| ${impact ?? ''} | ${helpUrl ? `[${id}](${helpUrl})` : id} | ${help ?? ''} | ${stories} | ${nodes} | ${newStories} |`
    );
  const enforced = enforcedRules.length > 0 ? enforcedRules.map(rule => `\`${rule}\``).join(', ') : 'none yet';
  const storiesWithViolations = reports.filter(report => report.violations.length > 0).length;
  return [
    A11Y_COMMENT_MARKER,
    '## Accessibility',
    '',
    blocking.length > 0
      ? `:x: ${blocking.length} new accessibility violation${blocking.length === 1 ? '' : 's'}.`
      : ':white_check_mark: No new accessibility violations.',
    '',
    `${storiesWithViolations} stories with violations. New ${blockingImpacts.join('/')} violations (a rule not in \`${baselinePath}\` for that story, or failing on more nodes than recorded there) and any violation of an enforced rule block: ${enforced}.`,
    '',
    ...(rows.length > 0
      ? [
          '| Impact | Rule | Description | Stories | Nodes | New |',
          '| --- | --- | --- | --- | --- | --- |',
          ...rows,
          ''
        ]
      : []),
    ...(blocking.length > 0
      ? [
          '### New violations',
          '',
          ...blocking.map(({ story, id, nodes }) => `- \`${story}\`: ${id} (${nodes} nodes)`),
          ''
        ]
      : [])
  ].join('\n');
}
