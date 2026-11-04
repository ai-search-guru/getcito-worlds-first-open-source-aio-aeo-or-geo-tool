import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { questionVolume, type QuestionVolume } from '@/lib/content/questionVolume';

/**
 * A content opportunity's question's volume (questionVolume.ts), read for
 * its prompt. prompt_volumes is a server-only table, so the prompt is first
 * read with `client` — the signed-in user's (RLS), or the admin client once
 * the API has checked the key's organization — as the brand's, and only then
 * is its volume read with the admin client. Null when the prompt isn't the
 * brand's or has no volume.
 */
export async function readQuestionVolume(
  client: SupabaseClient,
  brandId: string,
  promptId: string,
): Promise<QuestionVolume | null> {
  const { data: prompt, error } = await client
    .from('prompts')
    .select('id, text, prompt_sets!inner(brand_id)')
    .eq('prompt_sets.brand_id', brandId)
    .eq('id', promptId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!prompt) return null;
  const { data: row, error: volumeError } = await supabaseAdmin
    .from('prompt_volumes')
    .select('est_ai_volume, google_volumes, ai_volume_multiplier, keywords, fetched_at')
    .eq('prompt_id', promptId)
    .maybeSingle();
  if (volumeError) throw new Error(volumeError.message);
  if (!row) return null;
  return questionVolume(prompt.text as string, {
    estAiVolume: Number(row.est_ai_volume ?? 0),
    googleVolumes: (row.google_volumes ?? {}) as Record<string, number>,
    aiVolumeMultiplier: Number(row.ai_volume_multiplier ?? 0),
    keywords: (row.keywords ?? []) as string[],
    fetchedAt: row.fetched_at as string,
  });
}
