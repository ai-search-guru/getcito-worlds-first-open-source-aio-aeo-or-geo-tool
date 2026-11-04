import { AuthScheme, Composio } from '@composio/core';

/**
 * Composio managed-auth helper (#577, extended for Google Analytics in #658).
 * Composio's verified Google app runs the OAuth consent flow and stores the
 * tokens — we only ever hold the connected-account id. Self-host installs
 * without the env vars stay fully functional: isComposioConfigured() gates
 * every route and the UI renders a "not configured" card instead of erroring.
 *
 * Providers are described by the map below rather than by copy-pasted
 * functions: the connect / status / disconnect flow is identical for every
 * OAuth source, so only the auth-config env var differs. Provider-specific
 * behaviour (listing GSC properties, querying analytics) stays in its own
 * function further down.
 */

let client = null;

/**
 * Supported integration providers. The key is the public identifier used in
 * API routes, the `integration_connections.provider` column and the UI.
 */
export const PROVIDERS = {
  'google-search-console': {
    label: 'Google Search Console',
    authConfigEnv: 'COMPOSIO_GSC_AUTH_CONFIG_ID',
  },
  'google-analytics': {
    label: 'Google Analytics',
    authConfigEnv: 'COMPOSIO_GA_AUTH_CONFIG_ID',
  },
  // The catalog's Merchant Center sources read through it (#1270): see proxyRequest.
  'google-merchant-center': {
    label: 'Google Merchant Center',
    authConfigEnv: 'COMPOSIO_GMC_AUTH_CONFIG_ID',
  },
};

export function isKnownProvider(provider) {
  return Object.hasOwn(PROVIDERS, provider);
}

/**
 * The Account's own entity (#577): Settings › Integrations connects Google
 * under it. Several sign-ins may share an entity (BRAND-ACCESS PR 14), so a
 * call names the connected account it uses (see `toolTarget`).
 */
export function entityIdFor(organizationId) {
  return `org_${organizationId}`;
}

/**
 * Who a tool runs as: the entity, and the connected account when it is known.
 * An entity may hold several connected accounts of one auth config (link and
 * initiate take `allowMultiple`, as connectWebflowToken does); with only the
 * entity, Composio would pick one of them itself. A brand's connection
 * (lib/brandIntegrations.js) always names its account.
 *
 * @param {{ entityId: string, accountId?: string|null }} connection
 */
function toolTarget({ entityId, accountId = null }) {
  return accountId ? { userId: entityId, connectedAccountId: accountId } : { userId: entityId };
}

function authConfigId(provider) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Unknown integration provider: ${provider}`);
  return process.env[config.authConfigEnv];
}

/**
 * A provider is usable only when the API key AND its own auth config are
 * present — one provider being configured must never imply the other is.
 */
export function isComposioConfigured(provider) {
  if (!process.env.COMPOSIO_API_KEY) return false;
  if (!isKnownProvider(provider)) return false;
  return Boolean(authConfigId(provider));
}

function getClient() {
  if (!client) {
    client = new Composio({ apiKey: process.env.COMPOSIO_API_KEY });
  }
  return client;
}

/**
 * Start the hosted OAuth flow for an entity. Returns the URL the client
 * opens in a popup plus the pending connected-account id.
 */
export async function initiateConnection(provider, entityId, callbackUrl) {
  const request = await getClient().connectedAccounts.link(entityId, authConfigId(provider), {
    callbackUrl,
  });
  return {
    redirectUrl: request.redirectUrl,
    connectedAccountId: request.connectedAccountId ?? request.id ?? null,
    status: request.connectionStatus ?? 'INITIATED',
  };
}

/**
 * The entity's ACTIVE connection for this provider on Composio, or null: the
 * account `accountId` when one is named (an entity may hold several), else
 * the first.
 */
export async function getActiveConnection(provider, entityId, accountId = null) {
  const connections = await getClient().connectedAccounts.list({
    authConfigIds: [authConfigId(provider)],
    userIds: [entityId],
    statuses: ['ACTIVE'],
  });
  const items = connections.items ?? [];
  if (accountId) return items.find((item) => item.id === accountId) ?? null;
  return items[0] ?? null;
}

export async function deleteConnection(connectedAccountId) {
  await getClient().connectedAccounts.delete(connectedAccountId);
}

/**
 * A call to a provider's own API through Composio's proxy (#1270), on one
 * connected account: Composio adds the account's OAuth token on its side,
 * so the token never reaches us, and we choose the API version ourselves
 * (a toolkit's ready-made tools may call an older one). Composio doesn't
 * retry it: the caller decides what a 429 means.
 *
 * Returns the API's own answer, whatever its status: `{ status, headers, data }`.
 * Throws when Composio itself refuses the call (an account no longer active).
 */
export async function proxyRequest(connectedAccountId, { endpoint, query = {}, signal }) {
  const parameters = Object.entries(query)
    .filter(([, value]) => value != null && value !== '')
    .map(([name, value]) => ({ in: 'query', name, value: String(value) }));
  const res = await getClient().tools.proxyExecute(
    { endpoint, method: 'GET', parameters, connectedAccountId },
    signal ? { signal } : undefined,
  );
  return { status: res.status, headers: res.headers ?? {}, data: res.data ?? null };
}

/**
 * Composio requires a pinned toolkit version for manual tool execution
 * ("latest" is rejected). Bump deliberately after checking the changelog;
 * override per-deploy via env if a hotpin is ever needed.
 */
const GSC_TOOLKIT_VERSION = process.env.COMPOSIO_GSC_TOOLKIT_VERSION || '20260721_00';

/**
 * Properties visible to the connected account (#642): `connection` is
 * `{ entityId, accountId }` (toolTarget).
 * Returns [{ siteUrl, permissionLevel }]. Requires the API key to have
 * tool-execution permission (the connect flow only needs connected_accounts).
 */
export async function listGscSites(connection) {
  const result = await getClient().tools.execute('GOOGLE_SEARCH_CONSOLE_LIST_SITES', {
    ...toolTarget(connection),
    arguments: {},
    version: GSC_TOOLKIT_VERSION,
  });
  if (result?.successful === false) {
    throw new Error(result?.error || 'Failed to list Search Console properties');
  }
  const entries = result?.data?.siteEntry ?? result?.data?.sites ?? [];
  return entries.map((e) => ({
    siteUrl: e.siteUrl,
    permissionLevel: e.permissionLevel ?? null,
  }));
}

/**
 * Search analytics rows for a property (#644), on the connected account
 * `connection` names (toolTarget). Parameters are deterministic — built by
 * the caller, never by an LLM. Returns the raw GSC rows:
 * [{ keys: [query, date], clicks, impressions, ctr, position }].
 */
export async function queryGscSearchAnalytics(connection, args) {
  const result = await getClient().tools.execute('GOOGLE_SEARCH_CONSOLE_SEARCH_ANALYTICS_QUERY', {
    ...toolTarget(connection),
    arguments: args,
    version: GSC_TOOLKIT_VERSION,
  });
  if (result?.successful === false) {
    throw new Error(result?.error || 'Search analytics query failed');
  }
  return result?.data?.rows ?? [];
}

// ─── Google Analytics ────────────────────────────────────────────────────────

/**
 * Same pinning rule as Search Console — manual tool execution rejects
 * "latest". Kept separate so the two toolkits can be bumped independently.
 */
const GA_TOOLKIT_VERSION = process.env.COMPOSIO_GA_TOOLKIT_VERSION || '20260721_00';

/** Hard ceiling on how many properties the picker lists. */
const GA_MAX_PROPERTIES = Number(process.env.COMPOSIO_GA_MAX_PROPERTIES) || 500;
/**
 * Properties we resolve data streams for. Listing them is a couple of calls
 * regardless of size, but streams are one call per property (~1s each), so
 * this bounds how long the mapping UI waits. Properties past the limit are
 * still listed and still selectable by hand — they just don't take part in
 * the domain auto-match.
 */
const GA_STREAM_LOOKUP_LIMIT = Number(process.env.COMPOSIO_GA_STREAM_LOOKUPS) || 100;
/** Stream lookups in flight at once. */
const GA_STREAM_CONCURRENCY = 8;

async function executeGaTool(slug, connection, args) {
  const result = await getClient().tools.execute(slug, {
    ...toolTarget(connection),
    arguments: args,
    version: GA_TOOLKIT_VERSION,
  });
  if (result?.successful === false) {
    throw new Error(result?.error || `${slug} failed`);
  }
  return result?.data ?? {};
}

/** Site URLs served by a property's web data streams (app streams have none). */
async function gaPropertySiteUrls(connection, propertyId) {
  const data = await executeGaTool('GOOGLE_ANALYTICS_LIST_DATA_STREAMS', connection, {
    parent: `properties/${propertyId}`,
    pageSize: 200,
  });
  return (data.dataStreams ?? [])
    .map((stream) => stream.webStreamData?.defaultUri)
    .filter((uri) => typeof uri === 'string' && uri.length > 0);
}

/**
 * GA4 properties visible to the connected account (#694): `connection` is
 * `{ entityId, accountId }` (toolTarget).
 *
 * `LIST_ACCOUNT_SUMMARIES` returns every account with its properties, but a
 * GA4 property is a numeric id plus a free-text display name — nothing a brand
 * domain can be matched against. The site URL lives on the property's web data
 * streams, so those are resolved too (bounded concurrency and count, best
 * effort): a property whose streams fail to load, or that falls past the
 * lookup limit, simply arrives with no site URLs and stays manually
 * selectable.
 *
 * With `streams: false` the site URLs are left empty and not looked up: for
 * a caller that only needs the ids (checking a picked property).
 *
 * Returns [{ propertyId, displayName, accountName, siteUrls }].
 */
export async function listGaProperties(connection, { streams = true } = {}) {
  const properties = [];
  let pageToken = null;

  do {
    const args = { pageSize: 200 };
    if (pageToken) args.pageToken = pageToken;
    const data = await executeGaTool('GOOGLE_ANALYTICS_LIST_ACCOUNT_SUMMARIES', connection, args);

    for (const account of data.accountSummaries ?? []) {
      for (const summary of account.propertySummaries ?? []) {
        // "properties/365372770" → "365372770"; the prefix is constant and is
        // added back by the callers that hit the Admin / Data APIs.
        const propertyId = String(summary.property ?? '').split('/')[1];
        if (!propertyId) continue;
        properties.push({
          propertyId,
          displayName: summary.displayName ?? propertyId,
          accountName: account.displayName ?? null,
          siteUrls: [],
        });
      }
    }

    pageToken = data.nextPageToken ?? null;
  } while (pageToken && properties.length < GA_MAX_PROPERTIES);

  const capped = properties.slice(0, GA_MAX_PROPERTIES);
  const withStreams = streams ? capped.slice(0, GA_STREAM_LOOKUP_LIMIT) : [];

  for (let i = 0; i < withStreams.length; i += GA_STREAM_CONCURRENCY) {
    const batch = withStreams.slice(i, i + GA_STREAM_CONCURRENCY);
    await Promise.all(
      batch.map(async (property) => {
        try {
          property.siteUrls = await gaPropertySiteUrls(connection, property.propertyId);
        } catch {
          // Best effort — the property stays listed, just without auto-match.
        }
      }),
    );
  }

  return capped;
}

/**
 * Run a GA4 Data API report for a property (#704), on the connected account
 * `connection` names (toolTarget).
 *
 * `body` is a runReport request minus `property`, built by the caller — the
 * dimensions, metrics and filters are deterministic, never model-generated.
 * Returns the report as GA4 shapes it (`dimensionHeaders`, `metricHeaders`,
 * `rows`, `rowCount`); parsing rows into storage is the sync's job.
 */
export async function runGaReport(connection, propertyId, body) {
  return executeGaTool('GOOGLE_ANALYTICS_RUN_REPORT', connection, {
    property: `properties/${propertyId}`,
    ...body,
  });
}

// ─── Webflow (Send to CMS, #1331 phase 2) ───────────────────────────────────

/**
 * Webflow has no Composio-managed OAuth app, so a brand connects its site
 * with a site token: an API-key connected account under the brand's own
 * Composio user (a site token is one site's). Composio keeps the token; we
 * keep the account's id (brand_cms_connections, 00283). Not in PROVIDERS:
 * the shared connect flow above is the workspace's OAuth.
 */
const WEBFLOW_AUTH_CONFIG_ENV = 'COMPOSIO_WEBFLOW_AUTH_CONFIG_ID';

/** Pinned as Search Console's is; manual tool execution rejects "latest". */
const WEBFLOW_TOOLKIT_VERSION = process.env.COMPOSIO_WEBFLOW_TOOLKIT_VERSION || '20260826_00';

export function isWebflowConfigured() {
  return Boolean(process.env.COMPOSIO_API_KEY && process.env[WEBFLOW_AUTH_CONFIG_ENV]);
}

/**
 * A connected account for a Webflow site token, under `entityId`. Returns
 * its id; whether Webflow takes the token is the first tool call's to say.
 * A new token is a second account until the first is removed (an API-key
 * account is active whether Webflow takes its token or not), so more than
 * one is allowed: forgetWebflowAccounts keeps the brand to one.
 */
export async function connectWebflowToken(entityId, token) {
  const request = await getClient().connectedAccounts.initiate(
    entityId,
    process.env[WEBFLOW_AUTH_CONFIG_ENV],
    { config: AuthScheme.APIKey({ api_key: token }), allowMultiple: true },
  );
  const id = request?.id ?? request?.connectedAccountId ?? null;
  if (!id) throw new Error('Composio returned no connected account');
  return id;
}

/**
 * Removes the Webflow accounts under `entityId` but `keep` (none kept when
 * it's null): the ones a replaced token, a refused one or a failed removal
 * left. Throws when one can't be removed.
 */
export async function forgetWebflowAccounts(entityId, keep = null) {
  const accounts = await getClient().connectedAccounts.list({
    authConfigIds: [process.env[WEBFLOW_AUTH_CONFIG_ENV]],
    userIds: [entityId],
  });
  for (const account of accounts.items ?? []) {
    if (account.id && account.id !== keep) await deleteConnection(account.id);
  }
}

/** A Webflow tool, run on one connected account; its data, or an error with Webflow's words. */
export async function executeWebflowTool(slug, { entityId, accountId }, args) {
  const result = await getClient().tools.execute(slug, {
    userId: entityId,
    connectedAccountId: accountId,
    arguments: args,
    version: WEBFLOW_TOOLKIT_VERSION,
  });
  if (result?.successful === false) {
    throw new Error(result?.error || `${slug} failed`);
  }
  return result?.data ?? {};
}
