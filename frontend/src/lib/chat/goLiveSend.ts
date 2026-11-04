import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { API_BASE_URL } from '@/config/api';
import type { PublishDraftToCmsResult, SendDraftToCmsResult } from '@/lib/actions/cmsSend';
import type { CmsDelivery } from '@/lib/content/cmsSendClient';
import { CMS_NAMES, type ChatCmsTarget } from '@/lib/content/cmsNames';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { GoLivePage } from './goLiveFacts';
import type { GoLiveStep } from './registry/defineTool';

/**
 * A step an agent takes live on its own (AUTONOMOUS-GO-LIVE §5.4, §6.1):
 * its slot of the agent's daily limit, reserved before it goes
 * (reserve_agent_go_live, under a lock per agent, 00443), then the page sent
 * through the API's internal route as the run's person, where every
 * condition is checked again from the database (PR 4) and the slot is
 * finished: done, or failed and freed. Never tried again by itself. Server
 * only.
 */

const t = createTranslator({ locale: 'en', messages, namespace: 'chatEngine.goLive' });

export interface GoLiveSlot {
  organizationId: string;
  agentId: string;
  runId: string;
  agentRunId: string;
  brandId: string;
  toolKey: string;
  step: GoLiveStep;
  dailyLimit: number;
}

/**
 * The step's slot: its id, or null when the agent reached its daily limit.
 * A page and destination counted in the last 24 hours keeps its slot.
 * Throws when it can't be reserved: nothing goes out on its own then.
 */
export async function reserveGoLive(slot: GoLiveSlot): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('reserve_agent_go_live', {
    p_organization_id: slot.organizationId,
    p_agent_id: slot.agentId,
    p_run_id: slot.runId,
    p_agent_run_id: slot.agentRunId,
    p_brand_id: slot.brandId,
    p_content_draft_id: slot.step.draftId,
    p_tool_key: slot.toolKey,
    p_kind: slot.step.kind,
    p_target: slot.step.target,
    p_limit: slot.dailyLimit,
  });
  if (error) throw new Error(`Could not reserve the go-live slot: ${error.message}`);
  return typeof data === 'string' ? data : null;
}

/** Frees a reserved slot whose page never reached the API. Logged, never thrown. */
export async function releaseGoLive(id: string, why: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('finish_agent_go_live', {
    p_id: id,
    p_status: 'failed',
    p_error: why.slice(0, 500),
  });
  if (error) console.error('[chat/go-live] could not free a slot:', error.message);
}

export interface GoLiveSend {
  organizationId: string;
  agentRunId: string;
  runId: string;
  actingUserId: string;
  reservationId: string;
  step: GoLiveStep;
  page: GoLivePage;
}

/** The API's codes for a CMS the brand hasn't connected, or that refused its key. */
const NOT_CONNECTED = /^(no_|webhook_not_subscribed$)|_not_configured$|_not_ready$|_refused$/;

/**
 * Sends the page through the API's internal route (CRON_SECRET), answered as
 * the person's own send (sendDraftToCms) is, so the run reads it the same.
 * Never throws. A CMS draft (PR 5), or a new page published live (PR 9);
 * a webhook send comes with PR 11.
 */
export async function sendOnItsOwn(
  send: GoLiveSend,
): Promise<SendDraftToCmsResult | PublishDraftToCmsResult> {
  const target = send.step.target as ChatCmsTarget;
  const cms = CMS_NAMES[target] ?? send.step.target;
  const secret = process.env.CRON_SECRET;
  if (!secret || send.step.kind === 'webhook' || send.step.target === 'webhook') {
    await releaseGoLive(send.reservationId, 'not sent: no internal route for it');
    return { ok: false, reason: 'failed', message: t('notSent') };
  }
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/internal/chat/go-live/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify({
        orgId: send.organizationId,
        agentRunId: send.agentRunId,
        runId: send.runId,
        actingUserId: send.actingUserId,
        draftId: send.step.draftId,
        target,
        kind: send.step.kind,
        reservationId: send.reservationId,
        page: send.page,
      }),
      cache: 'no-store',
    });
  } catch (err) {
    // It may have gone: its slot stays counted, the closed side.
    console.error('[chat/go-live] the API could not be reached:', err);
    return { ok: false, reason: 'failed', message: t('unreached', { cms }) };
  }
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    delivery?: CmsDelivery | null;
  };
  if (!res.ok) {
    const code = body.code ?? '';
    const why = body.message || t('notSent');
    // The API's own check again (§5.4): the permission, the plan, the role or the slot changed.
    if (res.status === 403) return { ok: false, reason: 'forbidden_role', message: t('rechecked') };
    // The CMS refused the publish itself (PR 9), not its key: said before the refusals below.
    if (code === 'publish_refused') return { ok: false, reason: 'publish_refused', message: why };
    if (NOT_CONNECTED.test(code)) {
      return { ok: false, reason: 'not_connected', message: t('refused', { cms, why }) };
    }
    if (code === 'daily_limit') return { ok: false, reason: 'quota_exceeded', message: why };
    // A page live already stays the editor's; the CMS didn't publish it (it stays a draft there).
    if (code === 'live_item') return { ok: false, reason: 'live_item', message: why };
    if (code === 'in_progress') return { ok: false, reason: 'conflict', message: why };
    if (res.status === 404) return { ok: false, reason: 'not_found', message: why };
    if (res.status === 400 || res.status === 422)
      return { ok: false, reason: 'invalid', message: why };
    return { ok: false, reason: 'failed', message: t('refused', { cms, why }) };
  }
  const delivery = body.delivery ?? null;
  if (!delivery || delivery.status === 'failed') {
    const why = delivery?.error || t('notSent');
    return { ok: false, reason: 'failed', message: t('refused', { cms, why }) };
  }
  if (send.step.kind === 'publish') {
    return {
      ok: true,
      target: target as Exclude<ChatCmsTarget, 'framer'>,
      url: delivery.published_url ?? null,
    };
  }
  return {
    ok: true,
    target,
    status: delivery.status ?? 'queued',
    updated: delivery.updated ?? false,
    live: delivery.live ?? false,
  };
}
