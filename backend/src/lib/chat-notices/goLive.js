import supabaseAdmin from '../../config/supabase.js';
import { brandReaders } from '../access.js';
import { deliverEmail } from '../email.js';
import logger from '../logger.js';
import { appOrigin, emailOf, escapeHtml } from './ownKey.js';

/**
 * Telling people an agent went live on its own (AUTONOMOUS-GO-LIVE §6.4,
 * 00446), or is no longer allowed to (§7.2):
 *
 *   * agent_went_live: the agent's owner and the people its version
 *     notifies (chat_agent_versions.notify_user_ids), those of them who reach
 *     the page's brand, get a notice at the top of their Inbox's Needs you,
 *     and an e-mail by their "Notify me when an agent needs me"
 *     (chat_user_prefs.notify_via, 00408). Once per step (its event). When
 *     the page's draft works on an Action Center action, its History says so
 *     too (action_events agent_went_live).
 *   * agent_go_live_off: an edit made a new version of an allowed agent. The
 *     Admin who allowed it and its owner, once per version allowed.
 *
 * Through Resend (email.js), a silent no-op where it isn't configured. Never
 * on the step's way: the caller logs what fails.
 */

const CMS_NAMES = {
  webflow: 'Webflow',
  wordpress: 'WordPress',
  framer: 'Framer',
  wix: 'Wix',
  webhook: 'your webhook',
};

/** One row, or null; a read that fails throws. */
async function one(query) {
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** How each person wants to hear when an agent needs them; Inbox and e-mail by default. */
async function notifyViaOf(ids) {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabaseAdmin
    .from('chat_user_prefs')
    .select('user_id, notify_via')
    .in('user_id', ids);
  if (error) throw new Error(error.message);
  return new Map((data ?? []).map((row) => [row.user_id, row.notify_via]));
}

/** The members of the workspace among `ids`, each once. */
async function membersOf(orgId, ids) {
  const wanted = [...new Set(ids.filter(Boolean))];
  if (wanted.length === 0) return [];
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('id')
    .eq('organization_id', orgId)
    .in('id', wanted);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.id);
}

/**
 * Writes one notice per person (unique by person and `dedupe`), then sends
 * the e-mail to those it was new for who want e-mail. What went out.
 */
async function tell({ orgId, people, kind, payload, dedupe, brandId = null, email }) {
  if (people.length === 0) return { notices: 0, emails: 0 };
  const { data: written, error } = await supabaseAdmin
    .from('chat_notices')
    .upsert(
      people.map((id) => ({
        organization_id: orgId,
        user_id: id,
        kind,
        payload,
        dedupe_key: dedupe,
        brand_id: brandId,
      })),
      { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true },
    )
    .select('user_id');
  if (error) throw new Error(error.message);
  const told = new Set((written ?? []).map((row) => row.user_id));
  const via = await notifyViaOf([...told]);
  let emails = 0;
  for (const id of told) {
    // Inbox only, and Inbox only until Slack exists, send no e-mail.
    if ((via.get(id) ?? 'inbox_email') !== 'inbox_email') continue;
    const to = await emailOf(id);
    if (!to) continue;
    const outcome = await deliverEmail({ to: [to], ...email });
    if (outcome === 'sent') emails += 1;
    else if (outcome !== 'skipped')
      logger.warn({ orgId, kind, outcome }, 'go-live e-mail not sent');
  }
  return { notices: told.size, emails };
}

const BUTTON =
  'background:#111827;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-size:14px;display:inline-block;margin-right:8px;';
const LINK_BUTTON =
  'background:#ffffff;color:#111827;text-decoration:none;padding:9px 17px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;display:inline-block;';

function frame(title, lines, buttons, footer) {
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
  <h1 style="font-size:18px;color:#111827;margin:0 0 8px 0;">${title}</h1>
  ${lines.map((line) => `<p style="font-size:14px;color:#111827;margin:0 0 16px 0;">${line}</p>`).join('\n  ')}
  <div style="margin:24px 0;">
    ${buttons.join('\n    ')}
  </div>
  <p style="font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:16px;">${footer}</p>
</div>`;
}

/** The site a live page is on, for the words: its host, without www. */
export function siteOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The e-mail for a page an agent sent or published on its own (§6.4's words).
 * @param {{ agent: string, title: string, target: string, brand: string, draftId: string,
 *   chatId: string|null, kind?: string, url?: string|null }} input
 */
export function renderWentLiveEmail({
  agent,
  title,
  target,
  brand,
  draftId,
  chatId,
  kind = 'cms_draft',
  url = null,
}) {
  const cms = CMS_NAMES[target] ?? target;
  const origin = appOrigin();
  const site = kind === 'publish' && url ? siteOf(url) : null;
  const subject = site
    ? `${agent} published “${title}” on ${site}`
    : `${agent} sent “${title}” to ${cms} as a draft`;
  const html = frame(
    escapeHtml(subject),
    site
      ? [
          `${escapeHtml(agent)} published the ${escapeHtml(brand)} page “${escapeHtml(title)}” on ${escapeHtml(site)} through ${escapeHtml(cms)}, without a click. An Admin allowed this agent to publish and send on its own.`,
          'It passed Quality and your brand facts first. It is live now: check it, and if it shouldn’t be, use Take down on its notice in your Chat Inbox.',
        ]
      : [
          `${escapeHtml(agent)} sent the ${escapeHtml(brand)} page “${escapeHtml(title)}” to ${escapeHtml(cms)} as a draft, without a click. An Admin allowed this agent to publish and send on its own.`,
          `It passed Quality and your brand facts first. Nothing is live yet: the page waits in ${escapeHtml(cms)} as a draft.`,
        ],
    [
      site
        ? `<a href="${escapeHtml(url)}" style="${BUTTON}">Open the live page</a>`
        : `<a href="${escapeHtml(`${origin}/dashboard/content/editor/${draftId}`)}" style="${BUTTON}">Open the page</a>`,
      ...(chatId
        ? [
            `<a href="${escapeHtml(`${origin}/dashboard/chat/${chatId}`)}" style="${LINK_BUTTON}">Open the run</a>`,
          ]
        : []),
    ],
    "You get this as the agent's owner or one of the people it notifies, by your Chat settings' Notify me when an agent needs me.",
  );
  return { subject, html };
}

/**
 * The e-mail for an agent an edit stopped from going live on its own (§7.2's words).
 * @param {{ agent: string, agentId: string }} input
 */
export function renderGoLiveOffEmail({ agent, agentId }) {
  const subject = `${agent} no longer publishes on its own`;
  const html = frame(
    escapeHtml(subject),
    [
      `${escapeHtml(agent)} changed, so it no longer publishes on its own. Turn it on again if you still want it: an Admin ticks Publish and send on its own on the agent's Mode & approvals step.`,
    ],
    [
      `<a href="${escapeHtml(`${appOrigin()}/dashboard/agents/${agentId}`)}" style="${BUTTON}">Open the agent</a>`,
    ],
    "You get this as the Admin who allowed the agent, or as its owner, by your Chat settings' Notify me when an agent needs me.",
  );
  return { subject, html };
}

/**
 * A step an agent took live on its own (its chat_agent_go_live_events row,
 * done): the notices, their e-mails, and the action's History line. What
 * went out: { notices, emails, history }.
 * @param {{ eventId: string }} input
 */
export async function tellWentLive({ eventId }) {
  const event = await one(
    supabaseAdmin
      .from('chat_agent_go_live_events')
      .select(
        'id, organization_id, agent_id, agent_run_id, brand_id, content_draft_id, target, kind, status, published_url',
      )
      .eq('id', eventId),
  );
  if (!event || event.status !== 'done' || !event.agent_id || !event.content_draft_id) {
    return { notices: 0, emails: 0, history: false };
  }
  const orgId = event.organization_id;
  const [agent, run, draft, brand, convo] = await Promise.all([
    one(supabaseAdmin.from('chat_agents').select('name, owner_id').eq('id', event.agent_id)),
    event.agent_run_id
      ? one(
          supabaseAdmin
            .from('chat_agent_runs')
            .select('agent_version, acting_user_id')
            .eq('id', event.agent_run_id),
        )
      : null,
    one(
      supabaseAdmin
        .from('content_drafts')
        .select('title, action_id')
        .eq('id', event.content_draft_id),
    ),
    one(supabaseAdmin.from('brands').select('name').eq('id', event.brand_id)),
    event.agent_run_id
      ? one(
          supabaseAdmin
            .from('chat_conversations')
            .select('id')
            .eq('agent_run_id', event.agent_run_id)
            .limit(1),
        )
      : null,
  ]);
  if (!agent || !draft) return { notices: 0, emails: 0, history: false };
  const version = run?.agent_version
    ? await one(
        supabaseAdmin
          .from('chat_agent_versions')
          .select('notify_user_ids')
          .eq('agent_id', event.agent_id)
          .eq('version', run.agent_version),
      )
    : null;

  // The owner and the version's Notify people, those who are members and reach the brand.
  const members = await membersOf(orgId, [agent.owner_id, ...(version?.notify_user_ids ?? [])]);
  const readers = await brandReaders(orgId, [event.brand_id]);
  const people = members.filter((id) => readers.has(id));
  const title = draft.title?.trim() || 'Untitled page';
  const told = await tell({
    orgId,
    people,
    kind: 'agent_went_live',
    brandId: event.brand_id,
    dedupe: `went_live:${event.id}`,
    payload: {
      agent: agent.name,
      agentId: event.agent_id,
      title,
      target: event.target,
      kind: event.kind,
      draftId: event.content_draft_id,
      chatId: convo?.id ?? null,
      url: event.published_url ?? null,
    },
    email: renderWentLiveEmail({
      kind: event.kind,
      url: event.published_url ?? null,
      agent: agent.name,
      title,
      target: event.target,
      brand: brand?.name ?? 'your',
      draftId: event.content_draft_id,
      chatId: convo?.id ?? null,
    }),
  });

  // The action the page works on: its History says the agent sent or published it (once per step).
  let history = false;
  const site = event.kind === 'publish' && event.published_url ? siteOf(event.published_url) : null;
  const historyEvent = site ? 'agent_published' : 'agent_went_live';
  if (draft.action_id) {
    const { data: earlier, error } = await supabaseAdmin
      .from('action_events')
      .select('id')
      .eq('action_id', draft.action_id)
      .eq('event', historyEvent)
      .eq('data->>event_id', event.id)
      .limit(1);
    if (error) throw new Error(error.message);
    if ((earlier ?? []).length === 0) {
      const { error: insertError } = await supabaseAdmin.from('action_events').insert({
        action_id: draft.action_id,
        event: historyEvent,
        data: {
          source: 'chat',
          event_id: event.id,
          agent: agent.name,
          title,
          to: site ?? CMS_NAMES[event.target] ?? event.target,
        },
        actor_id: run?.acting_user_id ?? null,
      });
      if (insertError) throw new Error(insertError.message);
      history = true;
    }
  }
  return { ...told, history };
}

/**
 * An edit made a new version of an agent allowed for `version`: the Admin
 * who allowed it and its owner are told, once per version allowed, but not
 * `editor`, who made the change. Nothing when the agent wasn't allowed for
 * that version.
 * @param {{ orgId: string, agentId: string, version: number, editor?: string }} input
 */
export async function tellGoLiveOff({ orgId, agentId, version, editor }) {
  const [agent, permission] = await Promise.all([
    one(
      supabaseAdmin
        .from('chat_agents')
        .select('name, owner_id')
        .eq('id', agentId)
        .eq('organization_id', orgId),
    ),
    one(
      supabaseAdmin
        .from('chat_agent_go_live')
        .select('version, granted_by')
        .eq('agent_id', agentId)
        .eq('organization_id', orgId),
    ),
  ]);
  if (!agent || !permission || permission.version !== version) return { notices: 0, emails: 0 };
  const people = (await membersOf(orgId, [permission.granted_by, agent.owner_id])).filter(
    (id) => id !== editor,
  );
  return tell({
    orgId,
    people,
    kind: 'agent_go_live_off',
    dedupe: `go_live_off:${agentId}:${version}`,
    payload: { agent: agent.name, agentId },
    email: renderGoLiveOffEmail({ agent: agent.name, agentId }),
  });
}
