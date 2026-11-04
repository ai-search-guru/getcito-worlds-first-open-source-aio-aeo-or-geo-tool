import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * What Chat's staff Debug view shows of an answer (CHAT-03 items 25–26;
 * Chat Wave 1, W1-15): each step's tool, input and output (the first 20 KB;
 * the rest with "Download full"), its latency and cache hit, and the run's
 * model calls from the AI budget's ledger (model, tokens, cost in USD,
 * latency). Read with the service role from the columns members are never
 * granted (chat_run_steps.tool, debug_json and the step's measure, 00400 and
 * 00410; prompt_improve_usage, 00405). Server only, for the staff-only
 * endpoint (GET /api/internal/chat/messages/{id}/debug), which checks the
 * person first: none of it goes into an event, the conversation API or a
 * customer's page. Staff read only the answers they could open themselves
 * (privacy first): in their own workspace, in their own chat or one shared
 * with the team, as the chat's policies give it (00407); any other reads as
 * not there.
 */

/** How much of a step's output the view shows; the rest is a download. */
export const DEBUG_OUTPUT_BYTES = 20 * 1024;

export interface ChatDebugStep {
  /** Its place in the run, from 1. */
  n: number;
  kind: string;
  status: string;
  /** The label registry's words, as the person saw them. */
  label: string;
  /** The registry name of the tool that ran; null for a step without one. */
  tool: string | null;
  input: unknown;
  /** The output as JSON text, its first DEBUG_OUTPUT_BYTES; null without one. */
  output: string | null;
  /** The whole output's size, in bytes. */
  outputBytes: number;
  outputCut: boolean;
  /** Why it failed, as the tool or the engine said it. */
  error: string | null;
  latencyMs: number | null;
  cacheHit: boolean;
  /** Its result was cut to the run's budget before the model saw it. */
  truncated: boolean;
  resultTokens: number | null;
}

export interface ChatDebugModelCall {
  /** The step it was for, when it had one. */
  n: number | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUsd: number;
  latencyMs: number | null;
  at: string;
}

export interface ChatMessageDebug {
  status: string;
  /** The run's model setting ('auto' or a model) and effort. */
  model: string;
  effort: string;
  /** Its standard result code when it ended in error ('failed', 'timeout'). */
  error: string | null;
  steps: ChatDebugStep[];
  modelCalls: ChatDebugModelCall[];
  totals: { inputTokens: number; outputTokens: number; costUsd: number };
}

interface RunRow {
  id: string;
  conversation_id: string;
  status: string;
  model: string;
  effort: string;
  error: string | null;
}

interface StepRow {
  id: string;
  position: number;
  kind: string;
  status: string;
  label: string;
  tool: string | null;
  debug_json: unknown;
  latency_ms: number | null;
  cache_hit: boolean | null;
  truncated: boolean | null;
  result_tokens: number | null;
}

interface LedgerRow {
  chat_run_step_id: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  cost_usd: number | string | null;
  latency_ms: number | null;
  used_at: string;
}

const RUN_COLUMNS = 'id, conversation_id, status, model, effort, error';

/** The staff member who asks: their sign-in id and their workspace. */
export interface ChatDebugViewer {
  userId: string;
  organizationId: string;
}

/**
 * The answer's run: `id` is the answer's message id, or its run's id (the
 * handle the page already has for its routes). Null when there is none, or
 * when the staff member who asks couldn't open its chat: it isn't in their
 * workspace, it was deleted, or it is a teammate's chat not shared with the
 * team (the chat's own select policies, 00407, as the service role skips them).
 */
async function runOf(id: string, viewer: ChatDebugViewer): Promise<RunRow | null> {
  let run: RunRow | null = null;
  for (const column of ['message_id', 'id'] as const) {
    const { data, error } = await supabaseAdmin
      .from('chat_runs')
      .select(RUN_COLUMNS)
      .eq(column, id)
      .maybeSingle();
    if (error) throw new Error(`Could not read the run: ${error.message}`);
    if (data) {
      run = data as RunRow;
      break;
    }
  }
  if (!run) return null;
  const { data: chat, error } = await supabaseAdmin
    .from('chat_conversations')
    .select('organization_id, user_id, shared_at, deleted_at')
    .eq('id', run.conversation_id)
    .maybeSingle();
  if (error) throw new Error(`Could not read the run's chat: ${error.message}`);
  const row = chat as {
    organization_id: string;
    user_id: string;
    shared_at: string | null;
    deleted_at: string | null;
  } | null;
  if (!row || row.organization_id !== viewer.organizationId || row.deleted_at) return null;
  return row.user_id === viewer.userId || row.shared_at ? run : null;
}

/** The run's steps in order; with `n`, that step only. */
async function stepsOf(runId: string, n?: number): Promise<StepRow[]> {
  let query = supabaseAdmin
    .from('chat_run_steps')
    .select(
      'id, position, kind, status, label, tool, debug_json, latency_ms, cache_hit, truncated, result_tokens',
    )
    .eq('run_id', runId);
  if (n !== undefined) query = query.eq('position', n);
  const { data, error } = await query.order('position', { ascending: true });
  if (error) throw new Error(`Could not read the run's steps: ${error.message}`);
  return (data ?? []) as StepRow[];
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const numberOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/** A value as the view prints it: JSON, indented. */
const printed = (value: unknown) => JSON.stringify(value, null, 2) ?? String(value);

/** The text's first `max` bytes (UTF-8), and whether it was cut. */
function firstBytes(text: string, max: number): { text: string; bytes: number; cut: boolean } {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= max) return { text, bytes: bytes.length, cut: false };
  return { text: new TextDecoder().decode(bytes.slice(0, max)), bytes: bytes.length, cut: true };
}

function debugStep(row: StepRow): ChatDebugStep {
  const debug = record(row.debug_json);
  const output =
    debug.output === undefined ? null : firstBytes(printed(debug.output), DEBUG_OUTPUT_BYTES);
  const error = debug.error;
  return {
    n: row.position,
    kind: row.kind,
    status: row.status,
    label: row.label,
    tool: row.tool,
    input: debug.input ?? null,
    output: output?.text ?? null,
    outputBytes: output?.bytes ?? 0,
    outputCut: output?.cut ?? false,
    error: error === undefined || error === null ? null : String(error),
    latencyMs: numberOr(row.latency_ms) ?? numberOr(debug.latencyMs),
    cacheHit: row.cache_hit === true,
    truncated: row.truncated === true,
    resultTokens: numberOr(row.result_tokens),
  };
}

/**
 * The Debug view of an answer: its run's steps with their tool, input and
 * output, and its model calls; null when `id` names no answer's run that
 * `viewer` can open.
 */
export async function readChatMessageDebug(
  id: string,
  viewer: ChatDebugViewer,
): Promise<ChatMessageDebug | null> {
  const run = await runOf(id, viewer);
  if (!run) return null;
  const [steps, ledger] = await Promise.all([
    stepsOf(run.id),
    supabaseAdmin
      .from('prompt_improve_usage')
      .select(
        'chat_run_step_id, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, latency_ms, used_at',
      )
      .eq('chat_run_id', run.id)
      .order('used_at', { ascending: true }),
  ]);
  if (ledger.error) throw new Error(`Could not read the run's AI usage: ${ledger.error.message}`);
  const stepN = new Map(steps.map((step) => [step.id, step.position]));
  const modelCalls = ((ledger.data ?? []) as LedgerRow[]).map(
    (row): ChatDebugModelCall => ({
      n: row.chat_run_step_id ? (stepN.get(row.chat_run_step_id) ?? null) : null,
      model: row.model,
      inputTokens: numberOr(row.input_tokens),
      outputTokens: numberOr(row.output_tokens),
      cacheReadTokens: numberOr(row.cache_read_tokens),
      cacheWriteTokens: numberOr(row.cache_write_tokens),
      costUsd: Number(row.cost_usd ?? 0) || 0,
      latencyMs: numberOr(row.latency_ms),
      at: row.used_at,
    }),
  );
  return {
    status: run.status,
    model: run.model,
    effort: run.effort,
    error: run.error,
    steps: steps.map(debugStep),
    modelCalls,
    totals: {
      inputTokens: modelCalls.reduce((sum, call) => sum + (call.inputTokens ?? 0), 0),
      outputTokens: modelCalls.reduce((sum, call) => sum + (call.outputTokens ?? 0), 0),
      costUsd: modelCalls.reduce((sum, call) => sum + call.costUsd, 0),
    },
  };
}

/**
 * "Download full": step `n`'s whole output as JSON text; null when the
 * answer (one `viewer` can open), the step or its output isn't there.
 */
export async function readChatStepOutput(
  id: string,
  viewer: ChatDebugViewer,
  n: number,
): Promise<string | null> {
  const run = await runOf(id, viewer);
  if (!run) return null;
  const [step] = await stepsOf(run.id, n);
  const output = step ? record(step.debug_json).output : undefined;
  return output === undefined ? null : printed(output);
}
