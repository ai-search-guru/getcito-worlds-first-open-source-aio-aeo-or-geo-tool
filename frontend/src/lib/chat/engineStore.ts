import type { ModelMessage } from 'ai';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import {
  chatEvent,
  isChatEventType,
  type ChatEvent,
  type ChatEventPayloads,
  type ChatEventType,
} from './events';
import type { RunKeyFailure } from './engineKey';
import type { ChatPhase } from './engineModel';
import type { UntrustedShingles } from './goLiveChecks';
import type { NextMoveInput } from './nextMoves';
import type { PageSites } from './pageSites';
import type { ChatMode } from './precedence';
import { publishRunEvent, type TailSource } from './runHub';
import type { ChatEffort } from './runLimits';
import { toClientStep, type ChatRunStepMemberRow } from './steps';

/**
 * What the engine keeps of a run, in the tables of 00400 and 00406, read and
 * written with the service role: the run, its state, its steps and its
 * events. A step's `tool` and `debug_json` are written here and never read
 * back for a browser (toClientStep). Server only.
 */

export const CHAT_RUN_STATUSES = [
  'queued',
  'running',
  'waiting',
  'paused',
  'paused_cap',
  'done',
  'error',
  'stopped',
] as const;
export type ChatRunStatus = (typeof CHAT_RUN_STATUSES)[number];

/** A run that may still work: the ones a Stop or the sweep act on. */
export const OPEN_RUN_STATUSES: readonly ChatRunStatus[] = [
  'queued',
  'running',
  'waiting',
  'paused',
  'paused_cap',
];

/** One tool call of a model step. */
export interface PendingCall {
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** A call's answer for the model, by its call. */
export interface CallResult {
  toolCallId: string;
  toolName: string;
  /** What the model reads: the tool's output, cut to the run's budget, or a result code. */
  value: Json;
  error: boolean;
  /** It may carry text written outside the workspace: the model reads it in an untrusted block. */
  untrusted?: boolean;
  /** Where it came from, in the step's words ("AI answers"), for its block's label. */
  source?: string;
}

/** The calls of a model step a run waits in: the one on the card, and those after it. */
export interface PendingCalls {
  calls: PendingCall[];
  /** The call on the card. */
  index: number;
  /** The answers of the calls before it. */
  results: CallResult[];
  /** The card's step. */
  stepId: string;
  n: number;
  /** The hash of the arguments on the card (ChatConfirm.digest). */
  digest: string;
  /** A WRITE's card (`ask`), an EXECUTE's click, or a question card (CHAT-07). */
  kind: 'ask' | 'click' | 'question';
  offerDontAskAgain: boolean;
}

/**
 * Why a run stopped: the person's Stop, a card left 7 days, its agent run's
 * cap, or the Action Center action its run worked on closed (CHAT-21 edge
 * case 7).
 */
export type ChatStopReason = 'person' | 'expired' | 'limit' | 'action_closed';

/** A run's phase, counters and what it read so far (CHAT-04 item 5, CHAT-20 §14). */
export interface RunProgress {
  phase: ChatPhase;
  modelSteps: number;
  reads: number;
  dataChars: number;
  /** Writes made, by tool name. */
  writes: Record<string, number>;
  /** Reads made, by tool name, for the reads READ_CAPS caps (pages opened). */
  toolReads?: Record<string, number>;
  /**
   * The sites the run's reads listed in their structured fields (competitors'
   * domains, cited and audited pages): with the person's and the brand's, a
   * page may be opened on these (CHAT-10 item 11, pageSites.ts).
   */
  pageSites?: PageSites;
  /** What the read phase read, for the writing model. */
  readLog: { tool: string; input: unknown; result: Json; source?: string; untrusted?: boolean }[];
  /** Steps so far: the next one is n = steps + 1. */
  steps: number;
  /** The answer so far, as the person saw it stream. */
  text: string;
  /** The newest data a read used (CHAT-20 §15a). */
  dataAsOf: string | null;
  /** The "Data used" chips: rows by source label. */
  sources: Record<string, number>;
  timezone: string;
  brandId: string | null;
  /**
   * A read this run returned text from outside the workspace's own numbers
   * (AI answers, cited pages, drafts, generated tasks), or the run started
   * so (a tainted run's next move, a chat where a read aimed words at AI):
   * every change after it shows a card, in every mode (CHAT-20 §16a).
   */
  tainted?: boolean;
  /**
   * A read returned text written to steer an AI assistant (CHAT-05 item
   * 12), or a page this run opened aimed words at AI (§16a rule 3): ignored,
   * said so in the answer, and the rest of the run asks first and opens only
   * pages given exactly; a later run of the chat starts tainted.
   */
  injection?: boolean;
  /**
   * An agent run's untrusted reads, as hashed 12-word runs (goLiveChecks.ts
   * keepShingles, 32 KB at most): a page the agent wants to take live on its
   * own must not copy 30 words in a row of them (AUTONOMOUS-GO-LIVE §6.3).
   */
  untrustedShingles?: UntrustedShingles;
  /**
   * The answer's fact check (CHAT-05 item 11): figures checked against the
   * run's data, and the ones taken out (a placeholder in their place).
   */
  facts?: { checked: number; replaced: string[] };
  /**
   * The question is a next move a tainted run suggested: no site comes from
   * its words, here or in a later turn (its row's context_json says so too).
   */
  fromTaintedMove?: boolean;
  /** Question cards asked so far (CHAT-07 §B: at most 4 a run). */
  asks?: number;
  /**
   * A run a scheduled job started (CHAT-12 item 11), not a person's message
   * in the job's chat: nobody watches it, and it is metered as the job's.
   */
  scheduled?: boolean;
  /**
   * A change-only job's run (CHAT-12 item 20): the fingerprint of what its
   * last delivered run read; null for its first run, which always delivers.
   */
  changeOnly?: { last: string | null };
  /** sha256 of what this scheduled run read (schedule/fingerprint.ts), kept as the job's once delivered. */
  fingerprint?: string;
  /** It read what its change-only job's last delivered run read: it stopped before writing ("No change"). */
  unchanged?: boolean;
  /**
   * The Recommended options a scheduled job's run took for nobody watching
   * (CHAT-12 item 12): listed at the top of its answer.
   */
  assumptions?: string[];
  /** Why did it move analyses kept so far: the next one's card is n = whys + 1. */
  whys?: number;
  /** The next moves the model suggested last (CHAT-07 §C), kept once the run ends. */
  nextMoves?: NextMoveInput[];
  /** The limit a run at paused_cap reached: the month's AI limit, or its agent run's cap. */
  capHit?: 'run' | 'month';
  /** Why a stopped run stopped (its run.stopped reason), for its agent run (CHAT-21 §H). */
  stoppedFor?: ChatStopReason;
  /**
   * The run ended on the workspace's own key failing (AGENT-OWN-KEY §5.2):
   * its agent run is stopped `own_key`, and a triggered agent pauses.
   */
  keyFailure?: RunKeyFailure;
  /**
   * Its scope holds text from outside the workspace's own numbers (an Action
   * Center action's title and tasks, CHAT-21 §F): the models read it as
   * untrusted data, never as instructions (CHAT-20 §16a).
   */
  scopeUntrusted?: boolean;
  /** The skills loaded for this run, by name, in order (CHAT-13 item 4: at most 3). */
  skills?: string[];
  /**
   * The shortcut the message started (CHAT-08, W2-09; chat_messages.shortcut_id):
   * its playbook loads first, and the run reads only its data plan.
   */
  shortcut?: string;
  /** The run put Action Center tasks in its chat's task strip (CHAT-09 §B): it shows it as it ends. */
  taskStrip?: boolean;
  /** The action a /tasks run opened last (get_action): what it files next is for its task. */
  taskAction?: string;
  /**
   * The job in parts the person is asked about (CHAT-04 item 17a): how many
   * the AI limit left covers, of how many, and what they are; and which
   * limit binds, the agent run's own cap or the month's.
   */
  parts?: { fits: number; parts: number; unit: string; limit?: 'run' | 'month' };
  /**
   * No one was there to ask (an agent's or a scheduled run): the parts that
   * fit are done, and the run stops at the limit that binds as it ends.
   */
  limitStop?: 'run' | 'month';
}

export function newProgress(timezone: string, brandId: string | null, phase: ChatPhase) {
  const progress: RunProgress = {
    phase,
    modelSteps: 0,
    reads: 0,
    dataChars: 0,
    writes: {},
    readLog: [],
    steps: 0,
    text: '',
    dataAsOf: null,
    sources: {},
    timezone,
    brandId,
  };
  return progress;
}

export interface LoadedRun {
  id: string;
  status: ChatRunStatus;
  conversationId: string;
  messageId: string;
  effort: ChatEffort;
  organizationId: string;
  userId: string;
  mode: ChatMode;
  messages: ModelMessage[];
  pending: PendingCalls | null;
  progress: RunProgress;
  workingMs: number;
  lastSeq: number;
  waitingSince: string | null;
}

const asJson = (value: unknown): Json => JSON.parse(JSON.stringify(value ?? null)) as Json;

function fail(what: string, error: { message: string } | null): never {
  throw new Error(`Chat could not ${what}: ${error?.message ?? 'no row'}`);
}

/** A run with its state; null when either is missing. */
export async function loadRun(runId: string): Promise<LoadedRun | null> {
  const [run, state] = await Promise.all([
    supabaseAdmin
      .from('chat_runs')
      .select('id, status, conversation_id, message_id, effort')
      .eq('id', runId)
      .maybeSingle(),
    supabaseAdmin
      .from('chat_run_state')
      .select(
        'organization_id, user_id, mode, messages, pending, progress, working_ms, last_seq, waiting_since',
      )
      .eq('run_id', runId)
      .maybeSingle(),
  ]);
  if (run.error) fail('read a run', run.error);
  if (state.error) fail("read a run's state", state.error);
  if (!run.data || !state.data) return null;
  const r = run.data as Record<string, unknown>;
  const s = state.data as Record<string, unknown>;
  return {
    id: r.id as string,
    status: r.status as ChatRunStatus,
    conversationId: r.conversation_id as string,
    messageId: r.message_id as string,
    effort: (r.effort as ChatEffort) ?? 'normal',
    organizationId: s.organization_id as string,
    userId: s.user_id as string,
    mode: s.mode as ChatMode,
    messages: (s.messages as ModelMessage[]) ?? [],
    pending: (s.pending as PendingCalls | null) ?? null,
    progress: s.progress as unknown as RunProgress,
    workingMs: (s.working_ms as number) ?? 0,
    lastSeq: (s.last_seq as number) ?? 0,
    waitingSince: (s.waiting_since as string | null) ?? null,
  };
}

/** A run's status, or null when it is gone. */
export async function runStatus(runId: string): Promise<ChatRunStatus | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_runs')
    .select('status')
    .eq('id', runId)
    .maybeSingle();
  if (error) fail("read a run's status", error);
  return ((data as { status?: ChatRunStatus } | null)?.status ?? null) as ChatRunStatus | null;
}

/**
 * Moves a run to `to`, only from one of `from`: false when it was in none
 * (a Stop got there first, or another request took it).
 */
export async function moveRun(
  runId: string,
  from: readonly ChatRunStatus[],
  to: ChatRunStatus,
  patch: { error?: string | null; finished?: boolean; started?: boolean } = {},
): Promise<boolean> {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('chat_runs')
    .update({
      status: to,
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.finished ? { finished_at: now } : {}),
      ...(patch.started ? { started_at: now } : {}),
    })
    .eq('id', runId)
    .in('status', [...from])
    .select('id');
  if (error) fail('change a run', error);
  return Array.isArray(data) && data.length > 0;
}

export interface StatePatch {
  messages?: ModelMessage[];
  pending?: PendingCalls | null;
  progress?: RunProgress;
  workingMs?: number;
  lastSeq?: number;
  waitingSince?: string | null;
}

export async function saveState(runId: string, patch: StatePatch): Promise<void> {
  const row: Record<string, unknown> = { heartbeat_at: new Date().toISOString() };
  if (patch.messages !== undefined) row.messages = asJson(patch.messages);
  if (patch.pending !== undefined) row.pending = patch.pending ? asJson(patch.pending) : null;
  if (patch.progress !== undefined) row.progress = asJson(patch.progress);
  if (patch.workingMs !== undefined) row.working_ms = Math.max(0, Math.round(patch.workingMs));
  if (patch.lastSeq !== undefined) row.last_seq = patch.lastSeq;
  if (patch.waitingSince !== undefined) row.waiting_since = patch.waitingSince;
  const { error } = await supabaseAdmin.from('chat_run_state').update(row).eq('run_id', runId);
  if (error) fail("save a run's state", error);
}

/** A step row as the engine writes it: what the person sees, and the server's tool and debug record. */
export interface StepWrite {
  position: number;
  kind: string;
  status: string;
  label: string;
  detail?: string | null;
  scope?: Record<string, unknown> | null;
  rowCount?: number | null;
  dataAsOf?: string | null;
  tool?: string | null;
  debug?: Record<string, unknown> | null;
  /** The step's measure (00410), for staff only: never a member column, never in an event. */
  measure?: StepMeasure;
}

/** What a step measured (CHAT-04 item 10): how long it took, and what its result sent the model. */
export interface StepMeasure {
  latencyMs?: number;
  /** Its result came from the chat's kept results (toolCache.ts). */
  cacheHit?: boolean;
  /** Its result was cut to its row limit or the run's budget before the model saw it. */
  truncated?: boolean;
  /** The tokens its result sent the model. */
  resultTokens?: number;
}

type MeasureColumns = Partial<{
  latency_ms: number;
  cache_hit: boolean;
  truncated: boolean;
  result_tokens: number;
}>;

/** A measure as chat_run_steps' columns; only what it holds. */
export function measureColumns(measure: StepMeasure | undefined): MeasureColumns {
  if (!measure) return {};
  const count = (n: number | undefined) =>
    typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.round(n)) : undefined;
  const row: MeasureColumns = {};
  const latency = count(measure.latencyMs);
  const tokens = count(measure.resultTokens);
  if (latency !== undefined) row.latency_ms = latency;
  if (measure.cacheHit !== undefined) row.cache_hit = measure.cacheHit;
  if (measure.truncated !== undefined) row.truncated = measure.truncated;
  if (tokens !== undefined) row.result_tokens = tokens;
  return row;
}

/** The member columns of a step the engine just wrote, for toClientStep. */
export type StepRow = ChatRunStepMemberRow;

const clip = (text: string | null | undefined, max: number) =>
  text ? (text.length > max ? `${text.slice(0, max - 1)}…` : text) : null;

/** A debug record within its column's 1 MB. */
function debugJson(debug: Record<string, unknown> | null | undefined): Json | null {
  if (!debug) return null;
  const text = JSON.stringify(debug);
  if (text.length <= 900_000) return asJson(debug);
  return asJson({ ...debug, output: '(cut: over 900 KB)', cut: true });
}

export async function insertStep(
  runId: string,
  step: StepWrite,
): Promise<StepRow & { id: string }> {
  const now = new Date().toISOString();
  const row = {
    run_id: runId,
    position: step.position,
    kind: step.kind,
    status: step.status,
    label: clip(step.label, 200) ?? '…',
    detail: clip(step.detail, 500),
    scope_json: (step.scope as Json | null | undefined) ?? null,
    row_count: step.rowCount ?? null,
    data_as_of: step.dataAsOf ?? null,
    started_at: now,
    finished_at: step.status === 'done' || step.status === 'error' ? now : null,
    tool: step.tool ?? null,
    debug_json: debugJson(step.debug),
    ...measureColumns(step.measure),
  };
  const { data, error } = await supabaseAdmin
    .from('chat_run_steps')
    .insert(row)
    .select(
      'id, run_id, position, kind, status, label, detail, scope_json, row_count, data_as_of, started_at, finished_at',
    )
    .single();
  if (error || !data) fail('write a step', error);
  return data as unknown as StepRow & { id: string };
}

export async function updateStep(
  stepId: string,
  patch: Partial<Omit<StepWrite, 'position' | 'tool'>>,
): Promise<StepRow> {
  const row: Record<string, unknown> = {};
  if (patch.kind !== undefined) row.kind = patch.kind;
  if (patch.status !== undefined) {
    row.status = patch.status;
    if (['done', 'error', 'skipped'].includes(patch.status)) {
      row.finished_at = new Date().toISOString();
    }
  }
  if (patch.label !== undefined) row.label = clip(patch.label, 200) ?? '…';
  if (patch.detail !== undefined) row.detail = clip(patch.detail, 500);
  if (patch.scope !== undefined) row.scope_json = patch.scope ?? null;
  if (patch.rowCount !== undefined) row.row_count = patch.rowCount;
  if (patch.dataAsOf !== undefined) row.data_as_of = patch.dataAsOf;
  if (patch.debug !== undefined) row.debug_json = debugJson(patch.debug);
  Object.assign(row, measureColumns(patch.measure));
  const { data, error } = await supabaseAdmin
    .from('chat_run_steps')
    .update(row)
    .eq('id', stepId)
    .select(
      'id, run_id, position, kind, status, label, detail, scope_json, row_count, data_as_of, started_at, finished_at',
    )
    .single();
  if (error || !data) fail('change a step', error);
  return data as unknown as StepRow;
}

/** The run's steps that are still under way (running or waiting), for a Stop. */
export async function openSteps(runId: string): Promise<(StepRow & { id: string })[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_run_steps')
    .select(
      'id, run_id, position, kind, status, label, detail, scope_json, row_count, data_as_of, started_at, finished_at',
    )
    .eq('run_id', runId)
    .in('status', ['running', 'waiting', 'pending']);
  if (error) fail("read a run's steps", error);
  return (data ?? []) as unknown as (StepRow & { id: string })[];
}

/** The answer as kept on its message: the text, and when it was made (CHAT-06 38–42). */
export async function saveAnswer(
  messageId: string,
  answer: { text: string; generatedAt?: string; dataAsOf?: string | null; timezone?: string },
): Promise<void> {
  const row: Record<string, unknown> = { content_md: answer.text.slice(0, 200_000) };
  if (answer.generatedAt) row.generated_at = answer.generatedAt;
  if (answer.dataAsOf !== undefined) row.data_as_of = answer.dataAsOf;
  if (answer.timezone) row.timezone = answer.timezone;
  const { error } = await supabaseAdmin.from('chat_messages').update(row).eq('id', messageId);
  if (error) fail('save the answer', error);
}

/** A run's kept events after `afterSeq`, in order; ones this build doesn't know are skipped. */
export async function readRunEvents(runId: string, afterSeq: number): Promise<ChatEvent[]> {
  const { data, error } = await supabaseAdmin
    .from('chat_run_events')
    .select('seq, type, data')
    .eq('run_id', runId)
    .gt('seq', afterSeq)
    .order('seq', { ascending: true })
    .limit(5000);
  if (error) fail("read a run's events", error);
  return ((data ?? []) as { seq: number; type: string; data: unknown }[])
    .filter((row) => isChatEventType(row.type))
    .map((row) => ({ type: row.type, seq: row.seq, data: row.data }) as ChatEvent);
}

/** The tail source for a run's kept events. */
export const STORED_EVENTS: TailSource = {
  readEvents: readRunEvents,
  async isWorking(runId) {
    const status = await runStatus(runId);
    return status === 'queued' || status === 'running';
  },
};

/** How long events wait before they are written together. */
const FLUSH_MS = 250;

/**
 * The events of one run as the engine sends them: each made safe
 * (chatEvent), numbered, handed at once to the listeners in this process,
 * and kept in chat_run_events, written in small batches. flush() before
 * the run waits or ends.
 */
export class RunEventSink {
  private seq: number;
  private buffer: { run_id: string; seq: number; type: string; data: Json }[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writing: Promise<void> = Promise.resolve();

  constructor(
    private readonly runId: string,
    lastSeq: number,
  ) {
    this.seq = lastSeq;
  }

  get lastSeq(): number {
    return this.seq;
  }

  emit<K extends ChatEventType>(type: K, data: ChatEventPayloads[K]): ChatEvent {
    const event = chatEvent(type, this.seq + 1, data);
    this.seq = event.seq;
    publishRunEvent(this.runId, event);
    this.buffer.push({ run_id: this.runId, seq: event.seq, type, data: asJson(event.data) });
    this.timer ??= setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_MS);
    return event;
  }

  /** Writes what is waiting; never throws (a lost write only loses the replay). */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const rows = this.buffer.splice(0);
    if (rows.length === 0) return this.writing;
    const lastSeq = rows[rows.length - 1].seq;
    this.writing = this.writing.then(async () => {
      try {
        const { error } = await supabaseAdmin.from('chat_run_events').insert(rows);
        if (error) throw new Error(error.message);
        await saveState(this.runId, { lastSeq });
      } catch (err) {
        console.error('[chat/engine] could not keep a run’s events:', err);
      }
    });
    return this.writing;
  }
}

/** A stored step as its event's payload. */
export function clientStep(row: StepRow) {
  const step = toClientStep(row);
  if (!step) throw new Error(`A step this build can't show: ${row.kind}/${row.status}`);
  return step;
}
