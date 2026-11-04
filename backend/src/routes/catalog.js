import express, { Router } from 'express';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { connectorFor, isSignIn, signInConnectors, storeConnectors } from '../connectors/index.js';
import { assertBrandAccess } from '../lib/access.js';
import { isComposioConfigured } from '../lib/composio.js';
import { CategoryPageError, categoryPages, setCategoryPage } from '../lib/catalog/categoryPages.js';
import { matchBrandLater } from '../lib/catalog/cardMatch.js';
import { credentialsConfigured } from '../lib/catalog/credentials.js';
import { syncSource } from '../lib/catalog/sources.js';
import {
  StoreError,
  connectSignInSource,
  connectStore,
  disconnectStore,
  listSignInAccounts,
  reconnectStore,
} from '../lib/catalog/stores.js';
import { catalogCategoryLimiter, catalogLimiter } from '../middleware/rateLimiter.js';

/**
 * A brand's catalog sources (#1263, 00279, 00282). Members see them through
 * RLS; admins and managers add and remove feed URLs there too. The server
 * syncs, and holds the stores' sign-ins:
 *   - POST /api/catalog/sources/:id/sync: a feed or a store read now;
 *   - POST /api/catalog/upload?brandId=…&format=…: a CSV (or XML) file as
 *     the request's body, kept as the brand's upload source;
 *   - GET /api/catalog/connectors: the stores a person can connect, and
 *     their fields; and the platforms read with the workspace's own
 *     sign-in (Google Merchant Center, #1270), and whether this server has
 *     that sign-in set up;
 *   - GET /api/catalog/accounts?brandId=…&kind=…: the accounts the
 *     workspace's sign-in opens on such a platform, to pick one;
 *   - POST /api/catalog/sources { brandId, kind, input }: a store connected,
 *     its sign-in checked with it and kept encrypted, then read; or a
 *     sign-in platform's account (`input.account`), checked, then read;
 *   - PUT /api/catalog/sources/:id/credentials { input }: its sign-in
 *     replaced;
 *   - GET /api/catalog/categories?brandId=…: the brand's categories, each
 *     with its products, how many are in stock, and its page on the site
 *     (shopping path): members read it;
 *   - PUT /api/catalog/categories { brandId, category, url }: a category's
 *     page set by hand (url), or set to none (null); DELETE with
 *     ?brandId=…&category=… puts it back to the automatic match;
 *   - DELETE /api/catalog/sources/:id: a store removed, with its sign-in and
 *     its products.
 *
 * A sync here that reads the catalog has the brand's AI shopping cards
 * matched to it right after, without waiting (matchAfter).
 */

const router = Router();

const WRITE_ROLES = ['admin', 'manager'];
/** What the API's proxy takes in one request; a larger catalog is a feed URL. */
export const UPLOAD_MAX = '4mb';
/** A feed synced this recently isn't read again on demand. */
const RESYNC_AFTER_MS = 2 * 60 * 1000;
const FORMATS = ['auto', 'google_xml', 'csv', 'meta_csv'];

/** Throws a 403 unless the person is an admin or a manager of the brand's workspace; `may` says what for. */
async function assertWriter(brandId, userId, may = 'sync the catalog') {
  await assertBrandAccess(brandId, userId);
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single();
  if (!WRITE_ROLES.includes(profile?.role)) {
    const err = new Error(`Only admins and managers can ${may}.`);
    err.status = 403;
    throw err;
  }
}

/** The response to a route's error; `failed` is what a 500 says. */
function fail(req, res, err, what, failed = 'Failed to sync the catalog') {
  if (err instanceof CategoryPageError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err instanceof StoreError) {
    return res.status(err.status).json({ error: err.message, code: err.code });
  }
  if (err?.status === 403 || err?.status === 404) {
    // An access refusal keeps its own code (not_in_workspace, no_brand_access);
    // this file's role refusals and lookups carry none.
    return res.status(err.status).json({
      error: err.message,
      code: err.code ?? (err.status === 404 ? 'not_found' : 'forbidden'),
    });
  }
  req.log.error({ err: { name: err?.name, message: err?.message } }, what);
  return res.status(500).json({ error: failed, code: 'failed' });
}

const outcomeBody = (outcome) => ({
  status: outcome.status,
  error: outcome.error ?? null,
  counts: outcome.counts ?? null,
});

const SOURCE_COLUMNS =
  'id, brand_id, kind, format, url, account, label, last_synced_at, last_orders_synced_at';
/** The kinds members add themselves; every other kind is a store's. */
const OWN_KINDS = ['feed_url', 'upload'];

async function sourceById(id) {
  const parsed = z.guid().safeParse(id);
  if (!parsed.success) return null;
  const { data } = await supabaseAdmin
    .from('catalog_sources')
    .select(SOURCE_COLUMNS)
    .eq('id', parsed.data)
    .maybeSingle();
  return data ?? null;
}

/**
 * After a sync that read the catalog, the brand's recent AI shopping cards
 * matched to it in the background (cardMatch.js): the daily sweep would
 * match them only the next day, and the Shelf would count none of the
 * brand's products until then.
 */
function matchAfter(source, outcome) {
  if (outcome?.status === 'ok') matchBrandLater(source.brand_id);
}

/** A store's first read, or its read after a new sign-in: not waited on, recorded on its row. */
function syncLater(req, source) {
  syncSource(source)
    .then((outcome) => matchAfter(source, outcome))
    .catch((err) =>
      req.log.error({ err: { name: err?.name }, sourceId: source.id }, 'catalog store sync error'),
    );
}

// GET /api/catalog/connectors — the stores a person can connect, and the sign-in platforms.
router.get('/connectors', (req, res) => {
  res.json({
    connectors: storeConnectors(),
    ready: credentialsConfigured(),
    signIns: signInConnectors().map((c) => ({
      ...c,
      configured: isComposioConfigured(c.provider),
    })),
  });
});

const KIND = z.string().regex(/^[a-z][a-z0-9_]{1,39}$/);

// GET /api/catalog/accounts?brandId=…&kind=… — the accounts the workspace's sign-in opens.
router.get('/accounts', catalogLimiter, async (req, res) => {
  const parsed = z.object({ brandId: z.guid(), kind: KIND }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    await assertWriter(parsed.data.brandId, req.user.id);
    return res.json({ accounts: await listSignInAccounts(parsed.data) });
  } catch (err) {
    return fail(req, res, err, 'catalog accounts error');
  }
});

const connectBody = z.object({
  brandId: z.guid(),
  kind: KIND,
  input: z.record(z.string(), z.string()),
});

// POST /api/catalog/sources — connect a store, or a sign-in platform's account.
router.post('/sources', catalogLimiter, async (req, res) => {
  const parsed = connectBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  const { brandId, kind, input } = parsed.data;
  try {
    await assertWriter(brandId, req.user.id);
    const connect = isSignIn(connectorFor(kind)) ? connectSignInSource : connectStore;
    const source = await connect({ brandId, kind, input, userId: req.user.id });
    syncLater(req, source);
    return res.status(201).json({ id: source.id, account: source.account });
  } catch (err) {
    return fail(req, res, err, 'catalog store connect error');
  }
});

// PUT /api/catalog/sources/:id/credentials — replace a store's sign-in.
router.put('/sources/:id/credentials', catalogLimiter, async (req, res) => {
  const parsed = z.object({ input: z.record(z.string(), z.string()) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const source = await sourceById(req.params.id);
    if (!source || OWN_KINDS.includes(source.kind)) {
      return res.status(404).json({ error: 'Not found', code: 'not_found' });
    }
    await assertWriter(source.brand_id, req.user.id);
    await reconnectStore({ source, input: parsed.data.input, userId: req.user.id });
    syncLater(req, source);
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err, 'catalog store reconnect error');
  }
});

// DELETE /api/catalog/sources/:id — remove a store (feeds and uploads are removed through RLS).
router.delete('/sources/:id', catalogLimiter, async (req, res) => {
  try {
    const source = await sourceById(req.params.id);
    if (!source || OWN_KINDS.includes(source.kind)) {
      return res.status(404).json({ error: 'Not found', code: 'not_found' });
    }
    await assertWriter(source.brand_id, req.user.id);
    await disconnectStore(source);
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err, 'catalog store disconnect error');
  }
});

// POST /api/catalog/sources/:id/sync — read a feed or a store now.
router.post('/sources/:id/sync', catalogLimiter, async (req, res) => {
  const parsed = z.guid().safeParse(req.params.id);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    const source = await sourceById(parsed.data);
    if (!source || source.kind === 'upload') {
      return res.status(404).json({ error: 'Not found', code: 'not_found' });
    }
    await assertWriter(source.brand_id, req.user.id);
    if (source.last_synced_at && Date.now() - Date.parse(source.last_synced_at) < RESYNC_AFTER_MS) {
      return res.status(409).json({ error: 'Synced a moment ago', code: 'recent' });
    }
    const outcome = await syncSource(source);
    matchAfter(source, outcome);
    return res.json(outcomeBody(outcome));
  } catch (err) {
    return fail(req, res, err, 'catalog sync error');
  }
});

const CHANGE_CATEGORY_PAGES = "change the catalog's category pages";
const CATEGORY_PAGES_FAILED = "Failed to change the catalog's category pages";

// GET /api/catalog/categories?brandId=… — the brand's categories and their pages.
// A read like the API's others: the general limiter only.
router.get('/categories', async (req, res) => {
  const parsed = z.object({ brandId: z.guid() }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    await assertBrandAccess(parsed.data.brandId, req.user.id);
    return res.json({ categories: await categoryPages(parsed.data.brandId) });
  } catch (err) {
    return fail(
      req,
      res,
      err,
      'catalog categories error',
      "Failed to read the catalog's category pages",
    );
  }
});

const categoryBody = z.object({
  brandId: z.guid(),
  category: z.string().min(1).max(750),
  url: z.string().max(2048).nullable(),
});

// PUT /api/catalog/categories — a category's page set by hand, or none (a
// category the catalog has: 404 otherwise). Writes, here and in DELETE, take
// a bucket of their own, apart from the syncs'.
router.put('/categories', catalogCategoryLimiter, async (req, res) => {
  const parsed = categoryBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    await assertWriter(parsed.data.brandId, req.user.id, CHANGE_CATEGORY_PAGES);
    await setCategoryPage({ ...parsed.data, userId: req.user.id });
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err, 'catalog category page error', CATEGORY_PAGES_FAILED);
  }
});

// DELETE /api/catalog/categories?brandId=…&category=… — back to the automatic match.
router.delete('/categories', catalogCategoryLimiter, async (req, res) => {
  const parsed = categoryBody.omit({ url: true }).safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: 'invalid', code: 'invalid' });
  try {
    await assertWriter(parsed.data.brandId, req.user.id, CHANGE_CATEGORY_PAGES);
    await setCategoryPage({ ...parsed.data, url: undefined, userId: req.user.id });
    return res.json({ ok: true });
  } catch (err) {
    return fail(req, res, err, 'catalog category page error', CATEGORY_PAGES_FAILED);
  }
});

// POST /api/catalog/upload?brandId=…&format=… — a file's text as the body.
router.post(
  '/upload',
  catalogLimiter,
  express.text({ type: () => true, limit: UPLOAD_MAX }),
  async (req, res) => {
    const parsed = z
      .object({ brandId: z.guid(), format: z.enum(FORMATS).default('auto') })
      .safeParse(req.query);
    if (!parsed.success || typeof req.body !== 'string' || !req.body.trim()) {
      return res.status(400).json({ error: 'invalid', code: 'invalid' });
    }
    const { brandId, format } = parsed.data;
    try {
      await assertWriter(brandId, req.user.id);
      // The brand's one upload source: made on its first upload, its format kept.
      let { data: source } = await supabaseAdmin
        .from('catalog_sources')
        .select('id, brand_id, kind, format, url')
        .eq('brand_id', brandId)
        .eq('kind', 'upload')
        .maybeSingle();
      if (!source) {
        const { data, error } = await supabaseAdmin
          .from('catalog_sources')
          .insert({ brand_id: brandId, kind: 'upload', format, created_by: req.user.id })
          .select('id, brand_id, kind, format, url')
          .single();
        if (error?.code === '23514') {
          return res.status(409).json({ error: error.message, code: 'too_many' });
        }
        if (error) throw new Error(error.message);
        source = data;
      } else if (source.format !== format) {
        await supabaseAdmin.from('catalog_sources').update({ format }).eq('id', source.id);
        source = { ...source, format };
      }
      const outcome = await syncSource(source, { text: req.body });
      matchAfter(source, outcome);
      return res.json(outcomeBody(outcome));
    } catch (err) {
      return fail(req, res, err, 'catalog upload error');
    }
  },
);

// A body over UPLOAD_MAX: said, not a 500.
router.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'The file is larger than 4 MB', code: 'too_large' });
  }
  return next(err);
});

export default router;
