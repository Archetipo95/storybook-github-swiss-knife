// Decides whether the visual approval label applies to the results being gated, using only data
// from the GitHub API (trusted): the pull request's issue events and the run that captured the
// results. Nothing produced by the pull request's own workflow run is involved, so a pushed
// commit cannot claim an earlier approval.
//
// The label counts only when it was added after:
// - the run that captured the results completed. Before that, nobody could have seen its report:
//   a label added while a new commit is still being captured approves nothing. A plain push makes
//   a new commit, whose results come from a run that starts after the push.
// - the head's last force-push. A force-push can bring back an older commit whose results were
//   captured long before a label given to another commit.
// Re-running the capture of an approved commit asks for approval again: its screenshots are new
// results.

/**
 * @param {{ labelName: string, labelPresent: boolean,
 *   labelEvents: { event: string, created_at: string, label?: { name?: string } }[],
 *   resultsCompletedAt: string | null | undefined }} input
 *   labelEvents: the pull request's issue events; resultsCompletedAt: when the run that captured
 *   the gated results completed (null when unknown).
 * @returns {{ approved: boolean, stale: boolean }} `stale`: the label is present but does not
 *   apply to these results, so it must be withdrawn when there are changes.
 */
export function evaluateApproval({ labelName, labelPresent, labelEvents, resultsCompletedAt }) {
  if (!labelPresent) return { approved: false, stale: false };
  const times = matches =>
    labelEvents
      .filter(matches)
      .map(event => Date.parse(event.created_at))
      .filter(Number.isFinite);
  const labeledAt = times(event => event.event === 'labeled' && event.label?.name === labelName);
  const completedAt = Date.parse(resultsCompletedAt ?? '');
  if (labeledAt.length === 0 || !Number.isFinite(completedAt)) return { approved: false, stale: true };
  const headSettledAt = Math.max(completedAt, ...times(event => event.event === 'head_ref_force_pushed'));
  const approved = Math.max(...labeledAt) > headSettledAt;
  return { approved, stale: !approved };
}
