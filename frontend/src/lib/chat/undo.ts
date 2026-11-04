import { createHash } from 'node:crypto';
import { createTranslator } from 'next-intl';
import messages from '../../../messages/en.json';
import { followRestoredPageType } from '@/lib/content/draftPageType';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { Json } from '@/types/supabase';
import { logActivity, summaryValue, type ActivityPlace } from './activity';
import { buildDenial, type ChatDenial } from './denial';
import type { ChatHref } from './events';
import { idempotencyKey, requestHash, withIdempotencyKey } from './idempotency';
import { decideToolCall, type ChatSurface } from './precedence';
import { readPrecedenceContext, readToolCall } from './precedenceContext';
import type { ChatTool } from './registry/defineTool';
import { chatToolByKey } from './registry/tools';
import { DAY_MS, asObject, check, textOf, type Snapshot } from './undoParts';
import { OUTPUT_UNDO_RULES } from './undoOutput';
import { SKILL_UNDO_RULES } from './undoSkills';
import { MEMORY_UNDO_RULES } from './undoMemory';
import { SETUP_UNDO_RULES } from './undoSetup';
import { ACTION_CENTER_UNDO_RULES } from './undoActionCenter';
import { scheduleUndo } from './schedule/undo';

/**
 * Undo (CHAT-20 §10b): the inverse of each WRITE, stored when it ran (the
 * state before, and the state after that Undo checks first), offered for the
 * tool's window (§9) to the person Chat acted as and to Admins.
 *
 * Undo is a WRITE of its own: it passes the same precedence as the tool
 * (the live role, a read-only workspace, the demo brand, an Admin's Never)
 * but needs no card, since it puts back what the person's run did; it is
 * logged (approval `run`), and the change it undid turns `undone`. When the
 * target changed since (someone edited the draft, set the opportunity
 * again, added the suggestion), nothing is overwritten: the change turns
 * `undo_conflict` and the answer says "This changed since. Open it to undo
 * by hand." with a link. A second click on Undo gets the first click's
 * answer (its own idempotency key).
 *
 * The inverses write with the service role, as the server's own routes for
 * these rows do (content.js, prompts.js), after the checks above: an
 * Analyst may save a draft but not archive one in the Library, and Undo
 * still takes back the draft their own run saved. Server only.
 */

/**
 * What the log row records about a change, read after it ran. Its brand is
 * the call's, as the precedence found it (resolveCallBrand).
 */
export interface WriteRecord {
  target: { type: string; id: string | null };
  /** chatActivity.summary's values. */
  summaryParams: Record<string, string>;
  /** What Undo restores and checks; null when the change changed nothing. */
  undo: Snapshot | null;
}

/**
 * How an inverse went: done, the target changed since, it is gone, or the
 * plan has no room for it now (resuming prompts is metered, §11a): nothing
 * changed, and Undo may be tried again once there is.
 */
export type InverseResult =
  'ok' | 'changed' | 'gone' | { refused: 'quota_exceeded'; message: string };

export interface UndoRule {
  /** The target's type in the log. */
  targetType: string;
  /** CHAT-20 §9's Undo window. */
  windowMs: number;
  /** Read just before the change: the state Undo restores. */
  before(input: unknown): Promise<Snapshot | null>;
  /** Read just after it: what the row records. */
  record(input: unknown, output: unknown, before: Snapshot | null): Promise<WriteRecord>;
  /**
   * The inverse, once the target is as the change left it. userId: who
   * clicked Undo, for a target whose own trail names who (Action History).
   */
  inverse(target: {
    id: string;
    brandId: string | null;
    data: Snapshot;
    userId?: string;
  }): Promise<InverseResult>;
  /** Where the target opens, to undo by hand. */
  href(targetId: string): ChatHref;
}

const sha256 = (text: string) => createHash('sha256').update(text).digest('hex');

// ─── create_draft: archive the draft it saved (§9: 30 days, "move to trash") ─

const DRAFT_COLUMNS = 'id, brand_id, title, body_html, status, archived_at, updated_at';
/** How long History keeps a version (00215): content_draft_restore's 90 days. */
const HISTORY_DAYS = 90;

/** What a draft looks like to a person: its title, page and status. */
function draftState(row: Record<string, unknown>): Snapshot {
  return {
    title: textOf(row.title),
    bodyHash: sha256(textOf(row.body_html) ?? ''),
    status: textOf(row.status),
  };
}

const createDraft: UndoRule = {
  targetType: 'content_draft',
  windowMs: 30 * DAY_MS,
  async before() {
    return null; // Nothing to read: the draft is new.
  },
  async record(input, output) {
    const id = textOf(output);
    const { title } = asObject(input);
    if (!id) {
      return {
        target: { type: 'content_draft', id: null },
        summaryParams: { title: summaryValue(title) },
        undo: null,
      };
    }
    const { data, error } = await supabaseAdmin
      .from('content_drafts')
      .select(DRAFT_COLUMNS)
      .eq('id', id)
      .maybeSingle();
    check(error, 'the draft');
    return {
      target: { type: 'content_draft', id },
      summaryParams: { title: summaryValue(data?.title ?? title) },
      undo: data ? { after: draftState(data) } : null,
    };
  },
  async inverse({ id, brandId, data }) {
    let read = supabaseAdmin.from('content_drafts').select(DRAFT_COLUMNS).eq('id', id);
    if (brandId) read = read.eq('brand_id', brandId);
    const { data: draft, error } = await read.maybeSingle();
    check(error, 'the draft');
    if (!draft) return 'gone';
    // Edited, renamed, moved on, or archived by someone since: theirs to decide.
    const after = asObject(data.after);
    const now = draftState(draft);
    if (
      draft.archived_at ||
      now.title !== after.title ||
      now.bodyHash !== after.bodyHash ||
      now.status !== after.status
    ) {
      return 'changed';
    }
    const { data: archived, error: archiveError } = await supabaseAdmin
      .from('content_drafts')
      .update({ archived_at: new Date().toISOString() })
      .eq('id', id)
      .eq('updated_at', draft.updated_at)
      .is('archived_at', null)
      .select('id')
      .maybeSingle();
    if (archiveError) throw new Error(`Could not archive the draft: ${archiveError.message}`);
    return archived ? 'ok' : 'changed';
  },
  href: (id) => `/dashboard/content/editor/${id}`,
};

// ─── update_draft: back to the page before (§9: 30 days, "restore previous version") ─

const updateDraft: UndoRule = {
  targetType: 'content_draft',
  windowMs: 30 * DAY_MS,
  async before() {
    return null; // The action keeps the page before in History, and says which version.
  },
  async record(input, output) {
    const id = textOf(asObject(input).draft_id);
    const result = asObject(output);
    const versionId = textOf(result.beforeVersionId);
    let row: Record<string, unknown> | null = null;
    if (id && result.ok === true) {
      const { data, error } = await supabaseAdmin
        .from('content_drafts')
        .select(DRAFT_COLUMNS)
        .eq('id', id)
        .maybeSingle();
      check(error, 'the draft');
      row = data;
    }
    return {
      target: { type: 'content_draft', id },
      summaryParams: { title: summaryValue(row?.title ?? asObject(input).title) },
      undo: row && versionId ? { versionId, after: draftState(row) } : null,
    };
  },
  async inverse({ id, brandId, data }) {
    let read = supabaseAdmin
      .from('content_drafts')
      .select(`${DRAFT_COLUMNS}, agent_state`)
      .eq('id', id);
    if (brandId) read = read.eq('brand_id', brandId);
    const { data: draft, error } = await read.maybeSingle();
    check(error, 'the draft');
    if (!draft) return 'gone';
    // Edited, renamed, archived or being written by the agent since: the person's to restore from History.
    const after = asObject(data.after);
    const now = draftState(draft);
    if (
      draft.archived_at ||
      draft.agent_state === 'writing' ||
      now.title !== after.title ||
      now.bodyHash !== after.bodyHash
    ) {
      return 'changed';
    }
    // The version kept before the change: this draft's, within History's 90 days (00215).
    const { data: version, error: versionError } = await supabaseAdmin
      .from('content_draft_versions')
      .select('draft_id, title, body_html, created_at')
      .eq('id', textOf(data.versionId) ?? '')
      .maybeSingle();
    check(versionError, 'the draft’s version');
    if (
      !version ||
      version.draft_id !== id ||
      Date.parse(version.created_at as string) < Date.now() - HISTORY_DAYS * DAY_MS
    ) {
      return 'gone';
    }
    // History's restore (content_draft_restore), only over the page just read: the page now
    // is kept first, then the version comes back; a write in between wins.
    const { error: keepError } = await supabaseAdmin.rpc('content_draft_keep_version', {
      p_draft_id: id,
      p_origin: 'restore',
    });
    if (keepError) throw new Error(`Could not keep the draft before Undo: ${keepError.message}`);
    const { data: restored, error: restoreError } = await supabaseAdmin
      .from('content_drafts')
      .update({
        title: version.title,
        body_html: version.body_html,
        restored_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('updated_at', draft.updated_at)
      .select('updated_at')
      .maybeSingle();
    if (restoreError) throw new Error(`Could not restore the draft: ${restoreError.message}`);
    if (!restored) return 'changed';
    await followRestoredPageType(supabaseAdmin, id, {
      title: version.title as string,
      bodyHtml: version.body_html as string,
      updatedAt: restored.updated_at as string,
    });
    return 'ok';
  },
  href: (id) => `/dashboard/content/editor/${id}`,
};

// ─── update_opportunity: its status and dismiss reason before (§9: 7 days) ──

const OPPORTUNITY_COLUMNS = 'id, brand_id, title, status, source_data, updated_at';

function opportunityState(row: Record<string, unknown>): Snapshot {
  return {
    status: textOf(row.status),
    dismissReason: textOf(asObject(row.source_data).dismissReason),
  };
}

async function readOpportunity(id: unknown) {
  if (typeof id !== 'string') return null;
  const { data, error } = await supabaseAdmin
    .from('content_opportunities')
    .select(OPPORTUNITY_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  check(error, 'the opportunity');
  return data as Record<string, unknown> | null;
}

const updateOpportunity: UndoRule = {
  targetType: 'content_opportunity',
  windowMs: 7 * DAY_MS,
  async before(input) {
    const row = await readOpportunity(asObject(input).opportunity_id);
    return row ? { ...opportunityState(row), title: textOf(row.title) } : null;
  },
  async record(input, _output, before) {
    const { opportunity_id: id, status } = asObject(input);
    const row = await readOpportunity(id);
    const after = row ? opportunityState(row) : null;
    const changed =
      before &&
      after &&
      (before.status !== after.status || before.dismissReason !== after.dismissReason);
    return {
      target: { type: 'content_opportunity', id: textOf(id) },
      summaryParams: {
        title: summaryValue(before?.title ?? row?.title),
        status: summaryValue(status),
      },
      undo: changed
        ? {
            before: { status: before.status, dismissReason: before.dismissReason },
            after,
          }
        : null,
    };
  },
  async inverse({ id, brandId, data }) {
    const before = asObject(data.before);
    const after = asObject(data.after);
    let read = supabaseAdmin.from('content_opportunities').select(OPPORTUNITY_COLUMNS).eq('id', id);
    if (brandId) read = read.eq('brand_id', brandId);
    const { data: row, error } = await read.maybeSingle();
    check(error, 'the opportunity');
    if (!row) return 'gone';
    const now = opportunityState(row);
    if (now.status !== after.status || now.dismissReason !== after.dismissReason) return 'changed';

    // The reason rides in source_data, which other writers touch too: keep theirs.
    const sourceData: Record<string, unknown> = { ...asObject(row.source_data) };
    if (typeof before.dismissReason === 'string') sourceData.dismissReason = before.dismissReason;
    else delete sourceData.dismissReason;
    let update = supabaseAdmin
      .from('content_opportunities')
      .update({
        status: before.status,
        source_data: sourceData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', now.status as string);
    update = row.updated_at
      ? update.eq('updated_at', row.updated_at)
      : update.is('updated_at', null);
    const { data: restored, error: restoreError } = await update.select('id').maybeSingle();
    if (restoreError) throw new Error(`Could not restore the opportunity: ${restoreError.message}`);
    return restored ? 'ok' : 'changed';
  },
  href: (id) => `/dashboard/content/${id}`,
};

// ─── dismiss_prompt_suggestion: bring it back (§9: 7 days) ──────────────────

const dismissSuggestion: UndoRule = {
  targetType: 'prompt_suggestion',
  windowMs: 7 * DAY_MS,
  async before(input) {
    const id = asObject(input).suggestion_id;
    if (typeof id !== 'string') return null;
    const { data, error } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('id, suggested_text, status')
      .eq('id', id)
      .maybeSingle();
    check(error, 'the suggestion');
    return data ? { status: textOf(data.status), text: textOf(data.suggested_text) } : null;
  },
  async record(input, _output, before) {
    const id = textOf(asObject(input).suggestion_id);
    return {
      target: { type: 'prompt_suggestion', id },
      summaryParams: { text: summaryValue(before?.text) },
      // Already dismissed before: nothing changed, nothing to undo.
      undo:
        before && before.status !== 'dismissed'
          ? { before: { status: before.status }, after: { status: 'dismissed' } }
          : null,
    };
  },
  async inverse({ id, brandId, data }) {
    const before = asObject(data.before);
    // Back only from dismissed: added since, or brought back by hand, is someone else's.
    let update = supabaseAdmin
      .from('prompt_suggestions')
      .update({ status: before.status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'dismissed');
    if (brandId) update = update.eq('brand_id', brandId);
    const { data: restored, error } = await update.select('id').maybeSingle();
    if (error) throw new Error(`Could not bring the suggestion back: ${error.message}`);
    if (restored) return 'ok';
    const { data: row, error: readError } = await supabaseAdmin
      .from('prompt_suggestions')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    check(readError, 'the suggestion');
    return row ? 'changed' : 'gone';
  },
  href: () => '/dashboard/prompts/suggestions',
};

// ─── request_access: withdraw it while it waits ────────────────────────────

const requestAccessRule: UndoRule = {
  targetType: 'access_request',
  // As long as a dismissed suggestion's; a request an Admin decided stays.
  windowMs: 7 * DAY_MS,
  async before() {
    return null;
  },
  async record(input, output) {
    const result = asObject(output);
    const id = result.ok === true ? textOf(result.id) : null;
    return {
      target: { type: 'access_request', id },
      summaryParams: { asked: summaryValue(asObject(input).asked) },
      // Refused (too many, already asked today, an Admin): nothing was sent.
      undo: id ? { before: { status: null }, after: { status: 'pending' } } : null,
    };
  },
  async inverse({ id }) {
    // Only while it waits: once an Admin decided it, it's theirs.
    const { data: withdrawn, error } = await supabaseAdmin
      .from('chat_access_requests')
      .update({ status: 'withdrawn', decided_at: new Date().toISOString() })
      .eq('id', id)
      .eq('status', 'pending')
      .select('id')
      .maybeSingle();
    if (error) throw new Error(`Could not withdraw the request: ${error.message}`);
    if (withdrawn) return 'ok';
    const { data: row, error: readError } = await supabaseAdmin
      .from('chat_access_requests')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    check(readError, 'the request');
    return row ? 'changed' : 'gone';
  },
  href: () => '/dashboard/settings/roles-access',
};

/**
 * Each WRITE row's Undo, by tool name. A rule whose window is 0 only records
 * what its change did (§9 gives it no Undo: a page sent to a CMS, an audit
 * started); a WRITE without one has no Undo. An EXECUTE's rule only records.
 */
export const UNDO_RULES: Readonly<Record<string, UndoRule>> = {
  create_draft: createDraft,
  update_opportunity: updateOpportunity,
  dismiss_prompt_suggestion: dismissSuggestion,
  request_access: requestAccessRule,
  update_draft: updateDraft,
  ...SETUP_UNDO_RULES,
  ...ACTION_CENTER_UNDO_RULES,
  ...OUTPUT_UNDO_RULES,
  create_schedule: scheduleUndo,
  ...SKILL_UNDO_RULES,
  ...MEMORY_UNDO_RULES,
};

/**
 * A tool's Undo rule, or null: a read has none, and an EXECUTE has no Undo
 * (§10b), so its rule is one that only records what it did (window 0).
 */
export function undoRule(tool: Pick<ChatTool, 'name' | 'class'>): UndoRule | null {
  if (tool.class === 'read' || !Object.hasOwn(UNDO_RULES, tool.name)) return null;
  const rule = UNDO_RULES[tool.name];
  return tool.class === 'write' || rule.windowMs === 0 ? rule : null;
}

// ─── Undo from the step, the result card or the Activity log ────────────────

export interface UndoRequest {
  /** The change's row in the Activity log. */
  activityId: string;
  /** Who clicked Undo. */
  userId: string;
  organizationId: string;
  surface: ChatSurface;
  /** Where Undo was clicked, when in a run. */
  place?: ActivityPlace;
}

export type UndoOutcome =
  /** activityId: the Undo's own row. */
  | { code: 'ok'; activityId: string | null }
  /** The target changed since, or is gone: nothing was overwritten. */
  | { code: 'conflict'; reason: 'changed' | 'gone'; href: ChatHref | null }
  | { code: 'expired' }
  | { code: 'not_undoable' }
  | { code: 'already_undone' }
  | { code: 'not_found' }
  | { code: 'in_progress' }
  | { code: 'denied'; denial: ChatDenial }
  /** The plan has no room for it now (§11a): nothing changed; Undo works again once it has. */
  | { code: 'quota_exceeded'; message: string }
  /** Something failed on the way (a read, a write): nothing was undone, Undo may try again. */
  | { code: 'failed' };

/** An outcome, with what the person reads. */
export type UndoResult = UndoOutcome & { message: string };

const undoT = createTranslator({ locale: 'en', messages, namespace: 'chatActivity.undo' });

/** What Undo says: "Undone.", or why not, from messages/en.json. */
export function undoMessage(outcome: UndoOutcome): string {
  switch (outcome.code) {
    case 'ok':
      return undoT('ok');
    case 'conflict':
      return undoT(outcome.reason === 'gone' ? 'gone' : 'changed');
    case 'denied':
      return outcome.denial.rule.detail;
    case 'quota_exceeded':
      return outcome.message;
    case 'expired':
      return undoT('expired');
    case 'not_undoable':
      return undoT('notUndoable');
    case 'already_undone':
      return undoT('alreadyUndone');
    case 'in_progress':
      return undoT('inProgress');
    case 'failed':
      return undoT('failed');
    default:
      return undoT('notFound');
  }
}

const result = (outcome: UndoOutcome): UndoResult => ({
  ...outcome,
  message: undoMessage(outcome),
});

/** What a repeated click gets back: the first click's answer, kept as JSON. */
type StoredUndo = { code: 'ok'; activityId: string | null };

interface LogRow {
  id: string;
  kind: string;
  user_id: string | null;
  brand_id: string | null;
  tool_key: string;
  class: string;
  status: string;
  target_type: string | null;
  target_id: string | null;
  summary_params: Json;
  undo_json: Json | null;
  undo_until: string | null;
  undoes_id: string | null;
}

const LOG_COLUMNS =
  'id, kind, user_id, brand_id, tool_key, class, status, target_type, target_id, summary_params, undo_json, undo_until, undoes_id';

/** chatActivity.summary's values, as stored. */
function paramsOf(json: Json): Record<string, string> {
  return Object.fromEntries(
    Object.entries(asObject(json)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}

/**
 * The input the precedence finds the change's brand from (the row's
 * brandOf): the brand it was made on, or its target's id, whose brand is
 * read again now. resolveCallBrand checks either is the workspace's.
 */
function brandInput(tool: ChatTool, row: LogRow): Record<string, unknown> {
  const { brandOf } = tool;
  if (!brandOf) return {};
  return 'input' in brandOf
    ? { [brandOf.input]: row.brand_id }
    : { [brandOf.idField]: row.target_id };
}

/**
 * Undoes one change from the log, for the person who clicked Undo: the
 * person Chat acted as, or an Admin. A row they can't read is not found.
 * Never throws (a server action calls it): a failure on the way is `failed`.
 */
export async function undoChange(req: UndoRequest): Promise<UndoResult> {
  try {
    return await undo(req);
  } catch (err) {
    console.error('Chat could not undo a change:', err);
    return result({ code: 'failed' });
  }
}

async function undo(req: UndoRequest): Promise<UndoResult> {
  const ctx = await readPrecedenceContext({
    userId: req.userId,
    organizationId: req.organizationId,
    // Undo needs no card in any mode: only a refusal stops it.
    mode: 'auto',
    surface: req.surface,
  });
  if (!ctx) return result({ code: 'not_found' });

  const { data, error } = await supabaseAdmin
    .from('chat_activity_log')
    .select(LOG_COLUMNS)
    .eq('id', req.activityId)
    .eq('organization_id', req.organizationId)
    .maybeSingle();
  if (error) throw new Error(`Could not read the activity log: ${error.message}`);
  const row = data as LogRow | null;
  if (!row || (row.user_id !== req.userId && ctx.role !== 'admin')) {
    return result({ code: 'not_found' });
  }
  if (row.status === 'undone') return result({ code: 'already_undone' });

  const tool = chatToolByKey(row.tool_key);
  const rule = tool ? undoRule(tool) : null;
  if (
    row.kind !== 'change' ||
    !tool ||
    !rule ||
    !row.undo_until ||
    !row.undo_json ||
    !row.target_type ||
    !row.target_id
  ) {
    return result({ code: 'not_undoable' });
  }
  if (Date.parse(row.undo_until) <= Date.now()) return result({ code: 'expired' });

  // The same decision as the tool's, read now: the role, the plan, the policy, and the
  // brand found again as the tool's call finds it.
  const decision = decideToolCall(
    tool,
    ctx,
    await readToolCall(ctx, tool, brandInput(tool, row), false),
  );
  const params = paramsOf(row.summary_params);
  if (decision.kind === 'deny') {
    return result({
      code: 'denied',
      denial: buildDenial(decision.denial, {
        tool,
        role: ctx.role,
        plan: ctx.plan,
        target: params.title ?? params.text ?? null,
      }),
    });
  }

  const target = {
    id: row.target_id,
    brandId: row.brand_id,
    data: asObject(row.undo_json) as Snapshot,
    userId: req.userId,
  };
  const targetType = row.target_type;
  // Set inside the work: a conflict answers this click, and its key goes back.
  const found: {
    conflict: 'changed' | 'gone' | null;
    refused: { message: string } | null;
  } = { conflict: null, refused: null };
  const outcome = await withIdempotencyKey<StoredUndo>(
    {
      organizationId: req.organizationId,
      key: idempotencyKey('undo', [row.id]),
      requestHash: requestHash('undo', row.id),
    },
    async () => {
      const inverse = await rule.inverse(target);
      // No room on the plan: nothing changed, nothing marked; it may be tried again.
      if (typeof inverse === 'object') {
        found.refused = inverse;
        return { result: { code: 'ok', activityId: null }, activityId: null };
      }
      if (inverse !== 'ok') {
        found.conflict = inverse;
        await markChange(row.id, { status: 'undo_conflict' });
        return { result: { code: 'ok', activityId: null }, activityId: null };
      }
      // Undone: what follows records it, and a failure there never undoes twice.
      await markChange(row.id, {
        status: 'undone',
        undone_at: new Date().toISOString(),
        undone_by: req.userId,
      });
      let activityId: string | null = null;
      try {
        activityId = await logActivity({
          organizationId: req.organizationId,
          userId: req.userId,
          brandId: row.brand_id,
          place: req.place ?? { conversationId: null, runId: null, stepId: null },
          surface: req.surface,
          tool,
          mode: null,
          approval: { kind: 'run' },
          target: { type: targetType, id: row.target_id },
          summary: { key: `${tool.labelKey}Undo`, params },
          undo: null,
          undoesId: row.id,
        });
      } catch (err) {
        console.error('Chat could not log an Undo:', err);
      }
      return { result: { code: 'ok', activityId }, activityId };
    },
    // A conflict isn't kept: once the target is back as it was, Undo may try again.
    { keep: () => found.conflict === null && found.refused === null },
  );

  if (outcome.kind === 'mismatch' || outcome.kind === 'busy')
    return result({ code: 'in_progress' });
  if (found.refused) return result({ code: 'quota_exceeded', message: found.refused.message });
  const { conflict } = found;
  if (conflict) {
    return result({
      code: 'conflict',
      reason: conflict,
      href: conflict === 'gone' ? null : rule.href(row.target_id),
    });
  }
  return result(outcome.result);
}

/** Sets the undone change's status; logged, not thrown, once the inverse ran. */
async function markChange(id: string, patch: Record<string, string>): Promise<void> {
  const { error } = await supabaseAdmin
    .from('chat_activity_log')
    .update(patch)
    .eq('id', id)
    .in('status', ['done', 'undo_conflict']);
  if (error) console.error('Chat could not mark a change in the activity log:', error.message);
}
