/**
 * What Opportunities says after a bulk send to the workflow (#1590): how
 * many were sent, only when any were, and why the others weren't. A
 * webhook that redirects does so for every row, so when nothing was sent
 * and every failure was a redirect, it says so, as a single send does; else
 * how many failed (some got through, so "Nothing was sent" would be wrong).
 */
export function bulkSendNotes(result: { sent: number; failed: number; redirected?: number }): {
  sent: number | null;
  failure: 'redirect' | 'failed' | null;
} {
  const redirected = result.redirected ?? 0;
  return {
    sent: result.sent > 0 ? result.sent : null,
    failure:
      result.failed === 0
        ? null
        : result.sent === 0 && redirected > 0 && redirected === result.failed
          ? 'redirect'
          : 'failed',
  };
}
