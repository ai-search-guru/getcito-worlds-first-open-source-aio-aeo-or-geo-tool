'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { assertWritable } from '@/lib/subscriptionGuard';
import { MAX_TRUSTED_SOURCES, trustedHost } from '@/lib/content/trustedSources';
import { brandRulesValid } from '@/lib/content/brandRules';

/** Settings › Content: a brand's Content Editor settings. */
export interface ContentSettings {
  brands: {
    id: string;
    name: string;
    qualityHandoff: boolean;
    trustedSources: string[];
    brandRules: string[];
  }[];
  /** Admins and managers change them (brands: admin/manager update). */
  canManage: boolean;
  /** The database has brands.trusted_sources (00449): Trusted sources shows. */
  trustedSourcesOn: boolean;
  /** The database has brands.brand_rules (00450): Brand rules shows. */
  brandRulesOn: boolean;
}

/** The organization's brands, each with its Content settings; null without a workspace. */
export async function getContentSettings(): Promise<ContentSettings | null> {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return null;
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', auth.user.id)
    .maybeSingle();
  if (profileError) throw new Error(profileError.message);
  if (!profile?.organization_id) return null;
  const orgId = profile.organization_id;
  const columns = 'id, name, content_quality_handoff' as const;
  const brands = <C extends string>(select: C) =>
    supabase.from('brands').select(select).eq('organization_id', orgId).order('name');
  // The web ahead of its migrations, applied in order: without 00450 the
  // brands are read with no rules, without 00449 with no trusted sources
  // either, and the cards for what's missing don't show.
  const read = await brands(`${columns}, trusted_sources, brand_rules` as const);
  const brandRulesOn =
    !missingColumn(read.error, 'brand_rules') && !missingColumn(read.error, 'trusted_sources');
  const before00450 = brandRulesOn ? read : await brands(`${columns}, trusted_sources` as const);
  const trustedSourcesOn = !missingColumn(before00450.error, 'trusted_sources');
  const { data, error } = trustedSourcesOn ? before00450 : await brands(columns);
  if (error) throw new Error(error.message);
  return {
    brands: (data ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      qualityHandoff: b.content_quality_handoff,
      trustedSources: trustedSourcesOn ? listIn(b, 'trusted_sources') : [],
      brandRules: brandRulesOn ? listIn(b, 'brand_rules') : [],
    })),
    canManage: profile.role === 'admin' || profile.role === 'manager',
    trustedSourcesOn,
    brandRulesOn,
  };
}

/**
 * A list column of a brand row, read from the query with it or the one
 * without (before its migration): its strings, else none. Read, not
 * narrowed with `in`, which types the column the other query lacks as
 * unknown.
 */
function listIn(row: object, column: string): string[] {
  const value: unknown = (row as Record<string, unknown>)[column];
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/** A database without a brands column yet (42703 on a read, PGRST204 on a write). */
function missingColumn(error: { code?: string; message?: string } | null, column: string): boolean {
  return (
    (error?.code === '42703' || error?.code === 'PGRST204') &&
    (error.message ?? '').includes(column)
  );
}

const missingTrustedSources = (error: { code?: string; message?: string } | null) =>
  missingColumn(error, 'trusted_sources');

const trustedSources = z
  .array(z.string())
  .max(MAX_TRUSTED_SOURCES)
  .refine((list) => list.every((site) => trustedHost(site) === site), 'invalid')
  .refine((list) => new Set(list).size === list.length, 'invalid');

/**
 * The sites a brand trusts as sources (customer priorities item 6, 00449),
 * as Settings › Content saves them: hosts (parseTrustedSources'), each
 * once, at most 50. Admins and managers; never throws: what was saved, or
 * why not (`unavailable` before 00449).
 */
export async function setBrandTrustedSources(
  brandId: string,
  sources: string[],
): Promise<
  { ok: true; sources: string[] } | { ok: false; reason: 'invalid' | 'unavailable' | 'failed' }
> {
  const parsed = trustedSources.safeParse(sources);
  if (!z.guid().safeParse(brandId).success || !parsed.success)
    return { ok: false, reason: 'invalid' };
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('brands')
      .update({ trusted_sources: parsed.data })
      .eq('id', brandId)
      .select('trusted_sources');
    if (missingTrustedSources(error)) return { ok: false, reason: 'unavailable' };
    if (error || !data?.length) {
      if (error)
        console.error('[content-settings] could not save the trusted sources:', error.message);
      return { ok: false, reason: 'failed' };
    }
    return { ok: true, sources: data[0].trusted_sources };
  } catch (err) {
    console.error('[content-settings] could not save the trusted sources:', err);
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Hand off quality fixes automatically (Quality spec §5, CE-051): the
 * brand's new and optimized pages get the Content Agent's hand-off run, its
 * changes left for review. Admins and managers; a brand they can't change
 * is refused.
 */
export async function setBrandQualityHandoff(brandId: string, on: boolean): Promise<void> {
  await assertWritable({ brandId });
  if (!z.guid().safeParse(brandId).success || typeof on !== 'boolean') throw new Error('invalid');
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .update({ content_quality_handoff: on })
    .eq('id', brandId)
    .select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('forbidden');
}

/**
 * A brand's rules in its own words (customer priorities item 8, 00450), as
 * Settings › Content saves them: parseBrandRules' (trimmed, each once), at
 * most 30 of 300 characters. Admins and managers; never throws: what was
 * saved, or why not (`unavailable` before 00450).
 */
export async function setBrandRules(
  brandId: string,
  rules: string[],
): Promise<
  { ok: true; rules: string[] } | { ok: false; reason: 'invalid' | 'unavailable' | 'failed' }
> {
  if (!z.guid().safeParse(brandId).success || !Array.isArray(rules) || !brandRulesValid(rules)) {
    return { ok: false, reason: 'invalid' };
  }
  try {
    await assertWritable({ brandId });
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('brands')
      .update({ brand_rules: rules })
      .eq('id', brandId)
      .select('brand_rules');
    if (missingColumn(error, 'brand_rules')) return { ok: false, reason: 'unavailable' };
    if (error || !data?.length) {
      if (error) console.error('[content-settings] could not save the brand rules:', error.message);
      return { ok: false, reason: 'failed' };
    }
    return { ok: true, rules: data[0].brand_rules };
  } catch (err) {
    console.error('[content-settings] could not save the brand rules:', err);
    return { ok: false, reason: 'failed' };
  }
}

/**
 * A brand's rules (00450) for the Content Editor's Rules tab, which shows
 * them above the page's own. Anyone who can read the brand reads them;
 * none for a brand without, before 00450, or when they can't be read.
 * Never throws.
 */
export async function getBrandRules(brandId: string): Promise<string[]> {
  if (!z.guid().safeParse(brandId).success) return [];
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('brands')
      .select('brand_rules')
      .eq('id', brandId)
      .maybeSingle();
    if (error) {
      if (!missingColumn(error, 'brand_rules')) {
        console.error('[content-settings] could not read the brand rules:', error.message);
      }
      return [];
    }
    return data?.brand_rules ?? [];
  } catch (err) {
    console.error('[content-settings] could not read the brand rules:', err);
    return [];
  }
}
