// Decides whether the visual approval label applies to the current head commit, using only data
// from the GitHub API (trusted): the label's issue events and the runs created for the head SHA.
// Nothing produced by the pull request's own workflow run is involved, so a pushed commit
// cannot claim an earlier approval.

/**
 * @param {{ labelName: string, labelPresent: boolean,
 *   labelEvents: { event: string, created_at: string, label?: { name?: string } }[],
 *   headRunTimes: string[] }} input
 *   labelEvents: the pull request's issue events; headRunTimes: created_at of every run of the
 *   visual workflow for the current head SHA.
 * @returns {{ approved: boolean, stale: boolean }} `stale`: the label is present but was added
 *   before the current commit, so it must be withdrawn when there are changes.
 */
export function evaluateApproval({ labelName, labelPresent, labelEvents, headRunTimes }) {
  if (!labelPresent) return { approved: false, stale: false };
  const labeledAt = labelEvents
    .filter(event => event.event === 'labeled' && event.label?.name === labelName)
    .map(event => Date.parse(event.created_at))
    .filter(Number.isFinite);
  const firstRunAt = headRunTimes.map(time => Date.parse(time)).filter(Number.isFinite);
  if (labeledAt.length === 0 || firstRunAt.length === 0) return { approved: false, stale: true };
  const approved = Math.max(...labeledAt) >= Math.min(...firstRunAt);
  return { approved, stale: !approved };
}
