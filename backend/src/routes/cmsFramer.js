import { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { assertBrandAccess } from '../lib/access.js';
import { credentialsConfigured } from '../lib/catalog/credentials.js';
import { readCmsCredentials, saveCmsCredentials } from '../lib/cms/credentials.js';
import {
  FramerError,
  checkFieldMap,
  checkProject,
  collectionOf,
  listCollections,
  projectRef,
} from '../lib/cms/framer.js';
import { cmsLimiter } from '../middleware/rateLimiter.js';
import { assertWriter, brandOf } from './cms.js';

/**
 * A brand's Framer connection for Send to CMS (#1331, phase 2; 00295).
 * Members read a brand's connection; admins and managers connect the
 * brand's project with an API key made in it, pick the collection pages go
 * to and its fields, and disconnect:
 *   GET    /api/cms/brands/:brandId/framer                             the connection, or none
 *   POST   /api/cms/brands/:brandId/framer { project, apiKey }         connect, or replace the key
 *   GET    /api/cms/brands/:brandId/framer/collections                 the project's collections, with their fields
 *   PUT    /api/cms/brands/:brandId/framer { collectionId, fieldMap }  where pages go
 *   DELETE /api/cms/brands/:brandId/framer                             disconnect
 * The key passes through here once: it is checked with Framer, then sealed
 * by the API (lib/cms/credentials.js). It is never stored in the clear,
 * logged or sent back. Framer can't revoke a key through its API: the
 * person deletes it in the project.
 */

const router = Router();

const PROVIDER = 'framer';
const COLUMNS =
  'id, brand_id, status, site_id, site_name, site_url, account, collection_id, collection_name, field_map, created_at, updated_at';

const connectInput = z.object({
  // The project's address (framer.com/projects/…) or its id, read by projectRef().
  project: z.string().trim().min(1).max(2048),
  // A Framer API key: no spaces.
  apiKey: z.string().trim().min(8).max(512).regex(/^\S+$/),
});
// A Framer id (a collection's, a field's): compared with the project's own, never trusted.
const framerId = z
  .string()
  .trim()
  .max(100)
  .regex(/^[\x21-\x7e]*$/);
const part = framerId.nullable().optional();
const mapInput = z.object({
  collectionId: framerId.min(1),
  // The parts of a page, each a field's id or none; no other key.
  fieldMap: z
    .object({
      title: part,
      body: part,
      metaTitle: part,
      metaDescription: part,
      jsonLd: part,
      reviewer: part,
    })
    .strict(),
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
        projectId: row.site_id,
        projectName: row.site_name,
        siteUrl: row.site_url,
        account: row.account,
        collectionId: row.collection_id,
        collectionName: row.collection_name,
        fieldMap: row.field_map ?? {},
        connectedAt: row.created_at,
        updatedAt: row.updated_at,
      }
    : null;

/** A brand that must have a connection to go on. */
async function connected(id) {
  const row = await connectionOf(id);
  if (!row) {
    const err = new Error('Connect Framer first.');
    err.status = 409;
    err.code = 'not_connected';
    throw err;
  }
  return row;
}

/**
 * Sets the status of the connection as it was read: one connected again
 * meanwhile keeps its own.
 */
async function setStatus(row, status) {
  const { error } = await supabaseAdmin
    .from('brand_cms_connections')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', row.id)
    .eq('provider', PROVIDER)
    .eq('updated_at', row.updated_at);
  if (error) throw new Error(error.message);
}

/**
 * The connection's key, or 'auth_failed' when it has none the API can open.
 * A failed read throws as it is: the key may be fine.
 */
async function keyOf(row) {
  const credentials = await readCmsCredentials(row.id);
  if (!credentials?.apiKey) {
    throw new FramerError('auth_failed', 'The Framer API key can’t be read. Connect Framer again.');
  }
  return credentials.apiKey;
}

const FRAMER_STATUS = {
  invalid: 400,
  no_access: 403,
  not_found: 404,
  busy: 429,
  unreachable: 502,
  failed: 502,
};

/**
 * Answers a failure: a key Framer refuses marks the connection that was
 * read (`row`) auth_failed, so Settings asks for a new one. Logged by name
 * only, since a message may quote what the person typed.
 */
async function fail(req, res, err, what, row) {
  if (err instanceof FramerError) {
    if (err.code === 'auth_failed' && row) {
      await setStatus(row, 'auth_failed').catch((e) =>
        req.log.warn({ err: { name: e?.name } }, 'cms framer refusal not kept'),
      );
    }
    return res.status(FRAMER_STATUS[err.code] ?? 409).json({ error: err.message, code: err.code });
  }
  if (err?.status && err.status < 500) {
    return res.status(err.status).json({
      error: err.message,
      code: err.code ?? (err.status === 404 ? 'not_found' : 'forbidden'),
    });
  }
  req.log.error({ err: { name: err?.name } }, what);
  return res.status(500).json({ error: 'Something went wrong with Framer', code: 'failed' });
}

// The API keeps Framer's key encrypted, under CONNECTOR_CREDENTIALS_KEY.
const notConfigured = (res) =>
  res.status(503).json({ error: 'Framer is not set up on this server.', code: 'not_configured' });

// GET — the brand's connection, for every member (Settings, the Send dialog).
router.get('/brands/:brandId/framer', async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertBrandAccess(id, req.user.id);
    return res.json({
      configured: credentialsConfigured(),
      connection: shape(await connectionOf(id)),
    });
  } catch (err) {
    return fail(req, res, err, 'cms framer read error');
  }
});

// POST — connect the brand's project, or replace its key: checked with Framer first.
router.post('/brands/:brandId/framer', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  const parsed = connectInput.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: 'Paste the project’s address and an API key made in it.',
      code: 'invalid',
    });
  }
  try {
    await assertWriter(id, req.user.id);
    if (!credentialsConfigured()) return notConfigured(res);
    const project = projectRef(parsed.data.project);
    const { apiKey } = parsed.data;
    const checked = await checkProject(project, apiKey);
    // A new key for the same project keeps where pages go; another project starts over.
    const before = await connectionOf(id);
    const kept = before?.site_id === checked.projectId ? before : null;
    const { data: row, error } = await supabaseAdmin
      .from('brand_cms_connections')
      .upsert(
        {
          brand_id: id,
          provider: PROVIDER,
          site_id: checked.projectId,
          site_name: checked.projectName,
          site_url: checked.siteUrl,
          account: checked.account,
          collection_id: kept?.collection_id ?? null,
          collection_name: kept?.collection_name ?? null,
          field_map: kept?.field_map ?? {},
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
      // Connected without its key, a send would use the one it replaced, maybe another project's.
      await supabaseAdmin
        .from('brand_cms_connections')
        .update({ status: 'auth_failed', updated_at: new Date().toISOString() })
        .eq('id', row.id);
      throw err;
    }
    return res.json({ connection: shape(row) });
  } catch (err) {
    return fail(req, res, err, 'cms framer connect error');
  }
});

// GET — the project's collections pages may go to, with their fields.
router.get('/brands/:brandId/framer/collections', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  let row = null;
  try {
    await assertWriter(id, req.user.id);
    if (!credentialsConfigured()) return notConfigured(res);
    row = await connected(id);
    const collections = await listCollections(row.site_id, await keyOf(row));
    // Framer took the key again: a connection marked refused is connected.
    if (row.status === 'auth_failed') await setStatus(row, 'connected');
    return res.json({ collections });
  } catch (err) {
    return fail(req, res, err, 'cms framer collections error', row);
  }
});

// PUT — where the brand's pages go: the collection and its fields.
router.put('/brands/:brandId/framer', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  let row = null;
  try {
    await assertWriter(id, req.user.id);
    if (!credentialsConfigured()) return notConfigured(res);
    const parsed = mapInput.safeParse(req.body ?? {});
    if (!parsed.success)
      return res.status(400).json({ error: 'Invalid settings', code: 'invalid' });
    row = await connected(id);
    const { collectionId, fieldMap } = parsed.data;
    const collection = await collectionOf(row.site_id, await keyOf(row), collectionId);
    const checked = checkFieldMap(fieldMap, collection.fields);
    if (!checked.ok) {
      return res.status(400).json({
        error: 'The fields don’t fit the collection.',
        code: 'invalid_map',
        problems: checked.problems,
      });
    }

    const { data: saved, error } = await supabaseAdmin
      .from('brand_cms_connections')
      .update({
        status: 'connected',
        collection_id: collection.id,
        collection_name: collection.name,
        field_map: checked.map,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('provider', PROVIDER)
      // The connection it was checked with: one connected again or removed meanwhile isn't overwritten.
      .eq('updated_at', row.updated_at)
      .select(COLUMNS)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!saved) {
      const err = new Error(
        'Framer’s connection changed while this was saved. Reload and try again.',
      );
      err.status = 409;
      err.code = 'changed';
      throw err;
    }
    return res.json({ connection: shape(saved) });
  } catch (err) {
    return fail(req, res, err, 'cms framer settings error', row);
  }
});

// DELETE — disconnect: the row goes, its key with it.
router.delete('/brands/:brandId/framer', cmsLimiter, async (req, res) => {
  const id = brandOf(req, res);
  if (!id) return;
  try {
    await assertWriter(id, req.user.id);
    const row = await connectionOf(id);
    if (row) {
      const { error } = await supabaseAdmin.from('brand_cms_connections').delete().eq('id', row.id);
      if (error) throw new Error(error.message);
    }
    // Framer has no API to revoke a key: the person deletes it in the project's Site Settings › General.
    return res.json({ success: true, revoked: false });
  } catch (err) {
    return fail(req, res, err, 'cms framer disconnect error');
  }
});

export default router;
