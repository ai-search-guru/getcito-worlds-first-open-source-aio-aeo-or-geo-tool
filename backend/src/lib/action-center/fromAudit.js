/**
 * "Send to Action Center" from a Site Audit report (learning D2): the page
 * and the checks it fails, sent as one Fix action.
 *
 * The audit is read again here, by its id, within the brand: the page, its
 * score and its failing checks as the database has them, not as a client
 * says they are. The action names its page and those checks as its target,
 * so the Action Center can tell whether the fix took once the page is
 * audited again, as it does for a nightly Site Audit fix. Measured
 * afterwards on its page like any person-sent action (basketMetrics.js):
 * its citations and AI-referred sessions.
 */

import supabaseAdmin from '../../config/supabase.js';
import { resolve } from '../../config/actionEngine.js';
import { describeSignal } from '../audit/rubric.js';
import { opportunityKey } from '../audit/opportunities.js';
import { readAllRpcRows } from '../rpcPages.js';
import fixLowScores from './definitions/f01FixLowScores.js';
import { priorityOnCreate } from './priorityData.js';
import { resolveBrandSources } from './sources.js';
import { planTasks } from './tasks/plan.js';

export const AUDIT_PAGE_ACTION_KIND = 'audit_page';

const ACTIVE = ['new', 'in_progress', 'on_hold'];
const KPI_KEYS = ['citations', 'ai_referral_traffic'];

const { detection } = resolve();

function httpError(message, status, code, extra) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  if (extra) err.extra = extra;
  return err;
}

/** A check's status that says the page fails it: as the Action Center's page check reads it. */
export function failing(key, status) {
  return status === 'fail' || (status === 'warn' && key === 'json-ld-validity');
}

/** One open action per page: the same page sent again finds it. */
export function auditDedupKey(url) {
  return `${AUDIT_PAGE_ACTION_KIND}:${opportunityKey(url) ?? url}`;
}

/**
 * The page's latest completed audit after this one, if any: the one its row
 * on the Pages list opens (one page per opportunityKey of final_url, else
 * url). Read newest first, so the first of the page's is the latest.
 */
async function newerAuditOf(audit) {
  const key = opportunityKey(audit.final_url || audit.url);
  if (!key || !audit.created_at) return null;
  const { data, error } = await readAllRpcRows('site_audits', (from, to) =>
    supabaseAdmin
      .from('site_audits')
      .select('id, url, final_url')
      .eq('brand_id', audit.brand_id)
      .eq('status', 'completed')
      .not('total_score', 'is', null)
      .gt('created_at', audit.created_at)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to),
  );
  if (error) throw new Error(error.message);
  return (
    (data ?? []).find(
      (row) => row.id !== audit.id && opportunityKey(row.final_url || row.url) === key,
    ) ?? null
  );
}

/** High below the low-score line the nightly F01 is raised under; more failures, more urgent. */
export function auditImpact(score, failures) {
  if (score != null && Number(score) * 100 < detection.auditLowScore) return 'high';
  return failures >= 3 ? 'medium' : 'low';
}

/**
 * Creates the action, or returns the one open for the page. Refused (409)
 * for an audit not finished, one the page has a newer completed audit than
 * (`newer_audit`, with `extra.latestAuditId`), and one with nothing to fix.
 *
 * @param {string} brandId - checked against the caller's org by the route
 * @param {{ auditId: string, userId: string }} opts
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean }>}
 */
export async function sendAuditToActionCenter(brandId, { auditId, userId }) {
  const { data: audit, error: auditErr } = await supabaseAdmin
    .from('site_audits')
    .select('id, brand_id, url, final_url, status, total_score, created_at')
    .eq('id', auditId)
    .eq('brand_id', brandId)
    .maybeSingle();
  if (auditErr) throw new Error(auditErr.message);
  if (!audit) throw httpError('Audit not found', 404, 'not_found');
  if (audit.status !== 'completed') {
    throw httpError('The audit hasn’t finished', 409, 'not_completed');
  }
  // An older report of the page: what it failed then may be fixed by now.
  const newer = await newerAuditOf(audit);
  if (newer) {
    throw httpError('The page has a newer audit', 409, 'newer_audit', {
      latestAuditId: newer.id,
    });
  }

  const { data: results, error: resultsErr } = await supabaseAdmin
    .from('audit_signal_results')
    .select('signal_key, status')
    .eq('audit_id', audit.id);
  if (resultsErr) throw new Error(resultsErr.message);
  const checks = (results ?? [])
    .filter((r) => failing(r.signal_key, r.status))
    .map((r) => ({
      key: r.signal_key,
      label: describeSignal(r.signal_key)?.label ?? r.signal_key,
    }));
  if (!checks.length) throw httpError('The page passes its checks', 409, 'nothing_to_fix');

  const url = audit.final_url || audit.url;
  const dedupKey = auditDedupKey(url);
  const openAction = async () => {
    const { data } = await supabaseAdmin
      .from('actions')
      .select('id, action_no')
      .eq('brand_id', brandId)
      .eq('dedup_key', dedupKey)
      .in('status', ACTIVE)
      .maybeSingle();
    return data;
  };
  const open = await openAction();
  if (open) return { actionId: open.id, actionNo: Number(open.action_no), created: false };

  const score = audit.total_score == null ? null : Number(audit.total_score);
  const impact = auditImpact(score, checks.length);
  let path = url;
  try {
    path = new URL(url).pathname || '/';
  } catch {
    // Kept as given.
  }
  const payload = {
    source: AUDIT_PAGE_ACTION_KIND,
    auditId: audit.id,
    url,
    score,
    checks,
    // Measured on this page once done (basketMetrics.js).
    pages: [url],
    targetEntity: 'pages',
    targetCount: 1,
    targetIds: [url],
    // The page and the checks it fails: what an audit run on it again reads.
    targets: [{ id: url, label: path, checks: checks.map((c) => c.key) }],
  };

  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: 'fix',
      kind: AUDIT_PAGE_ACTION_KIND,
      definition_version: 1,
      impact,
      payload,
      kpi_keys: KPI_KEYS,
      baseline: { score, failing: checks.length },
      dedup_key: dedupKey,
      ...(await priorityOnCreate({
        kind: AUDIT_PAGE_ACTION_KIND,
        category: 'fix',
        impact,
        payload,
      })),
    })
    .select('id, action_no')
    .single();
  if (error) {
    // Two sends at once: the other one opened it (the open-action dedup index, 00084).
    if (error.code === '23505') {
      const winner = await openAction();
      if (winner) {
        return { actionId: winner.id, actionNo: Number(winner.action_no), created: false };
      }
    }
    throw new Error(error.message);
  }

  const sources = await resolveBrandSources(brandId);
  const plan = planTasks(
    { id: AUDIT_PAGE_ACTION_KIND, tasks: fixLowScores.tasks },
    { sources, payload },
  );
  const { error: tasksErr } = await supabaseAdmin.from('action_tasks').insert(
    plan.map((item) => ({
      action_id: action.id,
      position: item.position,
      task_key: item.taskKey,
      task_version: item.version,
      mode: item.mode,
      permission: item.permission,
      depends_on: item.dependsOn,
      title_params: item.titleParams,
      details: item.details,
      status: 'todo',
    })),
  );
  if (tasksErr) throw new Error(tasksErr.message);

  await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: userId,
    data: { source: AUDIT_PAGE_ACTION_KIND, checks: checks.length, taskCount: plan.length },
  });

  return { actionId: action.id, actionNo: Number(action.action_no), created: true };
}
