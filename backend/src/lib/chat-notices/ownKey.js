import supabaseAdmin from '../../config/supabase.js';
import { deliverEmail } from '../email.js';
import logger from '../logger.js';

/**
 * Telling the Admins that the workspace's own AI key fails (AGENT-OWN-KEY
 * §5.3, 00441): a notice at the top of each Admin's Inbox, and an e-mail by
 * their "Notify me when an agent needs me" (chat_user_prefs.notify_via,
 * 00408): Inbox and e-mail (the default), Inbox only, or Inbox only until
 * Slack exists. Once per failure episode, and one reminder after 3 days
 * still failing. Through Resend (email.js), a silent no-op where it isn't
 * configured. The notice and the e-mail name no brand.
 */

/** How long a key fails before the one reminder. */
export const REMINDER_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const PROVIDER_NAMES = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google Gemini',
  azure: 'Microsoft Azure OpenAI',
  openrouter: 'OpenRouter',
};

/** Why the key fails, in words (web: chatAgents.ownKey.why). */
export function keyWhy(provider, failureClass) {
  const name = PROVIDER_NAMES[provider] ?? provider;
  switch (failureClass) {
    case 'invalid':
      return `${name} turned down your workspace's key.`;
    case 'no_credit':
      return `Your ${name} account is out of credit.`;
    case 'model':
      return `${name} can't reach the model set for your key.`;
    case 'unreadable':
      return `Your saved ${name} key can't be read any more.`;
    default:
      return `Your ${name} key isn't working.`;
  }
}

/** The dashboard's origin, for the e-mail's link. */
export function appOrigin() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    return new URL(raw).origin;
  } catch {
    return raw.replace(/\/$/, '');
  }
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The e-mail (AGENT-OWN-KEY §5.3's words).
 * @param {{ provider: string, failureClass: string, workspace: string, reminder?: boolean }} input
 * @returns {{ subject: string, html: string }}
 */
export function renderOwnKeyEmail({ provider, failureClass, workspace, reminder = false }) {
  const url = `${appOrigin()}/dashboard/settings/ai-providers`;
  const why = escapeHtml(keyWhy(provider, failureClass));
  const name = escapeHtml(workspace);
  const html = `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 8px 0;">Your AI key for GetCito isn't working</h1>
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">${why} Chat and agents in ${name} run on this key, so agents that use it are paused. None of their runs moved to your plan's AI limit.</p>
  <p style="font-size:14px;color:#111827;margin:0 0 16px 0;">Open Settings › AI Providers to replace or test the key. Agents paused for this start again by themselves once the key works.</p>
  <div style="margin:24px 0;">
    <a href="${escapeHtml(url)}" style="background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;">Open AI Providers</a>
  </div>
  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">
    ${reminder ? 'A reminder: the key has not worked for 3 days. We send one.' : "You get this as an Admin of the workspace, by your Chat settings' Notify me when an agent needs me."}
  </p>
</div>`;
  return {
    subject: reminder
      ? "Reminder: your AI key for GetCito still isn't working"
      : "Your AI key for GetCito isn't working",
    html,
  };
}

/**
 * Takes this episode's notice (or its one reminder) for the key, in one
 * conditional update on notified_at, so failures at once tell the Admins
 * once. The key as it was, or null when it isn't failing since `since`, or
 * the notice (the reminder) was already taken.
 */
async function claimNotice(orgId, provider, since, reminder, now) {
  const { data: key, error } = await supabaseAdmin
    .from('organization_ai_keys')
    .select('failing_since, failure_class, notified_at')
    .eq('organization_id', orgId)
    .eq('provider', provider)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!key?.failing_since || Date.parse(key.failing_since) !== Date.parse(since)) return null;
  const sinceMs = Date.parse(key.failing_since);
  if (reminder) {
    // Once, 3 days into the episode.
    if (now.getTime() - sinceMs < REMINDER_AFTER_MS) return null;
    if (key.notified_at && Date.parse(key.notified_at) >= sinceMs + REMINDER_AFTER_MS) return null;
  } else if (key.notified_at) {
    return null;
  }
  let claim = supabaseAdmin
    .from('organization_ai_keys')
    .update({ notified_at: now.toISOString() })
    .eq('organization_id', orgId)
    .eq('provider', provider)
    .eq('failing_since', key.failing_since);
  claim = key.notified_at
    ? claim.eq('notified_at', key.notified_at)
    : claim.is('notified_at', null);
  const { data: claimed, error: claimError } = await claim.select('provider');
  if (claimError) throw new Error(claimError.message);
  return (claimed ?? []).length > 0 ? key : null;
}

/** The workspace's Admins, with how each wants to hear when an agent needs them. */
export async function adminsOf(orgId) {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId)
    .eq('role', 'admin');
  if (error) throw new Error(error.message);
  const ids = (data ?? []).map((row) => row.id);
  if (ids.length === 0) return [];
  const { data: prefs, error: prefsError } = await supabaseAdmin
    .from('chat_user_prefs')
    .select('user_id, notify_via')
    .in('user_id', ids);
  if (prefsError) throw new Error(prefsError.message);
  const via = new Map((prefs ?? []).map((row) => [row.user_id, row.notify_via]));
  return ids.map((id) => ({ id, notifyVia: via.get(id) ?? 'inbox_email' }));
}

export async function emailOf(id) {
  const { data } = await supabaseAdmin.auth.admin.getUserById(id);
  return data?.user?.email ?? null;
}

/**
 * Tells the Admins the workspace's own key fails (AGENT-OWN-KEY §5.3): the
 * episode's first failure (`since`, its failing_since), or its one reminder.
 * What went out: { notices, emails } (0 and 0 when the notice was already
 * taken or the key works again).
 */
export async function notifyOwnKeyFailure(
  { orgId, provider, since, reminder = false },
  { now = new Date() } = {},
) {
  const key = await claimNotice(orgId, provider, since, reminder, now);
  if (!key) return { notices: 0, emails: 0 };

  const admins = await adminsOf(orgId);
  if (admins.length === 0) return { notices: 0, emails: 0 };
  const dedupe = `own_key:${provider}:${new Date(key.failing_since).toISOString()}${reminder ? ':reminder' : ''}`;
  const { data: written, error } = await supabaseAdmin
    .from('chat_notices')
    .upsert(
      admins.map((admin) => ({
        organization_id: orgId,
        user_id: admin.id,
        kind: 'own_key_failed',
        payload: { provider, class: key.failure_class, reminder },
        dedupe_key: dedupe,
      })),
      { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
    )
    .select('user_id');
  if (error) throw new Error(error.message);
  const told = new Set((written ?? []).map((row) => row.user_id));

  const { data: org } = await supabaseAdmin
    .from('organizations')
    .select('name')
    .eq('id', orgId)
    .maybeSingle();
  const { subject, html } = renderOwnKeyEmail({
    provider,
    failureClass: key.failure_class,
    workspace: org?.name ?? 'your workspace',
    reminder,
  });
  let emails = 0;
  for (const admin of admins) {
    // Inbox only, and Inbox only until Slack exists, send no e-mail.
    if (admin.notifyVia !== 'inbox_email' || !told.has(admin.id)) continue;
    const to = await emailOf(admin.id);
    if (!to) continue;
    const outcome = await deliverEmail({ to: [to], subject, html });
    if (outcome === 'sent') emails += 1;
    else if (outcome !== 'skipped') logger.warn({ orgId, outcome }, 'own key e-mail not sent');
  }
  return { notices: told.size, emails };
}
