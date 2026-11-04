import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import {
  PROVIDERS,
  entityIdFor,
  isKnownProvider,
  isComposioConfigured,
  initiateConnection,
  getActiveConnection,
  deleteConnection,
  listGscSites,
  listGaProperties,
} from '../lib/composio.js';
import { brandConnection, composioTarget, signInBrandIds } from '../lib/brandIntegrations.js';
import { runGscSync } from '../lib/gscSync.js';
import { runGaSync } from '../lib/gaSync.js';
import { detectPageOpportunitiesInWindow } from '../lib/pageOpportunities.js';
import { assertBrandAccess, assertAllBrands, assertEveryBrand } from '../lib/access.js';

const router = Router();

const GSC = 'google-search-console';
const GA = 'google-analytics';
const GMC = 'google-merchant-center';
const WRITE_ROLES = ['admin', 'manager'];

async function getProfile(userId) {
  const { data: profile, error } = await supabaseAdmin
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userId)
    .single();
  if (error) throw new Error(`Failed to load profile: ${error.message}`);
  if (!profile?.organization_id) {
    const err = new Error('No organization found for user.');
    err.status = 400;
    throw err;
  }
  return profile;
}

async function upsertConnectionRow(organizationId, provider, fields) {
  const { error } = await supabaseAdmin.from('integration_connections').upsert(
    {
      organization_id: organizationId,
      provider,
      updated_at: new Date().toISOString(),
      ...fields,
    },
    { onConflict: 'organization_id,provider' },
  );
  if (error) throw new Error(`Failed to save connection: ${error.message}`);
}

/**
 * Resolve `:provider` and reject anything unknown before it reaches Composio.
 * Keeps the URL space closed — only providers declared in PROVIDERS exist.
 */
function resolveProvider(req, res) {
  const { provider } = req.params;
  if (!isKnownProvider(provider)) {
    res.status(404).json({ error: 'Unknown integration provider.' });
    return null;
  }
  return provider;
}

function notConfigured(res, provider) {
  return res
    .status(503)
    .json({ error: `${PROVIDERS[provider].label} integration is not configured.` });
}

/**
 * GET /api/integrations/config
 *
 * Which integrations this deployment has credentials for. Env only — no
 * Composio round trip — so a surface can decide what to offer without paying
 * ~450ms per provider to ask whether a flow even exists.
 *
 * Declared before the `:provider` routes below, which would otherwise claim
 * this path. DataForSEO is included although it is not a Composio provider
 * and has no connect flow: it is our own key, enriching Search Console
 * candidates with competition and volume data, and a surface saying "enabled"
 * should be able to check rather than assume. Booleans only, never the
 * credentials themselves.
 */
export function integrationsConfig() {
  return {
    googleSearchConsole: isComposioConfigured(GSC),
    googleAnalytics: isComposioConfigured(GA),
    googleMerchantCenter: isComposioConfigured(GMC),
    dataForSeo: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
  };
}

router.get('/config', async (_req, res) => {
  return res.json(integrationsConfig());
});

// ─── Shared connect / status / disconnect ────────────────────────────────────
// Identical for every OAuth provider; only the auth config differs, which
// lives in the PROVIDERS map.

/**
 * GET /api/integrations/:provider/status
 * Resolves the live state against Composio (not just our stored row) and
 * syncs the row so teammates see the same state.
 */
router.get('/:provider/status', async (req, res) => {
  try {
    const provider = resolveProvider(req, res);
    if (!provider) return;

    if (!isComposioConfigured(provider)) {
      return res.json({ configured: false, status: 'not_configured' });
    }

    const profile = await getProfile(req.user.id);
    const entityId = entityIdFor(profile.organization_id);

    const active = await getActiveConnection(provider, entityId);
    if (active) {
      await upsertConnectionRow(profile.organization_id, provider, {
        composio_account_id: active.id,
        composio_entity_id: entityId,
        status: 'connected',
      });
      return res.json({ configured: true, status: 'connected', accountId: active.id });
    }

    // No active account on Composio — reflect that in our row if it claims
    // otherwise (revoked from the Google side, expired, etc.).
    const { data: row } = await supabaseAdmin
      .from('integration_connections')
      .select('status')
      .eq('organization_id', profile.organization_id)
      .eq('provider', provider)
      .maybeSingle();

    if (row?.status === 'connected') {
      await upsertConnectionRow(profile.organization_id, provider, {
        composio_account_id: null,
        composio_entity_id: entityId,
        status: 'disconnected',
      });
    }

    return res.json({ configured: true, status: 'not_connected' });
  } catch (err) {
    req.log.error({ err }, 'integrations status error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * POST /api/integrations/:provider/connect
 * Body: { callbackUrl } — where Composio sends the browser after consent.
 * Returns { redirectUrl } for the client to open.
 */
router.post('/:provider/connect', async (req, res) => {
  try {
    const provider = resolveProvider(req, res);
    if (!provider) return;

    if (!isComposioConfigured(provider)) return notConfigured(res, provider);

    const profile = await getProfile(req.user.id);
    if (!WRITE_ROLES.includes(profile.role)) {
      return res.status(403).json({ error: 'Only admins and managers can connect integrations.' });
    }

    const { callbackUrl } = req.body ?? {};
    if (typeof callbackUrl !== 'string' || !/^https?:\/\//.test(callbackUrl)) {
      return res.status(400).json({ error: 'callbackUrl is required' });
    }
    // Compare origins, not prefixes — PUBLIC_APP_URL may be misconfigured
    // with a path and must still validate correctly.
    const appUrl = process.env.PUBLIC_APP_URL;
    if (appUrl) {
      try {
        if (new URL(callbackUrl).origin !== new URL(appUrl).origin) {
          return res.status(400).json({ error: 'callbackUrl must be on the app origin' });
        }
      } catch {
        return res.status(400).json({ error: 'callbackUrl is not a valid URL' });
      }
    }

    const entityId = entityIdFor(profile.organization_id);
    const { redirectUrl, connectedAccountId } = await initiateConnection(
      provider,
      entityId,
      callbackUrl,
    );

    await upsertConnectionRow(profile.organization_id, provider, {
      composio_account_id: connectedAccountId,
      composio_entity_id: entityId,
      status: 'pending',
      connected_by: req.user.id,
    });

    return res.json({ redirectUrl });
  } catch (err) {
    req.log.error({ err }, 'integrations connect error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

/**
 * DELETE /api/integrations/:provider
 * Removes the connected account on Composio and resets our row.
 */
router.delete('/:provider', async (req, res) => {
  try {
    const provider = resolveProvider(req, res);
    if (!provider) return;

    if (!isComposioConfigured(provider)) return notConfigured(res, provider);

    const profile = await getProfile(req.user.id);
    if (!WRITE_ROLES.includes(profile.role)) {
      return res
        .status(403)
        .json({ error: 'Only admins and managers can disconnect integrations.' });
    }

    const entityId = entityIdFor(profile.organization_id);
    const active = await getActiveConnection(provider, entityId);
    if (active) {
      await deleteConnection(active.id);
    }

    const { error } = await supabaseAdmin
      .from('integration_connections')
      .delete()
      .eq('organization_id', profile.organization_id)
      .eq('provider', provider);
    if (error) throw new Error(`Failed to clear connection: ${error.message}`);

    return res.json({ success: true });
  } catch (err) {
    req.log.error({ err }, 'integrations disconnect error');
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Provider specific ───────────────────────────────────────────────────────
// Property listing differs per provider (a GSC property is a URL, a GA4
// property is a numeric id), and the query-stats sync has no Analytics
// equivalent yet, so these stay on explicit paths rather than under :provider.

const propertiesQuery = z.object({ brandId: z.guid().optional() });

/**
 * Assert that the caller may read through a brand's Google sign-in. A sign-in
 * lists the properties of every brand that uses it, and every brand uses the
 * Account's until the Brand settings cards (PR 15) let one use its own, so
 * the caller needs each of those brands (BRAND-ACCESS §5.2); before 00470,
 * when the sign-in is the Account's row, All brands.
 */
async function assertSignInReach(userId, connection) {
  const brandIds = await signInBrandIds(connection);
  if (brandIds === null) return assertAllBrands(userId);
  return assertEveryBrand(brandIds, userId);
}

/**
 * The live Composio target of the brand's sign-in for `provider`, or null
 * when it isn't connected (409). The caller checks the brand's access first;
 * this checks the sign-in's (assertSignInReach).
 */
async function brandSignIn(userId, brandId, provider) {
  const connection = await brandConnection(brandId, provider);
  if (!connection?.connected || !connection.entityId) return null;
  await assertSignInReach(userId, connection);
  const active = await getActiveConnection(
    provider,
    connection.entityId,
    connection.composioAccountId,
  );
  return active ? composioTarget(connection) : null;
}

/**
 * The Google sign-in a property list is read from, or null when it isn't
 * connected (409). Member-readable: the mapping UI is shown to everyone who
 * may see it; writes stay role-gated elsewhere.
 *   * `?brandId=`: the sign-in that brand uses (BRAND-ACCESS PR 14, 00470),
 *     for anyone who can access every brand that uses it (brandSignIn). The
 *     demo brand is everyone's sample data: it lists none.
 *   * Without one: the Account's own connection, as Settings › Integrations
 *     reads it today. That list serves every brand, so it needs All brands
 *     (BRAND-ACCESS §5.2).
 */
async function propertiesConnection(req, provider, brandId) {
  if (brandId) {
    const { brand } = await assertBrandAccess(brandId, req.user.id);
    if (brand.is_demo) return null;
    return brandSignIn(req.user.id, brand.id, provider);
  }

  await assertAllBrands(req.user.id);
  const profile = await getProfile(req.user.id);
  const entityId = entityIdFor(profile.organization_id);
  const active = await getActiveConnection(provider, entityId);
  return active ? { entityId, accountId: active.id } : null;
}

/**
 * GET /api/integrations/google-search-console/properties[?brandId=…]
 * Properties visible to the connected Google account (#642): the brand's, or
 * the Account's (propertiesConnection).
 */
router.get('/google-search-console/properties', async (req, res) => {
  const parsed = propertiesQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  try {
    if (!isComposioConfigured(GSC)) return notConfigured(res, GSC);

    const connection = await propertiesConnection(req, GSC, parsed.data.brandId);
    if (!connection) {
      return res.status(409).json({ error: 'Google Search Console is not connected.' });
    }

    const properties = await listGscSites(connection);
    return res.json({ properties });
  } catch (err) {
    req.log.error({ err }, 'integrations properties error');
    return res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

// Brand syncs started from the web app right after a property is mapped.
// Picking a property twice in quick succession must not run the same brand's
// sync twice at once.
const inFlightBrandSyncs = new Set();

/**
 * Start one brand's sync in the background, leaving the outcome to the log:
 * false when it is already running. A freshly mapped property otherwise has
 * no data until the nightly run, and suggestions built before then cannot
 * use it.
 */
function launchBrandSync(req, provider, brandId, run) {
  const key = `${provider}:${brandId}`;
  if (inFlightBrandSyncs.has(key)) return false;
  inFlightBrandSyncs.add(key);
  run({ brandId })
    .then((result) => req.log.info({ provider, brandId, result }, 'integrations brand sync done'))
    .catch((err) => req.log.error({ err, provider, brandId }, 'integrations brand sync failed'))
    .finally(() => inFlightBrandSyncs.delete(key));
  return true;
}

/** Start one brand's sync without holding the request open: answer 202 at once. */
function startBrandSync(req, res, provider, brandId, run) {
  return res.status(202).json({ started: launchBrandSync(req, provider, brandId, run) });
}

/**
 * Assert that the caller may sync the brand: they can access it, and every
 * brand that uses its sign-in (assertSignInReach), whose property the sync
 * reads through it.
 */
async function assertBrandSync(userId, brandId, provider) {
  await assertBrandAccess(brandId, userId);
  const connection = await brandConnection(brandId, provider);
  if (connection) await assertSignInReach(userId, connection);
}

const propertyBody = z.object({ property: z.string().min(1).max(2048).nullable() });

/**
 * PUT /api/integrations/{google-search-console,google-analytics}/brands/:brandId/property
 * Saves a brand's property pick (`{ property }`, null clears it) and starts
 * that brand's sync. For the admins and managers who can access the brand. A
 * property is checked against the list of the brand's own sign-in, read as
 * the property lists are (brandSignIn): a pick can't name a site or property
 * the brand's sign-in doesn't hold, and one the sign-in shares with brands
 * the caller wasn't given can't be picked at all.
 */
function propertyRoute({ provider, label, column, listIds, run }) {
  return async (req, res) => {
    const brandId = z.guid().safeParse(req.params.brandId);
    const body = propertyBody.safeParse(req.body ?? {});
    if (!brandId.success || !body.success) {
      return res.status(400).json({ error: 'Invalid request' });
    }
    try {
      if (!isComposioConfigured(provider)) return notConfigured(res, provider);

      const { brand, role } = await assertBrandAccess(brandId.data, req.user.id);
      if (!WRITE_ROLES.includes(role)) {
        return res.status(403).json({ error: 'Only admins and managers can map a property.' });
      }
      if (brand.is_demo) {
        return res.status(403).json({ error: "The demo brand's properties can't be changed." });
      }

      const { property } = body.data;
      if (property) {
        const target = await brandSignIn(req.user.id, brand.id, provider);
        if (!target) return res.status(409).json({ error: `${label} is not connected.` });
        const ids = await listIds(target);
        if (!ids.includes(property)) {
          return res.status(400).json({
            error: `That property isn't on the ${label} account this brand uses.`,
            code: 'unknown_property',
          });
        }
      }

      const { error } = await supabaseAdmin
        .from('brands')
        .update({ [column]: property })
        .eq('id', brand.id);
      if (error) throw new Error(`Failed to save the property: ${error.message}`);

      const syncStarted = property ? launchBrandSync(req, provider, brand.id, run) : false;
      return res.json({ saved: true, syncStarted });
    } catch (err) {
      req.log.error({ err }, 'integrations property save error');
      return res.status(err.status || 500).json({ error: err.message, code: err.code });
    }
  };
}

router.put(
  '/google-search-console/brands/:brandId/property',
  propertyRoute({
    provider: GSC,
    label: 'Google Search Console',
    column: 'gsc_property',
    listIds: async (target) => (await listGscSites(target)).map((site) => site.siteUrl),
    run: (args) => runGscSync(args),
  }),
);

router.put(
  '/google-analytics/brands/:brandId/property',
  propertyRoute({
    provider: GA,
    label: 'Google Analytics',
    column: 'ga_property_id',
    listIds: async (target) =>
      (await listGaProperties(target, { streams: false })).map((p) => p.propertyId),
    run: (args) => runGaSync(args),
  }),
);

/**
 * POST /api/integrations/google-search-console/sync
 * Runs the query-stats sync for the caller's org immediately (#644) —
 * testing and first-time backfill; the daily cycle runs the same sync.
 * With `{ brandId }` in the body it syncs that brand only, in the background,
 * for someone who may (assertBrandSync); without one, every brand, so it
 * needs All brands.
 */
router.post('/google-search-console/sync', async (req, res) => {
  try {
    if (!isComposioConfigured(GSC)) return notConfigured(res, GSC);

    const profile = await getProfile(req.user.id);
    if (!WRITE_ROLES.includes(profile.role)) {
      return res.status(403).json({ error: 'Only admins and managers can trigger a sync.' });
    }

    const brandId = req.body?.brandId;
    if (brandId) {
      await assertBrandSync(req.user.id, brandId, GSC);
      return startBrandSync(req, res, GSC, brandId, runGscSync);
    }

    await assertAllBrands(req.user.id);
    const result = await runGscSync({ organizationId: profile.organization_id });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'integrations sync error');
    return res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * GET /api/integrations/google-analytics/properties[?brandId=…]
 * GA4 properties visible to the connected Google account (#694): the
 * brand's, or the Account's, as the Search Console listing above.
 */
router.get('/google-analytics/properties', async (req, res) => {
  const parsed = propertiesQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  try {
    if (!isComposioConfigured(GA)) return notConfigured(res, GA);

    const connection = await propertiesConnection(req, GA, parsed.data.brandId);
    if (!connection) {
      return res.status(409).json({ error: 'Google Analytics is not connected.' });
    }

    const properties = await listGaProperties(connection);
    return res.json({ properties });
  } catch (err) {
    req.log.error({ err }, 'integrations GA properties error');
    return res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

/**
 * POST /api/integrations/google-analytics/sync
 * Runs the traffic sync for the caller's org immediately (#704) — testing and
 * first-time backfill; the daily cycle runs the same sync. With `{ brandId }`
 * in the body it syncs that brand only, in the background, for someone who
 * may (assertBrandSync); without one, every brand, so it needs All brands.
 */
router.post('/google-analytics/sync', async (req, res) => {
  try {
    if (!isComposioConfigured(GA)) return notConfigured(res, GA);

    const profile = await getProfile(req.user.id);
    if (!WRITE_ROLES.includes(profile.role)) {
      return res.status(403).json({ error: 'Only admins and managers can trigger a sync.' });
    }

    const brandId = req.body?.brandId;
    if (brandId) {
      await assertBrandSync(req.user.id, brandId, GA);
      return startBrandSync(req, res, GA, brandId, runGaSync);
    }

    await assertAllBrands(req.user.id);
    const result = await runGaSync({ organizationId: profile.organization_id });
    return res.json(result);
  } catch (err) {
    req.log.error({ err }, 'integrations GA sync error');
    return res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

const pageOpportunitiesQuery = z.object({
  brandId: z.guid(),
  // Inclusive days; either may be left open ("all time" sends neither).
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  // The card shows the best ten; an export asks for every finding (AT-015).
  limit: z.coerce.number().int().min(1).max(1000).optional(),
});

/**
 * GET /api/integrations/google-analytics/page-opportunities?brandId=…&from=…&to=…
 * The AI Traffic page's "Pages AI engines aren't sending traffic to" for the
 * range the page shows (AT-002): valuable pages with no AI visit from
 * Analytics or the tracking snippet in it. Reads synced data only, so it
 * needs no Composio call, and any member of the brand's org may read it.
 */
router.get('/google-analytics/page-opportunities', async (req, res) => {
  const parsed = pageOpportunitiesQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request' });
  const { brandId, from, to, limit } = parsed.data;

  try {
    await assertBrandAccess(brandId, req.user.id);
    const result = await detectPageOpportunitiesInWindow(brandId, {
      since: from ?? null,
      until: to ?? null,
      ...(limit ? { limit } : {}),
    });
    return res.json(result);
  } catch (err) {
    if (!err.status) req.log.error({ err }, 'integrations GA page opportunities error');
    return res.status(err.status || 500).json({ error: err.message, code: err.code });
  }
});

export default router;
