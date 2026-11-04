'use server';

import { API_BASE_URL } from '@/config/api';
import { bulkCmsItems, type BulkProblem, type CmsFields } from '@/lib/content/cmsSend';
import { CHAT_CMS_TARGETS, type ChatCmsTarget } from '@/lib/content/cmsNames';
import type { CmsDelivery } from '@/lib/content/cmsSendClient';
import { readCmsSources } from '@/lib/content/cmsSources';
import { withContentDom } from '@/lib/content/serverDom';
import { assertWritable } from '@/lib/subscriptionGuard';
import { createClient } from '@/lib/supabase/server';

export type SendDraftToCmsResult =
  | {
      ok: true;
      target: ChatCmsTarget;
      /** As the API answers the page's send: sent, still on its way, or already live. */
      status: CmsDelivery['status'];
      /** Its CMS item (or draft post) was updated, not made. */
      updated: boolean;
      /** WordPress: a new draft post beside the live one; Framer: live with the site's next publish. */
      live: boolean;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_connected'
        | 'invalid'
        | 'quota_exceeded'
        | 'conflict'
        | 'forbidden_role'
        | 'execute_off'
        | 'live_item'
        | 'failed';
      message: string;
    };

/** Where a page is published live from Chat (AUTONOMOUS-GO-LIVE PR 9): Framer publishes whole sites. */
export type PublishCmsTarget = Exclude<ChatCmsTarget, 'framer'>;

export type PublishDraftToCmsResult =
  | {
      ok: true;
      target: PublishCmsTarget;
      /** Its live address; null when the CMS put it live but its address wasn't read yet. */
      url: string | null;
    }
  | Extract<SendDraftToCmsResult, { ok: false }>
  | { ok: false; reason: 'publish_refused'; message: string };

/** Why a page can't go as it is, in words (the editor's Send dialog says where to fix it). */
const PROBLEM_WORDS: Record<BulkProblem, string> = {
  noTitle: 'The page needs a title before it can be sent.',
  longTitle: 'The page’s title is too long for the CMS.',
  empty: 'The page is empty.',
  tooLong: 'The page is too long for the CMS.',
  placeholders: 'The page still has placeholders to fill. Fill them in the Content Editor first.',
  slug: 'The page needs a slug. Set it in Send to CMS in the Content Editor.',
  metaTitle: 'The page’s meta title is too long. Change it in Send to CMS in the Content Editor.',
  metaDescription:
    'The page’s meta description is too long. Change it in Send to CMS in the Content Editor.',
};

/** The API's codes for a CMS the brand hasn't connected, or hasn't set up for sends. */
const NOT_CONNECTED = new Set([
  'no_webhook',
  'webhook_not_subscribed',
  'webflow_not_configured',
  'no_webflow',
  'webflow_not_ready',
  'wordpress_not_configured',
  'no_wordpress',
  'framer_not_configured',
  'no_framer',
  'framer_not_ready',
  'wix_not_configured',
  'no_wix',
]);

/**
 * Send one Library draft to the brand's CMS as a draft: Chat's push_cms_draft
 * (CHAT-20 §9 row 58), an EXECUTE in the publishing group. Admins and
 * Managers, checked here as the API checks them, and a Manager only while an
 * Admin hasn't turned publishing off for Managers (sendAccess). A page that
 * went live (published_url, or a send published) isn't sent: its CMS item
 * would change on the live site, with the CMS's next publish (live_item; the
 * Content Editor sends it). The page is made ready
 * as the Library's bulk send makes each (readCmsSources, bulkCmsItems: its
 * author and byline, the slug and meta it kept from its last send, else the
 * page's) and goes through the API's own send, as the signed-in member: its
 * connections and its daily limit. Nothing goes live: the CMS keeps it as a
 * draft (DECISIONS 1). Errors come back as values (#427).
 */
export async function sendDraftToCms(
  draftId: string,
  target: ChatCmsTarget,
): Promise<SendDraftToCmsResult> {
  try {
    await assertWritable();
    return (await sendOne(draftId, target)) as SendDraftToCmsResult;
  } catch (err) {
    console.error('Failed to send the page to the CMS:', err);
    return { ok: false, reason: 'failed', message: 'The page couldn’t be sent. Try again.' };
  }
}

/**
 * Whether the signed-in member may send: an Admin, or a Manager while the
 * publishing group is on for Managers (Settings › Chat, "Managers can't go
 * live": chat_settings.manager_execute_off). Chat decides the same before
 * its card and again on the click (precedence.ts); a server action can be
 * called without Chat, so it checks for itself, on the member's own client.
 */
async function sendAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<'ok' | 'forbidden_role' | 'execute_off'> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 'forbidden_role';
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('role, organization_id')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (profile?.role === 'admin') return 'ok';
  if (profile?.role !== 'manager' || !profile.organization_id) return 'forbidden_role';
  const { data: settings, error: settingsError } = await supabase
    .from('chat_settings')
    .select('manager_execute_off')
    .eq('organization_id', profile.organization_id)
    .maybeSingle();
  if (settingsError) throw new Error(settingsError.message);
  return settings?.manager_execute_off.includes('publishing') ? 'execute_off' : 'ok';
}

/**
 * Publish one new Library page live in the brand's CMS (AUTONOMOUS-GO-LIVE
 * PR 9, Chat's publish_cms): an EXECUTE in the publishing group, checked as
 * Send to CMS is (Admins and Managers, not Managers while publishing is off
 * for them, not a page live already). The page is made ready as Send to CMS
 * makes it and goes through the API's publish (POST
 * /api/content-drafts/publish-cms), which writes it into its CMS draft and
 * puts it live there: Webflow, WordPress or Wix. Errors come back as values.
 */
export async function publishDraftToCms(
  draftId: string,
  target: PublishCmsTarget,
): Promise<PublishDraftToCmsResult> {
  try {
    await assertWritable();
    return (await sendOne(draftId, target, true)) as PublishDraftToCmsResult;
  } catch (err) {
    console.error('Failed to publish the page:', err);
    return { ok: false, reason: 'failed', message: 'The page couldn’t be published. Try again.' };
  }
}

async function sendOne(
  draftId: string,
  target: ChatCmsTarget,
  publish = false,
): Promise<SendDraftToCmsResult | PublishDraftToCmsResult> {
  if (publish && target === 'framer') {
    return {
      ok: false,
      reason: 'invalid',
      message:
        'Framer publishes the whole site at once: send the draft, then publish it in Framer.',
    };
  }
  if (!CHAT_CMS_TARGETS.includes(target)) {
    return {
      ok: false,
      reason: 'invalid',
      message: 'Chat sends to Webflow, WordPress, Framer or Wix. Send it from the Content Editor.',
    };
  }
  const supabase = await createClient();
  const access = await sendAccess(supabase);
  if (access === 'forbidden_role') {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can send a page to the CMS.',
    };
  }
  if (access === 'execute_off') {
    return {
      ok: false,
      reason: 'execute_off',
      message: 'An Admin turned publishing off for Managers.',
    };
  }
  const [{ data: draft, error }, published] = await Promise.all([
    supabase
      .from('content_drafts')
      .select(
        'id, brand_id, slug, meta_title, meta_description, published_url, archived_at, brands(name, language)',
      )
      .eq('id', draftId)
      .maybeSingle(),
    supabase
      .from('content_draft_deliveries')
      .select('id')
      .eq('draft_id', draftId)
      .eq('status', 'published')
      .limit(1)
      .maybeSingle(),
  ]);
  if (error) return { ok: false, reason: 'failed', message: error.message };
  if (!draft || draft.archived_at) {
    return { ok: false, reason: 'not_found', message: 'That draft isn’t in the Library.' };
  }
  // Whether it is live can't be told: nothing is sent.
  if (published.error) return { ok: false, reason: 'failed', message: published.error.message };
  if (draft.published_url || published.data) {
    return {
      ok: false,
      reason: 'live_item',
      message: publish
        ? 'This page is live already; change it from the Content Editor.'
        : 'This page is live; send it from the Content Editor.',
    };
  }
  const brand = (Array.isArray(draft.brands) ? draft.brands[0] : draft.brands) as {
    name?: string;
    language?: string | null;
  } | null;

  await withContentDom();
  const sources = await readCmsSources({
    brandId: draft.brand_id,
    draftIds: [draftId],
    brandName: brand?.name ?? '',
    brandLanguage: brand?.language,
  });
  const source = sources.get(draftId);
  if (!source)
    return { ok: false, reason: 'not_found', message: 'That draft isn’t in the Library.' };
  const kept = new Map<string, Partial<CmsFields>>([
    [
      draftId,
      {
        slug: draft.slug ?? undefined,
        metaTitle: draft.meta_title ?? undefined,
        metaDescription: draft.meta_description ?? undefined,
      },
    ],
  ]);
  const [item] = bulkCmsItems([source], kept);
  if (!item?.page) {
    return {
      ok: false,
      reason: 'invalid',
      message: item?.problem ? PROBLEM_WORDS[item.problem] : 'The page can’t be sent as it is.',
    };
  }

  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session)
    return { ok: false, reason: 'failed', message: 'Your session ended. Sign in again.' };
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}/api/content-drafts/${publish ? 'publish-cms' : 'send'}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(
        publish
          ? { brandId: draft.brand_id, page: item.page, target }
          : { brandId: draft.brand_id, pages: [item.page], target },
      ),
    });
  } catch (err) {
    console.error('Failed to send the page to the CMS:', err);
    return { ok: false, reason: 'failed', message: 'The CMS couldn’t be reached. Try again.' };
  }
  const body = (await res.json().catch(() => ({}))) as {
    code?: string;
    error?: string;
    deliveries?: CmsDelivery[];
    delivery?: CmsDelivery | null;
    url?: string | null;
  };
  if (!res.ok) {
    const code = body.code ?? '';
    const message = body.error || 'The page couldn’t be sent.';
    // The CMS refused the publish itself (PR 9): said before the key's refusals below.
    if (code === 'publish_refused') return { ok: false, reason: 'publish_refused', message };
    // The CMS refused its connection's key: it is connected again in Settings › Integrations.
    if (NOT_CONNECTED.has(code) || code.endsWith('_refused')) {
      return { ok: false, reason: 'not_connected', message };
    }
    if (code === 'daily_limit') return { ok: false, reason: 'quota_exceeded', message };
    if (code === 'in_progress') return { ok: false, reason: 'conflict', message };
    if (code === 'live_item') return { ok: false, reason: 'live_item', message };
    if (code === 'execute_off') return { ok: false, reason: 'execute_off', message };
    if (res.status === 403) return { ok: false, reason: 'forbidden_role', message };
    if (res.status === 404) return { ok: false, reason: 'not_found', message };
    if (res.status === 400 || res.status === 422) return { ok: false, reason: 'invalid', message };
    return { ok: false, reason: 'failed', message };
  }
  if (publish) {
    if (body.delivery?.status === 'failed') {
      return {
        ok: false,
        reason: 'failed',
        message: body.delivery.error || 'The CMS refused the page.',
      };
    }
    return { ok: true, target: target as PublishCmsTarget, url: body.url ?? null };
  }
  const [delivery] = body.deliveries ?? [];
  if (delivery?.status === 'failed') {
    return {
      ok: false,
      reason: 'failed',
      message: delivery.error || 'The CMS refused the page.',
    };
  }
  return {
    ok: true,
    target,
    status: delivery?.status ?? 'queued',
    updated: delivery?.updated ?? false,
    live: delivery?.live ?? false,
  };
}
