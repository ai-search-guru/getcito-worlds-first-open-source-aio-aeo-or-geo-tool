'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import {
  MAX_LOCATION_COLUMNS,
  PROMPT_COLUMNS,
  isLocationColumn,
  readColumnsView,
  type PromptColumnsView,
} from '@/lib/promptTableColumns';

/**
 * The Tracked Prompts table's column views (PROMPT-015a, 00363), read and
 * written through RLS: a member reads and writes their own view and reads
 * the brand's; an admin or manager writes the brand's shared view.
 * Failures come back as a value: production masks a thrown error's message.
 */

const columnId = z.union([z.enum(PROMPT_COLUMNS), z.string().refine(isLocationColumn)]);
const MAX_IDS = PROMPT_COLUMNS.length + MAX_LOCATION_COLUMNS;
const viewSchema = z.object({
  order: z.array(columnId).max(MAX_IDS),
  hidden: z.array(columnId).max(MAX_IDS),
});

export interface PromptTableViews {
  /** The person's own view; null when they have none. */
  mine: PromptColumnsView | null;
  /** The view shared with everyone on the brand; null when none is. */
  brand: PromptColumnsView | null;
}

export async function getPromptTableViews(brandId: string): Promise<PromptTableViews> {
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { mine: null, brand: null };
  const { data, error } = await supabase
    .from('prompt_table_views')
    .select('user_id, columns')
    .eq('brand_id', brandId)
    .or(`user_id.is.null,user_id.eq.${user.id}`);
  if (error) throw new Error(error.message);
  const row = (mine: boolean) =>
    (data ?? []).find((r) => (mine ? r.user_id === user.id : r.user_id === null));
  return {
    mine: readColumnsView(row(true)?.columns),
    brand: readColumnsView(row(false)?.columns),
  };
}

export type SaveViewResult =
  { ok: true } | { ok: false; error: 'invalid' | 'forbidden' | 'failed' };

/**
 * Saves the person's own view, or, with `scope: 'brand'`, shares it with
 * everyone on the brand (admins and managers; RLS refuses anyone else).
 */
export async function savePromptTableView(
  brandId: string,
  view: PromptColumnsView,
  scope: 'mine' | 'brand' = 'mine',
): Promise<SaveViewResult> {
  const parsed = viewSchema.safeParse(view);
  if (!z.guid().safeParse(brandId).success || !parsed.success)
    return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'forbidden' };
  const { data, error } = await supabase
    .from('prompt_table_views')
    .upsert(
      {
        brand_id: brandId,
        user_id: scope === 'brand' ? null : user.id,
        columns: { order: [...parsed.data.order], hidden: [...parsed.data.hidden] },
        updated_by: user.id,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'brand_id,user_id' },
    )
    .select('id');
  if (error) {
    console.error('Failed to save the Tracked Prompts columns:', error.message);
    return { ok: false, error: error.code === '42501' ? 'forbidden' : 'failed' };
  }
  // RLS filters a write it refuses to nothing, rather than raising.
  return data?.length ? { ok: true } : { ok: false, error: 'forbidden' };
}

/**
 * Removes the person's own view (Reset: back to the brand's view, or the
 * default), or, with `scope: 'brand'`, stops sharing the brand's.
 */
export async function removePromptTableView(
  brandId: string,
  scope: 'mine' | 'brand' = 'mine',
): Promise<SaveViewResult> {
  if (!z.guid().safeParse(brandId).success) return { ok: false, error: 'invalid' };
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'forbidden' };
  const query = supabase.from('prompt_table_views').delete().eq('brand_id', brandId);
  const { error } = await (scope === 'brand'
    ? query.is('user_id', null)
    : query.eq('user_id', user.id));
  if (error) {
    console.error('Failed to reset the Tracked Prompts columns:', error.message);
    return { ok: false, error: 'failed' };
  }
  return { ok: true };
}
