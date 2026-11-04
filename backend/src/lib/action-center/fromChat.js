/**
 * "Send to Action Center" from Chat (CHAT-09 §E, CHAT-20 §12: the V1 Final
 * rules): a finding Chat proposes as an action, once the person approved its
 * card (or Full auto ran it, where policy allows).
 *
 *  - Duplicate check first. An active action of the brand that already
 *    covers the finding's prompts, pages or competitors (its kept list,
 *    action_entities, 00244, and the prompts and pages its payload names)
 *    is returned instead of a new one: `all` when it covers every one of
 *    them (or is the same proposal: its dedup key), `some` when it shares
 *    a few. Chat then offers to add the finding to it (attach_to_action);
 *    "Create anyway" only goes through when the entities differ (`some`).
 *    The existing action's targets never grow.
 *  - Frozen at creation: the objective, the targets (every entity, in the
 *    payload, and the kept list), the baseline (the basket's metrics over
 *    the 14 days before, and each named prompt's state per platform),
 *    the evidence and the tasks. Nothing writes them again: the task
 *    writer's sweep skips the action (tasks_generated_at is set).
 *  - A person's send, as Improve's or Content's: its dedup key is Chat's
 *    own, so it takes no definition's slot, and it is never refused for the
 *    day's five new actions (config/actionEngine.js maxNewActionsPerDay).
 *    Like every send, it counts toward them, so the generator opens fewer
 *    of its own that night and the rest wait in its queue; the answer says
 *    when the day's five are reached, for Chat to tell the person. The
 *    engine scores it on creation (priority.js sentByHand).
 *  - History gets `created` with source `chat`, the conversation, the run
 *    and how it was approved (`execution.mode`: assisted or automated).
 *
 * Tasks follow AC-004: each names its page or where it is done, says when it
 * is done, and none is an analyze / identify / validate / measure to-do or a
 * "for N prompts" title.
 */

import { createHash } from 'node:crypto';
import { z } from 'zod';
import supabaseAdmin from '../../config/supabase.js';
import { selectInChunks } from '../chunkedIn.js';
import { resolve } from '../../config/actionEngine.js';
import { logger } from '../logger.js';
import { measureBasket } from './basketMetrics.js';
import { readPlatformStates } from './improveOutcome.js';
import { priorityOnCreate } from './priorityData.js';

export const CHAT_ACTION_KIND = 'chat_finding';
/** The `source` Chat's actions and History events carry (CHAT-20 §10a). */
export const CHAT_SOURCE = 'chat';

export const CHAT_CATEGORIES = ['growth', 'protect', 'recover', 'fix', 'compete'];
export const CHAT_TASK_TYPES = ['content', 'on_page', 'technical', 'outreach', 'pr', 'product'];
export const CHAT_TASK_CHECKS = ['auto', 'rerun', 'manual'];
export const EXECUTION_MODES = ['assisted', 'automated'];

export const MAX_CHAT_TASKS = 8;
export const MAX_CHAT_ENTITIES = 20;
/** Baseline: the 14 days before it was sent (CHAT-22 §2, Addendum 2 F). */
export const BASELINE_DAYS = 14;
/** Prompts whose state per platform the baseline keeps. */
const BASELINE_PLATFORM_PROMPTS = 5;
const KPI_KEYS = ['ai_visibility', 'citations', 'mentions'];
const ACTIVE = ['new', 'in_progress', 'on_hold'];
const DAY_MS = 86_400_000;
/** New actions a brand gets a day; every one counts, sent or raised (generate.js). */
export const DAILY_NEW_ACTIONS = resolve().noise.maxNewActionsPerDay;

// seeded ids (the demo's) aren't RFC 4122 versions, so a plain GUID shape.
const id = z.guid();
const line = (max) => z.string().trim().min(1).max(max);

export const chatTaskSchema = z.object({
  title: z.string().trim().min(3).max(200),
  type: z.enum(CHAT_TASK_TYPES),
  /** The exact page (AC-010): a path or a full address. */
  url: z.string().trim().max(500).optional(),
  /** Where else it is done: the prompt, platform, domain or competitor. */
  where: z.string().trim().max(300).optional(),
  why: z.string().trim().max(600).optional(),
  how: z.array(line(300)).max(8).default([]),
  done_when: line(300),
  change: z
    .object({ before: z.string().trim().max(1000).optional(), after: line(1000) })
    .optional(),
  check: z.enum(CHAT_TASK_CHECKS).optional(),
});

export const chatEntitiesSchema = z.object({
  prompts: z.array(id).max(MAX_CHAT_ENTITIES).default([]),
  pages: z.array(line(500)).max(MAX_CHAT_ENTITIES).default([]),
  competitors: z.array(id).max(10).default([]),
  platforms: z.array(line(40)).max(8).default([]),
});

export const chatProposalSchema = z.object({
  title: z.string().trim().min(3).max(120),
  category: z.enum(CHAT_CATEGORIES),
  impact: z.enum(['high', 'medium', 'low']).default('medium'),
  /** The finding: what Chat saw, in the person's words. */
  why: line(600),
  goal: z.string().trim().max(300).optional(),
  entities: chatEntitiesSchema,
  tasks: z.array(chatTaskSchema).min(1).max(MAX_CHAT_TASKS),
});

function httpError(message, status, code, extra) {
  const err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  if (extra) err.extra = extra;
  return err;
}

// ─── AC-004 ─────────────────────────────────────────────────────────────────

/** A to-do that only looks: AC-004's "no analyze / identify / validate / measure tasks". */
const LOOK_ONLY = /^\s*(analy[sz]e|identify|validate|measure|investigate|research|monitor)\b/i;
/** A title about a count instead of a thing: "for 12 prompts". */
const FOR_N = /\bfor\s+\d+\s+(prompts?|pages?|competitors?|queries|platforms?|urls?)\b/i;

/**
 * Why a proposal can't become an action, in words the model can fix: AC-004's
 * rules per task, and at least one prompt, page or competitor to measure.
 * Empty when it can.
 */
export function proposalProblems(proposal) {
  const problems = [];
  const { prompts, pages, competitors } = proposal.entities;
  if (prompts.length + pages.length + competitors.length === 0) {
    problems.push('Name at least one prompt, page or competitor the action is about.');
  }
  if (FOR_N.test(proposal.title)) {
    problems.push(`The title counts instead of naming: "${proposal.title}".`);
  }
  proposal.tasks.forEach((task, i) => {
    const n = i + 1;
    if (LOOK_ONLY.test(task.title)) {
      problems.push(`Task ${n} only looks ("${task.title}"): say the change to make.`);
    }
    if (FOR_N.test(task.title)) {
      problems.push(`Task ${n} counts instead of naming one thing: "${task.title}".`);
    }
    if (!task.url && !task.where) {
      problems.push(`Task ${n} needs its exact page (url) or where it is done.`);
    }
  });
  return problems;
}

// ─── Entities, as two actions are compared ──────────────────────────────────

/**
 * A page as two actions compare it: its path, lowercased, without a trailing
 * slash, for the brand's own site (an address on one of its domains, or a
 * path); host and path for another site's page.
 */
/** "pricing" or "blog/aeo": no scheme, no leading slash, and no dot in its first part (no host). */
function isBarePath(text) {
  if (/^https?:\/\//i.test(text) || text.startsWith('/')) return false;
  return !text.split(/[/?#]/)[0].includes('.');
}

export function pageKey(raw, brandHosts = []) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  let host = null;
  let path = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      host = url.hostname.toLowerCase().replace(/^www\./, '');
      path = url.pathname;
    } catch {
      return null;
    }
  } else if (isBarePath(text)) {
    // "pricing", "blog/what-is-aeo": a path written without its slash.
    path = `/${text}`;
  } else if (!text.startsWith('/')) {
    // "example.com/page": a host without its scheme.
    const slash = text.indexOf('/');
    host = (slash === -1 ? text : text.slice(0, slash)).toLowerCase().replace(/^www\./, '');
    path = slash === -1 ? '/' : text.slice(slash);
  }
  path =
    path
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '')
      .toLowerCase() || '/';
  return host && !brandHosts.includes(host) ? `${host}${path}` : path;
}

const hostOf = (domain) =>
  String(domain ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '');

/** The proposal's entities as keys: prompt ids, page keys, competitor ids and names. */
export function proposalKeys(entities, brandHosts = [], competitorNames = new Map()) {
  const competitors = [...new Set(entities.competitors.map((c) => c.toLowerCase()))];
  return {
    prompts: [...new Set(entities.prompts.map((p) => p.toLowerCase()))],
    pages: [...new Set(entities.pages.map((p) => pageKey(p, brandHosts)).filter(Boolean))],
    competitors,
    // Each competitor's name, beside its id: a kept list may key one by name (00244).
    competitorNames: competitors.map((c) => (competitorNames.get(c) ?? '').toLowerCase()),
  };
}

/**
 * One proposal per category and set of entities: the same finding sent
 * again, whatever its words, has the same key (CHAT-20 §9 row 43's
 * idempotency key: brand + definition or entity hash).
 */
export function chatDedupKey(category, keys) {
  const parts = [
    ...keys.prompts.map((k) => `p:${k}`),
    ...keys.pages.map((k) => `u:${k}`),
    ...keys.competitors.map((k) => `c:${k}`),
  ].sort();
  const digest = createHash('sha1').update(parts.join('\n')).digest('hex');
  return `${CHAT_ACTION_KIND}:${category}:${digest.slice(0, 20)}`;
}

/** What an existing action is about, as keys: its kept list and its payload's prompts and pages. */
export function actionKeys(action, entityRows, brandHosts = []) {
  const p = action.payload ?? {};
  const prompts = new Set();
  const pages = new Set();
  const competitors = new Set();
  for (const row of entityRows) {
    const key = String(row.entity_key ?? '');
    if (row.entity_type === 'prompts') prompts.add(key.toLowerCase());
    else if (row.entity_type === 'pages') {
      const page = pageKey(key, brandHosts);
      if (page) pages.add(page);
    } else if (row.entity_type === 'competitors') {
      competitors.add(key.toLowerCase());
      if (row.label) competitors.add(String(row.label).toLowerCase());
    }
  }
  for (const promptId of [...(Array.isArray(p.promptIds) ? p.promptIds : []), p.promptId]) {
    if (typeof promptId === 'string' && promptId) prompts.add(promptId.toLowerCase());
  }
  for (const page of Array.isArray(p.pages) ? p.pages : []) {
    const key = pageKey(page, brandHosts);
    if (key) pages.add(key);
  }
  // The competitors a payload names beside its kept list (Chat's own, a topic gap's).
  for (const competitorId of [
    ...(Array.isArray(p.competitorIds) ? p.competitorIds : []),
    p.competitorId,
  ]) {
    if (typeof competitorId === 'string' && competitorId) {
      competitors.add(competitorId.toLowerCase());
    }
  }
  return { prompts, pages, competitors };
}

/**
 * How much of the proposal an action covers: `all` (every prompt, page and
 * competitor it names, or the same proposal), `some`, or null.
 */
export function coverage(keys, action, dedupKey) {
  const total = keys.prompts.length + keys.pages.length + keys.competitors.length;
  if (dedupKey && action.dedupKey === dedupKey) return { covers: 'all', shared: total };
  const shared =
    keys.prompts.filter((k) => action.keys.prompts.has(k)).length +
    keys.pages.filter((k) => action.keys.pages.has(k)).length +
    keys.competitors.filter(
      (k, i) =>
        action.keys.competitors.has(k) ||
        (keys.competitorNames[i] && action.keys.competitors.has(keys.competitorNames[i])),
    ).length;
  if (shared === 0) return null;
  return { covers: shared >= total ? 'all' : 'some', shared };
}

/** The brand's own hosts: its domains without scheme or www. */
async function brandHosts(brandId) {
  const { data, error } = await supabaseAdmin
    .from('brand_domains')
    .select('domain, is_primary, created_at')
    .eq('brand_id', brandId)
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true });
  if (error) throw new Error(`brand_domains: ${error.message}`);
  return [...new Set((data ?? []).map((row) => hostOf(row.domain)).filter(Boolean))];
}

/** The brand's competitors among the ids, by id: their names. */
async function competitorNamesOf(brandId, ids) {
  if (!ids.length) return new Map();
  const { data, error } = await supabaseAdmin
    .from('competitors')
    .select('id, name')
    .eq('brand_id', brandId)
    .in('id', ids);
  if (error) throw new Error(`competitors: ${error.message}`);
  return new Map((data ?? []).map((row) => [String(row.id).toLowerCase(), row.name]));
}

/**
 * The brand's active actions that cover any of the proposal's entities,
 * the closest first: every entity covered, then the most shared. Each as
 * Chat names it: its number, its title where it has one, its kind and
 * category, and how much it covers.
 *
 * @param {string} brandId
 * @param {z.infer<typeof chatEntitiesSchema>} entities
 * @param {{ category?: string }} [opts]
 */
export async function findCoveringActions(brandId, entities, { category } = {}) {
  const [hosts, names] = await Promise.all([
    brandHosts(brandId),
    competitorNamesOf(brandId, entities.competitors),
  ]);
  const keys = proposalKeys(entities, hosts, names);
  const dedupKey = category ? chatDedupKey(category, keys) : null;

  const { data: actions, error } = await supabaseAdmin
    .from('actions')
    .select('id, action_no, kind, category, status, payload, dedup_key, priority_score')
    .eq('brand_id', brandId)
    .in('status', ACTIVE)
    .is('deleted_at', null)
    .limit(1000);
  if (error) throw new Error(`actions: ${error.message}`);
  if (!actions?.length) return { keys, dedupKey, covering: [] };

  const { data: rows, error: entitiesError } = await selectInChunks(
    actions.map((a) => a.id),
    (chunk) =>
      supabaseAdmin
        .from('action_entities')
        .select('action_id, entity_type, entity_key, label')
        .in('action_id', chunk)
        .is('removed_at', null),
  );
  if (entitiesError) throw new Error(`action_entities: ${entitiesError.message}`);
  const byAction = new Map();
  for (const row of rows ?? []) {
    if (!byAction.has(row.action_id)) byAction.set(row.action_id, []);
    byAction.get(row.action_id).push(row);
  }

  const covering = [];
  for (const action of actions) {
    const found = coverage(
      keys,
      {
        dedupKey: action.dedup_key,
        keys: actionKeys(action, byAction.get(action.id) ?? [], hosts),
      },
      dedupKey,
    );
    if (!found) continue;
    covering.push({
      actionId: action.id,
      actionNo: Number(action.action_no),
      title: typeof action.payload?.title === 'string' ? action.payload.title : null,
      kind: action.kind,
      category: action.category,
      covers: found.covers,
      shared: found.shared,
      priorityScore: action.priority_score === null ? null : Number(action.priority_score),
    });
  }
  covering.sort(
    (a, b) =>
      (a.covers === 'all' ? 0 : 1) - (b.covers === 'all' ? 0 : 1) ||
      b.shared - a.shared ||
      (b.priorityScore ?? -1) - (a.priorityScore ?? -1),
  );
  return { keys, dedupKey, covering: covering.slice(0, 3) };
}

// ─── Creating ───────────────────────────────────────────────────────────────

/** The brand's prompts among the ids: their texts, in the ids' order. */
async function brandPrompts(brandId, promptIds) {
  if (!promptIds.length) return [];
  const { data: sets, error: setsError } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId);
  if (setsError) throw new Error(`prompt_sets: ${setsError.message}`);
  const setIds = (sets ?? []).map((s) => s.id);
  if (!setIds.length) return [];
  const { data, error } = await supabaseAdmin
    .from('prompts')
    .select('id, text')
    .in('prompt_set_id', setIds)
    .in('id', promptIds);
  if (error) throw new Error(`prompts: ${error.message}`);
  const text = new Map((data ?? []).map((row) => [String(row.id).toLowerCase(), row.text]));
  return promptIds.filter((p) => text.has(p)).map((p) => ({ id: p, text: text.get(p) }));
}

/** A page as the action keeps it: a full address, on the primary host when it was a path. */
export function pageUrl(raw, primaryHost) {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) return text;
  const path = text.startsWith('/') ? text : isBarePath(text) ? `/${text}` : null;
  if (path) return primaryHost ? `https://${primaryHost}${path}` : null;
  return `https://${text}`;
}

/** The day `days` before `now`, and the day before `now`, as dates. */
export function baselineWindow(now, days = BASELINE_DAYS) {
  const to = new Date(now.getTime() - DAY_MS);
  const from = new Date(to.getTime() - (days - 1) * DAY_MS);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

/**
 * What the action is measured against later (CHAT-09 item 18b): the
 * basket's metrics over the 14 days before, and each named prompt's state
 * per named platform, as read now. A read that fails leaves its part null:
 * the action is never refused for its baseline.
 */
async function readBaseline(brandId, { promptIds, pages, platforms }, now) {
  const window = baselineWindow(now);
  let metrics = null;
  try {
    metrics = await measureBasket(brandId, { promptIds, pages }, window.from, window.to);
  } catch (err) {
    logger.warn({ err: err.message, brandId }, '[chat-action] baseline metrics not read');
  }
  const perPlatform = [];
  if (platforms.length) {
    const span = {
      from: `${window.from}T00:00:00.000Z`,
      to: `${window.to}T23:59:59.999Z`,
    };
    for (const promptId of promptIds.slice(0, BASELINE_PLATFORM_PROMPTS)) {
      try {
        perPlatform.push({
          promptId,
          platforms: await readPlatformStates({
            promptId,
            brandId,
            region: null,
            platforms,
            window: span,
          }),
        });
      } catch (err) {
        logger.warn({ err: err.message, promptId }, '[chat-action] baseline platforms not read');
      }
    }
  }
  return { capturedAt: now.toISOString(), window, metrics, platforms: perPlatform };
}

/** One task row per proposed task, in its order, with AC-004's details. */
export function chatTaskRows(actionId, tasks) {
  return tasks.map((task, i) => ({
    action_id: actionId,
    position: i + 1,
    task_key: null,
    title: task.title,
    status: 'todo',
    mode: 'human',
    permission: 'read',
    details: {
      type: task.type,
      ...(task.url ? { url: task.url } : {}),
      ...(task.where ? { where: task.where } : {}),
      ...(task.why ? { why: task.why } : {}),
      how: task.how ?? [],
      doneWhen: task.done_when,
      ...(task.change
        ? { change: { before: task.change.before || null, after: task.change.after } }
        : {}),
      check: task.check ?? 'manual',
      source: CHAT_SOURCE,
    },
  }));
}

/** The action Chat sent with this idempotency key, if it did (a retried call). */
async function sentWithKey(brandId, idempotencyKey) {
  const { data, error } = await supabaseAdmin
    .from('actions')
    .select('id, action_no, status, deleted_at')
    .eq('brand_id', brandId)
    .eq('kind', CHAT_ACTION_KIND)
    .eq('payload->>idempotencyKey', idempotencyKey)
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`actions: ${error.message}`);
  // Cancelled since (Undo), or deleted: not what this approval stands for any more.
  if (data && (data.deleted_at || data.status === 'dismissed')) {
    throw httpError(
      'The action this approval made was cancelled. Send the finding again for a new one.',
      409,
      'conflict',
    );
  }
  return data;
}

/**
 * The brand's new actions today as the generator counts them (generate.js):
 * every one created since midnight UTC, whoever sent it and wherever it is
 * now. Null when it can't be read: the action stands either way.
 */
export async function actionsToday(brandId, now = new Date()) {
  const dayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
  const { count, error } = await supabaseAdmin
    .from('actions')
    .select('id', { count: 'exact', head: true })
    .eq('brand_id', brandId)
    .gte('created_at', dayStart);
  if (error) {
    logger.warn({ err: error.message, brandId }, "[chat-action] today's count not read");
    return null;
  }
  return count ?? 0;
}

/**
 * The chat, run and approval a send names, as the database has them: the
 * caller's own chat, a run of it, and (by the approval's key, `chat:{step}`)
 * the step of that run sending it now, whose mark says whether it ran
 * without a card (engine.ts writeCall). Whatever doesn't hold is left out:
 * History never records what a caller only said.
 *
 * @returns {Promise<{ conversationId: string | null, runId: string | null,
 *   executionMode: 'assisted' | 'automated' | null }>}
 */
export async function verifiedPlace(userId, { conversationId, runId, idempotencyKey }) {
  const none = { conversationId: null, runId: null, executionMode: null };
  if (!conversationId) return none;
  const { data: chat, error } = await supabaseAdmin
    .from('chat_conversations')
    .select('id, user_id')
    .eq('id', conversationId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(`chat_conversations: ${error.message}`);
  if (!chat || chat.user_id !== userId) return none;
  if (!runId) return { ...none, conversationId: chat.id };
  const { data: run, error: runError } = await supabaseAdmin
    .from('chat_runs')
    .select('id')
    .eq('id', runId)
    .eq('conversation_id', chat.id)
    .maybeSingle();
  if (runError) throw new Error(`chat_runs: ${runError.message}`);
  if (!run) return { ...none, conversationId: chat.id };
  const stepId = /^chat:(.+)$/.exec(idempotencyKey ?? '')?.[1] ?? null;
  const { data: step, error: stepError } = stepId
    ? await supabaseAdmin
        .from('chat_run_steps')
        .select('id, tool, debug_json')
        .eq('id', stepId)
        .eq('run_id', run.id)
        .maybeSingle()
    : { data: null, error: null };
  if (stepError) throw new Error(`chat_run_steps: ${stepError.message}`);
  const executionMode =
    step && step.tool === 'create_action'
      ? step.debug_json?.auto === true
        ? 'automated'
        : 'assisted'
      : null;
  return { conversationId: chat.id, runId: run.id, executionMode };
}

/** A duplicate, as the route answers it (409) and Chat says it (CHAT-20 §11a `duplicate`). */
function duplicateError(found) {
  return httpError(`AC-${found.actionNo} already covers this.`, 409, 'duplicate', {
    action: {
      id: found.actionId,
      no: found.actionNo,
      title: found.title,
      covers: found.covers,
    },
    canCreateAnyway: found.covers === 'some',
  });
}

/**
 * Creates the action, or answers why not.
 *
 * @param {string} brandId - checked against the caller's org and role by the route
 * @param {object} opts
 * @param {z.infer<typeof chatProposalSchema>} opts.proposal
 * @param {string} opts.userId
 * @param {string | null} [opts.conversationId]
 * @param {string | null} [opts.runId]
 * @param {'assisted' | 'automated' | null} [opts.executionMode] - read again here (verifiedPlace)
 * @param {string} opts.idempotencyKey - one per approval: a retry finds what it made
 * @param {boolean} [opts.createAnyway] - the person chose Create anyway (entities differ)
 * @returns {Promise<{ actionId: string, actionNo: number, created: boolean,
 *   dailyLimit?: { used: number, limit: number, reached: boolean } }>}
 */
export async function sendChatAction(
  brandId,
  {
    proposal,
    userId,
    conversationId = null,
    runId = null,
    idempotencyKey,
    createAnyway = false,
    now = new Date(),
  },
) {
  const problems = proposalProblems(proposal);
  if (problems.length) {
    throw httpError(problems.join(' '), 400, 'invalid', { problems });
  }
  // Where it was sent from and how it was approved, as the database has them.
  const place = await verifiedPlace(userId, { conversationId, runId, idempotencyKey });

  const again = await sentWithKey(brandId, idempotencyKey);
  if (again) return { actionId: again.id, actionNo: Number(again.action_no), created: false };

  const { keys, dedupKey, covering } = await findCoveringActions(brandId, proposal.entities, {
    category: proposal.category,
  });
  const closest = covering[0];
  if (closest && (closest.covers === 'all' || !createAnyway)) throw duplicateError(closest);

  const prompts = await brandPrompts(brandId, keys.prompts);
  if (prompts.length !== keys.prompts.length) {
    throw httpError("Some of these prompts aren't the brand's.", 400, 'invalid');
  }
  const names = await competitorNamesOf(brandId, keys.competitors);
  if (names.size !== keys.competitors.length) {
    throw httpError("Some of these competitors aren't the brand's.", 400, 'invalid');
  }
  const hosts = await brandHosts(brandId);
  const pages = [
    ...new Set(proposal.entities.pages.map((page) => pageUrl(page, hosts[0])).filter(Boolean)),
  ];
  const platforms = [...new Set(proposal.entities.platforms)];
  const promptIds = prompts.map((p) => p.id);
  const competitors = keys.competitors.map((c) => ({ id: c, label: names.get(c) }));

  // The kept list (00244) holds one kind: the prompts, else the pages, else the competitors.
  const targetEntity = promptIds.length ? 'prompts' : pages.length ? 'pages' : 'competitors';
  const targets =
    targetEntity === 'prompts'
      ? prompts.map((p) => ({ id: p.id, label: p.text }))
      : targetEntity === 'pages'
        ? pages.map((url) => ({ id: url, label: url }))
        : competitors;

  const payload = {
    source: CHAT_SOURCE,
    title: proposal.title,
    why: proposal.why,
    ...(proposal.goal ? { goal: proposal.goal } : {}),
    // Measured on these once done (validate.js: a basket of its prompts and pages).
    promptIds,
    pages,
    competitorIds: competitors.map((c) => c.id),
    platforms,
    // Every entity, frozen as it was sent (CHAT-20 §12 rule 3).
    entities: {
      prompts: prompts.map((p) => ({ id: p.id, label: p.text })),
      pages,
      competitors,
      platforms,
    },
    targetEntity,
    targetCount: targets.length,
    targets,
    conversationId: place.conversationId,
    runId: place.runId,
    execution: place.executionMode ? { mode: place.executionMode } : null,
    idempotencyKey,
    ...(closest ? { createdAnywayBeside: closest.actionNo } : {}),
  };

  const baseline = await readBaseline(brandId, { promptIds, pages, platforms }, now);
  const nowIso = now.toISOString();
  const { data: action, error } = await supabaseAdmin
    .from('actions')
    .insert({
      brand_id: brandId,
      category: proposal.category,
      kind: CHAT_ACTION_KIND,
      definition_version: 1,
      impact: proposal.impact,
      payload,
      kpi_keys: KPI_KEYS,
      baseline,
      dedup_key: dedupKey,
      // Its tasks are the ones the person approved: the task writer's sweep never rewrites them.
      tasks_generated_at: nowIso,
      ...(await priorityOnCreate({
        brand_id: brandId,
        kind: CHAT_ACTION_KIND,
        category: proposal.category,
        impact: proposal.impact,
        payload,
      })),
    })
    .select('id, action_no')
    .single();
  if (error) {
    // The same proposal sent twice at once: the open-action dedup index (00084) let one in.
    if (error.code === '23505') {
      const { covering: now2 } = await findCoveringActions(brandId, proposal.entities, {
        category: proposal.category,
      });
      if (now2[0]) throw duplicateError({ ...now2[0], covers: 'all' });
    }
    throw new Error(error.message);
  }

  const { error: tasksError } = await supabaseAdmin
    .from('action_tasks')
    .insert(chatTaskRows(action.id, proposal.tasks));
  if (tasksError) {
    // Never an action without the tasks the person approved: it goes again,
    // with its kept list, so the same approval tried again makes it whole.
    const { error: undoError } = await supabaseAdmin.from('actions').delete().eq('id', action.id);
    if (undoError) {
      logger.error(
        { err: undoError.message, actionId: action.id },
        '[chat-action] an action without its tasks was left',
      );
    }
    throw new Error(`The action's tasks couldn't be kept: ${tasksError.message}`);
  }

  const { error: eventError } = await supabaseAdmin.from('action_events').insert({
    action_id: action.id,
    event: 'created',
    actor_id: userId,
    data: {
      source: CHAT_SOURCE,
      conversationId: place.conversationId,
      runId: place.runId,
      execution: place.executionMode ? { mode: place.executionMode } : null,
      taskCount: proposal.tasks.length,
      prompts: promptIds.length,
      pages: pages.length,
      competitors: competitors.length,
    },
  });
  if (eventError) logger.warn({ err: eventError.message }, '[chat-action] created event not kept');

  // Counted with the day's new actions, as every send is: said once they are reached.
  const used = await actionsToday(brandId, now);
  return {
    actionId: action.id,
    actionNo: Number(action.action_no),
    created: true,
    ...(used === null
      ? {}
      : {
          dailyLimit: { used, limit: DAILY_NEW_ACTIONS, reached: used >= DAILY_NEW_ACTIONS },
        }),
  };
}
