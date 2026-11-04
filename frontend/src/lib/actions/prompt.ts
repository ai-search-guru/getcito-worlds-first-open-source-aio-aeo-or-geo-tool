'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import type { PromptSet, Prompt, AIPlatform, PromptVolume } from '@/types';
import { ORG_PLAN_COLUMNS, getOrgPlan, planFromOrgRow } from '@/lib/guards/planGuard';
import { dbClient } from '@/lib/supabase/scoped';
import { effectivePlanForBrand } from '@/lib/demo/demoBrand';
import {
  activationDelta,
  getOrgLocationUsage,
  locationLimitMessage,
  planBulkLocationChange,
  promptLocationCount,
} from '@/lib/promptLocations';
import { ALL_MODELS, ALL_SCRAPERS, DEFAULT_PROMPT_RANGE_DAYS } from '@/config/promptOptions';
import { PROMPT_DELETE_BATCH } from '@/lib/promptBulkActions';
import { isValidLocation, locationCode } from '@/lib/region';
import { createLimiter } from '@/lib/limiter';
import {
  MATRIX_READS_AT_ONCE,
  MATRIX_REGIONS,
  type PromptLocationCell,
} from '@/lib/promptLocationMatrix';
import type { Plan, PlanId } from '@/config/plans';
import { getPromptVolumes, type VolumeQuota } from '@/lib/actions/volumes';
import {
  analyzeNewPrompts,
  getPromptVisibilitySummaries,
  type PromptVisibilitySummary,
} from '@/lib/actions/tracking';
import { POSITION_PLATFORMS, platformAccess } from '@/lib/promptPositions';
import {
  buildPositionCell,
  previousWindow,
  type PlatformPositionRow,
  type PromptPositionCell,
} from '@/lib/promptPositionSummary';
import { assertWritable } from '@/lib/subscriptionGuard';
import { isManager } from '@/lib/sessionRole';
import { NO_TOPICS, NO_TOPICS_MESSAGE, brandHasTopics } from '@/lib/topicsRequired';

/** A prompt's text as two are compared: case and spacing aside (the natural key, CHAT-20 §11c). */
const textKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ');

function filterByPlan(plan: Plan, platforms: string[], models: string[]) {
  const allowedScrapers = plan.limits.allowedScrapers
    ? new Set(plan.limits.allowedScrapers)
    : new Set(ALL_SCRAPERS.map((s) => s.id));
  const allowedModels = plan.limits.allowedModels
    ? new Set(plan.limits.allowedModels)
    : new Set(ALL_MODELS.map((m) => m.id));
  return {
    platforms: platforms.filter((p) => allowedScrapers.has(p)),
    models: models.filter((m) => allowedModels.has(m)),
  };
}

/**
 * Shopping tracking is opt-in per brand (#155). Every prompt write must pass
 * through this: with the pref OFF, `chatgpt-shopping` is stripped no matter
 * where it came from — the pickers offer the full engine list, and inherited
 * defaults (fan-out Track copies the latest prompt's platforms) would
 * otherwise keep leaking paid shopping scrapes onto brands that can't even
 * see the data.
 */
function stripShoppingWhenDisabled(
  platforms: string[],
  shoppingEnabled: boolean | null | undefined,
): string[] {
  return shoppingEnabled ? platforms : platforms.filter((p) => p !== 'chatgpt-shopping');
}

// ─── Row Mappers ──────────────────────────────────────────────────────────────

function mapPromptRow(row: Record<string, unknown>): Prompt {
  return {
    id: row.id as string,
    promptSetId: row.prompt_set_id as string,
    text: row.text as string,
    category: (row.category as string | null) ?? undefined,
    topicId: (row.topic_id as string | null) ?? undefined,
    platforms: ((row.platforms as string[]) ?? []) as AIPlatform[],
    regions: (row.regions as string[]) ?? [],
    models: (row.models as string[]) ?? [],
    isActive: row.is_active as boolean,
    workStatus: (row.work_status as Prompt['workStatus']) ?? null,
    targetUrlCount: Array.isArray(row.prompt_target_urls) ? row.prompt_target_urls.length : 0,
    citedUrlCount: Array.isArray(row.prompt_target_urls)
      ? (row.prompt_target_urls as { cited_count: number }[]).filter((t) => t.cited_count > 0)
          .length
      : 0,
    createdAt: row.created_at as string,
  };
}

function mapPromptSetRow(
  set: Record<string, unknown>,
  prompts: Record<string, unknown>[],
): PromptSet {
  return {
    id: set.id as string,
    brandId: set.brand_id as string,
    name: set.name as string,
    prompts: prompts.map(mapPromptRow),
    createdAt: set.created_at as string,
    updatedAt: set.updated_at as string,
  };
}

/**
 * `region` is the location new prompts start at — the brand's country, or
 * its state when one is set (#691). The brand's state is a DEFAULT here, not
 * a tracking-time override: the worker targets each prompt's own locations,
 * so a brand-wide setting that silently won over them would leave two
 * sources of truth for the same question.
 */
async function getBrandContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<{ organizationId: string; region: string }> {
  const { data } = await supabase
    .from('brands')
    .select('organization_id, region, state')
    .eq('id', brandId)
    .single();

  if (!data?.organization_id) throw new Error('Brand not found');
  const country = (data.region as string | null) ?? 'US';
  const candidate = locationCode(country, data.state as string | null);
  return {
    organizationId: data.organization_id as string,
    region: isValidLocation(candidate) ? candidate : country,
  };
}

async function resolveTopicId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  category: string | null | undefined,
): Promise<string | null> {
  if (!category) return null;
  const { data } = await supabase
    .from('topics')
    .select('id')
    .eq('brand_id', brandId)
    .eq('name', category)
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export async function getPromptSets(brandId: string): Promise<PromptSet[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('prompt_sets')
    .select('*, prompts(*, prompt_target_urls(cited_count))')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((ps) =>
    mapPromptSetRow(ps as Record<string, unknown>, (ps.prompts as Record<string, unknown>[]) ?? []),
  );
}

interface SavePromptSetInput {
  brandId: string;
  name: string;
  prompts: {
    text: string;
    category?: string;
    platforms: string[];
    models?: string[];
    isActive?: boolean;
  }[];
}

export type SavePromptSetResult = { promptSet: PromptSet } | { error: string; code?: 'plan_limit' };

/**
 * How many tracked locations a brand's save may total before hitting the
 * org's plan cap (#691: quota counts prompt × location, not prompt rows —
 * though the wizards only create single-location prompts, so for them one
 * prompt still costs one). `used` counts locations on the org's OTHER brands
 * only — savePromptSet replaces this brand's own set, so its current prompts
 * don't count against a re-save. Lets the setup wizards gate the review step
 * inline (counter + disabled Continue) instead of failing the save after the
 * fact.
 */
export async function getPromptCapacity(
  brandId: string,
): Promise<{ maxPrompts: number; used: number }> {
  const supabase = await createClient();
  const { organizationId: orgId } = await getBrandContext(supabase, brandId);
  const plan = await getOrgPlan(orgId);
  const usage = await getOrgLocationUsage(supabase, orgId);
  return {
    maxPrompts: plan.limits.maxPrompts,
    used: usage.total - (usage.byBrand.get(brandId) ?? 0),
  };
}

/**
 * User-facing failures (plan limit, empty platform selection, DB errors) come
 * back as a VALUE: production masks every error thrown from a server action,
 * so a thrown PlanLimitError would reach users as the meaningless digest
 * message (#427).
 */
export async function savePromptSet(input: SavePromptSetInput): Promise<SavePromptSetResult> {
  await assertWritable({ onboarding: true, brandId: input.brandId });
  const supabase = await createClient();

  const { organizationId: orgId, region: brandRegion } = await getBrandContext(
    supabase,
    input.brandId,
  );
  const plan = await getOrgPlan(orgId);

  // Count existing active locations for this org, excluding this brand's own
  // (its whole set is replaced below, so a re-save doesn't compete with
  // itself). Every prompt saved here targets exactly one location — the
  // brand's region — so the request adds one location per active prompt;
  // paused ones take no room (00128). The cap is inclusive: landing exactly
  // on maxPrompts is allowed (onboarding generates 5 per topic, so hitting
  // the cap there is a normal, recoverable state).
  const usage = await getOrgLocationUsage(supabase, orgId);
  const otherLocations = usage.total - (usage.byBrand.get(input.brandId) ?? 0);
  const adding = input.prompts.filter((p) => p.isActive ?? true).length;
  const limitError = locationLimitMessage(plan, otherLocations, adding);
  if (limitError) {
    return { code: 'plan_limit', error: limitError };
  }

  // Delete existing prompt sets for this brand to avoid duplicates
  // (e.g. user navigated back during onboarding and re-submitted)
  const { data: existing } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', input.brandId);

  if (existing && existing.length > 0) {
    const existingIds = existing.map((ps) => ps.id);
    await supabase.from('prompts').delete().in('prompt_set_id', existingIds);
    await supabase.from('prompt_sets').delete().eq('brand_id', input.brandId);
  }

  // Insert the prompt set
  const { data: set, error: setError } = await supabase
    .from('prompt_sets')
    .insert({
      brand_id: input.brandId,
      name: input.name,
    })
    .select()
    .single();

  if (setError || !set) {
    return { error: setError?.message ?? 'Failed to create prompt set' };
  }

  // Insert prompts
  let insertedPrompts: Record<string, unknown>[] = [];

  if (input.prompts.length > 0) {
    const { data: brandRow } = await supabase
      .from('brands')
      .select('shopping_mode_enabled')
      .eq('id', input.brandId)
      .single();
    const shoppingEnabled = !!brandRow?.shopping_mode_enabled;

    const categories = [
      ...new Set(input.prompts.map((p) => p.category).filter(Boolean)),
    ] as string[];
    const topicIdMap = new Map<string, string>();
    await Promise.all(
      categories.map(async (cat) => {
        const tid = await resolveTopicId(supabase, input.brandId, cat);
        if (tid) topicIdMap.set(cat, tid);
      }),
    );

    const rows = [];
    for (const p of input.prompts) {
      const filtered = filterByPlan(plan, p.platforms, p.models ?? []);
      const platforms = stripShoppingWhenDisabled(filtered.platforms, shoppingEnabled);
      if (platforms.length === 0 && filtered.models.length === 0) {
        return { error: 'At least one platform or model must be selected for each prompt.' };
      }
      rows.push({
        prompt_set_id: set.id,
        text: p.text,
        category: p.category || null,
        topic_id: (p.category && topicIdMap.get(p.category)) || null,
        platforms,
        regions: [brandRegion],
        models: filtered.models,
        is_active: p.isActive ?? true,
      });
    }

    const { data: prompts, error: promptError } = await supabase
      .from('prompts')
      .insert(rows)
      .select();

    if (promptError) return { error: promptError.message };
    insertedPrompts = (prompts as Record<string, unknown>[]) ?? [];
  }

  revalidatePath('/dashboard/brands');

  return { promptSet: mapPromptSetRow(set as Record<string, unknown>, insertedPrompts) };
}

export async function updatePrompt(
  id: string,
  updates: {
    text?: string;
    category?: string;
    platforms?: string[];
    models?: string[];
  },
): Promise<Prompt> {
  await assertWritable();
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (updates.text !== undefined) payload.text = updates.text;
  if (updates.category !== undefined) payload.category = updates.category || null;

  // Both the category and the platform/model branch need context from the
  // prompt's row (its brand, org and shopping pref) — one fetch serves them.
  let ctx: {
    brandId: string;
    organizationId: string;
    shoppingEnabled: boolean | null;
  } | null = null;
  if (
    updates.category !== undefined ||
    updates.platforms !== undefined ||
    updates.models !== undefined
  ) {
    const { data: promptRow } = await supabase
      .from('prompts')
      .select('prompt_sets!inner(brand_id, brands!inner(organization_id, shopping_mode_enabled))')
      .eq('id', id)
      .single();
    const set = promptRow?.prompt_sets as unknown as {
      brand_id: string;
      brands: { organization_id: string; shopping_mode_enabled: boolean | null };
    } | null;
    if (!set?.brands?.organization_id) throw new Error('Prompt not found');
    ctx = {
      brandId: set.brand_id,
      organizationId: set.brands.organization_id,
      shoppingEnabled: set.brands.shopping_mode_enabled,
    };
  }

  if (updates.category !== undefined && ctx) {
    payload.topic_id = await resolveTopicId(supabase, ctx.brandId, updates.category);
  }

  if ((updates.platforms !== undefined || updates.models !== undefined) && ctx) {
    const plan = await getOrgPlan(ctx.organizationId);
    const filtered = filterByPlan(plan, updates.platforms ?? [], updates.models ?? []);
    const platforms = stripShoppingWhenDisabled(filtered.platforms, ctx.shoppingEnabled);
    if (platforms.length === 0 && filtered.models.length === 0) {
      throw new Error('At least one platform or model must be selected.');
    }
    if (updates.platforms !== undefined) payload.platforms = platforms;
    if (updates.models !== undefined) payload.models = filtered.models;
  }

  const { data, error } = await supabase
    .from('prompts')
    .update(payload)
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to update prompt');
  }

  return mapPromptRow(data as Record<string, unknown>);
}

export type UpdatePromptLocationsResult =
  { prompt: Prompt } | { error: string; code?: 'plan_limit' };

/**
 * Retarget a prompt's tracking locations (#691).
 *
 * Its own action rather than a field on `updatePrompt` because locations meter
 * against the plan (as does resuming, see setPromptActive), so this edit can
 * be REFUSED — and a refusal has to reach the user as a value: every
 * error thrown from a server action reaches production as a meaningless
 * digest string (#427).
 *
 * The guard measures the DELTA, not the total: an edit that grows the list
 * from one location to three costs exactly what adding two more
 * single-location prompts would, and fails the same way with the same
 * message. Re-saving an unchanged list at the cap succeeds, and removing
 * locations frees capacity immediately — including for an org left over its
 * limit by a plan downgrade.
 */
export async function updatePromptLocations(
  id: string,
  regionsInput: string[],
): Promise<UpdatePromptLocationsResult> {
  await assertWritable();
  const supabase = await createClient();

  const regions = [...new Set(regionsInput.map((r) => r.trim().toUpperCase()))];
  if (regions.length === 0) {
    return { error: 'Select at least one location.' };
  }
  const unknown = regions.filter((r) => !isValidLocation(r));
  if (unknown.length > 0) {
    return {
      error: `Unknown location code${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
    };
  }

  const { data: promptRow } = await supabase
    .from('prompts')
    .select('regions, is_active, prompt_sets!inner(brands!inner(organization_id))')
    .eq('id', id)
    .single();
  const orgId = (
    promptRow?.prompt_sets as unknown as { brands: { organization_id: string } } | null
  )?.brands?.organization_id;
  if (!orgId) return { error: 'Prompt not found' };

  // A paused prompt takes no room; its locations are counted when resumed.
  const delta = regions.length - promptLocationCount(promptRow?.regions as string[] | null);
  if (delta > 0 && promptRow?.is_active !== false) {
    const plan = await getOrgPlan(orgId);
    const usage = await getOrgLocationUsage(supabase, orgId);
    const limitError = locationLimitMessage(plan, usage.total, delta);
    if (limitError) return { error: limitError, code: 'plan_limit' };
  }

  const { data, error } = await supabase
    .from('prompts')
    .update({ regions })
    .eq('id', id)
    .select()
    .single();

  if (error || !data) {
    return { error: error?.message ?? 'Failed to update locations' };
  }

  revalidatePath('/dashboard/brands');
  return { prompt: mapPromptRow(data as Record<string, unknown>) };
}

/**
 * PostgREST takes an `.in()` list in the query string, so a selection of a few
 * hundred prompts would overrun the request line long before the row cap
 * mattered — 100 UUIDs is already ~3.7KB (#427's lesson, same constant as the
 * fan-out roster read). The write itself goes out as a POST body and needs no
 * chunking.
 */
const BULK_LOCATION_READ_CHUNK = 100;

export interface BulkLocationSummary {
  /** Prompts whose locations moved. */
  updated: number;
  /** Already had every added location, or none of the removed ones. */
  unchanged: number;
  /** Skipped: the removal would have left them with no location at all. */
  blocked: number;
  /** Locations the batch added (negative when it freed some). */
  delta: number;
}

export type BulkUpdatePromptLocationsResult =
  BulkLocationSummary | { error: string; code?: 'plan_limit' };

/**
 * Add or remove one or more tracking locations across a selection of prompts
 * (#691).
 *
 * Add/remove rather than "set every selected prompt to this list": a selection
 * can hold prompts targeting different places, and assigning one list to all of
 * them would erase that targeting without saying so.
 *
 * The plan cap is measured once, for the whole batch, and the write goes out as
 * a single statement (`apply_prompt_locations`, 00074). Looping the
 * single-prompt action instead would check the cap once per prompt and could
 * stop half-way through, leaving a partly-retargeted selection and a bill for
 * whatever landed before the limit bit.
 *
 * Current locations are re-read here rather than taken from the caller: the
 * quota arithmetic must not rest on numbers the client supplied.
 */
export async function bulkUpdatePromptLocations(
  promptIds: string[],
  action: 'add' | 'remove',
  locationsInput: string[],
): Promise<BulkUpdatePromptLocationsResult> {
  await assertWritable();
  const supabase = await createClient();

  const ids = [...new Set(promptIds)].filter(Boolean);
  if (ids.length === 0) return { error: 'Select at least one prompt.' };

  const locations = [...new Set(locationsInput.map((r) => r.trim().toUpperCase()))].filter(Boolean);
  if (locations.length === 0) return { error: 'Select at least one location.' };
  // Only a location being added must be one the product can track: stopping
  // takes off whatever the prompts hold, a code no list names any more too.
  const unknown = action === 'add' ? locations.filter((r) => !isValidLocation(r)) : [];
  if (unknown.length > 0) {
    return {
      error: `Unknown location code${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}`,
    };
  }

  const rows: { id: string; regions: string[]; isActive: boolean; organizationId: string }[] = [];
  for (let i = 0; i < ids.length; i += BULK_LOCATION_READ_CHUNK) {
    const { data, error } = await supabase
      .from('prompts')
      .select('id, regions, is_active, prompt_sets!inner(brands!inner(organization_id))')
      .in('id', ids.slice(i, i + BULK_LOCATION_READ_CHUNK));
    if (error) return { error: error.message };
    for (const row of data ?? []) {
      const orgId = (row.prompt_sets as unknown as { brands: { organization_id: string } } | null)
        ?.brands?.organization_id;
      if (!orgId) continue;
      rows.push({
        id: row.id as string,
        regions: (row.regions as string[] | null) ?? [],
        isActive: row.is_active !== false,
        organizationId: orgId,
      });
    }
  }

  // RLS decides what came back; a selection that resolves to nothing is a
  // stale page, not a request to write.
  if (rows.length === 0) return { error: 'None of the selected prompts are available.' };

  const plan = planBulkLocationChange(rows, action, locations);
  if (plan.changes.length === 0) {
    return { updated: 0, unchanged: plan.unchanged, blocked: plan.blocked, delta: 0 };
  }

  if (plan.delta > 0) {
    const orgId = rows[0].organizationId;
    const [orgPlan, usage] = await Promise.all([
      getOrgPlan(orgId),
      getOrgLocationUsage(supabase, orgId),
    ]);
    const limitError = locationLimitMessage(orgPlan, usage.total, plan.delta);
    if (limitError) return { error: limitError, code: 'plan_limit' };
  }

  const { data: written, error } = await supabase.rpc('apply_prompt_locations', {
    p_updates: plan.changes.map((c) => ({ id: c.promptId, regions: c.regions })),
  });
  if (error) return { error: error.message };

  revalidatePath('/dashboard/brands');
  return {
    updated: Number(written ?? 0),
    unchanged: plan.unchanged,
    blocked: plan.blocked,
    delta: plan.delta,
  };
}

/**
 * Org-wide tracked-location usage against the plan cap, for the brand prompts
 * page to bound its location pickers before a save can fail. `maxPrompts` has
 * Enterprise plan_overrides merged. (The Tracked Prompts page reads the same
 * numbers from its usage cards, GET /api/prompts/usage.)
 */
export interface LocationQuota {
  /** Tracked-location cap; -1 = unlimited. */
  maxPrompts: number;
  used: number;
  planId: PlanId;
  planName: string;
}

export async function getLocationQuota(brandId: string): Promise<LocationQuota> {
  const supabase = await createClient();
  const { organizationId: orgId } = await getBrandContext(supabase, brandId);
  const [plan, usage] = await Promise.all([
    getOrgPlan(orgId),
    getOrgLocationUsage(supabase, orgId),
  ]);
  return {
    maxPrompts: plan.limits.maxPrompts,
    used: usage.total,
    planId: plan.id,
    planName: plan.name,
  };
}

interface AddPromptInput {
  promptSetId: string;
  text: string;
  category?: string;
  platforms: string[];
  models?: string[];
}

/**
 * Why a prompt wasn't added, when the person can do something about it: the
 * plan's prompt locations are full, or the brand has no topic to put it under.
 */
export type PromptAddFailureCode = 'plan_limit' | typeof NO_TOPICS;

export type AddPromptToSetResult =
  { prompt: Prompt } | { error: string; code?: PromptAddFailureCode };

/**
 * User-facing failures (plan limit, no topics, empty platform selection, DB
 * errors) come back as a VALUE: production masks every error thrown from a
 * server action, so a thrown PlanLimitError would reach users as the
 * meaningless digest message (#427). Prompts are grouped under topics, so a
 * brand without one gets `no_topics` and nothing is written.
 */
export async function addPromptToSet(input: AddPromptInput): Promise<AddPromptToSetResult> {
  await assertWritable();
  const supabase = await createClient();

  const { data: ps } = await supabase
    .from('prompt_sets')
    .select('brand_id')
    .eq('id', input.promptSetId)
    .single();

  if (!ps?.brand_id) return { error: 'Prompt set not found' };

  // A topic found by name means the brand has topics; only without one is it asked.
  const topicId = await resolveTopicId(supabase, ps.brand_id as string, input.category);
  if (!topicId && !(await brandHasTopics(supabase, ps.brand_id as string))) {
    return { error: NO_TOPICS_MESSAGE, code: NO_TOPICS };
  }

  const { organizationId: orgId, region: brandRegion } = await getBrandContext(
    supabase,
    ps.brand_id as string,
  );
  const plan = await getOrgPlan(orgId);

  // A new prompt starts at exactly one location (the brand's region), so the
  // change adds one to the org's tracked-location total (#691).
  const usage = await getOrgLocationUsage(supabase, orgId);
  const limitError = locationLimitMessage(plan, usage.total, 1);
  if (limitError) return { error: limitError, code: 'plan_limit' };
  const filtered = filterByPlan(plan, input.platforms, input.models ?? []);
  if (filtered.platforms.length === 0 && filtered.models.length === 0) {
    return { error: 'At least one platform or model must be selected.' };
  }

  // #155 — the brand's Shopping pref drives chatgpt-shopping BOTH ways: on
  // means every new prompt gets it appended automatically (the user doesn't
  // flip it per prompt), off means it's stripped even when inherited from a
  // picker default or a copied platform list.
  const { data: brandRow } = await supabase
    .from('brands')
    .select('shopping_mode_enabled')
    .eq('id', ps.brand_id as string)
    .single();
  const platforms = brandRow?.shopping_mode_enabled
    ? Array.from(new Set([...filtered.platforms, 'chatgpt-shopping']))
    : stripShoppingWhenDisabled(filtered.platforms, false);
  if (platforms.length === 0 && filtered.models.length === 0) {
    return { error: 'At least one platform or model must be selected.' };
  }

  const { data, error } = await supabase
    .from('prompts')
    .insert({
      prompt_set_id: input.promptSetId,
      text: input.text,
      category: input.category || null,
      topic_id: topicId,
      platforms,
      regions: [brandRegion],
      models: filtered.models,
      is_active: true,
    })
    .select()
    .single();

  if (error || !data) {
    return { error: error?.message ?? 'Failed to add prompt' };
  }

  revalidatePath('/dashboard/brands');
  return { prompt: mapPromptRow(data as Record<string, unknown>) };
}

export type AddPromptToBrandResult =
  { prompt: Prompt } | { error: string; code?: PromptAddFailureCode };

/**
 * Add a single prompt to a brand from the main Prompts page (#460). Same
 * write path as the brand page's Add Prompt card (addPromptToSet with the
 * caller's topic/platform/model choices); the brand's earliest prompt set is
 * the target, created on the fly when the brand has none yet.
 *
 * User-facing failures (plan limit, empty selection) come back as a VALUE:
 * production masks every error thrown from a server action, so a thrown
 * PlanLimitError would reach users as the meaningless digest message (#427).
 */
export async function addPromptToBrand(
  brandId: string,
  input: { text: string; category?: string; platforms: string[]; models?: string[] },
): Promise<AddPromptToBrandResult> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const trimmed = input.text.trim();
  if (!trimmed) return { error: 'Prompt text is required.' };
  if (input.platforms.length === 0 && (input.models ?? []).length === 0) {
    return { error: 'Select at least one platform or model.' };
  }

  const { data: ps, error: psErr } = await supabase
    .from('prompt_sets')
    .select('id')
    .eq('brand_id', brandId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (psErr) return { error: psErr.message };

  let promptSetId = ps?.id as string | undefined;
  if (!promptSetId) {
    const { data: createdSet, error: setErr } = await supabase
      .from('prompt_sets')
      .insert({ brand_id: brandId, name: 'Prompts' })
      .select('id')
      .single();
    if (setErr || !createdSet) {
      return { error: setErr?.message ?? 'Failed to create a prompt set for this brand.' };
    }
    promptSetId = createdSet.id as string;
  }

  const result = await addPromptToSet({
    promptSetId,
    text: trimmed,
    category: input.category,
    platforms: input.platforms,
    models: input.models ?? [],
  });
  if ('error' in result) return { error: result.error, code: result.code };

  revalidatePath('/dashboard/prompts');
  return { prompt: result.prompt };
}

export type SetPromptActiveResult = { prompt: Prompt } | { error: string; code?: 'plan_limit' };

type ResumeRow = {
  regions: unknown;
  is_active: boolean | null;
  prompt_sets: unknown;
};

/**
 * Whether the plan has room for these prompts to be active: the paused ones
 * among them bring all their locations back (activationDelta), so resuming is
 * measured like adding them. Null to allow, or the refusal as a value.
 */
async function resumeLimitError(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: ResumeRow[],
): Promise<{ error: string; code?: 'plan_limit' } | null> {
  const adding = activationDelta(
    rows.map((row) => ({
      isActive: row.is_active !== false,
      regions: row.regions as string[] | null,
    })),
  );
  if (adding <= 0) return null;
  const orgIds = new Set(
    rows.map(
      (row) =>
        (row.prompt_sets as { brands: { organization_id: string } } | null)?.brands
          ?.organization_id,
    ),
  );
  // One brand's prompts, so one organization's plan.
  const [orgId] = orgIds;
  if (orgIds.size !== 1 || !orgId) return { error: 'Prompt not found' };
  let limitError: string | null;
  try {
    const [plan, usage] = await Promise.all([
      getOrgPlan(orgId),
      getOrgLocationUsage(supabase, orgId),
    ]);
    limitError = locationLimitMessage(plan, usage.total, adding);
  } catch {
    return { error: "Couldn't check your plan's prompt limit. Please try again." };
  }
  return limitError ? { code: 'plan_limit', error: limitError } : null;
}

/**
 * Pause or resume one prompt — the only way a prompt's active state changes
 * after it is created. Pausing frees its locations on the plan (00128).
 * Resuming brings them all back (activationDelta), so it is measured like
 * adding them and refused when the plan has no room: pausing prompts,
 * filling their room with new ones and resuming the old ones can't get past
 * the limit. Errors come back as values (#427).
 */
export async function setPromptActive(
  id: string,
  isActive: boolean,
): Promise<SetPromptActiveResult> {
  await assertWritable();
  const supabase = await createClient();

  if (isActive) {
    const { data: row, error } = await supabase
      .from('prompts')
      .select('regions, is_active, prompt_sets!inner(brands!inner(organization_id))')
      .eq('id', id)
      .single();
    if (error || !row) return { error: 'Prompt not found' };
    const refused = await resumeLimitError(supabase, [row as ResumeRow]);
    if (refused) return refused;
  }

  const { data, error } = await supabase
    .from('prompts')
    .update({ is_active: isActive })
    .eq('id', id)
    .select()
    .single();
  if (error || !data) return { error: error?.message ?? 'Failed to update the prompt' };
  return { prompt: mapPromptRow(data as Record<string, unknown>) };
}

export interface ImportPromptRow {
  /** Index in the preview's importable list, echoed back for the imported ones. */
  idx: number;
  text: string;
  topic: string | null;
  /** The topic by its id, when the caller has it (Chat): never matched or made by name. */
  topicId?: string;
  platforms: string[];
  models: string[];
  regions: string[];
}

export type ImportPromptsResult =
  | { importedIdx: number[]; promptIds: string[]; analysisStarted: boolean }
  | { error: string; code?: typeof NO_TOPICS };

/**
 * Bulk import (PROMPT-005). The rows are the preview's importable ones, in
 * file order; they are checked again here (text, locations, duplicates, plan
 * engines) because the client is not trusted, then written by one locked
 * database call that stops at the plan's tracked-location cap
 * (import_prompts, 00122). New topics are created first, without touching the
 * brand's existing ones. The imported prompts are submitted for their first
 * run in one request. A brand with no topic yet gets `no_topics`.
 */
export async function importPrompts(
  brandId: string,
  rows: ImportPromptRow[],
): Promise<ImportPromptsResult> {
  await assertWritable({ brandId });
  if (rows.length === 0) return { importedIdx: [], promptIds: [], analysisStarted: false };
  if (rows.length > 1000) return { error: 'Import at most 1,000 prompts at a time.' };
  const supabase = await createClient();
  // Prompts are grouped under topics: a brand without one adds a topic first,
  // even when the file names topics of its own.
  if (!(await brandHasTopics(supabase, brandId))) {
    return { error: NO_TOPICS_MESSAGE, code: NO_TOPICS };
  }

  let promptSetId: string;
  {
    const { data: ps, error } = await supabase
      .from('prompt_sets')
      .select('id')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) return { error: error.message };
    if (ps?.id) promptSetId = ps.id as string;
    else {
      const { data: created, error: setErr } = await supabase
        .from('prompt_sets')
        .insert({ brand_id: brandId, name: 'Prompts' })
        .select('id')
        .single();
      if (setErr || !created) return { error: setErr?.message ?? 'Failed to create a prompt set.' };
      promptSetId = created.id as string;
    }
  }

  const { organizationId: orgId } = await getBrandContext(supabase, brandId);
  const [plan, { data: brandRow }, { data: existing }, { data: topicRows }] = await Promise.all([
    getOrgPlan(orgId),
    supabase.from('brands').select('shopping_mode_enabled').eq('id', brandId).single(),
    supabase
      .from('prompts')
      .select('text, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId),
    supabase.from('topics').select('id, name').eq('brand_id', brandId),
  ]);
  const shopping = !!brandRow?.shopping_mode_enabled;
  const keyOf = textKey;
  const seen = new Set((existing ?? []).map((p) => keyOf(p.text as string)));
  const topicIds = new Map((topicRows ?? []).map((t) => [keyOf(t.name as string), t.id as string]));

  const clean = rows.flatMap((r) => {
    const text = r.text.trim().replace(/\s+/g, ' ');
    if (!text || text.length > 500) return [];
    if (seen.has(keyOf(text))) return [];
    seen.add(keyOf(text));
    const regions = [...new Set(r.regions.map((c) => c.trim().toUpperCase()))].filter(
      isValidLocation,
    );
    if (regions.length === 0) return [];
    const filtered = filterByPlan(plan, r.platforms, r.models);
    const platforms = shopping
      ? Array.from(new Set([...filtered.platforms, 'chatgpt-shopping']))
      : stripShoppingWhenDisabled(filtered.platforms, false);
    if (platforms.length === 0 && filtered.models.length === 0) return [];
    return [{ ...r, text, regions, platforms, models: filtered.models }];
  });

  // New topics, once each, alongside the brand's existing ones.
  const newTopics = [
    ...new Map(
      clean
        .filter((r) => r.topic && !r.topicId && !topicIds.has(keyOf(r.topic)))
        .map((r) => [keyOf(r.topic!), r.topic!.trim().slice(0, 60)]),
    ).values(),
  ];
  if (newTopics.length) {
    const { data: created, error } = await supabase
      .from('topics')
      .insert(newTopics.map((name) => ({ brand_id: brandId, name, is_active: true })))
      .select('id, name');
    if (error) return { error: error.message };
    for (const t of created ?? []) topicIds.set(keyOf(t.name as string), t.id as string);
  }

  const { data: inserted, error } = await supabase.rpc('import_prompts', {
    p_prompt_set_id: promptSetId,
    p_organization_id: orgId,
    p_max_locations: plan.limits.maxPrompts,
    p_rows: clean.map((r) => ({
      idx: r.idx,
      text: r.text,
      category: r.topic?.trim() ?? '',
      topic_id: r.topicId ?? (r.topic ? (topicIds.get(keyOf(r.topic)) ?? '') : ''),
      platforms: r.platforms,
      models: r.models,
      regions: r.regions,
    })),
  });
  if (error) return { error: error.message };

  const imported = (inserted ?? []) as { idx: number; id: string }[];
  const promptIds = imported.map((r) => r.id);
  const { started } = await analyzeNewPrompts(brandId, promptIds);
  revalidatePath('/dashboard/prompts');
  return { importedIdx: imported.map((r) => r.idx), promptIds, analysisStarted: started };
}

export type AddTopicPromptsResult =
  | {
      ok: true;
      /** partial: some weren't added (CHAT-20 §11a), each with why. */
      code: 'ok' | 'partial';
      added: { id: string; text: string }[];
      skipped: { text: string; reason: 'duplicate' | 'plan_limit' | 'invalid' }[];
      analysisStarted: boolean;
    }
  | {
      ok: false;
      reason: 'forbidden_role' | 'not_found' | 'duplicate' | 'quota_exceeded' | 'failed';
      message: string;
    };

/** The ids of a brand's prompt sets: a prompt names its set, the set its brand. */
async function brandSetIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
): Promise<string[]> {
  const { data, error } = await supabase.from('prompt_sets').select('id').eq('brand_id', brandId);
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => row.id as string);
}

/**
 * Add prompts to one of a brand's topics: Chat's add_prompts (CHAT-20 §9
 * row 20). Admins and Managers, checked here (isManager). The topic comes
 * first: one of the brand's active topics, by its id (a new one is
 * add_topic's). Each prompt is tracked as the brand's newest active prompt
 * is (its platforms and models, else ChatGPT) at the brand's location,
 * through importPrompts: the same checks, the same locked write that stops
 * at the plan's locations, and the first run. A text the brand already
 * tracks is skipped (the natural key, §11c). Errors come back as values (#427).
 */
export async function addTopicPrompts(
  brandId: string,
  topicId: string,
  texts: string[],
): Promise<AddTopicPromptsResult> {
  try {
    await assertWritable({ brandId });
    return await addPromptsToTopic(brandId, topicId, texts);
  } catch (err) {
    console.error('Failed to add prompts from Chat:', err);
    return { ok: false, reason: 'failed', message: 'The prompts couldn’t be added. Try again.' };
  }
}

async function addPromptsToTopic(
  brandId: string,
  topicId: string,
  texts: string[],
): Promise<AddTopicPromptsResult> {
  const supabase = await createClient();
  if (!(await isManager(supabase))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can add prompts.',
    };
  }
  const { data: topic, error: topicError } = await supabase
    .from('topics')
    .select('id, name')
    .eq('id', topicId)
    .eq('brand_id', brandId)
    .eq('is_active', true)
    .maybeSingle();
  if (topicError) return { ok: false, reason: 'failed', message: topicError.message };
  if (!topic) {
    return {
      ok: false,
      reason: 'not_found',
      message: "That topic isn't one of this brand's topics. Add the topic first.",
    };
  }

  const sets = await brandSetIds(supabase, brandId);
  const [existingRead, latestRead] = sets.length
    ? await Promise.all([
        supabase.from('prompts').select('text').in('prompt_set_id', sets),
        supabase
          .from('prompts')
          .select('platforms, models')
          .in('prompt_set_id', sets)
          .eq('is_active', true)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ])
    : [
        { data: [], error: null },
        { data: null, error: null },
      ];
  const readError = existingRead.error ?? latestRead.error;
  if (readError) return { ok: false, reason: 'failed', message: readError.message };

  const { organizationId, region } = await getBrandContext(supabase, brandId);
  const latest = latestRead.data as { platforms?: unknown; models?: unknown } | null;
  const platforms =
    Array.isArray(latest?.platforms) && latest.platforms.length > 0
      ? (latest.platforms as string[])
      : ['chatgpt-web'];
  const models = Array.isArray(latest?.models) ? (latest.models as string[]) : [];
  const tracked = new Set(
    ((existingRead.data ?? []) as { text: string }[]).map((p) => textKey(p.text)),
  );
  const rows: ImportPromptRow[] = [];
  const skipped: Extract<AddTopicPromptsResult, { ok: true }>['skipped'] = [];
  for (const raw of texts) {
    const text = raw.trim().replace(/\s+/g, ' ');
    if (!text || text.length > 500) skipped.push({ text: raw, reason: 'invalid' });
    else if (tracked.has(textKey(text))) skipped.push({ text, reason: 'duplicate' });
    else {
      tracked.add(textKey(text));
      rows.push({
        idx: rows.length,
        text,
        // The topic by its id: a brand may have another, paused or not, of the same name.
        topic: topic.name as string,
        topicId: topic.id as string,
        platforms,
        models,
        regions: [region],
      });
    }
  }
  if (rows.length === 0) {
    return skipped.every((s) => s.reason === 'duplicate')
      ? { ok: false, reason: 'duplicate', message: 'The brand already tracks these prompts.' }
      : { ok: false, reason: 'failed', message: 'There was no prompt text to add.' };
  }

  const result = await importPrompts(brandId, rows);
  if ('error' in result) return { ok: false, reason: 'failed', message: result.error };
  const added = result.importedIdx.map((idx, i) => ({
    id: result.promptIds[i],
    text: rows[idx].text,
  }));
  const addedIdx = new Set(result.importedIdx);
  // What the locked write left out: the plan's locations ran out.
  for (const row of rows) {
    if (!addedIdx.has(row.idx)) skipped.push({ text: row.text, reason: 'plan_limit' });
  }
  if (added.length === 0) {
    const [plan, usage] = await Promise.all([
      getOrgPlan(organizationId),
      getOrgLocationUsage(supabase, organizationId),
    ]);
    return {
      ok: false,
      reason: 'quota_exceeded',
      message:
        locationLimitMessage(plan, usage.total, 1) ??
        "Your plan's prompt locations are used up, so no prompt was added.",
    };
  }
  return {
    ok: true,
    code: skipped.length > 0 ? 'partial' : 'ok',
    added,
    skipped,
    analysisStarted: result.analysisStarted,
  };
}

export type PauseBrandPromptsResult =
  | { ok: true; paused: string[] }
  | { ok: false; reason: 'forbidden_role' | 'not_found' | 'failed'; message: string };

/**
 * Pause some of a brand's prompts: Chat's pause_prompts (CHAT-20 §9 row 22,
 * its "archive": a paused prompt stops being tracked, frees its locations
 * and keeps its history). Admins and Managers, checked here. Only the
 * brand's prompts among the ids that are active now, as the table's bulk
 * Pause pauses them (pausing is never metered); the ones paused come back,
 * and none paused is a refusal. Errors come back as values (#427).
 */
export async function pauseBrandPrompts(
  brandId: string,
  ids: string[],
): Promise<PauseBrandPromptsResult> {
  try {
    await assertWritable({ brandId });
    return await pauseSomePrompts(brandId, ids);
  } catch (err) {
    console.error('Failed to pause prompts from Chat:', err);
    return { ok: false, reason: 'failed', message: 'The prompts couldn’t be paused. Try again.' };
  }
}

async function pauseSomePrompts(brandId: string, ids: string[]): Promise<PauseBrandPromptsResult> {
  const supabase = await createClient();
  if (!(await isManager(supabase))) {
    return {
      ok: false,
      reason: 'forbidden_role',
      message: 'Only an admin or a manager can pause prompts.',
    };
  }
  const sets = await brandSetIds(supabase, brandId);
  if (sets.length === 0) {
    return { ok: false, reason: 'not_found', message: "None of these prompts is this brand's." };
  }
  const { data, error } = await supabase
    .from('prompts')
    .update({ is_active: false })
    .in('prompt_set_id', sets)
    .in('id', ids)
    .eq('is_active', true)
    .select('id');
  if (error) return { ok: false, reason: 'failed', message: error.message };
  const paused = (data ?? []).map((row) => row.id as string);
  if (paused.length === 0) {
    return {
      ok: false,
      reason: 'not_found',
      message: "None of these prompts is one of this brand's active prompts.",
    };
  }
  revalidatePath('/dashboard/prompts');
  return { ok: true, paused };
}

export async function deletePrompt(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();

  const { error } = await supabase.from('prompts').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

export type SetPromptsActiveResult = { updated: number } | { error: string; code?: 'plan_limit' };

/**
 * Pause or resume several prompts in one write, from the prompts table's
 * bulk action bar (PROMPT-006). At most a page of rows; RLS keeps it to the
 * caller's prompts, so `updated` can be fewer than asked. Resuming is metered
 * as setPromptActive meters one: when the plan has no room for every paused
 * prompt's locations, nothing is written. Errors come back as values.
 */
export async function setPromptsActive(
  ids: string[],
  isActive: boolean,
): Promise<SetPromptsActiveResult> {
  await assertWritable();
  if (ids.length === 0) return { updated: 0 };
  const supabase = await createClient();

  if (isActive) {
    const { data: rows, error } = await supabase
      .from('prompts')
      .select('regions, is_active, prompt_sets!inner(brands!inner(organization_id))')
      .in('id', ids);
    if (error) return { error: error.message };
    const refused = await resumeLimitError(supabase, (rows ?? []) as ResumeRow[]);
    if (refused) return refused;
  }

  const { data, error } = await supabase
    .from('prompts')
    .update({ is_active: isActive })
    .in('id', ids)
    .select('id');
  if (error) return { error: error.message };
  return { updated: data?.length ?? 0 };
}

/**
 * Delete a few prompts and their history in one write, once the undo window
 * has passed (PROMPT-006). Each prompt's answers and citations go with it, so
 * a call takes at most PROMPT_DELETE_BATCH prompts and the page calls it in
 * turn (deleteInBatches); a whole page at once outran the statement timeout
 * on big brands. Returns the ids actually deleted: RLS quietly leaves out any
 * the caller can't delete. Errors come back as values.
 */
export async function deletePrompts(
  ids: string[],
): Promise<{ deletedIds: string[] } | { error: string }> {
  await assertWritable();
  if (ids.length === 0) return { deletedIds: [] };
  if (ids.length > PROMPT_DELETE_BATCH) {
    return { error: `At most ${PROMPT_DELETE_BATCH} prompts per call.` };
  }
  const supabase = await createClient();

  const { data, error } = await supabase.from('prompts').delete().in('id', ids).select('id');
  if (error) return { error: error.message };
  return { deletedIds: (data ?? []).map((row) => row.id as string) };
}

export async function deletePromptSet(id: string): Promise<void> {
  await assertWritable();
  const supabase = await createClient();

  const { error } = await supabase.from('prompt_sets').delete().eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/dashboard/brands');
}

export interface PromptsPageData {
  promptSets: PromptSet[];
  visibility: Record<string, PromptVisibilitySummary>;
  /** The Positions column per prompt id (PROMPT-007). */
  positions: Record<string, PromptPositionCell>;
  volumes: PromptVolume[];
  quota: VolumeQuota | null;
  /** True when the volumes upstream failed/timed out — the table still renders. */
  volumesDegraded: boolean;
  /** True when the visibility summaries failed/timed out — their columns read —. */
  visibilityDegraded: boolean;
}

/**
 * One consolidated server action for the Prompts page's first load.
 *
 * Next.js runs server actions sequentially — each is its own queued POST — so
 * the page's old three separate calls (volumes + prompt sets + visibility)
 * cost roughly their SUM on a cold load, with the suggestions card queued
 * behind them (the #313 lesson from Insights). This runs them in a real
 * server-side Promise.all: one round trip, genuinely parallel.
 *
 * Volumes come from the aeo-server and are the least reliable dependency, so
 * their failure degrades to an empty list instead of blanking the prompt
 * table — the page's core content must never be hostage to the volumes API.
 */
export async function getPromptsPageData(
  brandId: string,
  opts?: { days?: number; from?: string; to?: string; region?: string },
): Promise<PromptsPageData> {
  // Only the visibility summaries are window- and location-scoped. Prompt
  // sets are the roster itself, and volumes are keyword-level estimates with
  // no date dimension, so neither changes with the selected range or the
  // selected location.
  const days = opts?.days ?? DEFAULT_PROMPT_RANGE_DAYS;
  const window = {
    from: opts?.from ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    to: opts?.to,
  };
  // The plan-limit numbers aren't here: the usage cards read them from
  // GET /api/prompts/usage, which reads counters instead of counting prompts.
  const [promptSets, visibility, positionRows, volumesResult] = await Promise.all([
    getPromptSets(brandId),
    // The visibility columns scan the window's answers too: a timeout shows —
    // in them, with a note, rather than blanking the table as if the brand
    // had no prompts.
    getPromptVisibilitySummaries(brandId, {
      days,
      from: opts?.from,
      to: opts?.to,
      region: opts?.region,
    }).then(
      (summaries) => ({ summaries, degraded: false }),
      (err) => {
        console.error('[prompts] visibility summaries fetch failed, rendering without them:', err);
        return { summaries: {} as Record<string, PromptVisibilitySummary>, degraded: true };
      },
    ),
    // The Positions column scans every answer in the window and the one
    // before it. A timeout shows — in that column instead of failing the
    // table; the web deploying before 00153 falls back to 00123's rows.
    getPositionRows(brandId, window, opts?.region).catch((err) => {
      console.error('[prompts] position summaries fetch failed, rendering without them:', err);
      return noPositionRows();
    }),
    getPromptVolumes(brandId).then(
      (r) => ({ volumes: r.volumes, quota: r.quota ?? null, degraded: false }),
      (err) => {
        console.error('[prompts] volumes fetch failed, rendering without them:', err);
        return { volumes: [] as PromptVolume[], quota: null, degraded: true };
      },
    ),
  ]);

  const positions: Record<string, PromptPositionCell> = {};
  for (const prompt of promptSets.flatMap((ps) => ps.prompts)) {
    const current = positionRows.current.get(prompt.id) ?? [];
    // A dot for every included engine the prompt tracks, plus any it has
    // answers from in the window, so the dots and the average agree.
    const platforms = positionRows.included.filter(
      (p) =>
        prompt.platforms.includes(p.id as AIPlatform) || current.some((r) => r.platform === p.id),
    );
    positions[prompt.id] = buildPositionCell(
      current,
      positionRows.previous.get(prompt.id) ?? [],
      platforms,
    );
  }

  return {
    promptSets,
    visibility: visibility.summaries,
    positions,
    volumes: volumesResult.volumes,
    quota: volumesResult.quota,
    volumesDegraded: volumesResult.degraded,
    visibilityDegraded: visibility.degraded,
  };
}

interface PositionRows {
  included: { id: string; label: string }[];
  current: Map<string, PlatformPositionRow[]>;
  previous: Map<string, PlatformPositionRow[]>;
}

/** No position data: every prompt's Positions cell reads —. */
function noPositionRows(): PositionRows {
  return { included: [], current: new Map(), previous: new Map() };
}

/**
 * Per-prompt, per-engine position sums for the Positions column: the window
 * on screen and the period of the same length just before it, for the trend.
 * Only engines the brand's plan includes count (the org's, Growth's on the
 * demo brand), as in the Positions panel.
 */
async function getPositionRows(
  brandId: string,
  window: { from: string; to?: string },
  region?: string,
): Promise<PositionRows> {
  const before = previousWindow(window);
  const [included, current, previous] = await Promise.all([
    includedPositionPlatforms(brandId),
    positionSums(brandId, window, region),
    positionSums(brandId, before, region),
  ]);
  if (!included) return noPositionRows();
  return { included, current, previous };
}

/**
 * The engines the brand's plan includes (the org's, Growth's on the demo
 * brand), as the Positions panel counts them; null without a brand.
 */
async function includedPositionPlatforms(
  brandId: string,
): Promise<{ id: string; label: string }[] | null> {
  // dbClient: the member's session, or the service role the MCP's
  // get_prompt_locations scopes it with (withDbClient), the brand checked.
  const supabase = await dbClient();
  const { data: brand, error } = await supabase
    .from('brands')
    .select(
      `organization_id, is_demo, organizations!brands_organization_id_fkey(${ORG_PLAN_COLUMNS})`,
    )
    .eq('id', brandId)
    .maybeSingle();
  // The column then reads —: said here, so a broken read doesn't pass for no data.
  if (error)
    console.error('[prompts] brand plan read failed, positions without engines:', error.message);
  if (!brand?.organization_id) return null;
  const org = Array.isArray(brand.organizations) ? brand.organizations[0] : brand.organizations;
  const plan = effectivePlanForBrand(planFromOrgRow(org ?? null), brand.is_demo === true);
  return POSITION_PLATFORMS.filter((p) => platformAccess(plan, p.id).state === 'included').map(
    (p) => ({ id: p.id as string, label: p.label as string }),
  );
}

/**
 * Each tracked prompt's figures in each of `regions` (PROMPT-015b): the
 * same reads the table uses for one location, once per location, side by
 * side, so a location's column equals the table filtered to it. Keyed by
 * prompt id, then location code; a prompt with no answers in a location
 * has no cell there.
 */
export async function getPromptLocationMatrix(
  brandId: string,
  opts: { days?: number; from?: string; to?: string; regions: string[] },
): Promise<Record<string, Record<string, PromptLocationCell>>> {
  const regions = [...new Set(opts.regions.filter(isValidLocation))].slice(0, MATRIX_REGIONS);
  if (!z.guid().safeParse(brandId).success) throw new Error('invalid');
  const days = opts.days ?? DEFAULT_PROMPT_RANGE_DAYS;
  const window = {
    from: opts.from ?? new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
    to: opts.to,
  };
  // One round of reads, but at most MATRIX_READS_AT_ONCE of the heavy ones
  // (two per location) at a time: twelve locations at once squeezed the
  // database.
  const limit = createLimiter(MATRIX_READS_AT_ONCE);
  const [platforms, reads] = await Promise.all([
    includedPositionPlatforms(brandId),
    Promise.all(
      regions.map((region) =>
        Promise.all([
          limit(() =>
            getPromptVisibilitySummaries(brandId, { days, from: opts.from, to: opts.to, region }),
          ),
          limit(() => positionSums(brandId, window, region)).catch((err) => {
            console.error('[prompts] location position sums failed:', err);
            return new Map<string, PlatformPositionRow[]>();
          }),
        ]),
      ),
    ),
  ]);
  const included = platforms ?? [];
  const cells: Record<string, Record<string, PromptLocationCell>> = {};
  regions.forEach((region, i) => {
    const [visibility, positions] = reads[i];
    for (const [promptId, vis] of Object.entries(visibility)) {
      (cells[promptId] ??= {})[region] = {
        score: vis.score,
        mentions: vis.totalMentions,
        citations: vis.totalCitations,
        position: buildPositionCell(positions.get(promptId) ?? [], [], included).avg,
        runs: vis.runs,
      };
    }
  });
  return cells;
}

/** A prompt and platform's sums, as prompt_position_summaries_json (00153) returns them. */
interface PositionSummaryRow {
  prompt_id: string;
  platform: string;
  runs: number;
  mention_answers: number;
  position_sum: number;
  position_count: number;
  entity_sum: number;
  entity_count: number;
}

async function positionSums(
  brandId: string,
  window: { from: string; to?: string },
  region?: string,
): Promise<Map<string, PlatformPositionRow[]>> {
  const supabase = await dbClient();
  // One jsonb array (00153). A busy brand's 30 or 90 days come to thousands
  // of prompt × platform rows, past PostgREST's 1000-row cap, which dropped
  // the rest and left most prompts reading —; a single value isn't cut, so
  // one call reads them all at the aggregate's own cost.
  const { data, error } = await supabase.rpc('prompt_position_summaries_json', {
    p_brand_id: brandId,
    p_date_from: window.from,
    p_date_to: window.to ?? undefined,
    p_region: region ?? undefined,
  });
  let rows: PositionSummaryRow[];
  if (error?.code === 'PGRST202') {
    // The web deployed before 00153 was applied: 00123's rows, as before,
    // which only a brand past 1000 prompt × platform rows loses any of.
    const legacy = await supabase.rpc('prompt_position_summaries', {
      p_brand_id: brandId,
      p_date_from: window.from,
      p_date_to: window.to ?? undefined,
      p_region: region ?? undefined,
    });
    if (legacy.error) throw new Error(legacy.error.message);
    rows = legacy.data ?? [];
  } else if (error) {
    throw new Error(error.message);
  } else {
    // Null when the caller isn't a member of the brand's organization.
    rows = (data ?? []) as unknown as PositionSummaryRow[];
  }

  const byPrompt = new Map<string, PlatformPositionRow[]>();
  for (const row of rows) {
    const list = byPrompt.get(row.prompt_id) ?? [];
    list.push({
      platform: row.platform,
      runs: Number(row.runs ?? 0),
      mentionAnswers: Number(row.mention_answers ?? 0),
      positionSum: Number(row.position_sum ?? 0),
      positionCount: Number(row.position_count ?? 0),
      entitySum: Number(row.entity_sum ?? 0),
      entityCount: Number(row.entity_count ?? 0),
    });
    byPrompt.set(row.prompt_id, list);
  }
  return byPrompt;
}

/** How many prompts the brand tracks — the count beside Tracked Prompts in the sidebar (PROMPT-001). */
export async function getTrackedPromptCount(brandId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('prompts')
    .select('id, prompt_sets!inner(brand_id)', { count: 'exact', head: true })
    .eq('prompt_sets.brand_id', brandId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
