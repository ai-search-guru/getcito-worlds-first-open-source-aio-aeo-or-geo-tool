import { supabaseAdmin } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import {
  isChatEventType,
  maskIds,
  type ChatDeliverable,
  type ChatNextMove,
  type ChatRunSummary,
  type ChatActionSent,
  type ChatStep,
  type ChatTaskStrip,
  type ChatWhatsNewEntry,
} from './events';
import { clientMove } from './nextMoves';
import { applyChatEvent, emptyRun } from './runState';
import { CHAT_RUN_STEP_SELECT, toClientStep, type ChatRunStepMemberRow } from './steps';
import { readDeliverableTasks, readStrips, weekEndIn, type DeliverableTask } from './taskStrip';
import type { WhyResult } from './why/explain';
import { whyView, type ChatWhy } from './why/view';

/**
 * A saved chat as its page opens it (CHAT-01, CHAT-03 item 21): its
 * messages, and each answer's run with the steps as kept (toClientStep: no
 * tool, no debug record). Read as the person, so the chat's policy holds: a
 * chat is its author's only (CHAT-20 §16c). A run still under way is rebuilt
 * by the page from its events (`…/events?after=0`), and keeps streaming. A
 * run that ended keeps what its end event told the browser (W1-15): its
 * header's time, steps and sources, and why it ended in error, in the same
 * words, so a reload shows "Stopped after 41s" and the reason with Retry.
 * A finished run's next moves come back from chat_next_moves, in the
 * person's own chat only; a failed read of them loses the moves, not the chat.
 * A /tasks run's task strip comes back from chat_task_state as it is now
 * (CHAT-09 §B): a task the person completed in Action Center since reads
 * Done; a failed read loses the strip, not the chat.
 */

export interface ThreadRun {
  /** The run's handle for its routes (approve, stop, events): the person's own. */
  runId: string;
  status: string;
  steps: ChatStep[];
  /** Its answer in Files (CHAT-06 item 36): "In Files"; null until saved. */
  fileId: string | null;
  /** What it made, as filed (CHAT-06 item 1), in the order it made them. */
  deliverables: ChatDeliverable[];
  /** Its end, as its end event said it (CHAT-03 items 10, 18–19); null while it works. */
  summary: ChatRunSummary | null;
  /** Why it ended in error, in its run.error event's words; null without them. */
  errorReason: string | null;
  /** It ended because the workspace's own AI key failed (run.error `own_key`). */
  keyFailed: boolean;
  /** What could come next once it finished (CHAT-07 §C), best first. */
  nextMoves: ChatNextMove[];
  /** What it sent to the Action Center (CHAT-09 item 19), in order. */
  sent: ChatActionSent[];
  /** The Action Center tasks it worked on (CHAT-09 §B); null when it had none. */
  tasks: ChatTaskStrip | null;
  /** The Why did it move analyses it kept (CHAT-22 §1), in order. */
  why: ChatWhy[];
  /** What's new's cards (CHAT-11 item 10). */
  whatsNew: ChatWhatsNewEntry[];
}

export interface ThreadMessage {
  role: 'user' | 'assistant';
  text: string;
  generatedAt: string | null;
  dataAsOf: string | null;
  timezone: string | null;
  run: ThreadRun | null;
  /**
   * A question Retry may send again as it was (W1-15): one without files
   * (each goes with one message only) and without a page scope (its chips
   * and @ references stay on the server). Questions only.
   */
  resendable?: boolean;
}

export interface ChatThread {
  conversationId: string;
  title: string | null;
  brandId: string | null;
  /** The person's own chat; false for a teammate's shared one, which they only read. */
  mine: boolean;
  messages: ThreadMessage[];
}

/** A file in Files the chat's runs made or saved, as the thread reads it. */
interface FileRow {
  id: string;
  run_id: string | null;
  message_id: string | null;
  title: string;
  type: ChatDeliverable['type'];
  formats: string[];
  status: ChatDeliverable['status'];
  content_draft_id: string | null;
}

/** A run's end as the browser was told it: the event that ended it. */
const END_EVENTS = ['run.finished', 'run.stopped', 'run.error', 'run.paused_cap'];
/** What a run sent to the Action Center (CHAT-09 item 19), read back with its end. */
const SENT_EVENT = 'action.sent';
/** What's new's cards (CHAT-11 item 10), read back the same way. */
const WHATS_NEW_EVENT = 'whats_new.ready';

/** What an ended run's events keep: its end, and what it sent to the Action Center. */
interface RunEnd {
  summary: ChatRunSummary | null;
  errorReason: string | null;
  keyFailed: boolean;
  sent: ChatActionSent[];
  whatsNew: ChatWhatsNewEntry[];
}
const ENDED: readonly string[] = ['done', 'stopped', 'error', 'paused_cap'];

/**
 * The ended runs' last end events, as the run's answer applies them live
 * (applyChatEvent): the summary, and an error's reason. The events are the
 * server's (chat_run_events: service role only), read here for runs the
 * person already read; each was made safe for the browser when it was sent
 * (chatEvent). A read that fails leaves them out: the chat still opens.
 */
async function readRunEnds(runIds: string[]): Promise<Map<string, RunEnd>> {
  const ends = new Map<string, RunEnd>();
  if (runIds.length === 0) return ends;
  const { data, error } = await supabaseAdmin
    .from('chat_run_events')
    .select('run_id, seq, type, data')
    .in('run_id', runIds)
    .in('type', [...END_EVENTS, SENT_EVENT, WHATS_NEW_EVENT])
    .order('seq', { ascending: true });
  if (error) {
    console.error("[chat/thread] could not read the runs' ends:", error.message);
    return ends;
  }
  for (const row of (data ?? []) as {
    run_id: string;
    seq: number;
    type: string;
    data: unknown;
  }[]) {
    if (!isChatEventType(row.type) || !row.data || typeof row.data !== 'object') continue;
    const kept = ends.get(row.run_id) ?? {
      summary: null,
      errorReason: null,
      keyFailed: false,
      sent: [],
      whatsNew: [],
    };
    if (row.type === WHATS_NEW_EVENT) {
      const cards = (row.data as { entries?: unknown }).entries;
      ends.set(row.run_id, {
        ...kept,
        whatsNew: Array.isArray(cards) ? (cards as ChatWhatsNewEntry[]) : [],
      });
      continue;
    }
    if (row.type === SENT_EVENT) {
      ends.set(row.run_id, { ...kept, sent: [...kept.sent, row.data as ChatActionSent] });
      continue;
    }
    const run = applyChatEvent(emptyRun(), {
      type: row.type,
      seq: row.seq,
      data: row.data,
    } as Parameters<typeof applyChatEvent>[1]);
    ends.set(row.run_id, {
      ...kept,
      summary: run.summary,
      errorReason: run.errorReason,
      keyFailed: run.keyFailed,
    });
  }
  return ends;
}

/** A finished run's next move, as the thread reads it. */
interface NextMoveRow {
  run_id: string;
  rank: number;
  label: string;
  prompt: string;
  ghost_ok: boolean;
}

/** The person's chat with its messages and runs; null when it isn't theirs or isn't there. */
export async function loadChatThread(conversationId: string): Promise<ChatThread | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: chat, error } = await supabase
    .from('chat_conversations')
    .select('id, title, brand_id, user_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the chat: ${error.message}`);
  if (!chat) return null;

  const [messages, runs] = await Promise.all([
    supabase
      .from('chat_messages')
      .select('id, role, content_md, context_json, generated_at, data_as_of, timezone, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true }),
    supabase
      .from('chat_runs')
      .select('id, message_id, status')
      .eq('conversation_id', conversationId),
  ]);
  if (messages.error) throw new Error(`Could not read the chat: ${messages.error.message}`);
  if (runs.error) throw new Error(`Could not read the chat's runs: ${runs.error.message}`);

  const questionIds = (messages.data ?? []).filter((m) => m.role === 'user').map((m) => m.id);
  const uploads = questionIds.length
    ? await supabase.from('chat_uploads').select('message_id').in('message_id', questionIds)
    : { data: [], error: null };
  // Unread, every question counts as having files: Retry stays off rather than send it short.
  if (uploads.error)
    console.error('[chat/thread] could not read the files sent:', uploads.error.message);
  const withFiles = new Set(
    uploads.error
      ? questionIds
      : (uploads.data ?? []).map((row) => row.message_id).filter((id): id is string => !!id),
  );

  const runIds = (runs.data ?? []).map((run) => run.id);
  const endedIds = (runs.data ?? []).filter((run) => ENDED.includes(run.status)).map((r) => r.id);
  const mine = !!user && chat.user_id === user.id;
  const [steps, files, ends, moves, whys] = runIds.length
    ? await Promise.all([
        supabase
          .from('chat_run_steps')
          .select(CHAT_RUN_STEP_SELECT)
          .in('run_id', runIds)
          .order('position', { ascending: true }),
        supabase
          .from('chat_files')
          .select('id, run_id, message_id, title, type, formats, status, content_draft_id')
          .in('run_id', runIds)
          .order('created_at', { ascending: true }),
        readRunEnds(endedIds),
        // A teammate's shared chat shows no moves: they are the author's to take.
        mine
          ? supabase
              .from('chat_next_moves')
              .select('run_id, rank, label, prompt, ghost_ok')
              .in('run_id', runIds)
              .order('rank', { ascending: true })
          : { data: [], error: null },
        // Readable where the chat is (00420); the card's numbers, never its ids.
        supabase
          .from('chat_why_analyses')
          .select('run_id, scope_json, result_json')
          .in('run_id', runIds)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true }),
      ])
    : [
        { data: [], error: null },
        { data: [], error: null },
        new Map(),
        { data: [], error: null },
        { data: [], error: null },
      ];
  if (steps.error) throw new Error(`Could not read the chat's steps: ${steps.error.message}`);
  if (files.error) throw new Error(`Could not read the chat's files: ${files.error.message}`);
  if (moves.error)
    console.error("[chat/thread] could not read the chat's next moves:", moves.error.message);
  const strips = runIds.length
    ? await readThreadStrips(supabase, conversationId, messages.data ?? [], endedIds)
    : new Map<string, ChatTaskStrip>();
  // A failed read of the analyses loses their cards, not the chat.
  if (whys.error)
    console.error("[chat/thread] could not read the chat's Why analyses:", whys.error.message);
  // Each analysis keeps its place in its run (the drawer's route finds it by
  // that n); one that can't be shown is left out, not the chat.
  const whyByRun = new Map<string, ChatWhy[]>();
  const whyCount = new Map<string, number>();
  for (const row of (whys.error ? [] : (whys.data ?? [])) as unknown as {
    run_id: string | null;
    scope_json: Record<string, unknown>;
    result_json: WhyResult;
  }[]) {
    if (!row.run_id) continue;
    const n = (whyCount.get(row.run_id) ?? 0) + 1;
    whyCount.set(row.run_id, n);
    try {
      whyByRun.set(row.run_id, [
        ...(whyByRun.get(row.run_id) ?? []),
        whyView(n, row.result_json, row.scope_json),
      ]);
    } catch (error) {
      console.error('[chat/thread] could not show a Why analysis:', error);
    }
  }
  const movesByRun = new Map<string, ChatNextMove[]>();
  for (const m of (moves.error ? [] : (moves.data ?? [])) as NextMoveRow[]) {
    const move = clientMove({ label: m.label, prompt: m.prompt, ghostOk: m.ghost_ok });
    movesByRun.set(m.run_id, [...(movesByRun.get(m.run_id) ?? []), move]);
  }
  // An answer saved to Files names its message; what a run made doesn't.
  const fileByRun = new Map<string, string>();
  const madeByRun = new Map<string, ChatDeliverable[]>();
  const madeIds = ((files.data ?? []) as FileRow[]).filter((f) => f.run_id && !f.message_id);
  const tasksOfFiles = await readFileTasks(
    supabase,
    conversationId,
    madeIds.map((f) => f.id),
  );
  for (const f of (files.data ?? []) as FileRow[]) {
    if (!f.run_id) continue;
    if (f.message_id) {
      fileByRun.set(f.run_id, f.id);
      continue;
    }
    madeByRun.set(f.run_id, [
      ...(madeByRun.get(f.run_id) ?? []),
      {
        title: maskIds(f.title),
        type: f.type,
        formats: f.formats,
        status: f.status,
        ...(f.content_draft_id ? { href: `/dashboard/content/editor/${f.content_draft_id}` } : {}),
        filed: 'in_files',
        ...(tasksOfFiles.has(f.id) ? { task: tasksOfFiles.get(f.id) } : {}),
      },
    ]);
  }
  const stepsByRun = new Map<string, ChatStep[]>();
  for (const row of (steps.data ?? []) as unknown as ChatRunStepMemberRow[]) {
    const step = toClientStep(row);
    if (step) stepsByRun.set(row.run_id, [...(stepsByRun.get(row.run_id) ?? []), step]);
  }
  const runByMessage = new Map(
    (runs.data ?? []).map((run) => [
      run.message_id,
      {
        runId: run.id,
        status: run.status,
        steps: stepsByRun.get(run.id) ?? [],
        fileId: fileByRun.get(run.id) ?? null,
        deliverables: madeByRun.get(run.id) ?? [],
        summary: ends.get(run.id)?.summary ?? null,
        errorReason: ends.get(run.id)?.errorReason ?? null,
        keyFailed: ends.get(run.id)?.keyFailed ?? false,
        nextMoves: movesByRun.get(run.id) ?? [],
        sent: ends.get(run.id)?.sent ?? [],
        tasks: strips.get(run.id) ?? null,
        why: whyByRun.get(run.id) ?? [],
        whatsNew: ends.get(run.id)?.whatsNew ?? [],
      },
    ]),
  );

  return {
    conversationId: chat.id,
    title: chat.title,
    brandId: chat.brand_id,
    mine,
    messages: (messages.data ?? []).map((message) => ({
      role: message.role as 'user' | 'assistant',
      text: message.content_md,
      generatedAt: message.generated_at,
      dataAsOf: message.data_as_of,
      timezone: message.timezone,
      run: runByMessage.get(message.id) ?? null,
      ...(message.role === 'user'
        ? { resendable: !message.context_json && !withFiles.has(message.id) }
        : {}),
    })),
  };
}

/**
 * The chat's task strips, by run, read as the person: "due this week" in the
 * zone its latest answer was shown in (the run's), else UTC. A run that has
 * ended is writing nothing: a task it still has Writing (an Undo of Ready for
 * review put it back, or the run never reached its own end) reads Queued.
 */
async function readThreadStrips(
  db: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  messages: readonly { role: string; timezone: string | null }[],
  endedRunIds: readonly string[],
): Promise<Map<string, ChatTaskStrip>> {
  const zone =
    [...messages].reverse().find((m) => m.role === 'assistant' && m.timezone)?.timezone ?? 'UTC';
  try {
    const strips = await readStrips(db, conversationId, weekEndIn(new Date(), zone));
    for (const runId of endedRunIds) {
      for (const task of strips.get(runId)?.tasks ?? []) {
        if (task.status === 'writing') task.status = 'queued';
      }
    }
    return strips;
  } catch (err) {
    console.error("[chat/thread] could not read the chat's task strip:", err);
    return new Map();
  }
}

/** The tasks of the chat's deliverables (CHAT-09 item 12), read as the person; a failed read loses them, not the chat. */
async function readFileTasks(
  db: Awaited<ReturnType<typeof createClient>>,
  conversationId: string,
  fileIds: string[],
): Promise<Map<string, DeliverableTask>> {
  try {
    return await readDeliverableTasks(db, conversationId, fileIds);
  } catch (err) {
    console.error("[chat/thread] could not read the deliverables' tasks:", err);
    return new Map();
  }
}
