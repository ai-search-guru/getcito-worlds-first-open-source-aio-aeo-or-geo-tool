import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import type { ApiFailure } from '@/lib/apiFailure';
import { agentRunFrom, runUnderWay, shownSteps, stepMessage } from '@/lib/content/agentRuns';
import { isChatHref, maskIds, type ChatHref } from './events';
import { toClientStep, type ChatRunStepMemberRow } from './steps';

/**
 * The runs tray (Chat agentic plan §2, CHAT-23 G4 `runs.toggleTray`): the
 * person's Chat runs and the brand's Content Agent runs, newest first, each
 * with where it stands and where its Open goes. Built on the server from the
 * rows the person may read; what reaches the browser has no id but the one in
 * its link, and no tool name (CHAT-03 item 22).
 */

/** Where a run stands, as its row's avatar and right-hand control show it. */
export type TrayRunState = 'running' | 'needsYou' | 'paused' | 'done' | 'failed';

export interface TrayRun {
  source: 'chat' | 'content';
  state: TrayRunState;
  /** The chat's title or the draft's; null for a chat Chat hasn't named yet ("New chat"). */
  title: string | null;
  /** The step it is on, from 1; 0 when it has none yet. */
  step: number;
  /** How many steps it has; 0 when it has none yet. */
  steps: number;
  /** The step it is on, in words ("Read Citations", "Gathering 52 sources"). */
  stepLabel: string | null;
  /** When it started, ISO: the tray's order. */
  startedAt: string;
  /** When it ended, ISO; null while it is under way. */
  finishedAt: string | null;
  /** Its Open: the chat, or the draft in the Content Editor. Also the row's key. */
  href: ChatHref;
}

export interface TrayResponse {
  runs: TrayRun[];
  /** Runs under way (running or paused) and runs that need the person, in the whole list. */
  running: number;
  needsYou: number;
}

/**
 * Why the tray's runs couldn't be read, as a value (the reads' pattern since
 * #1777): `failure` for the app's plain words (apiFailure), `error` for a log.
 */
export interface TrayFailure {
  ok: false;
  failure: ApiFailure;
  error: string;
}

/** /api/chat/runs/tray's answer. */
export type TrayResult = ({ ok: true } & TrayResponse) | TrayFailure;

/** The tray's length: the newest runs first. */
export const TRAY_LIMIT = 10;

/** How long a run that ended stays in the tray. */
export const TRAY_DONE_MS = 24 * 60 * 60_000;

/** chat_runs.status (00400) as the tray shows it; null for one this build doesn't know. */
export function chatTrayState(status: string): TrayRunState | null {
  switch (status) {
    case 'queued':
    case 'running':
      return 'running';
    case 'waiting':
      return 'needsYou';
    case 'paused':
    case 'paused_cap':
      return 'paused';
    case 'done':
      return 'done';
    case 'error':
    case 'stopped':
      return 'failed';
    default:
      return null;
  }
}

const ended = (state: TrayRunState) => state === 'done' || state === 'failed';

/** Whether a run that ended, ended long enough ago to leave the tray. */
function tooOld(finishedAt: string | null, now: number): boolean {
  if (!finishedAt) return false;
  const at = Date.parse(finishedAt);
  return Number.isFinite(at) && now - at > TRAY_DONE_MS;
}

export interface ChatRunRow {
  conversation_id: string;
  status: string;
  created_at: string;
  finished_at: string | null;
}

/**
 * A Chat run as the tray shows it: its chat's title, and the step it is on (a
 * step waiting on the person, else the one running, else the last), in the
 * label registry's words. Null for a status this build doesn't know, or one
 * that ended more than a day ago.
 */
export function chatTrayRun(
  run: ChatRunRow,
  chatTitle: string | null,
  stepRows: ChatRunStepMemberRow[],
  now = Date.now(),
): TrayRun | null {
  const state = chatTrayState(run.status);
  const href = `/dashboard/chat/${run.conversation_id}`;
  if (!state || !isChatHref(href)) return null;
  const finishedAt = ended(state) ? (run.finished_at ?? run.created_at) : null;
  if (tooOld(finishedAt, now)) return null;
  const steps = stepRows
    .map(toClientStep)
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.n - b.n);
  const current =
    steps.find((s) => s.status === 'waiting') ??
    [...steps].reverse().find((s) => s.status === 'running') ??
    steps.at(-1);
  return {
    source: 'chat',
    state,
    title: chatTitle ? maskIds(chatTitle) : null,
    step: current ? steps.indexOf(current) + 1 : 0,
    steps: steps.length,
    stepLabel: current?.label ?? null,
    startedAt: run.created_at,
    finishedAt,
    href,
  };
}

/** The editor's step words; keys from stepMessage(), so typed loosely. */
const stepT = createTranslator({
  locale: 'en',
  messages,
  namespace: 'contentEditor.editor.agentCard.steps',
}) as unknown as (key: string, values: { count: number }) => string;

/**
 * A Content Agent run (content_agent_runs, 00249) as the tray shows it: its
 * draft's title, and the step it is on, in the editor's own words. A run a
 * stopped server left unfinished shows as failed, as the editor treats it.
 * Null for a row the editor couldn't show, or one that ended more than a day
 * ago.
 */
export function contentTrayRun(
  row: Record<string, unknown>,
  draft: { id: string; title: string | null },
  now = Date.now(),
): TrayRun | null {
  const run = agentRunFrom(row);
  const href = `/dashboard/content/editor/${draft.id}`;
  if (!run || !isChatHref(href)) return null;
  const underWay = runUnderWay(run, now);
  const state: TrayRunState = underWay
    ? 'running'
    : run.outcome === 'done' || (run.finishedAt && !run.outcome)
      ? 'done'
      : 'failed';
  const finishedAt = underWay ? null : (run.finishedAt ?? run.stoppedAt ?? run.startedAt);
  if (tooOld(finishedAt, now)) return null;
  const shown = shownSteps(run);
  // The step under way among the ones the editor shows; the last once done.
  const at = shown.findIndex(({ index }) => index >= run.step);
  const current = at === -1 ? shown.length - 1 : at;
  const message = shown[current] ? stepMessage(shown[current].step) : null;
  return {
    source: 'content',
    state,
    title: draft.title ? maskIds(draft.title) : null,
    step: shown.length ? current + 1 : 0,
    steps: shown.length,
    stepLabel: message ? stepT(message.key, { count: message.count ?? 0 }) : null,
    startedAt: run.startedAt,
    finishedAt,
    href,
  };
}

/**
 * The tray: newest first, one row per chat and per draft (its latest run),
 * at most TRAY_LIMIT, with the counts for its button.
 */
export function trayResponse(rows: TrayRun[], limit = TRAY_LIMIT): TrayResponse {
  const time = (iso: string) => {
    const at = Date.parse(iso);
    return Number.isFinite(at) ? at : 0;
  };
  const latest = new Map<string, TrayRun>();
  for (const row of [...rows].sort((a, b) => time(b.startedAt) - time(a.startedAt))) {
    if (!latest.has(row.href)) latest.set(row.href, row);
  }
  const runs = [...latest.values()];
  return {
    runs: runs.slice(0, limit),
    running: runs.filter((r) => r.state === 'running' || r.state === 'paused').length,
    needsYou: runs.filter((r) => r.state === 'needsYou').length,
  };
}
