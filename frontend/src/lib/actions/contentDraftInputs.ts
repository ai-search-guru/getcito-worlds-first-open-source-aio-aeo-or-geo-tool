'use server';

import { z } from 'zod';
import {
  NO_INPUTS,
  draftInputsSchema,
  keptInputs,
  type DraftInputs,
} from '@/lib/content/draftInputs';
import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscriptionGuard';

/**
 * Brief › Your input (Content Editor Quality spec §6, CE-048): the person's
 * experience, data and expert quotes for a draft (content_draft_inputs,
 * 00265), read and written by the members of its workspace (RLS), as the
 * draft is.
 */

const draftId = z.guid();

/** The draft's input, as kept (keptInputs); none given reads as empty. */
export async function getDraftInputs(id: string): Promise<DraftInputs> {
  if (!draftId.safeParse(id).success) throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('content_draft_inputs')
    .select('experience, data, getcito_data, quotes')
    .eq('draft_id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return NO_INPUTS;
  return keptInputs({
    experience: data.experience,
    data: data.data,
    getcitoData: data.getcito_data,
    quotes: data.quotes,
  });
}

/** Keeps the draft's input as given (all of it, as the editor holds it). */
export async function saveDraftInputs(id: string, inputs: DraftInputs): Promise<DraftInputs> {
  await assertWritable();
  const parsed = draftInputsSchema.safeParse(inputs);
  if (!draftId.safeParse(id).success || !parsed.success) throw new Error('invalid');
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { error } = await supabase.from('content_draft_inputs').upsert(
    {
      draft_id: id,
      experience: parsed.data.experience || null,
      data: parsed.data.data,
      getcito_data: parsed.data.getcitoData,
      quotes: parsed.data.quotes,
      updated_by: user?.id ?? null,
    },
    { onConflict: 'draft_id' },
  );
  if (error) throw new Error(error.message);
  return parsed.data;
}
