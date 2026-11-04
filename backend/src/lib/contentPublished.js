import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from './access.js';
import { logger } from './logger.js';
import { onBrandDomain } from './audit/host.js';
import { closeTakenDown, shipCmsPublish } from './impact-ledger/ship.js';

/**
 * A sent page now live at `url` (Send to CMS #1331), as a webhook's
 * callback says (phase 1) or Webflow shows (phase 2): the delivery is
 * published there, and its page too when it is the page's latest delivery
 * (an older one's late word doesn't move the page's address back), keeping
 * the page in History as a "publish" version unless History's latest
 * version is already this page.
 *
 * A delivery published at the same address already changes nothing, but a
 * CMS id it now names. A new delivery of a page live at the same address
 * (the post updated in place) is the page as published again. The delivery
 * is written last: a write before it that fails throws, and the next try,
 * finding it not yet published, does it all again. Then the publish goes
 * into the impact ledger as a shipped change (shipCmsPublish).
 *
 * @param {{ id: string, draft_id: string|null, status: string, published_url: string|null }} delivery
 * @param {string} url
 * @param {{ externalId?: string|null }} [options]
 */
export async function markDeliveryPublished(delivery, url, { externalId = null } = {}) {
  const now = new Date().toISOString();
  const own = externalId ? { external_id: externalId } : {};

  if (delivery.status === 'published' && delivery.published_url === url) {
    if (externalId) {
      const { error } = await supabaseAdmin
        .from('content_draft_deliveries')
        .update(own)
        .eq('id', delivery.id);
      if (error) throw new Error(error.message);
    }
    return;
  }
  if (delivery.draft_id) {
    const { data: latest, error: latestError } = await supabaseAdmin
      .from('content_draft_deliveries')
      .select('id')
      .eq('draft_id', delivery.draft_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latestError) throw new Error(latestError.message);
    if (latest?.id === delivery.id) await markDraftPublished(delivery.draft_id, url, { at: now });
  }
  const { error: deliveryError } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'published', published_url: url, published_at: now, ...own })
    .eq('id', delivery.id);
  if (deliveryError) throw new Error(deliveryError.message);
  // A shipped change for the impact ledger (CHAT-22 §2), measured at 7, 14,
  // 30 and 90 days: behind CHAT_AGENTIC, once per send, and never throws.
  await shipCmsPublish({ deliveryId: delivery.id, url, publishedAt: now });
}

/**
 * A published send taken down to a draft in its CMS (AUTONOMOUS-GO-LIVE PR
 * 10), once the CMS did it: the send is taken_down (00460: the status sweeps
 * and the nightly ship fill leave it), then, each logged and never thrown, as
 * the page is down whatever they do:
 *   * the page's address cleared, back to Ready, when it is this send's;
 *   * an agent's go-live of that page and CMS taken_down (00443), which its
 *     agent page shows;
 *   * the open notices of that go-live closed: there is nothing left to take down;
 *   * its ship events' measurements Not measurable, taken_down.
 * A page someone took down never goes live on its own again (the send's
 * status, read by Chat and the internal go-live route).
 *
 * @param {{ id: string, draft_id: string|null, target: string, published_url: string|null }} delivery
 * @param {{ userId: string, at?: string }} options
 */
export async function markDeliveryTakenDown(delivery, { userId, at = new Date().toISOString() }) {
  const { data: taken, error } = await supabaseAdmin
    .from('content_draft_deliveries')
    .update({ status: 'taken_down', taken_down_at: at, taken_down_by: userId })
    .eq('id', delivery.id)
    .eq('status', 'published')
    .select('id');
  if (error) throw new Error(error.message);
  if (!taken?.length) return false;
  if (!delivery.draft_id) return true;
  const draftId = delivery.draft_id;
  const steps = [
    [
      'page address',
      async () => {
        const { data: draft, error: readError } = await supabaseAdmin
          .from('content_drafts')
          .select('published_url')
          .eq('id', draftId)
          .maybeSingle();
        if (readError) throw new Error(readError.message);
        if (!draft?.published_url || draft.published_url !== delivery.published_url) return;
        const { error: writeError } = await supabaseAdmin
          .from('content_drafts')
          .update({ status: 'ready', published_url: null, published_at: null })
          .eq('id', draftId)
          .eq('published_url', draft.published_url);
        if (writeError) throw new Error(writeError.message);
      },
    ],
    [
      'go-live step',
      async () => {
        const { error: stepError } = await supabaseAdmin
          .from('chat_agent_go_live_events')
          .update({ status: 'taken_down', taken_down_at: at, taken_down_by: userId })
          .eq('content_draft_id', draftId)
          .eq('target', delivery.target)
          .eq('kind', 'publish')
          .eq('status', 'done');
        if (stepError) throw new Error(stepError.message);
      },
    ],
    ['notices', () => tellTakenDown(draftId, at)],
  ];
  for (const [what, step] of steps) {
    try {
      await step();
    } catch (err) {
      logger.warn(
        { err: { name: err?.name, message: err?.message }, draftId },
        `[content-published] taken down, ${what} not updated`,
      );
    }
  }
  await closeTakenDown({ draftId, at });
  return true;
}

/** The open went-live notices of a page published on its own: closed, as it is down. */
async function tellTakenDown(draftId, at) {
  const { error } = await supabaseAdmin
    .from('chat_notices')
    .update({ resolved_at: at })
    .eq('kind', 'agent_went_live')
    .eq('payload->>draftId', draftId)
    .eq('payload->>kind', 'publish')
    .is('resolved_at', null);
  if (error) throw new Error(error.message);
}

const MAX_URL = 2048;
/** Tries at writing an action's live pages when another write lands between. */
const PAGE_WRITES = 3;
/** A task a person or the system can still complete: not done, skipped, failed or waiting. */
const OPEN_TASKS = ['todo', 'in_progress'];
/** The library tasks a draft is the work of, by its method (the web's DRAFT_TASK_KEYS). */
export const DRAFT_TASK_KEYS = {
  create: ['create_content_draft'],
  optimize: ['optimize_content', 'refresh_content'],
};
/** A task no longer outstanding work (the web's TASK_DONE). */
export const TASK_DONE = ['completed', 'skipped', 'failed'];
/** A draft whose writing is done. */
const DRAFT_DONE = ['ready', 'published'];

/**
 * An http(s) address as the browser reads it (no stray whitespace kept),
 * without sign-in details (they'd be stored and shown as a link), or null.
 */
export function liveAddress(value) {
  try {
    const url = new URL(String(value ?? '').trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    return url.href.length <= MAX_URL ? url.href : null;
  } catch {
    return null;
  }
}

/** Whether `url` is on one of the brand's domains, where its numbers can be read. */
export async function onBrandDomains(brandId, url) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain')
    .eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  return onBrandDomain(
    url,
    (data ?? []).map((d) => d.domain),
  );
}

/**
 * The draft's live address in what its action is measured on
 * (payload.publishedPages, by draft: read beside payload.pages by
 * basketScope; payload.pages stays the pages the action names, which its
 * tasks work through). A page published again moves; one off the brand's
 * domains leaves it, as its numbers can't be read. Written only when the
 * payload is still as read, read again when another write landed first.
 */
async function setLivePage(action, draftId, url) {
  let current = action;
  for (let attempt = 0; attempt < PAGE_WRITES; attempt++) {
    const payload = current.payload && typeof current.payload === 'object' ? current.payload : {};
    const live =
      payload.publishedPages && typeof payload.publishedPages === 'object'
        ? { ...payload.publishedPages }
        : {};
    if ((live[draftId] ?? null) === url) return;
    if (url) live[draftId] = url;
    else delete live[draftId];
    const { data, error } = await supabaseAdmin
      .from('actions')
      .update({
        payload: { ...payload, publishedPages: live },
        updated_at: new Date().toISOString(),
      })
      .eq('id', current.id)
      .eq('updated_at', current.updated_at)
      .select('id');
    if (error) throw new Error(error.message);
    if (data?.length) return;
    const { data: again, error: readError } = await supabaseAdmin
      .from('actions')
      .select('id, payload, updated_at')
      .eq('id', current.id)
      .maybeSingle();
    if (readError) throw new Error(readError.message);
    if (!again) return;
    current = again;
  }
  throw new Error('the action changed while its live page was written');
}

/** The brand pages an action names (payload.pages), once each, as the web's actionPages reads them. */
function namedPages(action) {
  const pages = action.payload?.pages;
  if (!Array.isArray(pages)) return [];
  return [...new Set(pages.filter((p) => typeof p === 'string' && /^https?:\/\//i.test(p)))];
}

/**
 * Whether the action's work is all live: a published create draft when it
 * has a Create task, and a published optimize draft for each page it names
 * when it has an Optimize or Refresh task (as Ready completes them). Work
 * whose task someone skipped isn't waited for.
 */
function workPublished(action, tasks, drafts) {
  const keys = new Set(
    tasks.filter((task) => task.status !== 'skipped').map((task) => task.task_key),
  );
  const live = drafts.filter((d) => d.status === 'published');
  if (keys.has('create_content_draft') && !live.some((d) => d.method === 'create')) return false;
  if (keys.has('optimize_content') || keys.has('refresh_content')) {
    const pages = namedPages(action);
    const optimized = new Set(live.filter((d) => d.method === 'optimize').map((d) => d.source_url));
    if (pages.some((page) => !optimized.has(page))) return false;
    if (!pages.length && !live.some((d) => d.method === 'optimize')) return false;
  }
  return true;
}

/**
 * Completes the tasks as read, each in the action's History naming the
 * draft (so taking the page back reopens it, as the web's reopenDraftTasks
 * reads the trail). A task changed meanwhile (skipped in the drawer, say)
 * is left as it is, with no entry. Returns how many it completed.
 */
async function completeTasks(actionId, todo, data, actorId) {
  const now = new Date().toISOString();
  let done = 0;
  for (const task of todo) {
    const { data: changed, error } = await supabaseAdmin
      .from('action_tasks')
      .update({ status: 'completed', skip_reason: null, updated_at: now })
      .eq('id', task.id)
      .eq('status', task.status)
      .select('id');
    if (error) throw new Error(error.message);
    if (!changed?.length) continue;
    done += 1;
    // Best effort, as the drawer's: a missing trail entry doesn't undo the change.
    await supabaseAdmin.from('action_events').insert({
      action_id: actionId,
      event: 'task_status',
      data: { taskId: task.id, to: 'completed', ...data },
      actor_id: actorId,
    });
  }
  return done;
}

/**
 * The page's own work, done as Mark ready does it (the web's
 * completeDraftTasks): its Create task, or its Optimize or Refresh task
 * once each page the action names has a ready or published draft. A page
 * published without Mark ready (sent straight to a CMS, or marked live at
 * an address) doesn't leave open the work Publish depends on.
 */
function ownTasks(action, draft, tasks, drafts) {
  const method = draft.method === 'create' ? 'create' : 'optimize';
  if (method === 'optimize') {
    const pages = namedPages(action);
    const done = new Set(
      drafts
        .filter((d) => d.method === 'optimize' && DRAFT_DONE.includes(d.status))
        .map((d) => d.source_url),
    );
    if (pages.length > 1 && pages.some((page) => !done.has(page))) return [];
  }
  return tasks.filter(
    (task) => DRAFT_TASK_KEYS[method].includes(task.task_key) && !TASK_DONE.includes(task.status),
  );
}

/**
 * A linked action, its draft live at `url`: the address joins what it's
 * measured on (when on the brand's domains), the page's own task is done
 * (ownTasks), and once all its work is live, its open Publish task is done
 * too, each in its History. A deleted action (00168) is left as it is.
 * Returns whether the Publish task was completed.
 */
async function completePublishTask(draft, url, { actorId = null, onDomain } = {}) {
  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .select('id, payload, updated_at')
    .eq('id', draft.action_id)
    .eq('brand_id', draft.brand_id)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!action) return false;
  const measured = onDomain ?? (await onBrandDomains(draft.brand_id, url));
  await setLivePage(action, draft.id, measured ? url : null);

  const { data: tasks, error: tasksError } = await supabaseAdmin
    .from('action_tasks')
    .select('id, task_key, status')
    .eq('action_id', action.id);
  if (tasksError) throw new Error(tasksError.message);
  const { data: drafts, error: draftsError } = await supabaseAdmin
    .from('content_drafts')
    .select('id, method, source_url, status')
    .eq('action_id', action.id)
    .is('archived_at', null);
  if (draftsError) throw new Error(draftsError.message);

  const changed = await completeTasks(
    action.id,
    ownTasks(action, draft, tasks ?? [], drafts ?? []),
    { draftId: draft.id },
    actorId,
  );
  const todo = (tasks ?? []).filter(
    (task) => task.task_key === 'publish_content' && OPEN_TASKS.includes(task.status),
  );
  const publish =
    todo.length > 0 && workPublished(action, tasks ?? [], drafts ?? [])
      ? await completeTasks(action.id, todo, { draftId: draft.id, publishedUrl: url }, actorId)
      : 0;
  if (changed + publish > 0) {
    await supabaseAdmin
      .from('actions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', action.id);
  }
  return publish > 0;
}

/**
 * A page live at `url` (CE-013): Published, at that address, since `at`,
 * kept in History as a "publish" version (00215 keeps it for the server)
 * unless History's latest version is already this page; and its linked
 * action told (completePublishTask). The page is published whatever the
 * action's part does: that is logged, not thrown.
 *
 * @returns {Promise<{ taskCompleted: boolean }>}
 */
export async function markDraftPublished(
  draftId,
  url,
  { at = new Date().toISOString(), actorId = null, onDomain } = {},
) {
  const { data: draft, error } = await supabaseAdmin
    .from('content_drafts')
    .update({ status: 'published', published_url: url, published_at: at })
    .eq('id', draftId)
    .select('id, brand_id, action_id, method')
    .maybeSingle();
  if (error) throw new Error(error.message);
  const { error: keepError } = await supabaseAdmin.rpc('content_draft_snapshot', {
    p_draft_id: draftId,
    p_origin: 'publish',
  });
  if (keepError) {
    logger.warn({ err: keepError }, '[content-published] publish version not kept');
  }
  if (!draft?.action_id) return { taskCompleted: false };
  try {
    return { taskCompleted: await completePublishTask(draft, url, { actorId, onDomain }) };
  } catch (err) {
    logger.warn(
      { err: { name: err?.name, message: err?.message }, draftId },
      '[content-published] action not told',
    );
    return { taskCompleted: false };
  }
}

/**
 * A person marks a page live at `url` (CE-013): it becomes Published there
 * (markDraftPublished), so its Live page tab measures that address, and its
 * linked action is told. Says whether the address is on the brand's
 * domains: off them, it's kept, but its numbers can't be read.
 *
 * @param {{ id: string, brand_id: string }} draft
 * @returns {Promise<{ publishedUrl: string, publishedAt: string, taskCompleted: boolean, onBrandDomain: boolean }>}
 */
export async function publishDraft(draft, url, actorId) {
  const at = new Date().toISOString();
  const onDomain = await onBrandDomains(draft.brand_id, url);
  const { taskCompleted } = await markDraftPublished(draft.id, url, { at, actorId, onDomain });
  return { publishedUrl: url, publishedAt: at, taskCompleted, onBrandDomain: onDomain };
}

/**
 * The same mark for an MCP API key (`mark_content_draft_published`): the key
 * carries no session, so the web MCP layer passes the key's organization and
 * user. As the route, the draft must be the organization's, of a brand the
 * user reaches, and not archived;
 * null when it isn't (another's reads as not there). A page already
 * published at `url` is left as it is, its live-since time kept, so a call
 * made again changes nothing (the tool says it is idempotent).
 *
 * @param {{ draftId: string, url: string, userId: string, orgId: string }} input
 * @returns {Promise<{ publishedUrl: string, publishedAt: string, taskCompleted: boolean, onBrandDomain: boolean } | null>}
 */
export async function publishDraftForKeyUser({ draftId, url, userId, orgId }) {
  const { data: draft, error } = await supabaseAdmin
    .from('content_drafts')
    .select(
      'id, brand_id, action_id, archived_at, status, published_url, published_at, brands!inner(organization_id)',
    )
    .eq('id', draftId)
    .eq('brands.organization_id', orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!draft || draft.archived_at) return null;
  // The key's user must reach the draft's brand (Selected brands, as the
  // route has it); a brand they weren't given reads as not there.
  try {
    await assertBrandAccess(draft.brand_id, userId);
  } catch (err) {
    if (err.status === 403 || err.status === 404) return null;
    throw err;
  }
  if (draft.status === 'published' && draft.published_url === url) {
    return {
      publishedUrl: url,
      publishedAt: draft.published_at,
      taskCompleted: false,
      onBrandDomain: await onBrandDomains(draft.brand_id, url),
    };
  }
  return publishDraft(
    { id: draft.id, brand_id: draft.brand_id, action_id: draft.action_id },
    url,
    userId,
  );
}
