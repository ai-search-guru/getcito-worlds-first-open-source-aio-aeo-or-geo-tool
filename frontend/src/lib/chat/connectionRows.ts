import { supabaseAdmin } from '@/lib/supabase/admin';

/**
 * The one read of what brands have connected (Chat Wave 4, W4-24), as the
 * app keeps it per brand (Brand-level access): the brand's Search Console
 * and Analytics properties, its CMS sites (brand_cms_connections), its
 * workflow webhooks (webhook_configs) and its catalog sources
 * (catalog_sources). An agent's connection checks (agentConnections.ts
 * readBrandConnections), Chat's list_connections and the Connections page
 * (connections.ts) all build on it, so they never disagree. Server only.
 */

/** A brand's connection rows, with the details the Connections page shows. */
export interface ConnectionRows {
  brand: { gsc_property: string | null; ga_property_id: string | null } | null;
  cms: {
    provider: string;
    status: string;
    site_name?: string | null;
    connected_by?: string | null;
    created_at?: string | null;
  }[];
  webhooks: { events: string[] | null; name?: string | null; created_at?: string | null }[];
  catalog: {
    kind: string;
    last_status: string | null;
    label?: string | null;
    account?: string | null;
    url?: string | null;
    created_by?: string | null;
    created_at?: string | null;
  }[];
}

/** A brand with nothing connected. */
export const NO_CONNECTION_ROWS: ConnectionRows = Object.freeze({
  brand: null,
  cms: [],
  webhooks: [],
  catalog: [],
}) as ConnectionRows;

type WithBrand<T> = T & { brand_id: string };

/** The connection rows of each brand given, by its id; a brand with none has empty lists. */
export async function readConnectionRows(
  brandIds: readonly string[],
): Promise<Map<string, ConnectionRows>> {
  const ids = [...new Set(brandIds)];
  const out = new Map<string, ConnectionRows>();
  if (ids.length === 0) return out;
  const [brands, cms, webhooks, catalog] = await Promise.all([
    supabaseAdmin.from('brands').select('id, gsc_property, ga_property_id').in('id', ids),
    supabaseAdmin
      .from('brand_cms_connections')
      .select('brand_id, provider, status, site_name, connected_by, created_at')
      .in('brand_id', ids),
    supabaseAdmin
      .from('webhook_configs')
      .select('brand_id, name, events, created_at')
      .in('brand_id', ids)
      .eq('is_active', true),
    supabaseAdmin
      .from('catalog_sources')
      .select('brand_id, kind, last_status, label, account, url, created_by, created_at')
      .in('brand_id', ids),
  ]);
  for (const read of [brands, cms, webhooks, catalog]) {
    if (read.error) {
      throw new Error(`Could not read the brand's connections: ${read.error.message}`);
    }
  }
  for (const id of ids) out.set(id, { brand: null, cms: [], webhooks: [], catalog: [] });
  for (const row of (brands.data ?? []) as (ConnectionRows['brand'] & { id: string })[]) {
    const rows = out.get(row.id);
    if (rows) rows.brand = { gsc_property: row.gsc_property, ga_property_id: row.ga_property_id };
  }
  for (const row of (cms.data ?? []) as WithBrand<ConnectionRows['cms'][number]>[]) {
    out.get(row.brand_id)?.cms.push(row);
  }
  for (const row of (webhooks.data ?? []) as WithBrand<ConnectionRows['webhooks'][number]>[]) {
    out.get(row.brand_id)?.webhooks.push(row);
  }
  for (const row of (catalog.data ?? []) as WithBrand<ConnectionRows['catalog'][number]>[]) {
    out.get(row.brand_id)?.catalog.push(row);
  }
  return out;
}
