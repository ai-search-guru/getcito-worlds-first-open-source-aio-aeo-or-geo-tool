/**
 * Site Audit auto-audit (SA-006): 25% of the monthly quota audits pages by
 * itself, in five runs of 5% on days 1, 7, 14, 21 and 28 of the billing
 * month: first the pages a Site Audit fix was completed on and not audited
 * or tried since (learning B7), then the Opportunities inbox's top pages.
 * Pure: the schedule, the share kept for the runs to come, and which pages a
 * run takes. autoAuditSweep.js reads and writes; planGuard.js keeps the
 * reserved share out of the user's pool.
 */

export const AUTO_AUDIT = Object.freeze({
  runDays: Object.freeze([1, 7, 14, 21, 28]),
  /** Each run's share of the monthly quota. */
  share: 0.05,
  /** A run on a plan without a monthly limit (Self-hosted, Enterprise): Growth's 5% of 500. */
  unlimitedPerRun: 25,
  /** A page audited this recently is left to later runs. */
  freshDays: 30,
});

const DAY_MS = 24 * 60 * 60 * 1000;

/** Pages one run audits: 5% of the quota rounded down, at least one. */
export function perRunSlots(limit) {
  if (limit === -1) return AUTO_AUDIT.unlimitedPerRun;
  if (!(limit > 0)) return 0;
  return Math.max(1, Math.floor(limit * AUTO_AUDIT.share));
}

/**
 * Whether the org's runs happen: its own choice when it made one, else on
 * for a plan with a monthly quota and off for one without (it would spend a
 * self-hosted install's own keys unasked).
 *
 * @param {boolean|null} setting  site_audit_settings.auto_audit
 * @param {number} limit  the plan's maxSiteAudits (-1 unlimited)
 */
export function autoAuditEnabled(setting, limit) {
  if (typeof setting === 'boolean') return setting;
  return limit > 0;
}

const startOfUtcDay = (ms) => ms - (((ms % DAY_MS) + DAY_MS) % DAY_MS);

/**
 * The period's five runs. Day N is the (UTC) day N − 1 days after the period
 * starts, from its first hour, so the morning sweep runs it on that day
 * whatever time of day the subscription renewed; day 1 starts with the
 * period. A period shorter than N days runs day N on its last day. A run's
 * turn lasts until the next run starts (the last one's until the period
 * ends), so a sweep that misses a run's day still does it within that week.
 *
 * @returns {Array<{ day: number, at: Date, until: Date }>}
 */
export function runSchedule(periodStart, periodEnd) {
  const start = new Date(periodStart).getTime();
  const end = new Date(periodEnd).getTime();
  const lastDay = Math.max(start, startOfUtcDay(end - 1));
  const starts = AUTO_AUDIT.runDays.map((day) => {
    const at = Math.max(start, startOfUtcDay(start + (day - 1) * DAY_MS));
    return { day, at: at < end ? at : lastDay };
  });
  return starts.map((run, i) => ({
    day: run.day,
    at: new Date(run.at),
    until: new Date(i + 1 < starts.length ? starts[i + 1].at : end),
  }));
}

/** The run whose turn it is at `now`, or null. */
export function dueRun(schedule, now) {
  const t = new Date(now).getTime();
  return schedule.find((run) => run.at.getTime() <= t && t < run.until.getTime()) ?? null;
}

/**
 * The runs still to come: not recorded yet, and their turn not over (the
 * current run counts until it is recorded). Each keeps its slots out of the
 * user's pool; a run's unused slots return when it is recorded.
 *
 * @param {Array<{ day: number, at: Date, until: Date }>} schedule
 * @param {number[]} recordedDays  run days already recorded this period
 */
export function pendingRuns(schedule, recordedDays, now) {
  const t = new Date(now).getTime();
  const done = new Set(recordedDays);
  return schedule.filter((run) => run.until.getTime() > t && !done.has(run.day));
}

/**
 * A page within a run: brands may share a domain, and each audits, pins and
 * fixes its own pages, so a page is the brand's page (`brandId|key`).
 */
export const runPageKey = (brandId, key) => `${brandId}|${key}`;

/**
 * Pages fixed since their last audit (learning B7) take at most this share
 * of a run, rounded up: the rest is the inbox's, so new pages keep coming.
 */
export const FIXED_SHARE = 0.5;

/**
 * The pages a run audits. First the pages a Site Audit fix was completed on
 * and not audited or tried since (learning B7), the most recently fixed first,
 * up to FIXED_SHARE of the run: auditing them again says whether the fix
 * took, which the Action Center reads as the fix's result, a month sooner
 * than the 30-day rest below would. Then, from every brand's inbox (ordered
 * by priority.js), the pages not being audited and not audited in the last
 * 30 days, nor tried by a run in that time (an audit that failed, say on a
 * page that blocks bots, would otherwise take a slot every run); pinned
 * pages first, then the highest priority across the brands, at most `slots`
 * in all. A tie keeps the inboxes' own order.
 *
 * @param {Array<{ brandId: string, opportunities: Array<{ key: string, url: string, path: string, pinned: boolean, running: boolean, priority: number, lastAudit: { at: string }|null }> }>} inboxes
 * @param {number} slots
 * @param {Date} now
 * @param {Set<string>} [triedKeys]  page keys a run audited in the last 30 days
 * @param {Array<{ brandId: string, key: string, url: string, path: string }>} [fixed]
 *   pages fixed since their last audit, the most recently fixed first, already
 *   kept to the brand's own domains and its auto-audit exclusions (fixedPages)
 * @returns {Array<{ brandId: string, url: string, path: string, pinned: boolean, priority: number, fixed?: true }>}
 */
export function pickRunPages(inboxes, slots, now, triedKeys = new Set(), fixed = []) {
  const freshSince = new Date(now).getTime() - AUTO_AUDIT.freshDays * DAY_MS;
  const running = new Set(
    inboxes.flatMap(({ brandId, opportunities }) =>
      opportunities.filter((r) => r.running).map((r) => runPageKey(brandId, r.key)),
    ),
  );
  const first = [];
  const taken = new Set();
  const fixedSlots = Math.min(Math.max(0, slots), Math.ceil(Math.max(0, slots) * FIXED_SHARE));
  for (const page of fixed) {
    if (first.length >= fixedSlots) break;
    const id = page.key ? runPageKey(page.brandId, page.key) : null;
    if (!id || running.has(id) || taken.has(id)) continue;
    taken.add(id);
    first.push({
      brandId: page.brandId,
      url: page.url,
      path: page.path,
      pinned: false,
      priority: 0,
      fixed: true,
    });
  }
  const candidates = [];
  for (const { brandId, opportunities } of inboxes) {
    for (const row of opportunities) {
      // A template's row (SA-007) stands for pages the inbox lists one by one.
      if (row.template || row.running || triedKeys.has(row.key)) continue;
      if (taken.has(runPageKey(brandId, row.key))) continue;
      if (row.lastAudit && Date.parse(row.lastAudit.at) >= freshSince) continue;
      candidates.push({
        brandId,
        url: row.url,
        path: row.path,
        pinned: row.pinned,
        priority: row.priority,
      });
    }
  }
  return [
    ...first,
    ...candidates
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.priority - a.priority)
      .slice(0, Math.max(0, slots - first.length)),
  ];
}
