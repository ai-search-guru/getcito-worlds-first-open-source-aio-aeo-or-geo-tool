import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { credentialsConfigured } from '../lib/catalog/credentials.js';
import { saveCmsCredentials } from '../lib/cms/credentials.js';
import { WixError, checkSite, siteIdOf } from '../lib/cms/wix.js';
import { cmsLimiter } from '../middleware/rateLimiter.js';
import { assertWriter, brandOf } from './cms.js';

/**
 * A brand's Wix connection for Send to CMS (#1331, phase 2; 00372). Members
 * read a brand's connection; admins and managers connect the brand's site
 * with an API key its owner made in Wix's API Keys Manager, and disconnect:
 *   GET    /api/cms/brands/:brandId/wix                       the connection, or none
 *   POST   /api/cms/brands/:brandId/wix { siteId, apiKey }    connect, or replace the key
 *   DELETE /api/cms/brands/:brandId/wix                       disconnect
 * The key passes through here once: it is checked with Wix, then sealed by
 * the API (lib/cms/credentials.js). It is never stored in the clear, logged
 * or sent back. Wix can't revoke it for us: the owner deletes it in the API
 * Keys Manager.
 */

const router = Router();

const PROVIDER = 'wix';
const COLUMNS = 'id, brand_id, status, site_id, site_name, account, created_at, updated_at';

const connectInput = z.object({
  // The site's id, or its dashboard's address with it.
  siteId: z.string().trim().min(1).max(2048),
  // A Wix API key: a long token from the API Keys Manager.
  apiKey: z.string().trim().min(20).max(4096),
});

async function connectionOf(id) {
  const { data, error } = await supabaseAdmin
    .from('brand_cms_connections')
    .select(COLUMNS)
    .eq('brand_id', id)
    .eq('provider', PROVIDER)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/** The connection as the web shows it: never the key. */
const shape = (row) =>
  row
    ? {
        status: row.status,
        siteId: row.site_id,
        siteName: row.site_name,
        connectedAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

const WIX_STATUS = { invalid: 400, unreachable: 502, failed: 502 };

/** Answers a failure; logged by name only, since a message may quote what the person typed. */
function fail(req, res, err, what) {
  if (err instanceof WixError) {
    return res.status(WIX_STATUS[err.code] ?? 409).json({ error: err.message, code: err.code });
  }
  if (err?.status && err.status < 500) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code ?? (err.status === 404 ? 'not_found' : 'forbidden'),
    });
  }
  req.log.error({ err: { name: err?.name } }, what);
  return res.status(500).json({ error: 'Something went wrong with Wix', code: 'failed' });
}

// The API keeps Wix's API key encrypted, under CONNECTOR_CREDENTIALS_KEY.
const notConfigured = (res) =>
  res.status(503).json({ error: 'Wix is not set up on this server.', code: 'not_configured' });

// GET — the brand's connection, for every member (Settings, the Send dialog).
router.get('/brands/:brandId/wix', async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertBrandAccess(id, req.user.id);
    return res.json({
      configured: credentialsConfigured(),
      connection: shape(await connectionOf(id)),
    });
  } catch (err) {
    return fail(req, res, err, 'cms wix read error');
  }
});

// POST — connect the brand's site, or replace its key: checked with Wix first.
router.post('/brands/:brandId/wix', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  const parsed = connectInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res
      .status(400)
      .json({ error: 'Enter the site’s id and an API key from Wix.', code: 'invalid' });
  }
  try {
    await assertWriter(id, req.user.id);
    if (!credentialsConfigured()) return notConfigured(res);
    const siteId = siteIdOf(parsed.data.siteId);
    const { apiKey } = parsed.data;
    const { siteName, memberId } = await checkSite(siteId, apiKey);
    const { data: row, error } = await supabaseAdmin
      .from('brand_cms_connections')
      .upsert(
        {
          brand_id: id,
          provider: PROVIDER,
          site_id: siteId,
          site_name: siteName,
          account: memberId,
          status: 'connected',
          connected_by: req.user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'brand_id,provider' },
      )
      .select(COLUMNS)
      .single();
    if (error) throw new Error(error.message);
    try {
      await saveCmsCredentials(row.id, { apiKey }, { setBy: req.user.id });
    } catch (err) {
      // Connected without its key, a send would use the one it replaced, on the new site.
      await supabaseAdmin
        .from('brand_cms_connections')
        .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      throw err;
    }
    return res.json({ connection: shape(row) });
  } catch (err) {
    return fail(req, res, err, 'cms wix connect error');
  }
});

// DELETE — disconnect: the row goes, its key with it. The owner deletes the key in Wix.
router.delete('/brands/:brandId/wix', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertWriter(id, req.user.id);
    const row = await connectionOf(id);
    if (row) {
      const { error } = await supabaseAdmin.from('brand_cms_connections').delete().eq('id', row.id);
      if (error) throw new Error(error.message);
    }
    return res.json({ success: true });
  } catch (err) {
    return fail(req, res, err, 'cms wix disconnect error');
  }
});

export default router;
