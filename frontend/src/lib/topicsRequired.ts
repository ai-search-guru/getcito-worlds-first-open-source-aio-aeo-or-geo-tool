import type { createClient } from '@/lib/supabase/server';

/**
 * Prompts are grouped under topics, so a brand needs a topic before it can
 * have prompts: adding one, or having them suggested, on a brand with none is
 * refused with this code and the person is sent to add a topic first. Kept
 * apart from the server actions so client components can read it too.
 */
export const NO_TOPICS = 'no_topics';

/** The refusal in plain words, for a toast or an API caller. */
export const NO_TOPICS_MESSAGE = 'Add a topic first: prompts are grouped under topics.';

/** Where "Add a topic" goes: the Prompts page's Topics tab, with Add Topic open. */
export const ADD_TOPIC_HREF = '/dashboard/prompts/topics?new=1';

/** A result refused because the brand has no topics yet. */
export function isNoTopics(result: unknown): boolean {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { code?: unknown }).code === NO_TOPICS
  );
}

/**
 * Whether the brand has a topic, as the Add Prompt dialog's topic list reads
 * them (active ones). A failed read counts as yes: the write that follows says
 * what went wrong, rather than sending the person to add a topic they have.
 */
export async function brandHasTopics(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('topics')
    .select('id')
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (error) return true;
  return !!data;
}
