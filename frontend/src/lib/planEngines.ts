import { supabaseAdmin } from '@/lib/supabase/admin';
import { getPlan, type PlanId } from '@/config/plans';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/promptOptions';

/**
 * Resolve the scraper + model id sets a plan currently allows.
 *
 * Mirrors the gating logic in the onboarding wizard
 * (`(onboarding)/dashboard/onboarding/page.tsx`): if `allowedScrapers` /
 * `allowedModels` is **absent** on the plan, every engine / model is allowed
 * (Growth, Enterprise, Self-hosted). If it's an **array** — even an empty
 * one — only the listed ids are allowed (Starter ships
 * `allowedScrapers: ['chatgpt-web', 'copilot-web']` and
 * `allowedModels: []`).
 *
 * Used by the Stripe success route to align onboarding-created prompts to
 * the plan the user actually picks at step 6 — without this, a Growth
 * trial-er ends up tracking only the 2 Starter engines (issue #78).
 */
export function getActiveEngineIdsForPlan(planId: PlanId | string | null | undefined): {
  platforms: string[];
  models: string[];
} {
  const plan = getPlan((planId ?? 'starter') as PlanId);

  const allowedScrapers = plan.limits.allowedScrapers;
  const platforms = allowedScrapers
    ? ALL_SCRAPERS.filter((s) => allowedScrapers.includes(s.id)).map((s) => s.id)
    : ALL_SCRAPERS.map((s) => s.id);

  const allowedModels = plan.limits.allowedModels;
  const models = allowedModels
    ? ALL_MODELS.filter((m) => allowedModels.includes(m.id)).map((m) => m.id)
    : ALL_MODELS.map((m) => m.id);

  return { platforms, models };
}

/**
 * Rewrite every prompt in an organisation's brands so its `platforms` and
 * `models` arrays match what the given plan allows. Handles both directions:
 *
 *   - **Expansion** (Starter → Growth): Growth has no `allowedScrapers`,
 *     so every prompt's platforms array becomes all 8 engine ids. Without
 *     this an upgraded Growth customer keeps tracking only 2 engines (#79).
 *   - **Contraction** (Growth → Starter on downgrade / cancellation):
 *     Starter restricts to `['chatgpt-web', 'copilot-web']`, so prompts
 *     get trimmed down. Without this a downgraded org would keep paying
 *     scraper cost on engines the plan no longer covers.
 *
 * Idempotent — re-running with the same plan is a no-op write. Returns the
 * count of prompts rewritten so callers can log it.
 */
export async function alignPromptsToPlanForOrg(
  orgId: string,
  planId: PlanId | string | null | undefined,
): Promise<{
  platforms: string[];
  models: string[];
  promptCount: number;
}> {
  const { platforms, models: baseModels } = getActiveEngineIdsForPlan(planId);

  // Enterprise: API-model tracking (Claude) is a per-customer opt-in via
  // organizations.plan_overrides.allowedModels — without this check, an
  // alignment run would strip Claude from a customer we've enabled it for.
  let models = baseModels;
  if (planId === 'enterprise') {
    const { data: org } = await supabaseAdmin
      .from('organizations')
      .select('plan_overrides')
      .eq('id', orgId)
      .maybeSingle();
    const overrides = org?.plan_overrides as { allowedModels?: string[] } | null;
    if (overrides?.allowedModels) {
      models = ALL_MODELS.filter((m) => overrides.allowedModels!.includes(m.id)).map((m) => m.id);
    }
  }

  // Never the demo brand's prompts (00380): they are sample data on every engine.
  const { data: brands, error: brandsErr } = await supabaseAdmin
    .from('brands')
    .select('id')
    .eq('organization_id', orgId)
    .eq('is_demo', false);
  if (brandsErr) throw new Error(`brands lookup: ${brandsErr.message}`);

  const brandIds = (brands ?? []).map((b) => b.id);
  if (brandIds.length === 0) {
    return { platforms, models, promptCount: 0 };
  }

  const { data: promptSets, error: setsErr } = await supabaseAdmin
    .from('prompt_sets')
    .select('id')
    .in('brand_id', brandIds);
  if (setsErr) throw new Error(`prompt_sets lookup: ${setsErr.message}`);

  const promptSetIds = (promptSets ?? []).map((p) => p.id);
  if (promptSetIds.length === 0) {
    return { platforms, models, promptCount: 0 };
  }

  const { data: updatedRows, error: updateErr } = await supabaseAdmin
    .from('prompts')
    .update({ platforms, models })
    .in('prompt_set_id', promptSetIds)
    .select('id');
  if (updateErr) throw new Error(`prompts update: ${updateErr.message}`);

  return { platforms, models, promptCount: (updatedRows ?? []).length };
}
