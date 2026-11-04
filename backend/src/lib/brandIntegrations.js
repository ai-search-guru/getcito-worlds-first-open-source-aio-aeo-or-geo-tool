/**
 * A brand's integrations (BRAND-ACCESS PR 14, 00470): which of the Account's
 * sign-ins (integration_accounts) a brand uses for a provider
 * (brand_integrations). The one place the server answers "what does this
 * brand connect to Google (or its CMS) with?": the Search Console and
 * Analytics syncs, the property lists, the Action Center's Analytics tool and
 * its sources ask here, never the Account's row or entity themselves. The
 * web's lib/brandIntegrations.ts reads the same tables.
 *
 * A connection names the Composio entity and the connected account it calls
 * with: several sign-ins may share one entity (composio.js toolTarget).
 * Every brand uses the Account's Google connection until the Brand settings
 * cards (PR 15) let one use another, so nothing changes yet.
 *
 * Before 00470 is applied there is no pool: a brand's connection is its
 * Account's row (integration_connections), as before, said once.
 */

import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from './chunkedIn.js';
import { logger } from './logger.js';
import { readAllRpcRows } from './rpcPages.js';

/** A sign-in's columns as a connection reads them. */
const ACCOUNT_COLUMNS =
  'id, organization_id, composio_entity_id, composio_account_id, label, status';

/** Postgres' code for a missing table, PostgREST's for one (or a relationship) not in its cache. */
const NOT_MIGRATED = new Set(['42P01', 'PGRST205', 'PGRST200']);
let warnedNotMigrated = false;

function warnNotMigrated(error) {
  if (warnedNotMigrated) return;
  warnedNotMigrated = true;
  logger.warn(
    { code: error.code, migration: '00470' },
    "[brand-integrations] brand_integrations is missing: each brand uses its Account's connection until 00470 is applied",
  );
}

/**
 * @typedef {object} BrandConnection
 * @property {string} brandId
 * @property {string} provider
 * @property {string|null} accountId the sign-in (integration_accounts.id); null before 00470
 * @property {string} organizationId
 * @property {string|null} entityId the Composio entity
 * @property {string|null} composioAccountId the Composio connected account
 * @property {string|null} label
 * @property {string} status
 * @property {boolean} connected
 */

/** @returns {BrandConnection} */
function connectionOf(brandId, provider, account) {
  return {
    brandId,
    provider,
    accountId: account.id ?? null,
    organizationId: account.organization_id,
    entityId: account.composio_entity_id ?? null,
    composioAccountId: account.composio_account_id ?? null,
    label: account.label ?? null,
    status: account.status,
    connected: account.status === 'connected',
  };
}

/** What a Composio call on this connection runs as (composio.js toolTarget). */
export function composioTarget(connection) {
  return { entityId: connection.entityId, accountId: connection.composioAccountId };
}

/** Before 00470: the brand's Account's row for the provider, as every brand used it. */
async function accountRowConnection(brandId, provider) {
  const { data: brand, error } = await supabaseAdmin
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!brand?.organization_id) return null;
  const { data: row, error: rowError } = await supabaseAdmin
    .from('integration_connections')
    .select('organization_id, composio_entity_id, composio_account_id, status')
    .eq('organization_id', brand.organization_id)
    .eq('provider', provider)
    .maybeSingle();
  if (rowError) throw new Error(rowError.message);
  return row ? connectionOf(brandId, provider, { ...row, id: null, label: null }) : null;
}

/**
 * The brand's connection for `provider`, whatever its status, or null when
 * the brand uses none. The caller checks the brand's access first.
 * @param {string} brandId
 * @param {string} provider
 * @returns {Promise<BrandConnection|null>}
 */
export async function brandConnection(brandId, provider) {
  const { data, error } = await supabaseAdmin
    .from('brand_integrations')
    .select(
      `brand_id, provider, account:integration_accounts!brand_integrations_account_id_fkey(${ACCOUNT_COLUMNS})`,
    )
    .eq('brand_id', brandId)
    .eq('provider', provider)
    .maybeSingle();
  if (error && NOT_MIGRATED.has(error.code)) {
    warnNotMigrated(error);
    return accountRowConnection(brandId, provider);
  }
  if (error) throw new Error(error.message);
  return data?.account ? connectionOf(brandId, provider, data.account) : null;
}

/** Before 00470: every brand of an Account whose row is connected, with that row. */
async function connectedAccountRows(provider, { organizationId }) {
  let query = supabaseAdmin
    .from('integration_connections')
    .select('organization_id, composio_entity_id, composio_account_id, status')
    .eq('provider', provider)
    .eq('status', 'connected');
  if (organizationId) query = query.eq('organization_id', organizationId);
  const { data: rows, error } = await query;
  if (error) throw new Error(error.message);
  const byOrg = new Map((rows ?? []).map((row) => [row.organization_id, row]));
  const { data: brands, error: brandError } = await selectInChunks([...byOrg.keys()], (ids) =>
    supabaseAdmin.from('brands').select('id, organization_id').in('organization_id', ids),
  );
  if (brandError) throw new Error(brandError.message);
  return (brands ?? []).map((brand) =>
    connectionOf(brand.id, provider, {
      ...byOrg.get(brand.organization_id),
      id: null,
      label: null,
    }),
  );
}

/**
 * The brands whose connection for `provider` is live, each with it: every
 * such brand, an organization's (the manual sync), or the one brand (right
 * after its property is picked). Whether the brand is active, a demo or has
 * its property picked is the caller's to check.
 * @param {string} provider
 * @param {{ organizationId?: string, brandId?: string }} [scope]
 * @returns {Promise<BrandConnection[]>}
 */
export async function connectedBrands(provider, { organizationId, brandId } = {}) {
  if (brandId) {
    const connection = await brandConnection(brandId, provider);
    if (!connection?.connected) return [];
    return !organizationId || connection.organizationId === organizationId ? [connection] : [];
  }

  // The provider's live sign-ins…
  const { data: accounts, error } = await readAllRpcRows('integration_accounts', (from, to) => {
    let query = supabaseAdmin
      .from('integration_accounts')
      .select(ACCOUNT_COLUMNS)
      .eq('provider', provider)
      .eq('status', 'connected');
    if (organizationId) query = query.eq('organization_id', organizationId);
    return query.order('id').range(from, to);
  });
  if (error && NOT_MIGRATED.has(error.code)) {
    warnNotMigrated(error);
    return connectedAccountRows(provider, { organizationId });
  }
  if (error) throw new Error(error.message);
  const byId = new Map((accounts ?? []).map((account) => [account.id, account]));
  if (byId.size === 0) return [];

  // …and the brands that use them, a hundred sign-ins a read, page by page.
  const { data: uses, error: useError } = await selectInChunks([...byId.keys()], (ids) =>
    readAllRpcRows('brand_integrations', (from, to) =>
      supabaseAdmin
        .from('brand_integrations')
        .select('brand_id, account_id')
        .eq('provider', provider)
        .in('account_id', ids)
        .order('brand_id')
        .range(from, to),
    ),
  );
  if (useError) throw new Error(useError.message);
  return (uses ?? []).map((use) => connectionOf(use.brand_id, provider, byId.get(use.account_id)));
}

/**
 * The brands that use the connection's sign-in, its own among them: whose
 * properties a read through it lists, and so who may read through it
 * (access.js assertEveryBrand). Null before 00470, when the connection is the
 * Account's row, which every brand of the Account uses.
 * @param {BrandConnection} connection
 * @returns {Promise<string[]|null>}
 */
export async function signInBrandIds(connection) {
  if (!connection.accountId) return null;
  const { data, error } = await readAllRpcRows('brand_integrations', (from, to) =>
    supabaseAdmin
      .from('brand_integrations')
      .select('brand_id')
      .eq('account_id', connection.accountId)
      .order('brand_id')
      .range(from, to),
  );
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((use) => use.brand_id))];
}
