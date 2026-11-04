'use server';

import { createClient } from '@/lib/supabase/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { PromptVolume } from '@/types';

/** What a prompt's estimate is worked out from (PROMPT-013). */
export type PromptVolumeEstimateRow = Pick<
  PromptVolume,
  | 'estAiVolume'
  | 'totalGoogleVolume'
  | 'googleVolumes'
  | 'aiVolumeMultiplier'
  | 'keywords'
  | 'fetchedAt'
>;

/**
 * One prompt's volume for its detail page, or null when it has none.
 * prompt_volumes is a server-only table, so the prompt is first read with
 * the signed-in user's client (RLS): one they can't see reads null.
 */
export async function getPromptVolume(promptId: string): Promise<PromptVolumeEstimateRow | null> {
  const supabase = await createClient();
  const { data: prompt, error: promptError } = await supabase
    .from('prompts')
    .select('id')
    .eq('id', promptId)
    .maybeSingle();
  if (promptError) throw new Error(promptError.message);
  if (!prompt) return null;

  const { data, error } = await supabaseAdmin
    .from('prompt_volumes')
    .select(
      'est_ai_volume, total_google_volume, google_volumes, ai_volume_multiplier, keywords, fetched_at',
    )
    .eq('prompt_id', promptId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    estAiVolume: Number(data.est_ai_volume ?? 0),
    totalGoogleVolume: Number(data.total_google_volume ?? 0),
    googleVolumes: (data.google_volumes ?? {}) as Record<string, number>,
    aiVolumeMultiplier: Number(data.ai_volume_multiplier ?? 0),
    keywords: (data.keywords ?? []) as string[],
    fetchedAt: data.fetched_at as string,
  };
}
