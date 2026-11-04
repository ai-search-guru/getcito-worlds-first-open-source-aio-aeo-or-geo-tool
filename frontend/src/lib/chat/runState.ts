import type {
  ChatActionSent,
  ChatAsk,
  ChatConfirm,
  ChatNextMove,
  ChatDeliverable,
  ChatDenialCard,
  ChatEvent,
  ChatRunSummary,
  ChatStep,
  ChatTaskStrip,
  ChatWhatsNewEntry,
} from './events';
import { isChatEventType } from './events';
import type { ChatWhy } from './why/view';

/**
 * A run as the browser draws it, built from its events only (CHAT-00: the
 * client renders from the events). The same events, live or replayed from
 * the start after a reload (`GET …/events?after=0`), build the same run
 * (CHAT-03 item 21). An event already applied (its seq) or of a type this
 * build doesn't know is skipped.
 */

export type ClientRunStatus =
  | 'queued'
  | 'running'
  | 'waiting'
  | 'done'
  | 'stopped'
  | 'error'
  | 'paused_cap';

export interface ClientRun {
  status: ClientRunStatus;
  /** In step order. */
  steps: ChatStep[];
  /** The answer so far. */
  text: string;
  /** The card the run waits on; null when none. */
  confirm: ChatConfirm | null;
  /** The question card the run waits on (CHAT-07); null when none. */
  question: ChatAsk | null;
  /** What could come next, once it finished (CHAT-07 §C): best first. */
  nextMoves: ChatNextMove[];
  /** Out-of-permission answers, in order. */
  denials: ChatDenialCard[];
  /** What it made, in order (CHAT-06 item 1): the n-th is the run's file n. */
  deliverables: ChatDeliverable[];
  /** What it sent to the Action Center, in order (CHAT-09 item 19). */
  sent: ChatActionSent[];
  /** The Action Center tasks it works on (CHAT-09 §B); null when it has none. */
  tasks: ChatTaskStrip | null;
  /** Why did it move analyses it kept (CHAT-22 §1), in order. */
  why: ChatWhy[];
  /** What's new's cards (CHAT-11 item 10). */
  whatsNew: ChatWhatsNewEntry[];
  summary: ChatRunSummary | null;
  generatedAt: string | null;
  dataAsOf: string | null;
  /** Why it ended in error, in words, when the server gave them. */
  errorReason: string | null;
  /** It ended because the workspace's own AI key failed (AGENT-OWN-KEY §5.2): where to fix it shows. */
  keyFailed: boolean;
  /** The last event applied: a reconnect asks for the ones after it. */
  lastSeq: number;
}

export function emptyRun(status: ClientRunStatus = 'running'): ClientRun {
  return {
    status,
    steps: [],
    text: '',
    confirm: null,
    question: null,
    nextMoves: [],
    denials: [],
    deliverables: [],
    sent: [],
    tasks: null,
    why: [],
    whatsNew: [],
    summary: null,
    generatedAt: null,
    dataAsOf: null,
    errorReason: null,
    keyFailed: false,
    lastSeq: 0,
  };
}

function withStep(steps: ChatStep[], step: ChatStep): ChatStep[] {
  const rest = steps.filter((s) => s.n !== step.n);
  return [...rest, step].sort((a, b) => a.n - b.n);
}

/** The run after one more event. Pure: the run given isn't changed. */
export function applyChatEvent(run: ClientRun, event: ChatEvent): ClientRun {
  if (!isChatEventType(event.type) || event.seq <= run.lastSeq) return run;
  const next: ClientRun = { ...run, lastSeq: event.seq };
  switch (event.type) {
    case 'step.started':
    case 'step.updated':
    case 'step.finished': {
      next.steps = withStep(run.steps, event.data.step);
      // A step that runs again after its card (approved) isn't waiting any more.
      if (
        run.confirm &&
        event.data.step.n === run.confirm.n &&
        event.data.step.status !== 'waiting'
      ) {
        next.confirm = null;
      }
      // An answered question's step closes on its answer: the card folds into it.
      if (
        run.question &&
        event.data.step.n === run.question.n &&
        event.data.step.status !== 'waiting'
      ) {
        next.question = null;
      }
      if (next.status === 'waiting' && !next.confirm && !next.question) next.status = 'running';
      return next;
    }
    case 'text.delta':
      next.text = run.text + event.data.text;
      return next;
    case 'text.replaced':
      next.text = event.data.text;
      return next;
    case 'confirm.required':
      next.confirm = event.data;
      next.status = 'waiting';
      return next;
    case 'ask.created':
      next.question = event.data;
      next.status = 'waiting';
      return next;
    case 'deliverable.created':
      next.deliverables = [...run.deliverables, event.data];
      return next;
    case 'action.sent':
      next.sent = [...run.sent, event.data];
      return next;
    case 'tasks.updated':
      next.tasks = event.data;
      return next;
    case 'why.ready':
      next.why = [...run.why.filter((why) => why.n !== event.data.n), event.data];
      return next;
    case 'whats_new.ready':
      next.whatsNew = event.data.entries;
      return next;
    case 'next_moves':
      next.nextMoves = event.data.moves;
      return next;
    case 'access.denied':
      next.denials = [...run.denials, event.data];
      return next;
    case 'run.finished': {
      const { generatedAt, dataAsOf, ...summary } = event.data;
      return {
        ...next,
        status: 'done',
        confirm: null,
        question: null,
        summary,
        generatedAt,
        dataAsOf,
      };
    }
    case 'run.stopped': {
      const { reason: _reason, ...summary } = event.data;
      void _reason;
      return { ...next, status: 'stopped', confirm: null, question: null, summary };
    }
    case 'run.error': {
      const { code, reason, keyFailure: _keyFailure, ...summary } = event.data;
      void _keyFailure;
      return {
        ...next,
        status: 'error',
        confirm: null,
        question: null,
        summary,
        errorReason: reason ?? null,
        keyFailed: code === 'own_key',
      };
    }
    case 'run.paused_cap': {
      const { limit: _limit, ...summary } = event.data;
      void _limit;
      return { ...next, status: 'paused_cap', confirm: null, question: null, summary };
    }
    default:
      return next;
  }
}

/** A run from its events, in any order and with repeats. */
export function runFromEvents(
  events: readonly ChatEvent[],
  start: ClientRun = emptyRun(),
): ClientRun {
  return [...events].sort((a, b) => a.seq - b.seq).reduce(applyChatEvent, start);
}
