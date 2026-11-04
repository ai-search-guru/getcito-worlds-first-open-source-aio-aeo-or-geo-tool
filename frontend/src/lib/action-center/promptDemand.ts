import type { SupabaseClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { promptVolumeEstimate, type VolumeEstimate } from '@/lib/volumeEstimate';

/** Prompt ids per request, so the filter stays well inside a URL's length. */
const DEMAND_CHUNK = 150;

/**
 * The estimated monthly AI searches of these prompts, for the Affected tab's
 * Volume column and the Why (AC-003): each as an estimate, a range and how
 * sure it is (PROMPT-013). prompt_volumes is a server-only table,
 * so the prompts are first checked to be the brand's with `client` — the
 * signed-in user's (RLS), or the admin client once the API has checked the
 * key's organization — and only theirs are read with the admin client.
 */
export async function readPromptDemand(
  client: SupabaseClient,
  brandId: string,
  promptIds: string[],
): Promise<Map<string, VolumeEstimate>> {
  const demand = new Map<string, VolumeEstimate>();
  const ids = [...new Set(promptIds)];
  for (let i = 0; i < ids.length; i += DEMAND_CHUNK) {
    const chunk = ids.slice(i, i + DEMAND_CHUNK);
    const { data: visible, error } = await client
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId)
      .in('id', chunk);
    if (error) throw new Error(error.message);
    const allowed = (visible ?? []).map((row) => row.id as string);
    if (allowed.length === 0) continue;
    const { data: rows, error: volumeError } = await supabaseAdmin
      .from('prompt_volumes')
      .select(
        'prompt_id, est_ai_volume, google_volumes, ai_volume_multiplier, keywords, fetched_at',
      )
      .in('prompt_id', allowed);
    if (volumeError) throw new Error(volumeError.message);
    for (const row of rows ?? []) {
      const volume = Number(row.est_ai_volume ?? 0);
      if (volume <= 0) continue;
      demand.set(
        row.prompt_id as string,
        promptVolumeEstimate({
          estAiVolume: volume,
          googleVolumes: (row.google_volumes ?? {}) as Record<string, number>,
          aiVolumeMultiplier: Number(row.ai_volume_multiplier ?? 0),
          keywords: (row.keywords ?? []) as string[],
          fetchedAt: row.fetched_at as string,
        }),
      );
    }
  }
  return demand;
}
