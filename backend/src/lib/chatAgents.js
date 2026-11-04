/**
 * Chat's agents' background work (CHAT-21 §E, §G, §H; W2-16), behind
 * CHAT_AGENTIC. The agents live in the web app (their rules, the driver
 * that runs them as Chat runs); this server only wakes it:
 *
 *   - Every minute (startChatAgentTicks, node-cron) it calls the web's
 *     POST /api/internal/chat/agents/tick, which fires the Schedule
 *     triggers that are due and sweeps (lost and stale runs, failures, the
 *     AI limit's pauses); then, in the same tick, Chat's scheduled jobs'
 *     POST /api/internal/chat/schedules/tick (CHAT-12, W3-01), which
 *     settles their open runs, lets jobs paused at the AI limit go on and
 *     runs the ones that are due. Like the server's other crons, not in
 *     development (server.js): there, `node src/scripts/chatAgentsTick.js`
 *     calls both once.
 *   - After Action Center's signal pass records new signals on a brand
 *     (signals/record.js), notifyChatAgentsOfSignals tells the web's
 *     POST /api/internal/chat/agents/signals which signals, with the
 *     definitions each feeds and the pages and engines it names, so Signal
 *     triggers fire. It never waits on the web and never fails the pass: a
 *     Chat agent never slows an engine job (CHAT-21 boundary).
 *
 * Both send `Authorization: Bearer ${CHAT_INTERNAL_SECRET}` to the web app
 * at PUBLIC_APP_URL; without the secret, or with the new Chat off, nothing
 * is sent.
 */

import cron from 'node-cron';
import supabaseAdmin from '../config/supabase.js';
import { loadDefinitions } from './action-center/definitions/index.js';
import { chatAgenticDeployed, chatAgenticEnabled } from './chatFlag.js';
import { logger } from './logger.js';

/** Every minute. */
export const CHAT_AGENTS_TICK_SCHEDULE = '* * * * *';
/** How long a call to the web may take: under the minute, so ticks don't pile up. */
export const CHAT_AGENTS_CALL_TIMEOUT_MS = 50_000;
/** Most signals one notice carries (the web's limit). */
const MAX_SIGNALS = 200;
const MAX_ENTITIES = 50;

/** The web app's origin, from PUBLIC_APP_URL (localhost:3000 in development). */
export function webAppOrigin() {
  const raw = process.env.PUBLIC_APP_URL || 'http://localhost:3000';
  try {
    return new URL(raw).origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/**
 * POSTs to one of the web's internal Chat endpoints (/api/internal/chat/…).
 * Answers { status, body }, or null when nothing was sent (Chat off, no
 * secret) or the web didn't answer in time; never throws.
 *
 * @param {'agents/tick' | 'agents/signals' | 'schedules/tick'} path
 * @param {object} body
 */
async function postToChatInternal(path, body) {
  if (!chatAgenticDeployed()) return null;
  const secret = process.env.CHAT_INTERNAL_SECRET;
  if (!secret) return null;
  try {
    const res = await fetch(`${webAppOrigin()}/api/internal/chat/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_AGENTS_CALL_TIMEOUT_MS),
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  } catch (err) {
    logger.warn({ err: err?.name ?? err, path }, '[chat-agents] the web did not answer');
    return null;
  }
}

/**
 * POSTs to one of the web's internal agents endpoints (postToChatInternal).
 *
 * @param {'tick' | 'signals'} path
 * @param {object} body
 */
export function postToChatAgents(path, body) {
  return postToChatInternal(`agents/${path}`, body);
}

/** One tick: the web fires the due schedules and sweeps. Answers what it did, or null. */
export async function tickChatAgents() {
  const res = await postToChatAgents('tick', {});
  if (res && res.status !== 200) {
    logger.error({ status: res.status, body: res.body }, '[chat-agents] the tick failed');
  }
  return res;
}

/**
 * Chat's scheduled jobs' tick (CHAT-12, W3-01): the web settles their open
 * runs, resumes the ones the AI limit paused and runs the due ones. Answers
 * what it did, or null.
 */
export async function tickChatSchedules() {
  const res = await postToChatInternal('schedules/tick', {});
  if (res && res.status !== 200) {
    logger.error({ status: res.status, body: res.body }, '[chat-agents] the schedules tick failed');
  }
  return res;
}

/**
 * Starts the minute tick, with the new Chat on and CHAT_INTERNAL_SECRET
 * set: the agents' tick, then the scheduled jobs' (each apart: one that
 * fails doesn't stop the other); one tick at a time (a slow one is skipped
 * over, not stacked). Answers the cron task, or null when it didn't start.
 *
 * @param {typeof cron.schedule} [schedule]
 */
export function startChatAgentTicks(schedule = cron.schedule) {
  if (!chatAgenticDeployed()) return null;
  if (!process.env.CHAT_INTERNAL_SECRET) {
    logger.warn('[chat-agents] CHAT_INTERNAL_SECRET is not set: agents run only by Run now');
    return null;
  }
  let running = false;
  const task = schedule(CHAT_AGENTS_TICK_SCHEDULE, async () => {
    if (running) return;
    running = true;
    try {
      // Neither throws: the agents' tick first, then the jobs' in the same minute.
      await tickChatAgents();
      await tickChatSchedules();
    } catch (err) {
      logger.error({ err }, '[chat-agents] the tick crashed');
    } finally {
      running = false;
    }
  });
  logger.info({ schedule: CHAT_AGENTS_TICK_SCHEDULE }, '[chat-agents] minute tick active');
  return task;
}

const text = (value, max) =>
  typeof value === 'string' && value.trim() && value.trim().length <= max ? value.trim() : null;

/**
 * A signal as the web's Signal triggers read it: its kind, the enabled
 * definitions it feeds with their categories, and the pages and engines its
 * payload names (the fields the detectors write, and the targets of a
 * library signal, by its targetEntity).
 *
 * @param {{ id: string, kind: string, payload?: object | null }} row
 * @param {readonly { id: string, category: string, enabled?: boolean, signalKinds: readonly string[] }[]} definitions
 */
export function describeSignal(row, definitions) {
  const p = row.payload ?? {};
  const urls = new Set();
  const engines = new Set();
  const add = (set, value, max) => {
    const v = text(value, max);
    if (v && set.size < MAX_ENTITIES) set.add(v);
  };
  for (const value of [p.url, p.landingPage, p.pageUrl]) add(urls, value, 2048);
  for (const entry of Array.isArray(p.urls) ? p.urls : []) {
    add(urls, typeof entry === 'string' ? entry : entry?.url, 2048);
  }
  for (const value of [p.platform, p.engine]) add(engines, value, 100);
  for (const entry of Array.isArray(p.platforms) ? p.platforms : []) {
    add(engines, typeof entry === 'string' ? entry : (entry?.id ?? entry?.platform), 100);
  }
  for (const target of Array.isArray(p.targets) ? p.targets : []) {
    const id = target?.url ?? target?.id;
    if (p.targetEntity === 'platforms') add(engines, id, 100);
    else if (p.targetEntity === 'pages' || /^(https?:\/\/|\/)/.test(String(id ?? ''))) {
      add(urls, id, 2048);
    }
  }
  return {
    id: row.id,
    kind: row.kind,
    definitions: definitions
      .filter((d) => d.enabled !== false && d.signalKinds.includes(row.kind))
      .map((d) => ({ id: d.id, category: d.category }))
      .slice(0, 20),
    urls: [...urls],
    engines: [...engines],
  };
}

/**
 * Tells the web the signals the pass just raised or reopened on a brand
 * (detected_at = the pass's time), for its Signal triggers. Only signals
 * that feed a definition are sent; nothing when the brand's workspace
 * doesn't have the new Chat. Never throws.
 *
 * @param {string} brandId
 * @param {string} detectedAt the pass's time, as it wrote detected_at
 */
export async function notifyChatAgentsOfSignals(brandId, detectedAt) {
  try {
    if (!chatAgenticDeployed() || !process.env.CHAT_INTERNAL_SECRET) return null;
    const { data: brand, error } = await supabaseAdmin
      .from('brands')
      .select('organization_id')
      .eq('id', brandId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!brand || !chatAgenticEnabled(brand.organization_id)) return null;
    const { data: rows, error: readError } = await supabaseAdmin
      .from('signals')
      .select('id, kind, payload')
      .eq('brand_id', brandId)
      .eq('detected_at', detectedAt)
      .limit(MAX_SIGNALS);
    if (readError) throw new Error(readError.message);
    const definitions = await loadDefinitions();
    const signals = (rows ?? [])
      .map((row) => describeSignal(row, definitions))
      .filter((signal) => signal.definitions.length > 0);
    if (signals.length === 0) return null;
    const res = await postToChatAgents('signals', { brandId, signals });
    if (res && res.status !== 200) {
      logger.error({ status: res.status, brandId }, '[chat-agents] signal triggers failed');
    }
    return res;
  } catch (err) {
    logger.error({ err, brandId }, '[chat-agents] could not tell the agents about new signals');
    return null;
  }
}
