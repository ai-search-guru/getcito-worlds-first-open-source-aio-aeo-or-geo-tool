import supabaseAdmin from '../../config/supabase.js';
import { deliverEmail } from '../email.js';
import logger from '../logger.js';
import { adminsOf, appOrigin, emailOf, escapeHtml } from './ownKey.js';

/**
 * Warning the Admins about the key guard (AGENT-OWN-KEY §4.2 item 4, PR 10):
 * all agents together have used 80% of what they may spend on the
 * workspace's own AI key this AI period, or all of it (the agents pause).
 * Through the key's notice channel (00441): a notice at the top of each
 * Admin's Inbox, and an e-mail by their "Notify me when an agent needs me".
 * Once each per period; no 80% once the limit was reached. A notice leaves
 * the Inbox when what it says is over: the period renewed, or an Admin
 * raised the limit. Dollars at list prices: Admins only (D8).
 */

/** From this share of the limit the Admins are warned; at all of it the agents pause. */
export const OWN_KEY_LIMIT_WARN_AT = 0.8;

const KINDS = { 80: 'own_key_limit_80', 100: 'own_key_limit_100' };

/** Where a spend stands: 100 at or past the limit, 80 from 80% of it, else 0. */
export function limitLevel({ usedUsd, capUsd }) {
  if (usedUsd >= capUsd) return 100;
  if (usedUsd >= capUsd * OWN_KEY_LIMIT_WARN_AT) return 80;
  return 0;
}

/**
 * What this process last acted on for each workspace (its period and level):
 * the guard is read before every agent fire and run, and only a change needs
 * the database.
 */
const seen = new Map();

/** For tests: forget what was acted on. */
export function forgetOwnKeyLimitWarnings() {
  seen.clear();
}

const dollars = (usd, cents = false) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  }).format(usd);

const dayOf = (iso) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/**
 * The e-mail (§4.2 item 4).
 * @param {{ level: 80 | 100, usedUsd: number, capUsd: number, renewsAt: string, workspace: string }} input
 * @returns {{ subject: string, html: string }}
 */
export function renderOwnKeyLimitEmail({ level, usedUsd, capUsd, renewsAt, workspace }) {
  const url = `${appOrigin()}/dashboard/settings/ai-providers`;
  const spent = `about ${dollars(usedUsd)} of the ${dollars(capUsd, !Number.isInteger(capUsd))}`;
  const renews = dayOf(renewsAt);
  const title =
    level === 100
      ? 'Your agents reached their monthly limit on your AI key'
      : 'Your agents have used 80% of their monthly limit on your AI key';
  const body =
    level === 100
      ? `In ${escapeHtml(workspace)}, agents have used ${spent} they may spend on your own AI key this month, so the agents that run on it are paused. They start again by themselves when the month renews on ${renews}, or when an Admin raises the limit in Settings › AI Providers. Chat you use yourself keeps working.`
      : `In ${escapeHtml(workspace)}, agents have used ${spent} they may spend on your own AI key this month. At the limit they pause until the month renews on ${renews}, or until an Admin raises it in Settings › AI Providers.`;
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 8px 0;">${title}</h1>
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">${body}</p>
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">The amounts are an estimate at the providers' list prices. Your provider's bill is the real one.</p>
  <div style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">Open AI Providers</a>
  </div>
  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    You get this as an Admin of the workspace, by your Chat settings' Notify me when an agent needs me.
  </p>
</div>`;
  return { subject: title, html };
}

/** Takes the open warnings out of the Inbox that are over: another period, or another level. */
async function resolveOver(orgId, since, level, now) {
  const { data, error } = await supabaseAdmin
    .from('chat_notices')
    .select('id, kind, payload')
    .eq('organization_id', orgId)
    .in('kind', Object.values(KINDS))
    .is('resolved_at', null);
  if (error) throw new Error(error.message);
  const over = (data ?? [])
    .filter((row) => row.payload?.since !== since || row.kind !== KINDS[level])
    .map((row) => row.id);
  if (over.length === 0) return 0;
  const { error: resolveError } = await supabaseAdmin
    .from('chat_notices')
    .update({ resolved_at: now.toISOString() })
    .in('id', over);
  if (resolveError) throw new Error(resolveError.message);
  return over.length;
}

/** Each Admin's notice for the level, once a period, and the e-mails to those newly told. */
async function tell(orgId, level, spend) {
  if (level === 80) {
    // Reached already this period: the 80% has nothing left to warn of.
    const { data, error } = await supabaseAdmin
      .from('chat_notices')
      .select('id')
      .eq('organization_id', orgId)
      .eq('dedupe_key', `${KINDS[100]}:${spend.since}`);
    if (error) throw new Error(error.message);
    if ((data ?? []).length > 0) return { notices: 0, emails: 0 };
  }
  const admins = await adminsOf(orgId);
  if (admins.length === 0) return { notices: 0, emails: 0 };
  const { data: written, error } = await supabaseAdmin
    .from('chat_notices')
    .upsert(
      admins.map((admin) => ({
        organization_id: orgId,
        user_id: admin.id,
        kind: KINDS[level],
        payload: {
          level,
          usedUsd: spend.usedUsd,
          capUsd: spend.capUsd,
          since: spend.since,
          renewsAt: spend.renewsAt,
        },
        dedupe_key: `${KINDS[level]}:${spend.since}`,
      })),
      { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
    )
    .select('user_id');
  if (error) throw new Error(error.message);
  const told = new Set((written ?? []).map((row) => row.user_id));
  if (told.size === 0) return { notices: 0, emails: 0 };

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle();
  const { subject, html } = renderOwnKeyLimitEmail({
    level,
    usedUsd: spend.usedUsd,
    capUsd: spend.capUsd,
    renewsAt: spend.renewsAt,
    workspace: org?.name ?? 'your workspace',
  });
  let emails = 0;
  for (const admin of admins) {
    // Inbox only, and Inbox only until Slack exists, send no e-mail.
    if (admin.notifyVia !== 'inbox_email' || !told.has(admin.id)) continue;
    const to = await emailOf(admin.id);
    if (!to) continue;
    const outcome = await deliverEmail({ to: [to], subject, html });
    if (outcome === 'sent') emails += 1;
    else if (outcome !== 'skipped')
      logger.warn({ orgId, outcome }, 'own key limit e-mail not sent');
  }
  return { notices: told.size, emails };
}

/**
 * Warns the Admins when the agents' spend on the own key (ownKeyAgentSpend's
 * answer) reaches 80% or all of the limit, and takes warnings that are over
 * out of the Inbox. What changed: { notices, emails, resolved }.
 */
export async function warnOwnKeyLimit(orgId, spend, { now = new Date() } = {}) {
  const level = limitLevel(spend);
  const mark = `${spend.since}|${level}`;
  if (seen.get(orgId) === mark) return { notices: 0, emails: 0, resolved: 0 };
  const resolved = await resolveOver(orgId, spend.since, level, now);
  const told = level > 0 ? await tell(orgId, level, spend) : { notices: 0, emails: 0 };
  seen.set(orgId, mark);
  return { ...told, resolved };
}
