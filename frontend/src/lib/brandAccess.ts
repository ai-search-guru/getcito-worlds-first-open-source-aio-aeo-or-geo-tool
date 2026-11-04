import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { readAllRpcRows } from '@/lib/supabase/rpcPages';

/**
 * Brand access on the web's server paths (BRAND-ACCESS §5.3, 00388): Chat
 * and its agents, then MCP (PR 10) and the admin paths (PR 11). One Account
 * holds several brands, and a person has All brands or Selected brands.
 * Within their organization an Admin and All-brands people reach every
 * brand, a Selected-brands person the brands shared with them
 * (member_brands), and everyone the demo brand (00380, sample data): the
 * database's can_access_brand, which canAccessBrand asks, and which
 * readBrandAccess reads from the same tables, as the API server's
 * lib/access.js does. Everyone starts with All brands, so until the Team
 * screen narrows someone every answer is the organization's.
 *
 * Read fresh on each call, with the service role: access taken away counts
 * from the next call. Before 00388 there is no brand_scope and everyone has
 * All brands, as 00388 starts them; a scope it doesn't know is the closed
 * side (Selected brands). Server only.
 */

/** The brands a person may use: all of their organization's, or these ids (the demo brand's with them). */
export type BrandAccess = 'all' | readonly string[];

/** A profile as brand access reads it. */
export interface AccessProfile {
  role: string | null;
  organization_id: string | null;
  /** 'all' or 'selected'; before 00388 there is none, which is All brands. */
  brand_scope?: string | null;
}

/** A column that isn't there: Postgres' code, and PostgREST's for its schema cache. */
const MISSING_COLUMN = new Set(['42703', 'PGRST204']);
let warnedNoBrandScope = false;

const uuid = z.guid();

/**
 * A person's role, organization and brand scope; null without a profile.
 * Before 00388 the profile is read without the scope, as All brands (said
 * once). A read that fails throws: no access is decided on missing facts.
 */
export async function readAccessProfile(userId: string): Promise<AccessProfile | null> {
  const read = (columns: string) =>
    supabaseAdmin.from('profiles').select(columns).eq('id', userId).maybeSingle();
  const withScope = await read('role, organization_id, brand_scope');
  if (!withScope.error) return withScope.data as AccessProfile | null;
  if (!MISSING_COLUMN.has(withScope.error.code)) {
    throw new Error(`Could not read brand access: ${withScope.error.message}`);
  }
  if (!warnedNoBrandScope) {
    warnedNoBrandScope = true;
    console.warn(
      '[brand-access] profiles.brand_scope is missing: everyone counts as All brands until 00388 is applied',
    );
  }
  const without = await read('role, organization_id');
  if (without.error) throw new Error(`Could not read brand access: ${without.error.message}`);
  const profile = without.data as AccessProfile | null;
  return profile ? { ...profile, brand_scope: 'all' } : null;
}

/**
 * All brands: an Admin always (D3), and a profile whose scope says 'all'.
 * Anything else, a scope it doesn't know included, has Selected brands.
 */
export function hasAllBrands(profile: AccessProfile): boolean {
  return profile.role === 'admin' || profile.brand_scope === 'all';
}

/**
 * The access of the person whose profile this is, in an organization: null
 * when they aren't one of its members (no profile, none, or another one).
 * With Selected brands, the brands shared with them there and the demo
 * brand, read now.
 */
export async function brandAccessOf(
  profile: AccessProfile | null,
  userId: string,
  organizationId: string,
): Promise<BrandAccess | null> {
  if (!profile?.organization_id || profile.organization_id !== organizationId) return null;
  if (hasAllBrands(profile)) return 'all';
  const [grants, demo] = await Promise.all([
    supabaseAdmin
      .from('member_brands')
      .select('brand_id')
      .eq('user_id', userId)
      .eq('organization_id', organizationId),
    supabaseAdmin
      .from('brands')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('is_demo', true),
  ]);
  if (grants.error) throw new Error(`Could not read brand access: ${grants.error.message}`);
  if (demo.error) throw new Error(`Could not read brand access: ${demo.error.message}`);
  return [
    ...new Set([
      ...((grants.data ?? []) as { brand_id: string }[]).map((g) => g.brand_id),
      ...((demo.data ?? []) as { id: string }[]).map((b) => b.id),
    ]),
  ];
}

/**
 * The brands a person may use in an organization now: 'all', the ids of
 * the ones they may (Selected brands), or null when they aren't a member
 * of it, who may use none.
 */
export async function readBrandAccess(
  userId: string,
  organizationId: string,
): Promise<BrandAccess | null> {
  return brandAccessOf(await readAccessProfile(userId), userId, organizationId);
}

/**
 * The access of the person a tool acts for: what the caller read already
 * (Chat's precedence reads it for each call, McpAuthContext.brandAccess),
 * else read now. Null without a workspace, or for someone not in it.
 */
export async function brandAccessFor(auth: {
  userId: string;
  organizationId: string | null;
  brandAccess?: BrandAccess | null;
}): Promise<BrandAccess | null> {
  if (!auth.organizationId) return null;
  if (auth.brandAccess !== undefined) return auth.brandAccess;
  return readBrandAccess(auth.userId, auth.organizationId);
}

/**
 * Whether the access reaches a brand of the organization it was read for.
 * 'all' says nothing of another organization's brand: find the brand in
 * the organization first. Null (not a member) reaches none.
 */
export function hasBrandAccess(access: BrandAccess | null, brandId: string): boolean {
  return access === 'all' || (access !== null && access.includes(brandId));
}

/** The brands of the organization's `brands` that the access reaches, in their order. */
export function allowedBrands<T extends { id: string }>(
  access: BrandAccess | null,
  brands: readonly T[],
): T[] {
  return brands.filter((brand) => hasBrandAccess(access, brand.id));
}

/**
 * Whether a person may see a brand now: their organization's, and they are
 * an Admin, have All brands, have it shared or it is the demo brand (the
 * database's can_access_brand, asked with the service role). With
 * `organizationId`, the brand must be that organization's too (the
 * workspace a run or a key acts in). An id that isn't one, or a brand
 * that isn't there, is no one's. A read that fails throws, and so does a
 * database without can_access_brand (00388): no answer on a guess.
 */
export async function canAccessBrand(
  userId: string,
  brandId: string,
  organizationId?: string,
): Promise<boolean> {
  if (!uuid.safeParse(brandId).success) return false;
  const [brand, access] = await Promise.all([
    organizationId
      ? supabaseAdmin
          .from('brands')
          .select('id')
          .eq('id', brandId)
          .eq('organization_id', organizationId)
          .maybeSingle()
      : null,
    supabaseAdmin.rpc('can_access_brand', { p_brand_id: brandId, p_user_id: userId }),
  ]);
  if (brand?.error) throw new Error(`Could not read the brand: ${brand.error.message}`);
  if (access.error) throw new Error(`Could not read the brand's access: ${access.error.message}`);
  return (!brand || brand.data !== null) && access.data === true;
}

/** A member of the organization as brandReaders reads them. */
interface MemberScope extends AccessProfile {
  id: string;
}

/**
 * The organization's members with their role and brand scope. Before 00388
 * there is no brand_scope: everyone counts as All brands, as readAccessProfile
 * has it.
 */
async function readMemberScopes(organizationId: string): Promise<MemberScope[]> {
  const read = (columns: string) =>
    supabaseAdmin.from('profiles').select(columns).eq('organization_id', organizationId);
  const withScope = await read('id, role, organization_id, brand_scope');
  if (!withScope.error) return (withScope.data ?? []) as unknown as MemberScope[];
  if (!MISSING_COLUMN.has(withScope.error.code)) {
    throw new Error(`Could not read brand access: ${withScope.error.message}`);
  }
  const without = await read('id, role, organization_id');
  if (without.error) throw new Error(`Could not read brand access: ${without.error.message}`);
  return ((without.data ?? []) as unknown as MemberScope[]).map((m) => ({
    ...m,
    brand_scope: 'all',
  }));
}

/**
 * The organization's people who may use the brands of `brandIds`, each with
 * those they may, by brandAccessOf's rule (an Admin, All brands, the demo
 * brand, or a grant): who an action of the brand may be assigned to, and
 * whom an assignee picker lists. Read with the service role, as the API
 * server's brandReaders reads them, since can_access_brand answers for
 * another person only to the service role. People with none are left out;
 * another organization's brand, or an id that isn't one, counts for no one.
 */
export async function brandReaders(
  organizationId: string,
  brandIds: readonly string[],
): Promise<Map<string, Set<string>>> {
  const ids = [...new Set(brandIds)].filter((id) => uuid.safeParse(id).success);
  const readers = new Map<string, Set<string>>();
  if (ids.length === 0) return readers;
  const [brandsRead, members] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select('id, is_demo')
      .eq('organization_id', organizationId)
      .in('id', ids),
    readMemberScopes(organizationId),
  ]);
  if (brandsRead.error) throw new Error(`Could not read the brands: ${brandsRead.error.message}`);
  const brands = (brandsRead.data ?? []) as { id: string; is_demo: boolean | null }[];
  if (brands.length === 0) return readers;

  // Grants matter only to Selected-brands people: read page by page, as an
  // organization's can pass PostgREST's 1,000 rows.
  const granted = new Map<string, Set<string>>();
  const shareable = brands.filter((b) => b.is_demo !== true).map((b) => b.id);
  if (shareable.length > 0 && members.some((m) => !hasAllBrands(m))) {
    const grants = await readAllRpcRows<{ user_id: string; brand_id: string }>((from, to) =>
      supabaseAdmin
        .from('member_brands')
        .select('user_id, brand_id')
        .eq('organization_id', organizationId)
        .in('brand_id', shareable)
        .order('user_id')
        .order('brand_id')
        .range(from, to),
    );
    for (const grant of grants) {
      granted.set(grant.user_id, (granted.get(grant.user_id) ?? new Set()).add(grant.brand_id));
    }
  }

  for (const member of members) {
    const all = hasAllBrands(member);
    const reach = new Set(
      brands
        .filter((b) => all || b.is_demo === true || granted.get(member.id)?.has(b.id))
        .map((b) => b.id),
    );
    if (reach.size > 0) readers.set(member.id, reach);
  }
  return readers;
}

/** A member's brand access as Settings › Team shows it to an admin. */
export interface MemberBrandAccess {
  scope: 'all' | 'selected';
  /** The brands shared with a Selected-brands person; empty for All brands. */
  brandIds: string[];
}

/**
 * Every member's brand access in the organization (BRAND-ACCESS §3.2): All
 * brands for an Admin and for 'all', else the brands shared with them
 * (member_brands, page by page). For the admin screens: read with the
 * service role, so the caller checks the admin first.
 */
export async function readMemberBrandAccess(
  organizationId: string,
): Promise<Map<string, MemberBrandAccess>> {
  const members = await readMemberScopes(organizationId);
  const access = new Map<string, MemberBrandAccess>(
    members.map((member) => [
      member.id,
      { scope: hasAllBrands(member) ? 'all' : 'selected', brandIds: [] },
    ]),
  );
  if (![...access.values()].some((a) => a.scope === 'selected')) return access;
  const grants = await readAllRpcRows<{ user_id: string; brand_id: string }>((from, to) =>
    supabaseAdmin
      .from('member_brands')
      .select('user_id, brand_id')
      .eq('organization_id', organizationId)
      .order('user_id')
      .order('brand_id')
      .range(from, to),
  );
  for (const grant of grants) {
    const member = access.get(grant.user_id);
    if (member?.scope === 'selected') member.brandIds.push(grant.brand_id);
  }
  return access;
}
