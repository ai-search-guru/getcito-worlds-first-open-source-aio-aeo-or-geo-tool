import { BROWSER_API_BASE_URL } from '@/config/api';
import { apiFailure } from '@/lib/apiFailure';
import { createClient } from '@/lib/supabase/client';
import type { CmsFields, CmsPage } from '@/lib/content/cmsSend';
import { lastSend } from '@/lib/content/cmsStatus';

/**
 * Send to CMS from the browser (#1331), through the API's same-origin proxy:
 * not a server action, whose body is limited to 1 MB (25 pages are more) and
 * which Next runs one at a time, behind the editor's own.
 */

/**
 * Where pages go: the brand's webhook (phase 1), its Webflow collection, its
 * WordPress site, its Framer collection or its Wix site's Blog (phase 2).
 */
export type CmsTarget = 'webhook' | 'webflow' | 'wordpress' | 'framer' | 'wix';

/** Why a send didn't go, as the server names it. */
export type CmsSendError =
  | 'no_webhook'
  | 'webhook_not_subscribed'
  // Webflow (00283, 00284): not on this server, not connected, its token
  // refused, no collection picked, or the page already on its way.
  | 'webflow_not_configured'
  | 'no_webflow'
  | 'webflow_refused'
  | 'webflow_not_ready'
  // WordPress (00294): not on this server, not connected, or its sign-in refused.
  | 'wordpress_not_configured'
  | 'no_wordpress'
  | 'wordpress_refused'
  // Framer (00295): not on this server, not connected, its API key refused,
  // or no collection and fields picked.
  | 'framer_not_configured'
  | 'no_framer'
  | 'framer_refused'
  | 'framer_not_ready'
  // Wix (00372): not on this server, not connected, or its API key refused.
  | 'wix_not_configured'
  | 'no_wix'
  | 'wix_refused'
  | 'in_progress'
  | 'daily_limit'
  | 'forbidden'
  | 'not_found'
  | 'invalid'
  | 'failed'
  // More than the API's proxy takes in one request (413).
  | 'too_large'
  // Not a send's own: the session, another workspace's brand, the rate limiter,
  // a read-only workspace (the upgrade dialog, not a message).
  | 'session'
  | 'workspace'
  | 'busy'
  | 'subscription';

export interface CmsDelivery {
  id: string;
  draftId: string;
  /** taken_down: a person took the published page down to a draft in its CMS (00460). */
  status: 'queued' | 'sent' | 'failed' | 'published' | 'taken_down';
  /** What the webhook answered, when it did. */
  http_status?: number | null;
  /** Why it failed, as the server wrote it ("The webhook could not be reached"). */
  error?: string | null;
  /**
   * Webflow, WordPress or Framer, one page: its item (or draft post)
   * updated, not made, and what of the page changed on the way: Webflow's
   * tables and images, WordPress's JSON-LD blocks left out, Framer's images.
   */
  updated?: boolean;
  changed?: { tables?: number; images?: number; jsonLd?: number };
  /**
   * WordPress: the page's post was live, so the page went as a new draft
   * post. Framer: the item updated isn't a draft, so the page goes live with
   * the site's next publish.
   */
  live?: boolean;
  /** Where it went live, for a page published from Chat (AUTONOMOUS-GO-LIVE PR 9). */
  published_url?: string | null;
}

export type CmsSendResult =
  /** `skipped`: pages past the workspace's sends for the day, not sent. */
  | { ok: true; deliveries: CmsDelivery[]; skipped: number }
  | { ok: false; code: CmsSendError; field: string | null };

/** A send's own reasons, by the server's code. */
const KNOWN: readonly CmsSendError[] = [
  'no_webhook',
  'webhook_not_subscribed',
  'webflow_not_configured',
  'no_webflow',
  'webflow_refused',
  'webflow_not_ready',
  'wordpress_not_configured',
  'no_wordpress',
  'wordpress_refused',
  'framer_not_configured',
  'no_framer',
  'framer_refused',
  'framer_not_ready',
  'wix_not_configured',
  'no_wix',
  'wix_refused',
  'in_progress',
  'daily_limit',
  'forbidden',
  'not_found',
  'invalid',
];

/** The reasons any call can fail for, as the other calls read them (BUG-001). */
const GENERAL: readonly CmsSendError[] = ['session', 'workspace', 'busy', 'subscription'];

/**
 * Sends pages of one brand to its webhook, its Webflow collection, its
 * WordPress site or its Framer collection: one is sent before this answers,
 * more go on.
 */
export async function sendPagesToCms(
  brandId: string,
  pages: CmsPage[],
  target: CmsTarget = 'webhook',
): Promise<CmsSendResult> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return { ok: false, code: 'session', field: null };
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/content-drafts/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId, pages, target }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      code?: string;
      field?: string | null;
      deliveries?: CmsDelivery[];
      skipped?: number;
    };
    if (!res.ok) {
      if (res.status === 413) return { ok: false, code: 'too_large', field: null };
      const general = apiFailure(res.status, body);
      const code =
        KNOWN.find((c) => c === body.code) ?? GENERAL.find((c) => c === general) ?? 'failed';
      return { ok: false, code, field: body.field ?? null };
    }
    return { ok: true, deliveries: body.deliveries ?? [], skipped: body.skipped ?? 0 };
  } catch (err) {
    console.error('Failed to send to the CMS:', err);
    return { ok: false, code: 'failed', field: null };
  }
}

/**
 * Asks the API to read the brand's pages sent to a CMS that says when a page
 * goes live there, and mark the ones published since. The pages it marked,
 * by draft; none when it couldn't read or read a moment ago.
 */
async function refreshPublished(
  brandId: string,
  route: 'webflow-status' | 'wordpress-status' | 'framer-status' | 'wix-status',
  label: string,
): Promise<string[]> {
  try {
    const {
      data: { session },
    } = await createClient().auth.getSession();
    if (!session) return [];
    const res = await fetch(`${BROWSER_API_BASE_URL}/api/content-drafts/${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ brandId }),
    });
    if (!res.ok) return [];
    const body = (await res.json().catch(() => ({}))) as {
      published?: { draftId?: string | null }[];
    };
    return (body.published ?? []).flatMap((p) => (p.draftId ? [p.draftId] : []));
  } catch (err) {
    console.error(`Failed to read the pages sent to ${label}:`, err);
    return [];
  }
}

/** The brand's pages sent to Webflow, published there since (#1331, phase 2). */
export function refreshWebflowPublished(brandId: string): Promise<string[]> {
  return refreshPublished(brandId, 'webflow-status', 'Webflow');
}

/** The brand's pages sent to WordPress as draft posts, published there since (00294). */
export function refreshWordPressPublished(brandId: string): Promise<string[]> {
  return refreshPublished(brandId, 'wordpress-status', 'WordPress');
}

/** The brand's pages sent to Wix as draft posts, published there since (00372). */
export function refreshWixPublished(brandId: string): Promise<string[]> {
  return refreshPublished(brandId, 'wix-status', 'Wix');
}

/** The brand's pages sent to Framer as draft items, published there since (00295). */
export function refreshFramerPublished(brandId: string): Promise<string[]> {
  return refreshPublished(brandId, 'framer-status', 'Framer');
}

/** A draft's last send, as the Library shows it beside its status. */
export interface CmsStatus {
  status: CmsDelivery['status'];
  /**
   * Where it went: the webhook, Webflow or Framer (a draft item there once
   * sent) or WordPress (a draft post).
   */
  target: CmsTarget;
  /** When it was published, sent or queued. */
  at: string;
  /** What the webhook answered, when it did; else why it wasn't reached. */
  httpStatus: number | null;
  error: string | null;
  publishedUrl: string | null;
  /**
   * An agent sent it on its own (AUTONOMOUS-GO-LIVE §6.4, 00444): its name,
   * or null when it can't be read by the person; absent for a person's send.
   */
  agent?: { name: string | null };
}

/** Ids a read takes: content_draft_last_deliveries (00262) reads up to 500. */
const STATUS_IDS_PER_READ = 500;

/**
 * Each draft's last send, for the Library's rows: one row a draft, however
 * often it was sent. A read that fails (its function not there yet, 00262)
 * leaves its drafts with none.
 */
export async function readCmsStatuses(draftIds: string[]): Promise<Map<string, CmsStatus>> {
  const supabase = createClient();
  const chunks: string[][] = [];
  for (let i = 0; i < draftIds.length; i += STATUS_IDS_PER_READ) {
    chunks.push(draftIds.slice(i, i + STATUS_IDS_PER_READ));
  }
  const reads = await Promise.all(
    chunks.map((ids) => supabase.rpc('content_draft_last_deliveries', { p_draft_ids: ids })),
  );
  const statuses = new Map<string, CmsStatus>();
  const byAgent = new Map<string, string>();
  for (const { data, error } of reads) {
    if (error) {
      console.error('Failed to read the pages’ sends:', error);
      continue;
    }
    for (const row of data ?? []) {
      if (!row.draft_id) continue;
      statuses.set(row.draft_id, {
        ...lastSend(row),
        httpStatus: row.http_status,
        publishedUrl: row.published_url,
      });
      if (row.agent_run_id) byAgent.set(row.draft_id, row.agent_run_id);
    }
  }
  if (byAgent.size > 0) {
    const names = await agentNamesOf(supabase, [...new Set(byAgent.values())]);
    for (const [draftId, runId] of byAgent) {
      const status = statuses.get(draftId);
      if (status) statuses.set(draftId, { ...status, agent: { name: names.get(runId) ?? null } });
    }
  }
  return statuses;
}

/**
 * The agents of agent runs, by run, as the person may read them; a run or an
 * agent they can't see is left out (the send then says "an agent").
 */
async function agentNamesOf(
  supabase: ReturnType<typeof createClient>,
  runIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const { data: runs, error } = await supabase
    .from('chat_agent_runs')
    .select('id, agent_id')
    .in('id', runIds);
  if (error) {
    console.error('Failed to read who sent the pages:', error);
    return names;
  }
  const agentIds = [
    ...new Set((runs ?? []).map((run) => run.agent_id).filter((id): id is string => !!id)),
  ];
  if (agentIds.length === 0) return names;
  const { data: agents, error: agentsError } = await supabase
    .from('chat_agents')
    .select('id, name')
    .in('id', agentIds);
  if (agentsError) {
    console.error('Failed to read who sent the pages:', agentsError);
    return names;
  }
  const nameOf = new Map((agents ?? []).map((agent) => [agent.id, agent.name]));
  for (const run of runs ?? []) {
    const name = run.agent_id ? nameOf.get(run.agent_id) : undefined;
    if (name) names.set(run.id, name);
  }
  return names;
}

/** What a draft keeps of its sends: its slug and meta, where it went live, and its last send. */
export interface DraftCms {
  fields: Partial<CmsFields>;
  publishedUrl: string | null;
  last: {
    status: CmsDelivery['status'];
    target: CmsTarget;
    at: string;
    error: string | null;
  } | null;
}

/**
 * The draft's kept fields and last send, read when the Send dialog opens.
 * Null when they can't be read: the dialog then holds Send, with Try again
 * (a page sent before under another slug could otherwise land twice).
 */
export async function readDraftCms(draftId: string): Promise<DraftCms | null> {
  const supabase = createClient();
  const [draft, last] = await Promise.all([
    supabase
      .from('content_drafts')
      .select('slug, meta_title, meta_description, published_url')
      .eq('id', draftId)
      .maybeSingle(),
    supabase
      .from('content_draft_deliveries')
      .select('status, created_at, sent_at, published_at, error, target')
      .eq('draft_id', draftId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (draft.error || !draft.data) {
    if (draft.error) console.error('Failed to read the page’s CMS fields:', draft.error);
    return null;
  }
  const delivery = last.error ? null : last.data;
  return {
    fields: {
      slug: draft.data.slug ?? undefined,
      metaTitle: draft.data.meta_title ?? undefined,
      metaDescription: draft.data.meta_description ?? undefined,
    },
    publishedUrl: draft.data.published_url,
    last: delivery ? lastSend(delivery) : null,
  };
}

/**
 * The slug and meta each draft kept from its last send, for a bulk send
 * (the dialog's single read is readDraftCms); none for a draft that kept
 * none. Throws when they can't be read: sent with the page's own slug, a
 * page sent before could land in the CMS twice.
 */
export async function readKeptFields(draftIds: string[]): Promise<Map<string, Partial<CmsFields>>> {
  const kept = new Map<string, Partial<CmsFields>>();
  if (!draftIds.length) return kept;
  const { data, error } = await createClient()
    .from('content_drafts')
    .select('id, slug, meta_title, meta_description')
    .in('id', draftIds);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    kept.set(row.id, {
      slug: row.slug ?? undefined,
      metaTitle: row.meta_title ?? undefined,
      metaDescription: row.meta_description ?? undefined,
    });
  }
  return kept;
}

/** Sends as they are now, by id: a bulk send's, while they go. Null when they can't be read. */
export async function readDeliveries(ids: string[]): Promise<CmsDelivery[] | null> {
  if (!ids.length) return [];
  const { data, error } = await createClient()
    .from('content_draft_deliveries')
    .select('id, draft_id, status, http_status, error')
    .in('id', ids);
  if (error) {
    console.error('Failed to read the sends:', error);
    return null;
  }
  return (data ?? []).map((row) => ({
    id: row.id,
    draftId: row.draft_id ?? '',
    status: row.status as CmsDelivery['status'],
    http_status: row.http_status,
    error: row.error,
  }));
}
