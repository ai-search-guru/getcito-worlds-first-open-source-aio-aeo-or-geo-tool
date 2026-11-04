import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * Returns the current calendar month in UTC as `YYYY-MM`, matching the
 * shape stored in `agent_token_usage.year_month`. Used as the bucket key
 * for the per-month usage row this module writes.
 */
export function currentYearMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Add this turn's token usage to the user's monthly bucket. Kept after the
 * switch to BYOK on cloud purely for product analytics — we no longer pay
 * for the tokens, but knowing how heavily each org uses the agent
 * informs roadmap calls (e.g. "Starter customers are sending 5x what we
 * expected through their own keys, the feature is sticky").
 *
 * Combined `prompt + completion` is what reports compare against; both
 * are stored so we can break the cost shape down later.
 *
 * Uses Postgres `upsert` semantics through a fetch-then-write — the unique
 * constraint on (user_id, organization_id, year_month) protects against
 * races at the DB layer.
 */
export async function recordAgentTokenUsage(
  userId: string,
  organizationId: string,
  promptTokens: number,
  completionTokens: number,
): Promise<void> {
  if (promptTokens <= 0 && completionTokens <= 0) return;

  const yearMonth = currentYearMonth();

  const { data: existing } = await supabaseAdmin
    .from('agent_token_usage')
    .select('id, prompt_tokens, completion_tokens')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .eq('year_month', yearMonth)
    .maybeSingle();

  if (existing) {
    await supabaseAdmin
      .from('agent_token_usage')
      .update({
        prompt_tokens: Number(existing.prompt_tokens ?? 0) + promptTokens,
        completion_tokens: Number(existing.completion_tokens ?? 0) + completionTokens,
      })
      .eq('id', existing.id);
  } else {
    await supabaseAdmin.from('agent_token_usage').insert({
      user_id: userId,
      organization_id: organizationId,
      year_month: yearMonth,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
    });
  }
}
