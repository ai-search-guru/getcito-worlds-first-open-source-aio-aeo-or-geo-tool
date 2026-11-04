import supabaseAdmin from '../config/supabase.js';
import { selectInChunks } from '../lib/chunkedIn.js';
import logger from '../lib/logger.js';

/**
 * The demo brand is read-only (00380).
 *
 * A demo brand is an ordinary brand row in the organization, filled with
 * sample data by the server (lib/demo). People explore every page of it,
 * but nothing they ask of it may change that data or start a cost:
 * tracking, scraping, AI, audits, outside services, sends. So every
 * signed-in request that writes (any method but GET, HEAD and OPTIONS) and
 * names a demo brand is refused with 402 demo_brand, on the cloud and
 * self-hosted alike, whatever the plan: the web app opens the plan dialog
 * with the demo's offer.
 *
 * Every write route under /api is named here, route by route:
 *   - DEMO_GUARDED: where the request names its brand (the path, the body,
 *     the query, or a row of the brand's it acts on). The request is
 *     refused when that brand is a demo brand.
 *   - DEMO_OPEN: routes that name no brand (the organization's own, or
 *     onboarding's), or that stop work and never start any, or that answer
 *     a demo brand themselves; each with the reason.
 * demoBrand.test.js reads the route files and fails on a write route that
 * is in neither list, so a new one can't ship without saying which it is.
 * Reads and exports stay open.
 *
 * A row the request names that isn't found (or an id of the wrong shape) is
 * left to the route, which answers 400 or 404 itself.
 */

const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** The answer to a write or a cost on a demo brand. */
export const DEMO_BRAND = {
  success: false,
  error: 'plan_limit',
  code: 'demo_brand',
  message:
    'This is the demo brand, with sample data to explore. Choose a plan to do this for your own brand.',
};

// ─── Where a request names its brand ────────────────────────────────────────

/** The brand's id itself: in the path (a `:name` of the route), the body or the query. */
const brandIn = (where, key = 'brandId') => ({ where, key });

/**
 * A row (or rows: an array of ids) of `table` whose brand the request acts
 * on, by its id in the path, the body or the query.
 */
const rowIn = (table, where, key = 'id') => ({ table, where, key });

/** How a row of a table without its own brand_id reaches its brand. */
const OWNERS = {
  // Prompts belong to a brand through their prompt set.
  prompts: { select: 'id, prompt_sets!inner(brand_id)', brand: (row) => row.prompt_sets?.brand_id },
  // Tasks belong to a brand through their action.
  action_tasks: { select: 'id, actions!inner(brand_id)', brand: (row) => row.actions?.brand_id },
};
const BRAND_COLUMN = { select: 'id, brand_id', brand: (row) => row.brand_id };

/** `METHOD /path` (Express's own path syntax, under /api) and where it names its brand. */
const guard = (route, ...sources) => ({ route, sources });

/** `METHOD /path` that names no demo brand to refuse, and why. */
const open = (route, why) => ({ route, why });

/**
 * The write routes refused on a demo brand: every one that changes a
 * brand's data or starts work for it.
 */
export const DEMO_GUARDED = [
  // Action Center (actionCenter.js).
  guard('POST /action-center/signals/:id/rescore', rowIn('signals', 'path')),
  guard('POST /action-center/actions/:id/tasks/regenerate', rowIn('actions', 'path')),
  guard('DELETE /action-center/actions/:id', rowIn('actions', 'path')),
  guard('POST /action-center/tasks/:id/send', rowIn('action_tasks', 'path')),
  guard('POST /action-center/tasks/:id/check', rowIn('action_tasks', 'path')),
  guard('POST /action-center/pages', brandIn('body')),
  guard('POST /action-center/audits', brandIn('body')),
  guard('POST /action-center/products', brandIn('body')),
  guard('POST /action-center/content-drafts', brandIn('body')),
  guard('POST /action-center/chat-actions', brandIn('body')),
  guard('POST /action-center/chat-actions/check', brandIn('body')),

  // Site Audit (audits.js).
  guard('POST /audits', brandIn('body')),
  guard('POST /audits/bulk', brandIn('body')),
  guard('PUT /audits/opportunities/prefs', brandIn('body')),
  guard('PUT /audits/settings', brandIn('body')),
  guard('DELETE /audits/:id', rowIn('site_audits', 'path')),

  // AI-bot log connections (bots.js): the demo's are samples; removing one
  // would revoke a secret that was never given out.
  guard('POST /bots/connections/:brandId', brandIn('path')),
  guard('DELETE /bots/connections/:brandId/:id', brandIn('path')),

  // Brand facts (brandFacts.js): reading the site again, approving a fact.
  guard('POST /brand-facts/fetch', brandIn('body')),
  guard('PATCH /brand-facts/:id', rowIn('brand_facts', 'path')),

  // Brands (brands.js): reading the site's home page, and AI, for its kind,
  // and for the tracking snippet (a demo brand's site is a sample).
  guard('POST /brands/:id/detect-site-type', brandIn('path', 'id')),
  guard('POST /brands/:id/tracking-snippet/check', brandIn('path', 'id')),

  // Product catalog (catalog.js): the demo's stores are samples, so neither
  // connecting, syncing nor removing one may reach a store.
  guard('POST /catalog/sources', brandIn('body')),
  guard('PUT /catalog/sources/:id/credentials', rowIn('catalog_sources', 'path')),
  guard('DELETE /catalog/sources/:id', rowIn('catalog_sources', 'path')),
  guard('POST /catalog/sources/:id/sync', rowIn('catalog_sources', 'path')),
  guard('PUT /catalog/categories', brandIn('body')),
  guard('DELETE /catalog/categories', brandIn('query')),
  guard('POST /catalog/upload', brandIn('query')),

  // Webflow (cms.js): the demo's connection is a sample.
  guard('POST /cms/brands/:brandId/webflow', brandIn('path')),
  guard('PUT /cms/brands/:brandId/webflow', brandIn('path')),
  guard('DELETE /cms/brands/:brandId/webflow', brandIn('path')),

  // WordPress, Framer and Wix (cmsWordpress.js, cmsFramer.js, cmsWix.js):
  // a connection would reach a real site.
  guard('POST /cms/brands/:brandId/wordpress', brandIn('path')),
  guard('DELETE /cms/brands/:brandId/wordpress', brandIn('path')),
  guard('POST /cms/brands/:brandId/framer', brandIn('path')),
  guard('PUT /cms/brands/:brandId/framer', brandIn('path')),
  guard('DELETE /cms/brands/:brandId/framer', brandIn('path')),
  guard('POST /cms/brands/:brandId/wix', brandIn('path')),
  guard('DELETE /cms/brands/:brandId/wix', brandIn('path')),

  // Content Editor (contentDrafts.js): the draft's brand is in the body;
  // the draft itself is checked too.
  guard('POST /content-drafts/send', brandIn('body')),
  guard('POST /content-drafts/publish-cms', brandIn('body')),
  guard('POST /content-drafts/:draftId/publish', rowIn('content_drafts', 'path', 'draftId')),
  guard('POST /content-drafts/:draftId/take-down', rowIn('content_drafts', 'path', 'draftId')),
  guard('POST /content-drafts/webflow-status', brandIn('body')),
  guard('POST /content-drafts/wordpress-status', brandIn('body')),
  guard('POST /content-drafts/framer-status', brandIn('body')),
  guard('POST /content-drafts/wix-status', brandIn('body')),
  guard(
    'POST /content-drafts/:draftId/brief',
    brandIn('body'),
    rowIn('content_drafts', 'path', 'draftId'),
  ),
  guard(
    'POST /content-drafts/:draftId/shopping-path',
    brandIn('body'),
    rowIn('content_drafts', 'path', 'draftId'),
  ),
  guard(
    'POST /content-drafts/:draftId/suggestions',
    brandIn('body'),
    rowIn('content_drafts', 'path', 'draftId'),
  ),
  guard(
    'POST /content-drafts/:draftId/handoff',
    brandIn('body'),
    rowIn('content_drafts', 'path', 'draftId'),
  ),
  guard(
    'POST /content-drafts/:draftId/write',
    brandIn('body'),
    rowIn('content_drafts', 'path', 'draftId'),
  ),
  guard(
    'POST /content-drafts/:draftId/rewrite',
    brandIn('body'),
    rowIn('content_drafts', 'path', 'draftId'),
  ),

  // The editor's page checks (contentPages.js): pages read, AI asked.
  guard('POST /content-pages/import', brandIn('body')),
  guard('POST /content-pages/links', rowIn('content_drafts', 'body', 'draftId')),
  guard('POST /content-pages/source-classes', rowIn('content_drafts', 'body', 'draftId')),
  guard('POST /content-pages/claims', rowIn('content_drafts', 'body', 'draftId')),
  guard('POST /content-pages/page-read', rowIn('content_drafts', 'body', 'draftId')),

  // Content opportunities (content.js).
  guard('POST /content/generate', brandIn('body')),
  guard('POST /content/opportunities/generate', brandIn('body')),
  guard('POST /content/:id/alternative', rowIn('content_opportunities', 'path')),
  guard('POST /content/prompts/:promptId/suggest', rowIn('prompts', 'path', 'promptId')),
  guard('POST /content/bulk/status', rowIn('content_opportunities', 'body', 'ids')),
  guard('POST /content/bulk/delete', rowIn('content_opportunities', 'body', 'ids')),
  guard('POST /content/bulk/send-webhook', rowIn('content_opportunities', 'body', 'ids')),
  guard('PATCH /content/:id/status', rowIn('content_opportunities', 'path')),
  guard('POST /content/:id/send-webhook', rowIn('content_opportunities', 'path')),
  guard('POST /content/webhook-test', brandIn('body')),
  guard('POST /content/:id/brief', rowIn('content_opportunities', 'path')),
  guard('POST /content/:id/action', rowIn('content_opportunities', 'path')),

  // Search Console and Analytics (integrations.js): one brand's sync. Without
  // a brand, the organization's sync, which skips demo brands itself.
  guard('POST /integrations/google-search-console/sync', brandIn('body')),
  guard('POST /integrations/google-analytics/sync', brandIn('body')),
  // A brand's property pick (the route refuses the demo brand itself too).
  guard('PUT /integrations/google-search-console/brands/:brandId/property', brandIn('path')),
  guard('PUT /integrations/google-analytics/brands/:brandId/property', brandIn('path')),

  // Mentions (mentions.js).
  guard('POST /mentions/action', brandIn('body')),

  // Prompts (prompts.js).
  guard('POST /prompts/suggestions/:brandId/refresh', brandIn('path')),
  guard('POST /prompts/suggestions/:brandId/page', brandIn('path')),
  guard('POST /prompts/suggestions/:id/dismiss', rowIn('prompt_suggestions', 'path')),
  guard('POST /prompts/suggestions/:id/accept', rowIn('prompt_suggestions', 'path')),
  guard('POST /prompts/:promptId/improve', rowIn('prompts', 'path', 'promptId')),
  guard('POST /prompts/:promptId/improve/action', rowIn('prompts', 'path', 'promptId')),

  // Reports (reports.js): an AI summary.
  guard('POST /reports/summary', brandIn('body')),

  // Topics (topics.js).
  guard('POST /topics/suggestions/:brandId/refresh', brandIn('path')),
  guard('POST /topics/suggestions/:id/dismiss', rowIn('topic_suggestions', 'path')),
  guard('POST /topics/suggestions/:id/accept', rowIn('topic_suggestions', 'path')),
  guard('POST /topics/:id/gap-action', rowIn('topics', 'path')),
  guard('POST /topics/:id/opportunity-action', rowIn('topics', 'path')),

  // Tracking (tracking.js): "Run now" and the new prompts' first run.
  guard('POST /tracking/check', brandIn('body')),
  guard('POST /tracking/analyze-new', brandIn('body')),

  // Volumes (volumes.js): DataForSEO and the model.
  guard('POST /volumes/analyze', rowIn('prompts', 'body', 'promptId')),
  guard('POST /volumes/analyze-batch', brandIn('body')),
  guard('POST /volumes/bootstrap', brandIn('body')),
  guard('POST /volumes/refresh', brandIn('body')),
];

/** The write routes left open on a demo brand, and why. */
export const DEMO_OPEN = [
  open(
    'POST /content-drafts/:draftId/audit-estimate',
    "Site Audit's estimate of a draft: its page checks are free and write nothing; its AI checks, which spend, refuse the demo brand in the route itself, so its sample drafts still get an estimate.",
  ),
  open(
    'POST /billing/cancel-feedback',
    "The organization's own: why its plan is cancelled. Names no brand.",
  ),
  open(
    'DELETE /brands/:id',
    'brands.js answers a demo brand itself (409 demo_brand): it is hidden, not deleted, and the web app shows that as information, not as the plan dialog.',
  ),
  open(
    'POST /competitors/suggest',
    "Onboarding's suggestions from a brand's name and site, before the brand exists. Names no brand; the plan check bounds them.",
  ),
  open(
    'POST /content-drafts/:draftId/stop',
    "Stops the Content Agent's run on a draft: it never starts one, and no run is ever under way on a demo brand.",
  ),
  open('POST /demo', 'Opens (creates or rebuilds) the demo brand itself.'),
  open('PATCH /demo', 'Hides or shows the demo brand itself.'),
  open(
    'POST /integrations/:provider/connect',
    "Connects the organization's own Google account. Names no brand.",
  ),
  open('DELETE /integrations/:provider', "Disconnects the organization's own Google account."),
  open(
    'POST /prompts/suggest',
    "Onboarding's prompt ideas from a brand's name, before the brand exists. Names no brand.",
  ),
  open(
    'POST /prompts/from-topics',
    "Onboarding's prompts for the chosen topics, before the brand exists. Names no brand.",
  ),
  open(
    'POST /prompts/fanout-intents',
    "Classifies fan-out queries into a cache shared by every brand. Names no brand; the demo's queries are the same for every organization, so they are classified once.",
  ),
  open(
    'POST /topics/suggest',
    "Onboarding's topics from a brand's name and site, before the brand exists. Names no brand.",
  ),
  open(
    'DELETE /tracking/job/:jobId',
    'Cancels a tracking job: it never starts one, and a demo brand has none (its jobs are cancelled when claimed).',
  ),
];

// ─── Matching a request ─────────────────────────────────────────────────────

/** Express's path syntax as a regex: `:name` matches one segment, a trailing slash is optional. */
function compile(route) {
  const [method, path] = route.split(' ');
  const params = [];
  const pattern = path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      params.push(segment.slice(1));
      return `(?<${segment.slice(1)}>[^/]+)`;
    })
    .join('/');
  // Express matches paths case-insensitively by default.
  return { method, regex: new RegExp(`^${pattern}/?$`, 'i'), params: params.length };
}

const COMPILED_GUARDED = DEMO_GUARDED.map((entry) => ({ ...entry, ...compile(entry.route) }));
const COMPILED_OPEN = DEMO_OPEN.map((entry) => ({ ...entry, ...compile(entry.route) }));

/**
 * The entry a request reaches, as Express would route it: of the routes its
 * method and path match, the one with the fewest `:params` (a fixed segment,
 * like /content/bulk/status, is defined before the `:id` it would also match).
 */
function routeOf(entries, { method, path }) {
  let best = null;
  for (const entry of entries) {
    if (entry.method !== method) continue;
    const match = entry.regex.exec(path);
    if (!match) continue;
    if (!best || entry.params < best.entry.params) best = { entry, match };
  }
  return best;
}

/** Which guarded or open route a write request reaches, or null for none. */
export function demoRouteFor(req) {
  const guarded = routeOf(COMPILED_GUARDED, req);
  const opened = routeOf(COMPILED_OPEN, req);
  if (guarded && (!opened || guarded.entry.params <= opened.entry.params)) {
    return { guarded: true, entry: guarded.entry, match: guarded.match };
  }
  if (opened) return { guarded: false, entry: opened.entry, match: opened.match };
  return null;
}

// ─── Which brands are demo brands ───────────────────────────────────────────

/**
 * A uuid as Postgres reads one: 32 hex digits, upper or lower case, in
 * braces or not, with or without its hyphens. The demo's seeded ids aren't
 * RFC 4122 versions, so any digits go.
 */
const UUID_INPUT = /^(\{)?([0-9a-f-]+)(\})?$/i;

/**
 * The id in its usual form (lowercase, 8-4-4-4-12), or null when it isn't
 * one: a route passes the others to Postgres, which reads them as the same
 * row, so they are checked the same.
 */
function guidOf(value) {
  if (typeof value !== 'string') return null;
  const m = UUID_INPUT.exec(value);
  if (!m || Boolean(m[1]) !== Boolean(m[3])) return null;
  const hex = m[2].replace(/-/g, '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Ids a request may name at once (the bulk routes). A request naming more
 * is refused with 400: each one would be read here, and the route's own
 * read of them all at once wouldn't fit a request anyway.
 */
export const MAX_IDS = 500;

/** A request that names more than MAX_IDS ids. */
export class TooManyIds extends Error {}

/** A path param that isn't valid percent-encoding: Express refuses it with 400 too. */
export class BadPathParam extends Error {}

/** Brands remembered at most; the oldest goes first. */
export const MAX_CACHED_BRANDS = 10_000;

/**
 * Brand id → whether it is a demo brand. Kept for good: a brand never turns
 * into a demo brand or back (00380: only the server creates one, and people
 * can't change is_demo).
 */
const demoByBrand = new Map();

function remember(brandId, isDemo) {
  if (!demoByBrand.has(brandId) && demoByBrand.size >= MAX_CACHED_BRANDS) {
    demoByBrand.delete(demoByBrand.keys().next().value);
  }
  demoByBrand.set(brandId, isDemo);
}

/** The ids in `value` (one, or an array), in their usual form; others are left out. */
function guids(value) {
  return (Array.isArray(value) ? value : [value]).map(guidOf).filter(Boolean);
}

/** The ids a request names in one place: guids(), at most MAX_IDS of them. */
function requestGuids(value) {
  if (Array.isArray(value) && value.length > MAX_IDS) throw new TooManyIds();
  return guids(value);
}

/**
 * Whether any of `brandIds` is a demo brand. Throws when the brands can't be
 * read. The one check every demo guard goes through (this middleware, the
 * internal endpoints the MCP calls, a read that would otherwise fetch).
 *
 * @param {string|string[]} brandIds
 * @returns {Promise<boolean>}
 */
export async function isDemoBrand(brandIds) {
  const ids = [...new Set(guids(brandIds))];
  if (ids.some((id) => demoByBrand.get(id) === true)) return true;
  const unknown = ids.filter((id) => !demoByBrand.has(id));
  if (unknown.length === 0) return false;
  const { data, error } = await selectInChunks(unknown, (chunk) =>
    supabaseAdmin.from('brands').select('id, is_demo').in('id', chunk),
  );
  if (error) throw new Error(`brands read: ${error.message}`);
  for (const brand of data ?? []) remember(brand.id, Boolean(brand.is_demo));
  return (data ?? []).some((brand) => brand.is_demo);
}

/** The brands of the rows of `table` whose ids are `ids`. */
async function brandsOfRows(table, ids) {
  const owner = OWNERS[table] ?? BRAND_COLUMN;
  const { data, error } = await selectInChunks(ids, (chunk) =>
    supabaseAdmin.from(table).select(owner.select).in('id', chunk),
  );
  if (error) throw new Error(`${table} read: ${error.message}`);
  return (data ?? []).map(owner.brand).filter(Boolean);
}

/**
 * Whether any of the rows of `table` whose ids are `ids` belongs to a demo
 * brand: for a caller that names a row rather than a brand (the internal
 * endpoints the MCP calls). Rows that aren't found answer false.
 *
 * @param {string} table
 * @param {string|string[]} ids
 * @returns {Promise<boolean>}
 */
export async function isDemoBrandRow(table, ids) {
  const brands = await brandsOfRows(table, guids(ids));
  return brands.length > 0 && isDemoBrand(brands);
}

function valueAt(req, match, { where, key }) {
  if (where === 'path') {
    const raw = match.groups?.[key];
    if (raw === undefined) return raw;
    // Express hands the route its params decoded (%34a0… is 4a0…): read the
    // id the route will act on, not the raw text.
    try {
      return decodeURIComponent(raw);
    } catch {
      throw new BadPathParam();
    }
  }
  if (where === 'body') return req.body?.[key];
  return req.query?.[key];
}

/**
 * The brands a guarded request names, by its route's sources.
 *
 * @returns {Promise<string[]>}
 */
export async function brandsNamedBy(req, { entry, match }) {
  const brands = [];
  for (const source of entry.sources) {
    const ids = requestGuids(valueAt(req, match, source));
    if (ids.length === 0) continue;
    if (source.table) brands.push(...(await brandsOfRows(source.table, ids)));
    else brands.push(...ids);
  }
  return brands;
}

/**
 * Express middleware: refuses a signed-in person's writes on a demo brand
 * with 402 demo_brand. Runs after decodeToken, before the plan's check, so
 * the demo brand's answer is the same with a plan or without one.
 */
export async function refuseDemoBrandWrites(req, res, next) {
  if (READ_METHODS.has(req.method)) return next();
  const route = demoRouteFor(req);
  if (!route?.guarded) return next();
  try {
    const brands = await brandsNamedBy(req, route);
    if (brands.length > 0 && (await isDemoBrand(brands))) {
      return res.status(402).json(DEMO_BRAND);
    }
    return next();
  } catch (err) {
    if (err instanceof TooManyIds) {
      return res
        .status(400)
        .json({ success: false, error: 'invalid', message: `At most ${MAX_IDS} ids at once` });
    }
    if (err instanceof BadPathParam) {
      return res.status(400).json({ success: false, error: 'invalid', message: 'Invalid path' });
    }
    (req.log ?? logger).error({ err }, 'demo brand check failed');
    return res.status(500).json({ message: 'Internal Error' });
  }
}

// Test hook — what is refused depends on what is remembered.
export function clearDemoBrandCache() {
  demoByBrand.clear();
}
