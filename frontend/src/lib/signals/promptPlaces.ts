import type { SupabaseClient } from '@supabase/supabase-js';
import type { PromptPlace } from './where';

/**
 * Where each of a brand's prompts is tracked, by id: the read behind every
 * signal's Where (AC-002), shared by the Signals page (as the signed-in user)
 * and the MCP tools (through the API key's admin client). Paged, because a
 * brand can hold more prompts than one PostgREST response carries. A failed
 * read costs the Where details, not the caller, so it is logged and empty.
 */
export async function readPromptPlaces(
  client: SupabaseClient,
  brandId: string,
): Promise<Map<string, PromptPlace>> {
  const places = new Map<string, PromptPlace>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from('prompts')
      .select(
        'id, platforms, regions, topic_id, is_active, prompt_sets!inner(brand_id), topics(name)',
      )
      .eq('prompt_sets.brand_id', brandId)
      .order('id')
      .range(from, from + 999);
    if (error) {
      console.error('[signals] prompt places read failed:', error.message);
      return new Map();
    }
    const rows = (data ?? []) as PromptPlaceRow[];
    for (const row of rows) {
      // The join is to one topic, though it can come back as a list.
      const topic = Array.isArray(row.topics) ? row.topics[0] : row.topics;
      places.set(row.id, {
        platforms: row.platforms ?? [],
        regions: row.regions ?? [],
        topicId: row.topic_id,
        topic: topic?.name ?? null,
        isActive: row.is_active,
      });
    }
    if (rows.length < 1000) return places;
  }
}

interface PromptPlaceRow {
  id: string;
  platforms: string[] | null;
  regions: string[] | null;
  topic_id: string | null;
  is_active: boolean;
  topics: { name: string } | { name: string }[] | null;
}
