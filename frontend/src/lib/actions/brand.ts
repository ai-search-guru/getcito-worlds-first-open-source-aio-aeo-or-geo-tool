'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { getOrgPlan } from '@/lib/guards/planGuard';
import { isWithinLimit } from '@/config/plans';
import { slugify } from '@/lib/slug';
import { API_BASE_URL } from '@/config/api';
import type { Brand, BrandDomain, Industry } from '@/types';
import { MAX_PINNED_COMPETITORS } from '@/lib/insightsTrend';
import { isSiteType, type SiteType } from '@/lib/content/pageTypes';
import { isConversionsConsent, type ConversionsConsent } from '@/lib/conversionTracking';
import { assertWritable } from '@/lib/subscriptionGuard';
import { countPlanBrands } from '@/lib/planBrandCount';

function mapDomainRow(d: Record<string, unknown>): BrandDomain {
  return {
    id: d.id as string,
    brandId: d.brand_id as string,
    domain: d.domain as string,
    country: (d.country as string | null) ?? undefined,
    isPrimary: d.is_primary as boolean,
  };
}

function mapBrandRow(brand: Record<string, unknown>, domains: Record<string, unknown>[]): Brand {
  return {
    id: brand.id as string,
    organizationId: brand.organization_id as string,
    name: brand.name as string,
    slug: brand.slug as string,
    logoUrl: (brand.logo_url as string | null) ?? undefined,
    industry: (brand.industry as string | null) ?? undefined,
    description: (brand.description as string | null) ?? undefined,
    region: (brand.region as string | null) ?? undefined,
    state: (brand.state as string | null) ?? undefined,
    language: (brand.language as string | null) ?? undefined,
    trackingCode: (brand.tracking_code as string | null) ?? undefined,
    shoppingModeEnabled: !!brand.shopping_mode_enabled,
    siteType: (brand.site_type as string | null) ?? undefined,
    siteTypeSource:
      brand.site_type_source === 'auto' || brand.site_type_source === 'manual'
        ? brand.site_type_source
        : undefined,
    conversionsEnabled: brand.conversions_enabled === true,
    conversionsConsent: brand.conversions_consent === 'always' ? 'always' : 'wait',
    isActive: brand.is_active === undefined ? true : !!brand.is_active,
    isDemo: brand.is_demo === true,
    demoHiddenAt: (brand.demo_hidden_at as string | null | undefined) ?? null,
    domains: domains.map(mapDomainRow),
    createdAt: brand.created_at as string,
    updatedAt: brand.updated_at as string,
  };
}

export async function getBrands(organizationId: string): Promise<Brand[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('brands')
    .select('*, brand_domains(*)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false });

  if (error) throw new Error(error.message);

  return (data ?? []).map((b) =>
    mapBrandRow(b as Record<string, unknown>, (b.brand_domains as Record<string, unknown>[]) ?? []),
  );
}

export async function getBrandById(id: string): Promise<Brand | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('brands')
    .select('*, brand_domains(*)')
    .eq('id', id)
    .single();

  if (error || !data) return null;

  return mapBrandRow(
    data as Record<string, unknown>,
    (data.brand_domains as Record<string, unknown>[]) ?? [],
  );
}

interface CreateBrandInput {
  organizationId: string;
  name: string;
  logoUrl?: string;
  industry?: string;
  description?: string;
  region?: string;
  state?: string;
  language?: string;
  domains: { domain: string; country?: string; isPrimary: boolean }[];
}

export type CreateBrandResult = { brand: Brand } | { error: string; code: 'plan_limit' };

/**
 * The plan limit comes back as a VALUE: production masks every error thrown
 * from a server action, so a thrown PlanLimitError reached users as the
 * meaningless digest message (same as #427 for prompts).
 */
export async function createBrand(input: CreateBrandInput): Promise<CreateBrandResult> {
  await assertWritable({ onboarding: true });
  const supabase = await createClient();

  // Every brand of the organization, whatever this person sees (00390); the
  // demo brand (00380) never counts against the plan.
  const count = await countPlanBrands(supabase, input.organizationId);

  const plan = await getOrgPlan(input.organizationId);
  if (!isWithinLimit(plan, 'maxBrands', count)) {
    const max = plan.limits.maxBrands;
    return {
      code: 'plan_limit',
      error: `Your plan includes ${max} brand${max === 1 ? '' : 's'}. Upgrade your plan to add more.`,
    };
  }

  const slug = slugify(input.name) || `brand-${Date.now()}`;

  // The id is chosen here and the row is read back after the insert, never
  // with `insert … returning`: that checks the select policy before the row
  // is stored, and a Selected-brands person (00388/00389) only sees the brand
  // once the creator grant, which runs after the insert, has shared it.
  const brandId = crypto.randomUUID();
  const { error: insertError } = await supabase.from('brands').insert({
    id: brandId,
    organization_id: input.organizationId,
    name: input.name.trim(),
    slug,
    logo_url: input.logoUrl || null,
    industry: input.industry || null,
    description: input.description || null,
    region: input.region || 'US',
    // State only makes sense for US brands; drop it silently otherwise so
    // a stale value from a region switch can't leak into the row.
    state: (input.region || 'US') === 'US' ? input.state || null : null,
    language: input.language || 'en',
  });

  if (insertError) throw new Error(insertError.message);

  const { data: brand, error } = await supabase
    .from('brands')
    .select('*')
    .eq('id', brandId)
    .single();

  if (error || !brand) throw new Error(error?.message ?? 'Failed to create brand');

  let insertedDomains: Record<string, unknown>[] = [];

  if (input.domains.length > 0) {
    const { data: domains, error: domainError } = await supabase
      .from('brand_domains')
      .insert(
        input.domains.map((d) => ({
          brand_id: brand.id,
          domain: d.domain.trim(),
          country: d.country?.trim() || null,
          is_primary: d.isPrimary,
        })),
      )
      .select();

    if (domainError) throw new Error(domainError.message);
    insertedDomains = (domains as Record<string, unknown>[]) ?? [];
  }

  revalidatePath('/dashboard/brands');
  return { brand: mapBrandRow(brand as Record<string, unknown>, insertedDomains) };
}

interface UpdateBrandInput {
  name?: string;
  logoUrl?: string | null;
  industry?: string | null;
  description?: string | null;
  region?: string;
  state?: string | null;
  language?: string;
  /** The kind of site, for the Content Editor's page types (CE-023). */
  siteType?: SiteType | null;
  /** Conversions from AI visits (CE-017): on or off, and the snippet's consent mode. */
  conversionsEnabled?: boolean;
  conversionsConsent?: ConversionsConsent;
}

export async function updateBrand(id: string, updates: UpdateBrandInput): Promise<Brand> {
  await assertWritable({ brandId: id });
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (updates.name !== undefined) {
    payload.name = updates.name.trim();
    payload.slug = slugify(updates.name) || `brand-${Date.now()}`;
  }
  if ('logoUrl' in updates) payload.logo_url = updates.logoUrl ?? null;
  if ('industry' in updates) payload.industry = updates.industry ?? null;
  if ('description' in updates) payload.description = updates.description ?? null;
  if (updates.region !== undefined) payload.region = updates.region;
  if ('state' in updates) payload.state = updates.state ?? null;
  // A region change away from US invalidates any stored state.
  if (updates.region !== undefined && updates.region !== 'US') payload.state = null;
  if (updates.language !== undefined) payload.language = updates.language;
  if ('siteType' in updates) {
    if (updates.siteType != null && !isSiteType(updates.siteType)) {
      throw new Error('Unknown site type');
    }
    payload.site_type = updates.siteType ?? null;
  }
  if (updates.conversionsEnabled !== undefined) {
    payload.conversions_enabled = updates.conversionsEnabled === true;
  }
  if (updates.conversionsConsent !== undefined) {
    if (!isConversionsConsent(updates.conversionsConsent)) throw new Error('Unknown consent mode');
    payload.conversions_consent = updates.conversionsConsent;
  }

  const { data, error } = await supabase
    .from('brands')
    .update(payload)
    .eq('id', id)
    .select('*, brand_domains(*)')
    .single();

  if (error || !data) throw new Error(error?.message ?? 'Failed to update brand');

  revalidatePath('/dashboard/brands');
  return mapBrandRow(
    data as Record<string, unknown>,
    (data.brand_domains as Record<string, unknown>[]) ?? [],
  );
}

/**
 * Deletes a brand through the server, which removes its answers in batches
 * before the brand row: in one statement, a brand of any size outran the
 * database's 8-second limit for signed-in requests and was never deleted.
 *
 * `pending` means the server is still deleting a large brand; it finishes on
 * its own within minutes. Failures are returned rather than thrown, since a
 * thrown server-action error reaches the browser without its message.
 */
export async function deleteBrand(
  id: string,
): Promise<{ deleted: boolean; pending?: boolean } | { error: string }> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) return { error: 'Not authenticated' };

  const res = await fetch(`${API_BASE_URL}/api/brands/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const body = (await res.json().catch(() => ({}))) as {
    deleted?: boolean;
    pending?: boolean;
    error?: string;
  };
  if (!res.ok) return { error: body.error || 'Failed to delete the brand.' };

  revalidatePath('/dashboard/brands');
  return { deleted: Boolean(body.deleted), pending: Boolean(body.pending) };
}

/**
 * Toggle a brand's Shopping mode (#155).
 *
 * On `true`:
 *   - Set `brands.shopping_mode_enabled = true`
 *   - Add `chatgpt-shopping` to every prompt's `platforms` array (deduped)
 *   - Insert the `chatgpt-shopping` row into `brand_platforms` (idempotent)
 *     so the next tracking cycle picks it up alongside the prompt change.
 *
 * On `false`:
 *   - Set `brands.shopping_mode_enabled = false`
 *   - Leave existing prompt platforms and `brand_platforms` rows in place
 *     — historical opt-ins stay queryable, and any further per-prompt
 *     surgery is the operator's call.
 */
export async function setBrandShoppingMode(
  brandId: string,
  enabled: boolean,
): Promise<{ promptsUpdated: number }> {
  await assertWritable({ brandId });
  return applyShoppingMode(await createClient(), brandId, enabled);
}

/**
 * setBrandShoppingMode's writes, without its plan check: markBrandAsEcommerce
 * runs them in setup, where an organization that never subscribed may write.
 */
async function applyShoppingMode(
  supabase: Awaited<ReturnType<typeof createClient>>,
  brandId: string,
  enabled: boolean,
): Promise<{ promptsUpdated: number }> {
  // RLS gates this — the calling user must already have write access to
  // the brand via their org membership. The updated row comes back, as in
  // setBrandActive, so a write RLS denied (an analyst) fails instead of
  // reporting success, and nothing below runs.
  const { data: updated, error: updateErr } = await supabase
    .from('brands')
    .update({ shopping_mode_enabled: enabled })
    .eq('id', brandId)
    .select('id');
  if (updateErr) throw new Error(updateErr.message);
  if (!updated || updated.length === 0) {
    throw new Error('Brand not found or you do not have permission to update it.');
  }

  let promptsUpdated = 0;

  if (enabled) {
    // Pull every prompt under this brand. Prompts hang off prompt_sets
    // which hang off brands — one join via the !inner foreign key.
    const { data: rows, error: readErr } = await supabase
      .from('prompts')
      .select('id, platforms, prompt_sets!inner(brand_id)')
      .eq('prompt_sets.brand_id', brandId);
    if (readErr) throw new Error(readErr.message);

    const needsUpdate = (rows ?? []).filter((r) => {
      const platforms = ((r as { platforms: string[] | null }).platforms ?? []) as string[];
      return !platforms.includes('chatgpt-shopping');
    });

    for (const row of needsUpdate) {
      const existing = ((row as { platforms: string[] | null }).platforms ?? []) as string[];
      const next = [...existing, 'chatgpt-shopping'];
      const { data: written, error: writeErr } = await supabase
        .from('prompts')
        .update({ platforms: next })
        .eq('id', (row as { id: string }).id)
        .select('id');
      if (writeErr || !written?.length) {
        // Best-effort: log and continue. If a few prompts fail to update
        // (RLS oddity, race), the operator can toggle off+on or hit the
        // per-prompt platforms picker. Don't half-roll-back the brand flag.
        console.error('[shopping-mode] prompt update failed:', writeErr?.message ?? 'no row');
        continue;
      }
      promptsUpdated += 1;
    }

    // Also surface chatgpt-shopping at the brand-platforms layer so the
    // tracking worker actually fires the scraper. Idempotent.
    const { error: bpErr } = await supabase
      .from('brand_platforms')
      .upsert(
        { brand_id: brandId, platform: 'chatgpt-shopping', is_enabled: true },
        { onConflict: 'brand_id,platform', ignoreDuplicates: true },
      );
    if (bpErr) {
      console.error('[shopping-mode] brand_platforms upsert failed:', bpErr.message);
    }
  }

  revalidatePath('/dashboard/brands');
  return { promptsUpdated };
}

/** Postgres' code for a column that doesn't exist (here: 00379 not applied). */
const UNDEFINED_COLUMN = '42703';

/**
 * Setup found the brand sells products online (competitor research's
 * isEcommerce): its site type becomes e-commerce, as a detection, unless a
 * person chose one (00379); its industry becomes E-commerce & Retail when it
 * has none; and Shopping mode goes on, so Product Visibility shows in the
 * menu. A brand already in Shopping mode keeps its industry and mode.
 * `siteType` is the type written, null when it was left as it was.
 */
export async function markBrandAsEcommerce(
  brandId: string,
): Promise<{ industry: string | null; promptsUpdated: number; siteType: SiteType | null }> {
  await assertWritable({ onboarding: true, brandId });
  const supabase = await createClient();
  const read = await supabase
    .from('brands')
    .select('industry, shopping_mode_enabled, site_type, site_type_source')
    .eq('id', brandId)
    .single();
  // 00379 not applied yet (a deploy ahead of its migration): Shopping mode
  // still goes on; the site type is left for detection once it is.
  const typeKnown = read.error?.code !== UNDEFINED_COLUMN;
  const { data: brand, error } = typeKnown
    ? read
    : await supabase
        .from('brands')
        .select('industry, shopping_mode_enabled, site_type')
        .eq('id', brandId)
        .single();
  if (error || !brand) throw new Error(error?.message ?? 'Brand not found');

  let siteType: SiteType | null = null;
  const source = 'site_type_source' in brand ? brand.site_type_source : null;
  if (typeKnown && source !== 'manual' && brand.site_type !== 'ecommerce') {
    // Stamped as a detection, so the trigger keeps it auto.
    const { data: typed, error: typeErr } = await supabase
      .from('brands')
      .update({ site_type: 'ecommerce', site_type_detected_at: new Date().toISOString() })
      .eq('id', brandId)
      .select('id');
    if (typeErr && typeErr.code !== UNDEFINED_COLUMN) throw new Error(typeErr.message);
    if (!typeErr && (!typed || typed.length === 0)) {
      throw new Error('Brand not found or you do not have permission to update it.');
    }
    if (!typeErr) siteType = 'ecommerce';
  }

  if (brand.shopping_mode_enabled) {
    return { industry: brand.industry ?? null, promptsUpdated: 0, siteType };
  }

  let industry: string | null = brand.industry ?? null;
  if (!industry) {
    const ecommerce: Industry = 'E-commerce & Retail';
    const { data: updated, error: updateErr } = await supabase
      .from('brands')
      .update({ industry: ecommerce })
      .eq('id', brandId)
      .select('id');
    if (updateErr) throw new Error(updateErr.message);
    if (!updated || updated.length === 0) {
      throw new Error('Brand not found or you do not have permission to update it.');
    }
    industry = ecommerce;
  }
  const { promptsUpdated } = await applyShoppingMode(supabase, brandId, true);
  return { industry, promptsUpdated, siteType };
}

/**
 * Pause / resume a brand (#286).
 *
 * Sets `brands.is_active`. When `false`, the daily tracking cron skips the
 * brand (`runDailyTracking` filters on `is_active = true`) and the on-demand
 * tracking endpoints reject it — so a paused brand stops all Cloro / LLM spend
 * while keeping its historical data fully viewable. Resuming flips it back and
 * the next cron run picks tracking up again.
 *
 * RLS gates this — the calling user must already have write access to the
 * brand via their org membership.
 */
export async function setBrandActive(brandId: string, isActive: boolean): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();

  // Return the updated row so a no-op (invalid id, or RLS silently denying the
  // write) surfaces as an error instead of a false success — `update().eq()`
  // without `select()` does not error on a 0-row match.
  const { data, error } = await supabase
    .from('brands')
    .update({ is_active: isActive })
    .eq('id', brandId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('Brand not found or you do not have permission to update it.');
  }

  revalidatePath('/dashboard/brands');
}

/**
 * Pin competitors on the Insights visibility trend (VIS-007): saved on the
 * brand, in pin order, so the whole team sees the same lines whatever the
 * range. At most MAX_PINNED_COMPETITORS; ids that aren't this brand's
 * competitors are dropped. Returns what was saved.
 *
 * RLS gates the write like every brand setting: admins and managers only.
 */
export async function setPinnedCompetitors(
  brandId: string,
  competitorIds: string[],
): Promise<string[]> {
  await assertWritable({ brandId });
  if (!Array.isArray(competitorIds) || competitorIds.some((id) => typeof id !== 'string')) {
    throw new Error('Pinned competitors must be a list of competitor ids.');
  }
  const supabase = await createClient();
  const wanted = [...new Set(competitorIds)];

  const { data: owned, error: ownedError } = wanted.length
    ? await supabase.from('competitors').select('id').eq('brand_id', brandId).in('id', wanted)
    : { data: [], error: null };
  if (ownedError) throw new Error(ownedError.message);
  const ownedIds = new Set((owned ?? []).map((c) => c.id));
  const pinned = wanted.filter((id) => ownedIds.has(id)).slice(0, MAX_PINNED_COMPETITORS);

  // Return the updated row so RLS silently denying the write surfaces as an
  // error, as in setBrandActive.
  const { data, error } = await supabase
    .from('brands')
    .update({ insights_pinned_competitors: pinned })
    .eq('id', brandId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data || data.length === 0) {
    throw new Error('Brand not found or you do not have permission to update it.');
  }
  return pinned;
}

export interface BrandCardSummary {
  brandId: string;
  visibility7d: number;
  visibilityDelta: number;
  mentions7d: number;
  promptCount: number;
  trafficVisits7d: number;
  trend: number[];
  status: 'healthy' | 'declining' | 'no-prompts' | 'no-data';
}

export async function getBrandsCardSummary(
  brandIds: string[],
): Promise<Record<string, BrandCardSummary>> {
  if (brandIds.length === 0) return {};
  const supabase = await createClient();

  const now = Date.now();
  const since14d = new Date(now - 14 * 86400000).toISOString();

  const [resultsResp, promptsResp, trafficResp] = await Promise.all([
    supabase
      .from('prompt_results')
      .select('brand_id, visibility_score, mention_count, created_at')
      .in('brand_id', brandIds)
      .gte('created_at', since14d),
    supabase
      .from('prompts')
      .select('id, prompt_sets!inner(brand_id)')
      .in('prompt_sets.brand_id', brandIds)
      .eq('is_active', true),
    // Visits, not pageviews (00172), as the AI Traffic page counts them.
    supabase
      .from('ai_traffic_logs')
      .select('brand_id, created_at')
      .in('brand_id', brandIds)
      .is('visit_of', null)
      .gte('created_at', new Date(now - 7 * 86400000).toISOString()),
  ]);

  const results = resultsResp.data ?? [];
  const prompts = promptsResp.data ?? [];
  const traffic = trafficResp.data ?? [];

  const summary: Record<string, BrandCardSummary> = {};
  for (const id of brandIds) {
    summary[id] = {
      brandId: id,
      visibility7d: 0,
      visibilityDelta: 0,
      mentions7d: 0,
      promptCount: 0,
      trafficVisits7d: 0,
      trend: Array.from({ length: 7 }, () => 0),
      status: 'no-prompts',
    };
  }

  // Prompt counts
  for (const row of prompts) {
    const brandId = (row.prompt_sets as { brand_id?: string } | null)?.brand_id;
    if (brandId && summary[brandId]) summary[brandId].promptCount += 1;
  }

  // Traffic visits (last 7d)
  for (const row of traffic) {
    const bid = row.brand_id as string;
    if (summary[bid]) summary[bid].trafficVisits7d += 1;
  }

  // Visibility + mentions split into current 7d / previous 7d
  const cutoff = now - 7 * 86400000;
  type Bucket = { count: number; sum: number; mentions: number };
  const buckets: Record<string, { current: Bucket; prev: Bucket }> = {};
  const dailyByBrand: Record<string, Record<string, Bucket>> = {};

  for (const id of brandIds) {
    buckets[id] = {
      current: { count: 0, sum: 0, mentions: 0 },
      prev: { count: 0, sum: 0, mentions: 0 },
    };
    dailyByBrand[id] = {};
  }

  for (const row of results) {
    const bid = row.brand_id as string;
    if (!buckets[bid]) continue;
    const ts = new Date(row.created_at as string).getTime();
    const score = Number(row.visibility_score) || 0;
    const mentions = Number(row.mention_count) || 0;
    if (ts >= cutoff) {
      buckets[bid].current.count += 1;
      buckets[bid].current.sum += score;
      buckets[bid].current.mentions += mentions > 0 ? 1 : 0;

      const dayKey = (row.created_at as string).slice(0, 10);
      const day = dailyByBrand[bid][dayKey] ?? {
        count: 0,
        sum: 0,
        mentions: 0,
      };
      day.count += 1;
      day.sum += score;
      dailyByBrand[bid][dayKey] = day;
    } else {
      buckets[bid].prev.count += 1;
      buckets[bid].prev.sum += score;
      buckets[bid].prev.mentions += mentions > 0 ? 1 : 0;
    }
  }

  // Build 7-day trend array per brand (oldest → newest)
  const dayKeys = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(now - (6 - i) * 86400000);
    return d.toISOString().slice(0, 10);
  });

  for (const id of brandIds) {
    const b = buckets[id];
    const cur = b.current.count > 0 ? b.current.sum / b.current.count : 0;
    const prev = b.prev.count > 0 ? b.prev.sum / b.prev.count : 0;
    summary[id].visibility7d = Math.round(cur);
    summary[id].visibilityDelta = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : 0;
    summary[id].mentions7d = b.current.mentions;
    summary[id].trend = dayKeys.map((k) => {
      const d = dailyByBrand[id][k];
      return d && d.count > 0 ? Math.round(d.sum / d.count) : 0;
    });

    if (summary[id].promptCount === 0) {
      summary[id].status = 'no-prompts';
    } else if (b.current.count === 0) {
      summary[id].status = 'no-data';
    } else if (summary[id].visibilityDelta < -10) {
      summary[id].status = 'declining';
    } else {
      summary[id].status = 'healthy';
    }
  }

  return summary;
}
