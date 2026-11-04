'use server';

import { createClient } from '@/lib/supabase/server';
import { API_BASE_URL } from '@/config/api';
import { readBrandIntegrations, type BrandIntegration } from '@/lib/brandIntegrations';
import { assertWritable } from '@/lib/subscriptionGuard';

/** Providers that expose the shared connect / status / disconnect flow. */
export type IntegrationProvider =
  'google-search-console' | 'google-analytics' | 'google-merchant-center';

export type IntegrationStatus = 'not_configured' | 'not_connected' | 'connected';

/**
 * How long a call to the API waits. A provider's status, live connect and
 * property lists are read from the browser instead (lib/integrationsClient.ts):
 * Next runs server actions one at a time, so they held each other up.
 */
const CONFIG_TIMEOUT_MS = 10_000;
const DISCONNECT_TIMEOUT_MS = 20_000;
/** Saving a property reads the brand's sign-in's list from Google first. */
const PROPERTY_SAVE_TIMEOUT_MS = 20_000;

async function authHeaders(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session) throw new Error('Not authenticated');
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  };
}

/**
 * Whether this deployment can connect Google Merchant Center (the API has its
 * Composio auth config): where it can't, Product Visibility doesn't ask for
 * it. False when it can't be read: a claim of nothing.
 */
export async function getMerchantCenterOffered(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/integrations/config`, {
      headers: await authHeaders(),
      cache: 'no-store',
      signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const config = (await res.json()) as { googleMerchantCenter?: boolean };
    return Boolean(config.googleMerchantCenter);
  } catch {
    return false;
  }
}

/**
 * Everything the suggestion-sources panel needs, in two round trips (#659).
 *
 * Deliberately does NOT read the provider's status. That resolves the live
 * state against Composio and re-syncs our row, which costs ~450ms per
 * provider — measured — and made the panel appear well after the suggestions
 * it sits above. This reads the sign-in the brand uses (00470,
 * lib/brandIntegrations.ts), which follows the row Composio's own status
 * check maintains, plus the brand's property mapping.
 *
 * The trade-off is that a connection revoked on Google's side still reads as
 * connected here until Settings runs its authoritative check and rewrites the
 * row. For a panel that describes what feeds suggestions, a stale "connected"
 * for a few minutes is a better failure than a second of blank space on every
 * visit.
 */
export interface SourceState {
  configured: boolean;
  connected: boolean;
  mapped: boolean;
  /**
   * When this brand's first synced row landed, or null when nothing has been
   * synced yet. Suggestions generated before it could not draw on the source.
   */
  firstDataAt: string | null;
  /**
   * When the brand's newest day of data landed: the last sync that brought
   * anything. Read from the latest date's row, which the (brand, date) index
   * finds at once; a sync only inserts new days, so it's when that ran.
   */
  lastDataAt: string | null;
  /** The brand's property: a GSC property ("sc-domain:…" or a URL) or a GA4 property id. */
  property: string | null;
}

export interface SuggestionSourceStates {
  gsc: SourceState;
  ga: SourceState;
  dataForSeo: { configured: boolean };
}

export async function getSuggestionSourceStates(brandId: string): Promise<SuggestionSourceStates> {
  const supabase = await createClient();

  interface ConfigBody {
    googleSearchConsole?: boolean;
    googleAnalytics?: boolean;
    dataForSeo?: boolean;
  }

  const firstRow = (table: 'gsc_query_stats' | 'ga_page_stats') =>
    supabase
      .from(table)
      .select('created_at')
      .eq('brand_id', brandId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();

  const latestRow = (table: 'gsc_query_stats' | 'ga_page_stats') =>
    supabase
      .from(table)
      .select('created_at')
      .eq('brand_id', brandId)
      .order('date', { ascending: false })
      .limit(1)
      .maybeSingle();

  const [configRes, brandRes, integrations, gscFirst, gaFirst, gscLast, gaLast] = await Promise.all(
    [
      fetch(`${API_BASE_URL}/api/integrations/config`, {
        headers: await authHeaders(),
        cache: 'no-store',
        signal: AbortSignal.timeout(CONFIG_TIMEOUT_MS),
      })
        .then((r) => (r.ok ? (r.json() as Promise<ConfigBody>) : ({} as ConfigBody)))
        .catch(() => ({}) as ConfigBody),
      supabase
        .from('brands')
        .select('gsc_property, ga_property_id')
        .eq('id', brandId)
        .maybeSingle(),
      // A failed read is "not connected", as the Account's row read was.
      readBrandIntegrations(supabase, brandId).catch(() => new Map<string, BrandIntegration>()),
      firstRow('gsc_query_stats'),
      firstRow('ga_page_stats'),
      latestRow('gsc_query_stats'),
      latestRow('ga_page_stats'),
    ],
  );

  const connected = (provider: IntegrationProvider) =>
    Boolean(integrations.get(provider)?.connected);

  return {
    gsc: {
      configured: Boolean(configRes.googleSearchConsole),
      connected: connected('google-search-console'),
      mapped: Boolean(brandRes.data?.gsc_property),
      firstDataAt: gscFirst.data?.created_at ?? null,
      lastDataAt: gscLast.data?.created_at ?? null,
      property: brandRes.data?.gsc_property ?? null,
    },
    ga: {
      configured: Boolean(configRes.googleAnalytics),
      connected: connected('google-analytics'),
      mapped: Boolean(brandRes.data?.ga_property_id),
      firstDataAt: gaFirst.data?.created_at ?? null,
      lastDataAt: gaLast.data?.created_at ?? null,
      property: brandRes.data?.ga_property_id ?? null,
    },
    dataForSeo: { configured: Boolean(configRes.dataForSeo) },
  };
}

export async function disconnectIntegration(provider: IntegrationProvider): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/api/integrations/${provider}`, {
    method: 'DELETE',
    headers: await authHeaders(),
    signal: AbortSignal.timeout(DISCONNECT_TIMEOUT_MS),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
}

// ─── Property mapping (#642) ─────────────────────────────────────────────────

/**
 * Save a brand's property pick (null clears it) through the API, which checks
 * it against the brand's own Google sign-in, so a pick can't name a site the
 * brand's sign-in doesn't hold, and starts a freshly mapped brand's first
 * sync in the background. Without that sync the data only lands with the
 * nightly run, and suggestions generated in the meantime cannot draw on it.
 */
async function saveBrandProperty(
  provider: 'google-search-console' | 'google-analytics',
  brandId: string,
  property: string | null,
): Promise<void> {
  await assertWritable({ brandId });
  const res = await fetch(
    `${API_BASE_URL}/api/integrations/${provider}/brands/${encodeURIComponent(brandId)}/property`,
    {
      method: 'PUT',
      headers: await authHeaders(),
      body: JSON.stringify({ property }),
      signal: AbortSignal.timeout(PROPERTY_SAVE_TIMEOUT_MS),
    },
  );
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error || `Server error: ${res.status}`);
}

export interface GscProperty {
  siteUrl: string;
  permissionLevel: string | null;
}

export interface GscBrandMapping {
  brandId: string;
  brandName: string;
  gscProperty: string | null;
  domains: string[];
}

/** Org brands with their domains and current property picks (RLS-scoped). */
export async function getGscBrandMappings(): Promise<GscBrandMapping[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, gsc_property, brand_domains(domain)')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    brandId: b.id,
    brandName: b.name,
    gscProperty: b.gsc_property,
    domains: (b.brand_domains ?? []).map((d) => d.domain),
  }));
}

/** Persist a brand's property pick (null clears it): admin/manager (saveBrandProperty). */
export async function setBrandGscProperty(brandId: string, property: string | null): Promise<void> {
  await saveBrandProperty('google-search-console', brandId, property);
}

// ─── Google Analytics property mapping (#694) ────────────────────────────────

export interface GaProperty {
  /** Bare GA4 numeric id — the "properties/" prefix is added by the API layer. */
  propertyId: string;
  displayName: string;
  accountName: string | null;
  /** Site URLs from the property's web data streams; empty for app-only ones. */
  siteUrls: string[];
}

export interface GaBrandMapping {
  brandId: string;
  brandName: string;
  gaPropertyId: string | null;
  domains: string[];
}

/** Org brands with their domains and current GA property picks (RLS-scoped). */
export async function getGaBrandMappings(): Promise<GaBrandMapping[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, ga_property_id, brand_domains(domain)')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((b) => ({
    brandId: b.id,
    brandName: b.name,
    gaPropertyId: b.ga_property_id,
    domains: (b.brand_domains ?? []).map((d) => d.domain),
  }));
}

/** Persist a brand's GA property pick (null clears it): admin/manager (saveBrandProperty). */
export async function setBrandGaProperty(
  brandId: string,
  propertyId: string | null,
): Promise<void> {
  await saveBrandProperty('google-analytics', brandId, propertyId);
}
