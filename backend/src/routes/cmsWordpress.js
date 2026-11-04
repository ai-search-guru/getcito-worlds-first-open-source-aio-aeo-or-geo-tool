import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { credentialsConfigured } from '../lib/catalog/credentials.js';
import { readCmsCredentials, saveCmsCredentials } from '../lib/cms/credentials.js';
import { WordPressError, checkSite, revokePassword, siteAddress } from '../lib/cms/wordpress.js';
import { cmsLimiter } from '../middleware/rateLimiter.js';
import { assertWriter, brandOf } from './cms.js';

/**
 * A brand's WordPress connection for Send to CMS (#1331, phase 2; 00294).
 * Members read a brand's connection; admins and managers connect the
 * brand's site with a user's Application Password, and disconnect:
 *   GET    /api/cms/brands/:brandId/wordpress                                 the connection, or none
 *   POST   /api/cms/brands/:brandId/wordpress { siteUrl, username, password } connect, or replace the sign-in
 *   DELETE /api/cms/brands/:brandId/wordpress                                 disconnect
 * The password passes through here once: it is checked with the site, then
 * sealed by the API (lib/cms/credentials.js). It is never stored in the
 * clear, logged or sent back.
 */

const router = Router();

const PROVIDER = 'wordpress';
const COLUMNS = 'id, brand_id, status, site_url, site_name, account, created_at, updated_at';

const connectInput = z.object({
  siteUrl: z.string().trim().min(1).max(2048),
  // A WordPress user name, or the user's e-mail: WordPress takes either.
  username: z.string().trim().min(1).max(200),
  // An Application Password: 24 letters and digits, shown in groups of four.
  password: z.string().trim().min(16).max(200),
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

/** The connection as the web shows it: never the password. */
const shape = (row) =>
  row
    ? {
        status: row.status,
        siteUrl: row.site_url,
        siteName: row.site_name,
        account: row.account,
        connectedAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

/**
 * Whether a new sign-in replaces the kept one: another site, user or
 * password (its spaces aside, as WordPress reads it). The same one typed
 * again isn't revoked.
 */
function replaced(before, old, site, credentials) {
  const bare = (password) => String(password ?? '').replace(/\s+/g, '');
  return (
    before.site_url !== site ||
    old.username !== credentials.username ||
    bare(old.password) !== bare(credentials.password)
  );
}

const WORDPRESS_STATUS = { invalid: 400, unreachable: 502, failed: 502 };

/** Answers a failure; logged by name only, since a message may quote what the person typed. */
function fail(req, res, err, what) {
  if (err instanceof WordPressError) {
    return res
      .status(WORDPRESS_STATUS[err.code] ?? 409)
      .json({ error: err.message, code: err.code });
  }
  if (err?.status && err.status < 500) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code ?? (err.status === 404 ? 'not_found' : 'forbidden'),
    });
  }
  req.log.error({ err: { name: err?.name } }, what);
  return res.status(500).json({ error: 'Something went wrong with WordPress', code: 'failed' });
}

// The API keeps WordPress's sign-in encrypted, under CONNECTOR_CREDENTIALS_KEY.
const notConfigured = (res) =>
  res
    .status(503)
    .json({ error: 'WordPress is not set up on this server.', code: 'not_configured' });

// GET — the brand's connection, for every member (Settings, the Send dialog).
router.get('/brands/:brandId/wordpress', async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertBrandAccess(id, req.user.id);
    return res.json({
      configured: credentialsConfigured(),
      connection: shape(await connectionOf(id)),
    });
  } catch (err) {
    return fail(req, res, err, 'cms wordpress read error');
  }
});

// POST — connect the brand's site, or replace its sign-in: checked with the site first.
router.post('/brands/:brandId/wordpress', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  const parsed = connectInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Enter the site’s address, a user and its Application Password.',
      code: 'invalid',
    });
  }
  try {
    await assertWriter(id, req.user.id);
    if (!credentialsConfigured()) return notConfigured(res);
    const site = siteAddress(parsed.data.siteUrl);
    const credentials = { username: parsed.data.username, password: parsed.data.password };
    const { siteName, account } = await checkSite(site, credentials);
    // The sign-in this one replaces, if any: revoked below once the new one is kept.
    const before = await connectionOf(id);
    const old = before ? await readCmsCredentials(before.id).catch(() => null) : null;
    const { data: row, error } = await supabaseAdmin
      .from('brand_cms_connections')
      .upsert(
        {
          brand_id: id,
          provider: PROVIDER,
          site_url: site,
          site_name: siteName,
          account,
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
      await saveCmsCredentials(row.id, credentials, { setBy: req.user.id });
    } catch (err) {
      // Connected without its sign-in, a send would use the one it replaced, on the new site.
      await supabaseAdmin
        .from('brand_cms_connections')
        .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      throw err;
    }
    if (old && replaced(before, old, site, credentials)) {
      await revokePassword(before.site_url, old);
    }
    return res.json({ connection: shape(row) });
  } catch (err) {
    return fail(req, res, err, 'cms wordpress connect error');
  }
});

// DELETE — disconnect: the Application Password revoked where the site allows, then the row (its sign-in with it).
router.delete('/brands/:brandId/wordpress', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertWriter(id, req.user.id);
    const row = await connectionOf(id);
    if (!row) return res.json({ success: true, revoked: false });
    let revoked = false;
    if (credentialsConfigured()) {
      const credentials = await readCmsCredentials(row.id).catch(() => null);
      if (credentials) revoked = await revokePassword(row.site_url, credentials);
    }
    const { error } = await supabaseAdmin.from('brand_cms_connections').delete().eq('id', row.id);
    if (error) throw new Error(error.message);
    // Not revoked: the person deletes the password under Users › Profile in WordPress.
    return res.json({ success: true, revoked });
  } catch (err) {
    return fail(req, res, err, 'cms wordpress disconnect error');
  }
});

export default router;
