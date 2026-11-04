/**
 * A published page that links products no longer for sale (shopping path,
 * part 7): after each catalog sync the shopping check reads the live page
 * again (shoppingCheck.js), and a page linking a product that is sold out,
 * refused by Merchant Center or gone from the catalog gets a Fix action with
 * one task: swap them for products that sell, the page's own shopping path
 * naming the ones in stock.
 *
 * The same check closes it, after a sync or by Check now on its task
 * (action-center/taskChecks.js): once the live page links none of them,
 * its task is completed as checked automatically (AC-010's task_checked),
 * and the action too unless someone added work to it, each in its History.
 * One open action per page (its draft). A page whose action
 * someone dismissed isn't raised again for the same products; one closed
 * while they still don't sell waits REST_DAYS. Nothing is measured
 * afterwards (no KPI): the page links them or it doesn't.
 */

import supabaseAdmin from '../../config/supabase.js';
import { priorityOnCreate } from './priorityData.js';

export const SHOPPING_LINKS_ACTION_KIND = 'shopping_links';

/** A completed action's products, still linked, wait this long for a new one. */
export const REST_DAYS = 7;

const ACTIVE = ['new', 'in_progress', 'on_hold'];
const OPEN_TASKS = ['todo', 'in_progress'];
const DAY_MS = 86_400_000;
/** The products a task names; the rest it counts. */
const NAMED = 3;
/** A product's name in a task's text. */
const NAME_CHARS = 60;
/** The task this module writes, by its details' source: the one the check completes. */
const TASK_SOURCE = 'shopping_check';

/** One open action per page: its draft's. */
export function shoppingLinksDedupKey(draftId) {
  return `${SHOPPING_LINKS_ACTION_KIND}:${draftId}`;
}

const STATE_TEXT = {
  sold_out: 'is sold out',
  refused: 'is refused by Merchant Center',
  gone: 'is no longer in your catalog',
};

const nameOf = (product) => {
  const title = String(product?.title ?? '').trim() || 'A product';
  return title.length > NAME_CHARS ? `${title.slice(0, NAME_CHARS - 1)}…` : title;
};

/** "A", "A and B", "A, B and C", "A, B, C and 2 more". */
function names(products) {
  const named = products.slice(0, NAMED).map(nameOf);
  const more = products.length - named.length;
  if (more > 0) return `${named.join(', ')} and ${more} more`;
  if (named.length < 2) return named.join('');
  return `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`;
}

/**
 * The task: what no longer sells and why, the steps, the products of the
 * page's path to link instead, and how it's done. Checked by the next
 * catalog sync's shopping check, or now by Check now on its draft
 * (`draftId`), not by the nightly page sweep: it reads no change text.
 *
 * @param {{ draftId: string, pageUrl: string, bad: Array<{ title: string, state: string }>,
 *   swaps: Array<{ title: string }> }} page
 */
export function shoppingLinksTask({ draftId, pageUrl, bad, swaps }) {
  const reasons = bad
    .slice(0, NAMED)
    .map((p) => `${nameOf(p)} ${STATE_TEXT[p.state] ?? STATE_TEXT.gone}`)
    .join('; ');
  const more = bad.length > NAMED ? `; and ${bad.length - NAMED} more` : '';
  return {
    title:
      bad.length === 1
        ? 'Swap the product that no longer sells'
        : `Swap the ${bad.length} products that no longer sell`,
    details: {
      source: TASK_SOURCE,
      draftId,
      url: pageUrl,
      where: pageUrl,
      why: `${reasons}${more}. Readers and AI answers that follow those links land on a product they can't buy.`,
      how: [
        'Open the page in the Content Editor.',
        `Remove or replace the links to ${names(bad)}.`,
        ...(swaps.length
          ? [`Link ${names(swaps)} instead: in stock, from the page's shopping path.`]
          : []),
        'Publish the page again.',
      ],
      doneWhen:
        'The page links no product that is sold out, refused or gone. Checked automatically after the next catalog sync.',
      check: 'auto',
      type: 'content',
      effort: '~15m',
      role: 'Content editor',
    },
  };
}

/** Whether a closed action already named every one of these products. */
function named(action, ids) {
  const before = new Set(
    Array.isArray(action.payload?.productIds) ? action.payload.productIds : [],
  );
  return ids.every((id) => before.has(id));
}

/**
 * The products each draft's open action names, by draft id. The check
 * counts them on its page even once its path has dropped them (a rebuild
 * keeps the products in stock): the action closes only when the page links
 * none of them that still doesn't sell.
 *
 * @param {string[]} draftIds
 * @returns {Promise<Map<string, string[]>>}
 */
export async function openActionProducts(db, brandId, draftIds) {
  const byDraft = new Map();
  if (!draftIds.length) return byDraft;
  const drafts = new Map(draftIds.map((id) => [shoppingLinksDedupKey(id), id]));
  const { data, error } = await db
    .from('actions')
    .select('dedup_key, payload')
    .eq('brand_id', brandId)
    .eq('kind', SHOPPING_LINKS_ACTION_KIND)
    .in('status', ACTIVE)
    .in('dedup_key', [...drafts.keys()]);
  if (error) throw new Error(`actions read: ${error.message}`);
  for (const action of data ?? []) {
    const draftId = drafts.get(action.dedup_key);
    const ids = action.payload?.productIds;
    if (!draftId || !Array.isArray(ids)) continue;
    byDraft.set(draftId, [
      ...new Set([...(byDraft.get(draftId) ?? []), ...ids.filter((id) => typeof id === 'string')]),
    ]);
  }
  return byDraft;
}

/** The page's actions, newest first: the open one, else the last closed. */
async function pageActions(db, brandId, dedupKey) {
  const { data, error } = await db
    .from('actions')
    .select('id, action_no, status, completed_at, updated_at, created_at, payload')
    .eq('brand_id', brandId)
    .eq('dedup_key', dedupKey)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw new Error(`actions read: ${error.message}`);
  return data ?? [];
}

/**
 * Completes the check's open task as checked automatically on `pageUrl`
 * (its card's last check, and AC-010's task_checked line in the History)
 * and, when no other work is open on it, the action, with its line too. A
 * task or an action someone changed meanwhile is left as it is.
 */
async function closeAction(db, action, pageUrl, now) {
  const at = now.toISOString();
  const { data: tasks, error } = await db
    .from('action_tasks')
    .select('id, title, status, details')
    .eq('action_id', action.id)
    .in('status', OPEN_TASKS);
  if (error) throw new Error(`action_tasks read: ${error.message}`);
  const own = (tasks ?? []).filter((task) => task.details?.source === TASK_SOURCE);
  let completed = 0;
  for (const task of own) {
    const autoCheck = { at, triedAt: at, url: pageUrl, passed: true, missing: [] };
    const { data: changed, error: taskErr } = await db
      .from('action_tasks')
      .update({
        status: 'completed',
        skip_reason: null,
        details: { ...task.details, autoCheck },
        updated_at: at,
      })
      .eq('id', task.id)
      .eq('status', task.status)
      .select('id');
    if (taskErr) throw new Error(`action_tasks write: ${taskErr.message}`);
    if (!changed?.length) continue;
    completed += 1;
    // Best effort, as the drawer's: a missing History line doesn't undo the change.
    await db.from('action_events').insert({
      action_id: action.id,
      event: 'task_checked',
      data: { taskId: task.id, task: null, title: task.title ?? null },
      actor_id: null,
    });
  }
  // Someone's own work on it is theirs to finish; the action moves up its list.
  if ((tasks ?? []).length > own.length) {
    if (completed) await db.from('actions').update({ updated_at: at }).eq('id', action.id);
    return false;
  }
  const { data: closed, error: closeErr } = await db
    .from('actions')
    .update({ status: 'completed', completed_at: at, updated_at: at })
    .eq('id', action.id)
    .eq('status', action.status)
    .select('id');
  if (closeErr) throw new Error(`actions write: ${closeErr.message}`);
  if (!closed?.length) return false;
  await db.from('action_events').insert({
    action_id: action.id,
    event: 'status_changed',
    data: { to: 'completed', source: TASK_SOURCE },
    actor_id: null,
  });
  return true;
}

/**
 * Opens the page's action from its live page's check, keeps it, or closes
 * it. Returns 'opened', 'closed', 'kept' (still open: it links them still,
 * or someone's work on it is open), 'resting' (dismissed for these products,
 * or closed less than REST_DAYS ago), 'held' (none opened: `open` is false)
 * or 'none'.
 *
 * @param {string} brandId
 * @param {{ draft: { id: string, title?: string|null }, pageUrl: string,
 *   check: { bad: Array<{ id: string, title: string, state: string }>,
 *   swaps: Array<{ id: string, title: string }> } }} page
 * @param {{ db?: object, now?: Date, open?: boolean }} [opts]
 *   `open` false: the run's new actions are spent, only close or keep.
 */
export async function syncShoppingLinksAction(
  brandId,
  { draft, pageUrl, check },
  { db = supabaseAdmin, now = new Date(), open = true } = {},
) {
  const dedupKey = shoppingLinksDedupKey(draft.id);
  const actions = await pageActions(db, brandId, dedupKey);
  const active = actions.find((a) => ACTIVE.includes(a.status));
  if (!check.bad.length) {
    if (!active) return 'none';
    return (await closeAction(db, active, pageUrl, now)) ? 'closed' : 'kept';
  }
  if (active) return 'kept';

  const ids = check.bad.map((p) => p.id);
  const last = actions[0];
  if (last && named(last, ids)) {
    if (last.status === 'dismissed') return 'resting';
    const closedAt = Date.parse(last.completed_at ?? last.updated_at ?? '') || 0;
    if (now.getTime() - closedAt < REST_DAYS * DAY_MS) return 'resting';
  }
  if (!open) return 'held';

  const title = String(draft.title ?? '').trim() || null;
  const payload = {
    source: TASK_SOURCE,
    draftId: draft.id,
    title,
    pageUrl,
    // Its page, for the drawer and the task's check (AC-010's onePage).
    pages: [pageUrl],
    products: check.bad,
    productIds: ids,
    soldOut: check.bad.every((p) => p.state === 'sold_out'),
    swaps: check.swaps,
    targetEntity: 'pages',
    targetCount: 1,
    targetIds: [pageUrl],
    targets: [{ id: pageUrl, label: title ?? pageUrl }],
  };
  const category = 'fix';
  const impact = check.bad.length >= 3 ? 'high' : 'medium';
  const { data: action, error } = await db
    .from('actions')
    .insert({
      brand_id: brandId,
      category,
      kind: SHOPPING_LINKS_ACTION_KIND,
      definition_version: 1,
      impact,
      status: 'new',
      payload,
      kpi_keys: [],
      baseline: { capturedAt: now.toISOString(), products: ids.length },
      dedup_key: dedupKey,
      ...(await priorityOnCreate(
        { kind: SHOPPING_LINKS_ACTION_KIND, category, impact, payload },
        now,
      )),
    })
    .select('id, action_no')
    .single();
  if (error) {
    // A check running beside this one opened it (the open-action dedup index, 00084).
    if (error.code === '23505') return 'kept';
    throw new Error(`actions write: ${error.message}`);
  }

  const task = shoppingLinksTask({
    draftId: draft.id,
    pageUrl,
    bad: check.bad,
    swaps: check.swaps,
  });
  const { error: taskErr } = await db.from('action_tasks').insert({
    action_id: action.id,
    position: 1,
    title: task.title,
    details: task.details,
    status: 'todo',
  });
  if (taskErr) throw new Error(`action_tasks write: ${taskErr.message}`);

  await db.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: null,
    data: { source: TASK_SOURCE, draftId: draft.id, products: ids.length, taskCount: 1 },
  });
  return 'opened';
}
