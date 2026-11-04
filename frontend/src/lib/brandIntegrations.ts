import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * A brand's integrations on the web (BRAND-ACCESS PR 14, 00470): which of the
 * Account's sign-ins (integration_accounts) the brand uses for each provider
 * (brand_integrations), as the API server's lib/brandIntegrations.js reads
 * them. The one place the web answers "is this brand's Google connected?":
 * the suggestion sources, AI Referral Traffic and Chat's Google reads ask
 * here, not the Account's row. Every brand uses the Account's Google
 * connection until the Brand settings cards (PR 15) let one use another, so
 * nothing changes yet.
 *
 * `db` is the person's client (RLS: only a brand they can access answers) or
 * the service role after a brand check. Before 00470 is applied there are no
 * such tables: a brand's connections are its Account's rows
 * (integration_connections), as before.
 */

export interface BrandIntegration {
  provider: string;
  /** The sign-in (integration_accounts.id); null before 00470. */
  accountId: string | null;
  /** What the sign-in is called on a card: a CMS site's name; none for Google yet. */
  label: string | null;
  /** pending, connected or disconnected (Google); connected or auth_failed (a CMS site). */
  status: string;
  connected: boolean;
}

interface AccountRow {
  id?: string | null;
  label?: string | null;
  status: string;
}

/** Postgres' code for a missing table, PostgREST's for one (or a relationship) not in its cache. */
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST200']);

function integrationOf(provider: string, account: AccountRow): BrandIntegration {
  return {
    provider,
    accountId: account.id ?? null,
    label: account.label ?? null,
    status: account.status,
    connected: account.status === 'connected',
  };
}

/** Before 00470: the brand's Account's rows, as every brand used them. */
async function accountRows(
  db: SupabaseClient,
  brandId: string,
): Promise<Map<string, BrandIntegration>> {
  const brand = await db.from('brands').select('organization_id').eq('id', brandId).maybeSingle();
  if (brand.error) throw new Error(brand.error.message);
  const organizationId = (brand.data as { organization_id?: string } | null)?.organization_id;
  if (!organizationId) return new Map();
  const rows = await db
    .from('integration_connections')
    .select('provider, status')
    .eq('organization_id', organizationId);
  if (rows.error) throw new Error(rows.error.message);
  return new Map(
    ((rows.data ?? []) as { provider: string; status: string }[]).map((row) => [
      row.provider,
      integrationOf(row.provider, row),
    ]),
  );
}

/**
 * The brand's integrations, by provider: the sign-in it uses for each,
 * whatever its status. A provider the brand uses none for isn't there.
 */
export async function readBrandIntegrations(
  db: SupabaseClient,
  brandId: string,
): Promise<Map<string, BrandIntegration>> {
  const { data, error } = await db
    .from('brand_integrations')
    .select(
      'provider, account:integration_accounts!brand_integrations_account_id_fkey(id, label, status)',
    )
    .eq('brand_id', brandId);
  if (error && NOT_MIGRATED.has(error.code ?? '')) return accountRows(db, brandId);
  if (error) throw new Error(error.message);
  const found = new Map<string, BrandIntegration>();
  for (const row of (data ?? []) as unknown as {
    provider: string;
    account: AccountRow | AccountRow[] | null;
  }[]) {
    const account = Array.isArray(row.account) ? row.account[0] : row.account;
    if (account) found.set(row.provider, integrationOf(row.provider, account));
  }
  return found;
}
