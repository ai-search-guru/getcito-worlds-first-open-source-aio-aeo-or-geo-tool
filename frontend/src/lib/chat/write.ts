import type { Json } from '@/types/supabase';
import { logActivity, type ActivityApproval, type ActivityPlace } from './activity';
import type { GoLivePage } from './goLiveFacts';
import { sendOnItsOwn, type GoLiveSend } from './goLiveSend';
import { idempotencyKey, requestHash, sweepExpiredKeys, withIdempotencyKey } from './idempotency';
import type { ChatMode, ChatSurface } from './precedence';
import { runsWithoutSession, type ChatTool, type ChatToolContext } from './registry/defineTool';
import { undoRule, type WriteRecord } from './undo';

/**
 * Runs a WRITE or an EXECUTE the precedence allowed (decideToolCall, then
 * the card's OK or the click when it asked for one), once per approval, and
 * logs it: the change runs under its idempotency key (idempotency.ts), the
 * state Undo needs is read around it (undo.ts), and the Activity log gets
 * its row (activity.ts) with the mode, the approval and the Undo window.
 * A repeat of the approval (a double click, a reconnect, a retry) returns
 * the first call's result and log row and changes nothing. An action that
 * refused as a value ({ ok: false }) changed nothing and gets no row. Server only: the
 * engine (C3) calls it for each change a run makes.
 */

export interface WriteRequest {
  /** A WRITE or EXECUTE row of the registry. */
  tool: ChatTool;
  /** Its input, already parsed by the row's schema. */
  input: unknown;
  /** Who the tool acts as: the signed-in person. */
  ctx: ChatToolContext;
  organizationId: string;
  userId: string;
  /** The call's brand, as the precedence found it (readToolCall, resolveCallBrand). */
  brandId: string | null;
  surface: ChatSurface;
  mode: ChatMode;
  /** How it was approved: approvalFor(decision) once the card or the click came. */
  approval: Exclude<ActivityApproval, { kind: 'run' }>;
  place: ActivityPlace;
  /**
   * The approval it runs on: the run step that asked for it (the card the
   * person clicks, or the step that ran it without one). Its repeats share it.
   */
  approvalKey: string;
  /**
   * An EXECUTE an allowed agent takes live on its own (approval go_live,
   * AUTONOMOUS-GO-LIVE §5.4): its agent, its reserved slot and the page its
   * guards were checked on, which the API sends as the run's person.
   */
  goLive?: { agentId: string; reservationId: string; page: GoLivePage };
  /**
   * No session of the person is behind the call (an agent run on its own):
   * a sessionFree row's runFor makes the change, as `ctx`'s person, instead
   * of `run`, whose server action reads the session.
   */
  withoutSession?: boolean;
}

export type WriteOutcome =
  /** repeated: an earlier call with the approval made the change; this is its result. */
  | { code: 'ok'; output: Json; activityId: string | null; repeated: boolean }
  /** The approval was used for another change (§11a): show the card again. */
  | { code: 'approval_mismatch' }
  /** The first call with the approval is still running. */
  | { code: 'in_progress' }
  /**
   * The change failed, or its key couldn't be read: nothing was made and the
   * approval may be tried again (§11b). reason: for the server's log and the
   * step's debug record, never the person.
   */
  | { code: 'failed'; reason: string };

const toJson = (value: unknown): Json =>
  value === undefined ? null : (JSON.parse(JSON.stringify(value)) as Json);

/** An action's refusal as a value ({ ok: false }, #427): nothing changed, so nothing is logged. */
const refused = (output: unknown): boolean =>
  !!output &&
  typeof output === 'object' &&
  !Array.isArray(output) &&
  (output as { ok?: unknown }).ok === false;

/** A run with no session whose write the API server took as no one (lib/chat/actor/api.ts). */
const wayRefused = (output: unknown): boolean =>
  refused(output) && (output as { reason?: unknown }).reason === 'acting_refused';

/**
 * Whether a call goes live on its own: an agent run's EXECUTE whose row may
 * (its goLive), approved by step 4b, with its slot and page (§5.4 item 1).
 */
const goesLiveOnItsOwn = (req: WriteRequest) =>
  req.approval.kind === 'auto' &&
  req.approval.via === 'go_live' &&
  req.tool.class === 'execute' &&
  !!req.tool.goLive &&
  !!req.place.agentRunId &&
  !!req.place.runId &&
  !!req.goLive;

/** What the API sends for a call that goes live on its own; null for the row's own action. */
function sendOf(req: WriteRequest): GoLiveSend | null {
  const { agentRunId, runId } = req.place;
  if (!goesLiveOnItsOwn(req) || !req.tool.goLive || !req.goLive || !agentRunId || !runId) {
    return null;
  }
  return {
    organizationId: req.organizationId,
    agentRunId,
    runId,
    actingUserId: req.userId,
    reservationId: req.goLive.reservationId,
    step: req.tool.goLive(req.input as never),
    page: req.goLive.page,
  };
}

/**
 * Never throws for a failure on the way (the engine and server actions call
 * it): `failed`. Only a call against the rules (a read, an EXECUTE without
 * its click, outside an agent run allowed to go live on its own; a change
 * without a session whose row needs one) throws, before anything runs.
 */
export async function runLoggedWrite(req: WriteRequest): Promise<WriteOutcome> {
  const { tool } = req;
  if (tool.class === 'read') throw new Error('A read changes nothing to log');
  const onItsOwn = goesLiveOnItsOwn(req);
  if (req.approval.kind === 'auto' && req.approval.via === 'go_live' && !onItsOwn) {
    throw new Error('Only an allowed agent run goes live on its own');
  }
  if (tool.class === 'execute' && req.approval.kind !== 'click' && !onItsOwn) {
    throw new Error("An EXECUTE runs on the person's click only");
  }
  // Going live on its own needs no session: the API sends it as the run's person (§5.4).
  if (req.withoutSession && !onItsOwn && !runsWithoutSession(tool)) {
    throw new Error(`${tool.name} runs only with its person's session`);
  }
  try {
    return await run(req);
  } catch (err) {
    console.error('Chat could not make a change:', err);
    return { code: 'failed', reason: err instanceof Error ? err.message : String(err) };
  }
}

async function run(req: WriteRequest): Promise<WriteOutcome> {
  const { tool } = req;
  const rule = undoRule(tool);

  const outcome = await withIdempotencyKey<Json>(
    {
      organizationId: req.organizationId,
      key: idempotencyKey(tool.labelKey, [req.approvalKey]),
      requestHash: requestHash(tool.labelKey, req.input),
    },
    async () => {
      const before = rule ? await rule.before(req.input) : null;
      // Where it runs, for a row that records it on what it changes (Action History, §10a).
      const ctx: ChatToolContext = {
        ...req.ctx,
        chat: {
          conversationId: req.place.conversationId,
          runId: req.place.runId,
          ...(req.place.agentRunId ? { agentRunId: req.place.agentRunId } : {}),
          approvalKey: req.approvalKey,
          executionMode: req.approval.kind === 'auto' ? 'automated' : 'assisted',
        },
      };
      // On its own, the API sends the page its guards were checked on, as the run's person;
      // no session: the row's own write for the run's person (runLoggedWrite checked it has one).
      const send = sendOf(req);
      const output = send
        ? await sendOnItsOwn(send)
        : req.withoutSession
          ? await tool.runFor!(ctx, req.input as never)
          : await tool.run(ctx, req.input as never);
      // The change is made: whatever happens to its log row, it isn't made again.
      let activityId: string | null = null;
      if (!refused(output)) {
        try {
          activityId = await logActivity(await activityOf(req, rule, before, output));
        } catch (err) {
          console.error('Chat could not log a change it made:', err);
        }
      }
      return { result: toJson(output), activityId };
    },
    // The API server took no one to act as (acting_refused): nothing changed, and the
    // approval is its person's to give again on its card, with the same key.
    { keep: (result) => !wayRefused(result) },
  );

  if (outcome.kind === 'mismatch') return { code: 'approval_mismatch' };
  if (outcome.kind === 'busy') return { code: 'in_progress' };
  if (outcome.kind === 'ran') await sweepExpiredKeys(req.organizationId);
  return {
    code: 'ok',
    output: outcome.result,
    activityId: outcome.activityId,
    repeated: outcome.kind === 'repeat',
  };
}

/** The log row for a change: the rule's record, or the bare facts when it has none or fails. */
async function activityOf(
  req: WriteRequest,
  rule: ReturnType<typeof undoRule>,
  before: Awaited<ReturnType<NonNullable<ReturnType<typeof undoRule>>['before']>>,
  output: unknown,
) {
  let record: WriteRecord = {
    target: { type: rule?.targetType ?? req.tool.area, id: null },
    summaryParams: {},
    undo: null,
  };
  if (rule) {
    try {
      record = await rule.record(req.input, output, before);
    } catch (err) {
      // Logged without an Undo rather than not at all.
      console.error('Chat could not read what Undo needs:', err);
    }
  }
  return {
    organizationId: req.organizationId,
    userId: req.userId,
    brandId: req.brandId,
    place: req.place,
    surface: req.surface,
    tool: req.tool,
    mode: req.mode,
    approval: req.approval,
    target: record.target,
    summary: { key: req.tool.labelKey, params: record.summaryParams },
    undo:
      rule && record.undo
        ? { data: record.undo, until: new Date(Date.now() + rule.windowMs) }
        : null,
    // Gone live on its own: the agent and its run, for Activity and its filter (§6.4).
    ...(req.goLive
      ? { agentId: req.goLive.agentId, agentRunId: req.place.agentRunId ?? null }
      : {}),
  };
}
