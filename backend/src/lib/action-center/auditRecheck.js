import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/actionEngine.js';
import { pageScope } from './basketMetrics.js';

/**
 * Did a Site Audit fix take? (learning A2.) F01, F03 and F10 had no metric
 * to measure (their signals name none), so their result always read "could
 * not be measured", and the audit's own answer was never asked: does the
 * page pass now? This reads it from the audits run on the action's pages
 * since it closed.
 */

const { detection } = resolve();

/** A check's status that says the issue it raised is gone: as the Action Center's page check reads it. */
const passes = (key, status) =>
  status === 'pass' || status === 'na' || (status === 'warn' && key !== 'json-ld-validity');

const keyOf = (url) => pageScope([url]).keys[0] ?? null;

/**
 * Whether a Site Audit fix's pages pass in the latest audit of each run
 * since the action closed: a page whose target names the checks that raised
 * it (F03 structured data, F10 internal links…) when every one of them
 * passes; a low-scored page (F01) when its score is past the low-score line
 * the signal is raised under. `{ pages, audited, passed }`: the pages it can
 * tell about, those audited again, those passing. Null for an action with no
 * such page.
 */
export async function auditRecheck(action) {
  if (!action.completed_at) return null;
  const lowScore = action.kind === 'fix_low_scores';
  const targets = (Array.isArray(action.payload?.targets) ? action.payload.targets : []).filter(
    (t) =>
      typeof t?.id === 'string' &&
      /^https?:\/\//i.test(t.id) &&
      (lowScore || (Array.isArray(t.checks) && t.checks.length > 0)),
  );
  if (!targets.length) return null;

  const { data: audits, error } = await supabaseAdmin
    .from('site_audits')
    .select('id, url, final_url, total_score')
    .eq('brand_id', action.brand_id)
    .eq('status', 'completed')
    // A partial audit's AI-judged checks read n/a, which isn't the fix taking.
    .eq('partial', false)
    .gt('completed_at', action.completed_at)
    .order('completed_at', { ascending: false })
    .limit(500);
  if (error) throw new Error(`site_audits: ${error.message}`);
  // Each page's latest audit, by the address it was asked for or ended at.
  const latest = new Map();
  for (const audit of audits ?? []) {
    for (const url of [audit.url, audit.final_url]) {
      const key = url ? keyOf(url) : null;
      if (key && !latest.has(key)) latest.set(key, audit);
    }
  }
  const found = targets
    .map((target) => ({ target, audit: latest.get(keyOf(target.id)) }))
    .filter((f) => f.audit);
  if (!found.length) return { pages: targets.length, audited: 0, passed: 0 };

  if (lowScore) {
    const passed = found.filter(
      ({ audit }) =>
        audit.total_score != null && Number(audit.total_score) * 100 >= detection.auditLowScore,
    ).length;
    return { pages: targets.length, audited: found.length, passed };
  }

  const checks = [...new Set(found.flatMap(({ target }) => target.checks))];
  const { data: results, error: resultsError } = await supabaseAdmin
    .from('audit_signal_results')
    .select('audit_id, signal_key, status')
    .in(
      'audit_id',
      found.map(({ audit }) => audit.id),
    )
    .in('signal_key', checks);
  if (resultsError) throw new Error(`audit_signal_results: ${resultsError.message}`);
  const statusOf = new Map((results ?? []).map((r) => [`${r.audit_id}|${r.signal_key}`, r.status]));
  const passed = found.filter(({ target, audit }) =>
    target.checks.every((key) => passes(key, statusOf.get(`${audit.id}|${key}`))),
  ).length;
  return { pages: targets.length, audited: found.length, passed };
}

/**
 * A fix's verdict from its pages audited again: its aim is the check
 * passing, more than any metric over a week. All passing reads improved;
 * none, no meaningful change; some, mixed (part of the work took).
 */
export function auditOutcome({ audited, passed }) {
  if (!audited) return null;
  if (passed === 0) return 'no_meaningful_change';
  return passed === audited ? 'improved' : 'mixed';
}
