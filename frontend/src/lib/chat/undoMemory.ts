import { supabaseAdmin } from '@/lib/supabase/admin';
import { summaryValue } from './activity';
import { MEMORY_SCOPES, MEMORY_UNDO_MS, type MemoryScope } from './memory/rules';
import { scopeWords } from './memory/store';
import type { UndoRule, WriteRecord } from './undo';
import { asObject, check, textOf } from './undoParts';

/**
 * What Chat's memory rows record, and their Undo (CHAT-20 §9 rows 73–74:
 * "Yes · 10 s"): a line Chat saved is taken out again (or the line it
 * replaced gets its old words back), and a line Chat removed comes back,
 * while each is as the change left it. Server only.
 */

const scopeOf = (value: unknown): MemoryScope =>
  MEMORY_SCOPES.find((scope) => scope === value) ?? 'user';

/** A line's words and scope, for the log; null when it isn't there. */
async function readLine(id: string): Promise<{ text: string; scope: MemoryScope } | null> {
  const { data, error } = await supabaseAdmin
    .from('chat_memory_items')
    .select('text, scope')
    .eq('id', id)
    .maybeSingle();
  check(error, 'the memory');
  const row = data as { text: string; scope: string } | null;
  return row ? { text: row.text, scope: scopeOf(row.scope) } : null;
}

/** Whether the line is still there, for an inverse that found it changed. */
async function stillThere(id: string): Promise<'changed' | 'gone'> {
  const { data, error } = await supabaseAdmin
    .from('chat_memory_items')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  check(error, 'the memory');
  return data ? 'changed' : 'gone';
}

const saveMemory: UndoRule = {
  targetType: 'chat_memory_item',
  windowMs: MEMORY_UNDO_MS,
  async before(input) {
    const replaces = textOf(asObject(input).replaces);
    if (!replaces) return null;
    const line = await readLine(replaces);
    return line ? { text: line.text } : null;
  },
  async record(input, output, before): Promise<WriteRecord> {
    const saved = asObject(output);
    const id = saved.saved === true ? textOf(saved.id) : null;
    const text = textOf(saved.text) ?? textOf(asObject(input).text);
    const scope = scopeOf(saved.scope ?? asObject(input).scope);
    return {
      target: { type: 'chat_memory_item', id },
      summaryParams: { text: summaryValue(text), scope: scopeWords(scope) },
      // A request sent to the Admins changed nothing yet.
      undo: id && text ? { after: { text }, before: before ? { text: before.text } : null } : null,
    };
  },
  async inverse({ id, data }) {
    const after = String(asObject(data.after).text);
    const earlier = textOf(asObject(data.before).text);
    const change = supabaseAdmin.from('chat_memory_items');
    const { data: done, error } = earlier
      ? await change
          .update({ text: earlier })
          .eq('id', id)
          .eq('text', after)
          .is('deleted_at', null)
          .select('id')
      : await change.delete().eq('id', id).eq('text', after).is('deleted_at', null).select('id');
    if (error) throw new Error(`Could not undo the memory: ${error.message}`);
    return (done ?? []).length > 0 ? 'ok' : stillThere(id);
  },
  href: () => '/dashboard/chat',
};

const forgetMemory: UndoRule = {
  targetType: 'chat_memory_item',
  windowMs: MEMORY_UNDO_MS,
  async before(input) {
    const id = textOf(asObject(input).memory_id);
    const line = id ? await readLine(id) : null;
    return line ? { text: line.text, scope: line.scope } : null;
  },
  async record(input, output, before): Promise<WriteRecord> {
    const removed = asObject(output);
    const id = textOf(removed.id);
    const text = textOf(removed.text) ?? textOf(before?.text);
    const scope = scopeOf(removed.scope ?? before?.scope);
    return {
      target: { type: 'chat_memory_item', id: id ?? textOf(asObject(input).memory_id) },
      summaryParams: { text: summaryValue(text), scope: scopeWords(scope) },
      undo: id ? { after: { deleted: true } } : null,
    };
  },
  async inverse({ id }) {
    const { data: done, error } = await supabaseAdmin
      .from('chat_memory_items')
      .update({ deleted_at: null })
      .eq('id', id)
      .not('deleted_at', 'is', null)
      .select('id');
    // The scope filled up since: it stays removed.
    if (error?.code === '23514' || error?.code === '23505') return 'changed';
    if (error) throw new Error(`Could not undo the memory: ${error.message}`);
    return (done ?? []).length > 0 ? 'ok' : stillThere(id);
  },
  href: () => '/dashboard/chat',
};

/** The memory rows' record and Undo, by tool name (undo.ts UNDO_RULES). */
export const MEMORY_UNDO_RULES: Readonly<Record<string, UndoRule>> = {
  save_memory: saveMemory,
  forget_memory: forgetMemory,
};
