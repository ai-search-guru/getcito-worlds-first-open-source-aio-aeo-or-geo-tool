import { z } from 'zod';
import type { BrandAccess } from '@/lib/brandAccess';
import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * The brands a chat touched (BRAND-ACCESS §10, 00436): a chat with no brand
 * lets each call pick its own, so a shared one can hold any brand's data.
 * Its touched_brand_ids say which: the chat's own brand when it starts, and
 * the brands of the objects a message references with @ (or its page's
 * brand), and the brand of every call Chat lets run (or asks about), noted
 * before the call reads anything. A read about no brand that names every brand the
 * person can access (the brand list, the connections) touches all of them:
 * for someone with All brands, the whole workspace (null). A file filed
 * from the chat keeps the chat's set (00436's trigger).
 *
 * Null is "not known": a chat from before 00436, one Chat didn't start (an
 * old Agent chat copied in), or one that touched the whole workspace. With
 * no brand and not known, only Admins and All-brands people read someone
 * else's (00424); a known set lets a Selected-brands person read it when
 * every brand in it is theirs (00436's policies).
 *
 * Before 00436 the functions aren't there: nothing is noted, and nothing
 * reads the set. Server only.
 */

const uuid = z.guid();

/** A call's brands: these ids, or every brand of the workspace. */
export type TouchedBrands = readonly string[] | 'workspace';

/** A function that isn't there: PostgREST doesn't know it, or Postgres doesn't. */
const MISSING_FUNCTION = new Set(['PGRST202', '42883']);
/** A column that isn't there: Postgres' code, and PostgREST's for its schema cache. */
const MISSING_COLUMN = new Set(['42703', 'PGRST204']);
let warnedMissing = false;

function missing(error: { code?: string; message: string }): boolean {
  if (!MISSING_FUNCTION.has(error.code ?? '')) return false;
  if (!warnedMissing) {
    warnedMissing = true;
    console.warn("[chat] a chat's brands aren't kept until 00436 is applied");
  }
  return true;
}

/**
 * What a call touches: its brand; for a read about no brand that names the
 * brands the person can access (`namesBrands`), every one of them, which
 * for All brands is the whole workspace; else nothing. Pure.
 */
export function touchedByCall(
  tool: { namesBrands?: true },
  brandId: string | null,
  access: BrandAccess | null,
): TouchedBrands {
  if (brandId) return [brandId];
  if (!tool.namesBrands) return [];
  return access === 'all' ? 'workspace' : [...(access ?? [])];
}

/**
 * Starts keeping a new chat's brands: its own brand, or none yet. Only a
 * chat with no message yet (the database checks): anything already in it
 * is of brands no one noted. A start that fails leaves the set not known,
 * the closed side: it is logged, and the chat goes on.
 */
export async function startTouchedBrands(conversationId: string): Promise<void> {
  const { error } = await supabaseAdmin.rpc('chat_start_touched_brands', {
    p_conversation_id: conversationId,
  });
  if (error && !missing(error)) {
    console.error("[chat] could not start keeping a chat's brands:", error.message);
  }
}

/**
 * Notes what a call touches on its chat, before it runs. Answers whether
 * the call may go on: false when the note failed, so the call reads
 * nothing a shared chat would then show to someone without that brand.
 */
export async function noteTouchedBrands(
  conversationId: string,
  touched: TouchedBrands,
): Promise<boolean> {
  if (touched !== 'workspace' && touched.length === 0) return true;
  const { error } = await supabaseAdmin.rpc('chat_note_touched_brands', {
    p_conversation_id: conversationId,
    p_brand_ids: touched === 'workspace' ? [] : [...touched],
    p_whole_workspace: touched === 'workspace',
  });
  if (!error) return true;
  if (missing(error)) {
    // The set can't take the call's brands: it becomes not known, the closed side.
    // Before 00436 there is no column either, and nothing reads one.
    const { error: cleared } = await supabaseAdmin
      .from('chat_conversations')
      .update({ touched_brand_ids: null })
      .eq('id', conversationId);
    if (!cleared || MISSING_COLUMN.has(cleared.code ?? '')) return true;
    console.error("[chat] could not note a call's brands:", cleared.message);
    return false;
  }
  console.error("[chat] could not note a call's brands:", error.message);
  return false;
}

/** What a message names besides its words: its page's chips and its @ references. */
interface MessageNames {
  context?: { chips: { key: string; value?: string }[] };
  references?: { type: string; id: string }[];
}

/**
 * The brands a message's @ references are about (CHAT-02 items 15–17),
 * which go into the chat with their labels: a tracked prompt's and an Action
 * Center task's own brand, and for a page, chart, metric or table of the
 * page the brand of its brand chip (the brand the page was showing). One
 * that can't be told is the whole workspace, the closed side. None without
 * references.
 */
export async function referenceTouches(message: MessageNames): Promise<TouchedBrands> {
  const references = message.references ?? [];
  if (references.length === 0) return [];
  const ids = (type: string) => references.filter((r) => r.type === type).map((r) => r.id);
  const prompts = ids('prompt');
  const tasks = ids('task');
  if ([...prompts, ...tasks].some((id) => !uuid.safeParse(id).success)) return 'workspace';
  const found = new Set<string>();
  if (references.some((r) => r.type !== 'prompt' && r.type !== 'task')) {
    const chip = message.context?.chips.find((c) => c.key === 'brand')?.value;
    if (!chip || !uuid.safeParse(chip).success) return 'workspace';
    found.add(chip);
  }
  const [promptRows, taskRows] = await Promise.all([
    prompts.length
      ? supabaseAdmin.from('prompts').select('id, prompt_sets!inner(brand_id)').in('id', prompts)
      : null,
    tasks.length
      ? supabaseAdmin.from('action_tasks').select('id, actions!inner(brand_id)').in('id', tasks)
      : null,
  ]);
  for (const read of [promptRows, taskRows]) {
    if (read?.error)
      throw new Error(`Could not read what the message names: ${read.error.message}`);
  }
  const promptBrands = (
    (promptRows?.data ?? []) as { prompt_sets?: { brand_id?: string } | null }[]
  ).flatMap((row) => (row.prompt_sets?.brand_id ? [row.prompt_sets.brand_id] : []));
  const taskBrands = (
    (taskRows?.data ?? []) as { actions?: { brand_id?: string } | null }[]
  ).flatMap((row) => (row.actions?.brand_id ? [row.actions.brand_id] : []));
  // One that names nothing found: its label came from somewhere it can't say.
  if (promptBrands.length < new Set(prompts).size || taskBrands.length < new Set(tasks).size) {
    return 'workspace';
  }
  for (const id of [...promptBrands, ...taskBrands]) found.add(id);
  return [...found];
}
