/**
 * Billing-anchored quota window math (#500). Pure functions — no I/O — so
 * they can be unit-tested without the supabase config (which exits the
 * process when env vars are missing).
 */

/** Add `delta` months with Stripe-style day clamping (Mar 31 − 1mo → Feb 28/29). */
export function shiftMonthClamped(date, delta) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + delta);
  const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, daysInMonth));
  return d;
}

/**
 * Start of the monthly window containing `now`, anchored to the billing day
 * of `endsAt` (Stripe's current_period_end). Walks month-by-month so it also
 * lands on the right window under webhook lag (endsAt briefly in the past
 * right after renewal) or annual billing (endsAt far in the future).
 */
export function anchoredPeriodStart(endsAt, now = new Date()) {
  let end = endsAt;
  let start = shiftMonthClamped(end, -1);
  for (let i = 0; start > now && i < 24; i++) {
    end = start;
    start = shiftMonthClamped(end, -1);
  }
  for (let i = 0; end <= now && i < 24; i++) {
    start = end;
    end = shiftMonthClamped(start, 1);
  }
  return start;
}
