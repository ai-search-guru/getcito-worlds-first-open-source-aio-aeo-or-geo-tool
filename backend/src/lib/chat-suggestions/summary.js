/**
 * What a daily suggestion keeps of its action as sent (CHAT-26 §3 item 5,
 * chat_suggestions.summary): assembled from the action's own data, with no
 * model call.
 *
 * Structured fields, never finished sentences: the web already turns them
 * into its words (en.json) — the title from the kind and payload
 * (actionTexts), "Why this priority?" from the priority reason
 * (priorityReasonText), the time line from the page count — so the Inbox
 * (W2-25) and the detail page (W2-26) read the same words as the Action
 * Center, in the reader's language, and a copy change reaches suggestions
 * already sent. "Why this action?" (actionStory) is told from the action's
 * signals, which the detail page reads by its id, as the drawer does.
 *
 * Version 1:
 *   {
 *     version: 1,
 *     action: { no, kind, category, impact, createdAt, payload },
 *     priority: { score, level, reason },
 *     waitingDays,
 *     ranking: { score, waitPoints, startNowPoints, variety },
 *     startNow: { method: 'create' | 'optimize', pages, minutes } | null,
 *     play: { id, assetType, reasons, dataRow } | null,
 *   }
 * payload holds only what actionTexts reads for a title, strings cut and
 * lists kept short; play is the action plan's pick (AC action plan spec
 * §4–5) once actions carry one.
 */

import { MINUTES_PER_PAGE, START_NOW_LIFT } from './rules.js';

export const SUMMARY_VERSION = 1;
/**
 * The summary's ceiling, well under chat_suggestions' 32,000-byte check on
 * the jsonb's text, measured as that text is (summaryBytes).
 */
export const SUMMARY_MAX_BYTES = 20_000;

/** The payload keys the web's actionTexts reads for an action's title and description. */
export const TITLE_KEYS = Object.freeze([
  'targetEntity',
  'targetCount',
  'title',
  'method',
  'products',
  'soldOut',
  'pageUrl',
  'why',
  'topicName',
  'competitorName',
  'gap',
  'demand',
  'mentionCount',
  'promptCount',
  'negativeCount',
  'promptText',
  'promptIds',
  'removedKeys',
  'reason',
  'pageCount',
  'targets',
  'citations',
  'checks',
]);

/** Items kept of a list: titles read a list's length and first items only. */
const LIST_MAX = 100;
/** Items of a list that keep their label (targets: the first names the page). */
const LABELS_KEPT = 3;
const TEXT_MAX = 300;
/** An Improve action's own "why" is its description. */
const WHY_MAX = 1000;

/**
 * A text cut to `max` UTF-16 units, never through a character: a cut that
 * would end on the first half of an emoji's pair drops that half, since
 * Postgres refuses a lone surrogate in jsonb and the brand's whole insert
 * would fail with it.
 */
function clip(text, max = TEXT_MAX) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A list as a title reads it: its first items, primitives as they are, objects by label. */
function compactList(list) {
  return list.slice(0, LIST_MAX).map((item, i) => {
    if (typeof item === 'string') return clip(item);
    if (item === null || typeof item === 'number' || typeof item === 'boolean') return item;
    if (i < LABELS_KEPT && typeof item?.label === 'string') return { label: clip(item.label) };
    return {};
  });
}

/** What actionTexts reads of a payload, cut to size. */
export function titlePayload(payload) {
  const out = {};
  if (!payload || typeof payload !== 'object') return out;
  for (const key of TITLE_KEYS) {
    const value = payload[key];
    if (typeof value === 'string') out[key] = clip(value, key === 'why' ? WHY_MAX : TEXT_MAX);
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value;
    else if (Array.isArray(value)) out[key] = compactList(value);
  }
  return out;
}

/** The brand pages an action works on (payload.pages), as the web's actionPages reads them. */
export function actionPages(payload) {
  const pages = payload?.pages;
  if (!Array.isArray(pages)) return [];
  return [...new Set(pages.filter((p) => typeof p === 'string' && /^https?:\/\//i.test(p)))];
}

/**
 * The "Start now" line: the draft it opens and the time it takes, about
 * MINUTES_PER_PAGE a page (a new page counts as one).
 */
export function startNowOf(method, payload) {
  if (!method) return null;
  const pages = Math.max(1, actionPages(payload).length);
  return { method, pages, minutes: pages * MINUTES_PER_PAGE };
}

/** The action plan's pick when the action carries one: its id, page type, reasons and data row. */
function playOf(payload) {
  const play = payload?.play;
  if (!play || typeof play !== 'object' || Array.isArray(play)) return null;
  return {
    id: typeof play.id === 'string' ? clip(play.id, 100) : null,
    assetType: typeof play.assetType === 'string' ? clip(play.assetType, 100) : null,
    reasons: Array.isArray(play.reasons) ? play.reasons.slice(0, 10) : [],
    dataRow: play.dataRow && typeof play.dataRow === 'object' ? play.dataRow : null,
  };
}

/**
 * A summary's size as the database's check reads it, or more: jsonb's text
 * puts a space after each comma and colon, which JSON.stringify doesn't, so
 * each one counts a byte more (one inside a string too: never less).
 */
export function summaryBytes(value) {
  const json = JSON.stringify(value);
  return Buffer.byteLength(json, 'utf8') + (json.match(/[,:]/g)?.length ?? 0);
}

/**
 * A suggestion's summary (the version-1 shape above). Kept within
 * SUMMARY_MAX_BYTES: past it the play's data row goes, then the payload's
 * lists, then the priority reason and the play; a title then reads generic,
 * as the web's does for an action whose payload names nothing.
 *
 * @param {object} input
 * @param {object} input.action the action's row: action_no, kind, category, impact,
 *   created_at, priority_score, priority_level, priority_reason
 * @param {object} input.payload its payload
 * @param {{ score: number, wait: { days: number, points: number }, startNow: string|null,
 *   variety: boolean }} input.pick what pickSuggestion chose it with
 */
export function buildSummary({ action, payload, pick }) {
  const summary = {
    version: SUMMARY_VERSION,
    action: {
      no: action.action_no ?? null,
      kind: action.kind,
      category: action.category,
      impact: action.impact ?? null,
      createdAt: action.created_at ?? null,
      payload: titlePayload(payload),
    },
    priority: {
      score: Number.isFinite(action.priority_score) ? action.priority_score : null,
      level: action.priority_level ?? null,
      reason: action.priority_reason ?? null,
    },
    waitingDays: pick.wait.days,
    ranking: {
      score: pick.score,
      waitPoints: pick.wait.points,
      startNowPoints: pick.startNow ? START_NOW_LIFT : 0,
      variety: pick.variety,
    },
    startNow: startNowOf(pick.startNow, payload),
    play: playOf(payload),
  };

  if (summaryBytes(summary) > SUMMARY_MAX_BYTES && summary.play) summary.play.dataRow = null;
  if (summaryBytes(summary) > SUMMARY_MAX_BYTES) {
    summary.action.payload = Object.fromEntries(
      Object.entries(summary.action.payload).filter(([, value]) => !Array.isArray(value)),
    );
  }
  if (summaryBytes(summary) > SUMMARY_MAX_BYTES) {
    summary.priority.reason = null;
    summary.play = null;
  }
  return summary;
}
