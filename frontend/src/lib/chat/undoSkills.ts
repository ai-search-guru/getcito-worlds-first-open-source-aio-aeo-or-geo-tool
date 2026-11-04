import { supabaseAdmin } from '@/lib/supabase/admin';
import { summaryValue } from './activity';
import type { UndoRule, WriteRecord } from './undo';
import { DAY_MS, asObject, check, textOf } from './undoParts';

/**
 * What Chat's skill row records, and its Undo (CHAT-20 §9 row 75: "Yes · 30
 * d (delete)"): a skill Chat saved is deleted again, while it is as it was
 * saved and still its creator's alone. One shared with the workspace since,
 * or changed, is someone else's to keep: Undo says it changed. Server only.
 */

const saveSkill: UndoRule = {
  targetType: 'chat_skill',
  windowMs: 30 * DAY_MS,
  async before() {
    return null;
  },
  async record(input, output): Promise<WriteRecord> {
    const saved = asObject(asObject(output).value);
    const id = textOf(saved.id);
    let checksum: string | null = null;
    if (id) {
      const { data, error } = await supabaseAdmin
        .from('chat_skills')
        .select('checksum_sha256')
        .eq('id', id)
        .maybeSingle();
      check(error, 'the skill');
      checksum = (data as { checksum_sha256: string } | null)?.checksum_sha256 ?? null;
    }
    const name = textOf(saved.name) ?? textOf(asObject(input).name);
    return {
      target: { type: 'chat_skill', id },
      summaryParams: { name: summaryValue(name ? `/${name}` : '') },
      undo: id && checksum ? { after: { checksum } } : null,
    };
  },
  async inverse({ id, data }) {
    const { data: removed, error } = await supabaseAdmin
      .from('chat_skills')
      .delete()
      .eq('id', id)
      .eq('checksum_sha256', String(asObject(data.after).checksum))
      .eq('visibility', 'private')
      .select('id');
    if (error) throw new Error(`Could not delete the skill: ${error.message}`);
    if ((removed ?? []).length > 0) return 'ok';
    const { data: row, error: readError } = await supabaseAdmin
      .from('chat_skills')
      .select('id')
      .eq('id', id)
      .maybeSingle();
    check(readError, 'the skill');
    return row ? 'changed' : 'gone';
  },
  href: () => '/dashboard/chat',
};

/** The skill row's record and Undo, by tool name (undo.ts UNDO_RULES). */
export const SKILL_UNDO_RULES: Readonly<Record<string, UndoRule>> = {
  save_skill: saveSkill,
};
