import supabaseAdmin from '../../config/supabase.js';
import { isCloud, isSubscriptionActive } from '../../config/plans.js';
import { connectorFor, isSignIn, isStore } from '../../connectors/index.js';
import { ConnectorHttpError, requestJson } from '../../connectors/http.js';
import { FeedFormatError, parseFeed } from '../feeds/index.js';
import { isComposioConfigured } from '../composio.js';
import { PageFetchError } from '../safeFetch.js';
import { logger } from '../logger.js';
import { PlanLimitError, getCatalogProductCap } from '../planGuard.js';
import { queueShoppingCheck } from '../shoppingCheck.js';
import { CredentialsKeyError, readCredentials } from './credentials.js';
import { saveItemIssues } from './issues.js';
import { brandSignIn, signInRequest as workspaceSignIn } from './signIn.js';
import { syncCatalog } from './sync.js';
import { syncCatalogOrders } from './orders.js';

/**
 * A brand's catalog sources (#1263, 00279, 00282) synced into its catalog: a
 * feed URL or a store, read through its connector, daily and on demand; or
 * an uploaded CSV. Each source keeps its own products under `sourceKey(id)`,
 * and its last sync's outcome on its row (`last_*`), which the Settings card
 * shows. A store is read with its saved sign-in (credentials.js); a
 * platform like Google Merchant Center with the workspace's own sign-in
 * (signIn.js), and the issues it reports per item are kept (issues.js).
 * On the managed cloud, the plan caps the workspace's live products
 * (ECOM-019): a source keeps what's left of it, and records how many it
 * couldn't. A capped workspace's sources write one at a time
 * (writeWithinCap), so two read at once can't both count the room the other
 * takes.
 */

/** Feeds and stores read again after this long, by the daily run. */
export const SYNC_EVERY_MS = 20 * 60 * 60 * 1000;
/** Sources a daily run reads at most, the longest waiting first, one at a time. */
export const SWEEP_LIMIT = 50;
/** A run stops starting sources after this; the rest wait first in line for the next. */
export const SWEEP_DEADLINE_MS = 10 * 60 * 1000;
/** Skipped products' errors kept on the source, for the person to see. */
const ERRORS_KEPT = 5;
/** A store's read stops calling it after this: one slow store can't hold the daily run. */
export const STORE_READ_MS = 10 * 60 * 1000;
/**
 * A capped write waits this long at most for the one before it in its
 * workspace's line (inLine): a write stuck past it can't hold the line.
 */
export const LINE_WAIT_MS = 5 * 60 * 1000;

/** The sources being read in this process: a source isn't read twice at once. */
const reading = new Set();
/**
 * Each workspace's line of capped writes in this process (writeWithinCap):
 * the last write's promise, settled either way, by organization id.
 */
const capLines = new Map();

/** The catalog's `source` for a catalog source: `src_` and its id without dashes. */
export function sourceKey(id) {
  return `src_${String(id).replace(/-/g, '')}`;
}

/** What a store's API said, in words a person can act on. */
const STORE_WORDS = {
  invalid_url: "The store's address isn't a valid http(s) address.",
  blocked: "The store's address isn't a public one.",
  unreachable: "The store couldn't be reached.",
  timeout: 'The store took too long to answer.',
  too_large: 'The store answered with more than can be read at once.',
  rate_limited: 'The store asked to wait. The next daily run tries again.',
  bad_response: "The store's answer couldn't be read.",
};

/** Why a sync failed, in words a person can act on. No page, feed or store text. */
export function failureOf(err, connector = null) {
  if (err instanceof FeedFormatError) return { status: 'format_error', error: err.message };
  if (err instanceof PlanLimitError) return { status: 'failed', error: err.message };
  if (err instanceof ConnectorHttpError && isSignIn(connector)) {
    // The workspace's sign-in, not the source's: it's reconnected in Settings › Integrations.
    if (err.code === 'auth') {
      return {
        status: 'auth_failed',
        error: `The Google sign-in can't open this ${connector.label} account anymore. Reconnect it in Settings › Integrations.`,
      };
    }
    if (err.code === 'not_set_up') {
      // This server's own setup, or Google's for this account: reconnecting wouldn't help.
      return {
        status: 'failed',
        error: `${connector.label} isn't set up correctly on this server, or the Google account connected in Settings › Integrations can't open this account. The next daily run tries again.`,
      };
    }
    if (err.code === 'rate_limited') {
      return {
        status: 'failed',
        error: `${connector.label} asked to wait. The next daily run tries again.`,
      };
    }
    return {
      status: 'failed',
      error: `${connector.label} couldn't be read just now. The next daily run tries again.`,
    };
  }
  if (err instanceof ConnectorHttpError) {
    if (err.code === 'auth') {
      return {
        status: 'auth_failed',
        error: 'The store refused the saved sign-in. Update it in Settings › Integrations.',
      };
    }
    return {
      status: 'failed',
      error:
        STORE_WORDS[err.code] ??
        `The store answered ${err.status ?? 'an error'}. The next daily run tries again.`,
    };
  }
  if (err instanceof CredentialsKeyError) {
    return { status: 'failed', error: "Store connections aren't set up on this server." };
  }
  if (err instanceof PageFetchError) {
    const words = {
      invalid_url: "The feed's address isn't a valid http(s) address.",
      blocked: "The feed's address isn't a public one.",
      unreachable: "The feed's address couldn't be reached.",
      timeout: 'The feed took too long to answer.',
      too_large: 'The feed is larger than 50 MB.',
      not_html: "The address doesn't serve a feed (XML or CSV).",
      http_error: `The feed's address answered ${err.status ?? 'an error'}.`,
      too_many_redirects: "The feed's address redirects too many times.",
    };
    return { status: 'failed', error: words[err.code] ?? "The feed couldn't be read." };
  }
  return { status: 'failed', error: "The source couldn't be synced. Try again later." };
}

/** A sign-in the saved credentials no longer open. */
const NO_SIGN_IN = {
  status: 'auth_failed',
  error: "The store's saved sign-in can't be read. Update it in Settings › Integrations.",
};

/** A message with a store's credential values taken out, for a log. */
export function redact(message, credentials) {
  let text = String(message ?? '');
  for (const value of Object.values(credentials ?? {})) {
    if (typeof value === 'string' && value.length >= 4) text = text.split(value).join('[redacted]');
  }
  return text;
}

/**
 * The live products a source may keep (ECOM-019): its workspace's cap less
 * the live products of the workspace's other sources, on any of its brands
 * but its demo brand (00380), whose sample catalog never counts.
 * `room` is Infinity (and `cap` -1) on a self-hosted server, or for a plan
 * without a cap.
 */
export async function productRoom(
  source,
  { db = supabaseAdmin, capOf = getCatalogProductCap } = {},
) {
  const none = { room: Infinity, cap: -1 };
  if (!isCloud()) return none;
  const { data: brand, error } = await db
    .from('brands')
    .select('organization_id')
    .eq('id', source.brand_id)
    .maybeSingle();
  if (error) throw new Error(`brands read: ${error.message}`);
  const cap = await capOf(brand?.organization_id ?? null);
  if (cap < 0) return none;
  const { data: brands, error: brandsError } = await db
    .from('brands')
    .select('id')
    .eq('organization_id', brand.organization_id)
    .eq('is_demo', false);
  if (brandsError) throw new Error(`brands read: ${brandsError.message}`);
  const { count, error: countError } = await db
    .from('catalog_products')
    .select('id', { count: 'exact', head: true })
    .in(
      'brand_id',
      (brands ?? []).map((b) => b.id),
    )
    .neq('source', sourceKey(source.id))
    .is('removed_at', null);
  if (countError) throw new Error(`catalog_products count: ${countError.message}`);
  return { room: Math.max(0, cap - (count ?? 0)), cap };
}

/**
 * `work` run after the work in `key`'s line before it, alone, and its result.
 * The line is dropped once it's empty. Work waits `waitMs` at most: if the
 * work before it is still running then, it runs anyway (and the work after
 * it waits for it), so one stuck write doesn't hold its workspace's line.
 */
export function inLine(key, work, lines = capLines, waitMs = LINE_WAIT_MS) {
  const before = lines.get(key);
  const waited = before ? waitAtMost(before, waitMs, key) : Promise.resolve();
  const run = waited.then(() => work());
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  lines.set(key, tail);
  tail.then(() => {
    if (lines.get(key) === tail) lines.delete(key);
  });
  return run;
}

/** `before` settled, or `ms` gone by first: said in the log, as the line goes on without it. */
function waitAtMost(before, ms, key) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => {
      logger.warn({ line: key, waitMs: ms }, '[catalog] capped write stopped waiting in line');
      resolve();
    }, ms);
    timer.unref?.();
  });
  return Promise.race([before, late]).finally(() => clearTimeout(timer));
}

/**
 * Writes a source's items into its brand's catalog within the workspace's
 * cap (ECOM-019), and says what changed and the cap (-1 for none).
 *
 * On the managed cloud, a workspace's sources write one at a time: the room
 * a source has is its workspace's cap less the live products of its other
 * sources, and two sources counting that at once (a sync from Settings
 * while the daily run reads another store) would each count the other's
 * products as they were before either wrote, and keep more than the cap
 * between them. Only the count and the writes wait in line; the read of a
 * store or a feed, the long part, doesn't. A workspace whose plan has no cap
 * doesn't wait at all; one that waits recounts its room when its turn comes,
 * and waits LINE_WAIT_MS at most. The line is this process's (as `reading`
 * is): the API and the daily run both sync here.
 *
 * Products past the cap are marked removed (removed_at), as if gone from
 * the source, and come back live when there's room again. A product marked
 * so stays marked from the day it went over: the daily purge of products
 * removed for more than 90 days (#1632) deletes it then, with its variants,
 * images and category links, and its cards' match is cleared (00360, on
 * delete set null). If there's room again later, the next sync adds it back
 * as a new row, and the daily card match finds its cards again (90 days).
 * Telling these apart from products gone from the source would take a
 * column of its own (a removed reason), not added here.
 */
async function writeWithinCap(source, items, { db, now, capOf = getCatalogProductCap }) {
  const write = async (known) => {
    const { room, cap } = known ?? (await productRoom(source, { db, capOf }));
    const counts = await syncCatalog(source.brand_id, sourceKey(source.id), items, {
      db,
      now,
      room,
    });
    return { counts, cap };
  };
  const uncapped = { room: Infinity, cap: -1 };
  if (!isCloud()) return write(uncapped);
  const { data: brand, error } = await db
    .from('brands')
    .select('organization_id')
    .eq('id', source.brand_id)
    .maybeSingle();
  if (error) throw new Error(`brands read: ${error.message}`);
  // Nothing to count for a plan without a cap: its sources write at once.
  if ((await capOf(brand?.organization_id ?? null)) < 0) return write(uncapped);
  return inLine(brand?.organization_id ?? `brand:${source.brand_id}`, () => write());
}

async function record(db, id, at, outcome) {
  const { error } = await db
    .from('catalog_sources')
    .update({
      last_synced_at: at,
      last_status: outcome.status,
      last_error: outcome.error ?? null,
      last_counts: outcome.counts ?? null,
    })
    .eq('id', id);
  if (error) throw new Error(`catalog_sources write: ${error.message}`);
}

/**
 * Syncs one source and records how it went. A feed or a store is read
 * through its connector, a store with its saved sign-in; an upload's text is
 * passed in. Never throws for the source's own failure: it's recorded and
 * returned.
 *
 * A source being read already isn't read again at once: the answer says so,
 * and nothing is recorded. A store's calls stop after `readMs` (STORE_READ_MS).
 *
 * After a sync that read the catalog, the brand's pages' shopping links are
 * checked against it (shoppingCheck.js), behind the answer.
 *
 * @param {{ id: string, brand_id: string, kind: string, format: string, url?: string|null, account?: string|null }} source
 * @param {{ text?: string, db?: object, now?: Date, fetch?: Function, request?: Function, signInRequest?: Function, connectors?: object, readMs?: number, capOf?: Function, afterSync?: Function }} [options]
 *   `fetch` (a feed's), `request` (a store's HTTP client), `signInRequest`
 *   (the workspace sign-in's, signIn.js), `connectors`, `readMs`, `capOf`
 *   (the plan's product cap, by organization) and `afterSync` (the shopping
 *   check's queue) are the tests' stand-ins
 */
export async function syncSource(source, { afterSync = queueShoppingCheck, ...options } = {}) {
  if (reading.has(source.id)) {
    return {
      status: 'failed',
      error: 'This source is being read right now. Try again in a minute.',
    };
  }
  reading.add(source.id);
  let outcome;
  try {
    outcome = await syncOnce(source, options);
  } finally {
    reading.delete(source.id);
  }
  if (outcome.status === 'ok') afterSync(source.brand_id, options.db ? { db: options.db } : {});
  return outcome;
}

/** A store's HTTP client whose every call stops at one deadline, `ms` from now. */
function withDeadline(request, ms) {
  const deadline = AbortSignal.timeout(ms);
  return (address, opts = {}) =>
    request(address, {
      ...opts,
      signal: opts.signal ? AbortSignal.any([opts.signal, deadline]) : deadline,
    });
}

/**
 * A store's changed orders (#1275), after its catalog was written. The cursor
 * (`last_orders_synced_at`) moves only past orders saved: to the sync's start
 * once the read is complete, or to the last change read when the connector
 * stopped at its page cap, so a store with more orders catches up over the
 * next runs instead of reading the same first pages again. A failure here
 * leaves the cursor where it was and the catalog's outcome as it is, and is
 * kept in plain words in the source's order counts: the orders are tried
 * again by the next sync. The orders' read has its own deadline (readMs).
 */
async function syncStoreOrders(source, connector, { request, credentials, db, now, at }) {
  const since = source.last_orders_synced_at ?? null;
  try {
    const result = await connector.syncOrders(source, { request, credentials, since });
    const counts = await syncCatalogOrders(source.brand_id, sourceKey(source.id), result.orders, {
      db,
      now,
    });
    const cursor = Date.parse(result.truncated ? (result.cursor ?? '') : at);
    const previous = since ? Date.parse(since) : NaN;
    if (Number.isFinite(cursor) && !(cursor <= previous)) {
      const { error } = await db
        .from('catalog_sources')
        .update({ last_orders_synced_at: new Date(cursor).toISOString() })
        .eq('id', source.id);
      if (error) throw new Error(`catalog_sources order cursor write: ${error.message}`);
    }
    return {
      ...counts,
      skippedFromApi: Number.isInteger(result.skipped) ? result.skipped : 0,
      truncated: !!result.truncated,
    };
  } catch (err) {
    logger.warn(
      { err: { name: err?.name, code: err?.code }, sourceId: source.id },
      '[catalog] order sync failed; the next sync tries again',
    );
    // Kept with the catalog's counts, so a read that keeps failing (one that
    // runs out of time, say) shows why. Plain words only, no store text.
    const error =
      err instanceof ConnectorHttpError
        ? failureOf(err).error
        : "The orders couldn't be synced. The next sync tries again.";
    return { failed: true, ...(err?.code === 'timeout' ? { timedOut: true } : {}), error };
  }
}

async function syncOnce(
  source,
  {
    text,
    db = supabaseAdmin,
    now = new Date(),
    fetch,
    request = requestJson,
    signInRequest = workspaceSignIn,
    connectors,
    readMs = STORE_READ_MS,
    capOf,
  },
) {
  const at = now.toISOString();
  let outcome;
  let credentials = null;
  let connector = null;
  let storeRequest = null;
  try {
    let parsed;
    if (text !== undefined) {
      parsed = parseFeed(text, source.format);
    } else {
      connector = connectorFor(source.kind, connectors);
      if (!connector) {
        outcome = { status: 'failed', error: "This server can't read this kind of source." };
      } else if (isSignIn(connector) && !isComposioConfigured(connector.signIn)) {
        outcome = { status: 'failed', error: `${connector.label} isn't set up on this server.` };
      } else if (isSignIn(connector)) {
        const signedIn = signInRequest(
          connector.signIn,
          await brandSignIn(source.brand_id, connector.signIn, { db }),
          { hosts: connector.hosts },
        );
        // Every call the read makes stops at its deadline.
        const deadline = AbortSignal.timeout(readMs);
        parsed = await connector.readCatalog(source, {
          request: (address, opts = {}) => signedIn(address, { ...opts, signal: deadline }),
        });
      } else if (isStore(connector)) {
        credentials = await readCredentials(source.id, { db });
        // Every call the read makes stops at its deadline.
        storeRequest = withDeadline(request, readMs);
        if (!credentials) outcome = NO_SIGN_IN;
        else parsed = await connector.readCatalog(source, { request: storeRequest, credentials });
      } else {
        parsed = await connector.readCatalog(source, { fetch, request });
      }
    }
    if (!outcome) {
      const { counts, cap } = await writeWithinCap(source, parsed.items, { db, now, capOf });
      outcome = {
        status: 'ok',
        counts: {
          format: parsed.format,
          items: parsed.items.length,
          skipped: parsed.errors.length,
          errors: parsed.errors.slice(0, ERRORS_KEPT).map((e) => e.message),
          products: counts.products,
          variants: counts.variants,
          // Products past the plan's cap, not kept (ECOM-019), and the cap.
          ...(counts.overLimit ? { overLimit: counts.overLimit, limit: cap } : {}),
        },
      };
      // An item listed again (another language or feed label), kept once: not skipped.
      if (Number.isInteger(parsed.repeated)) outcome.counts.repeated = parsed.repeated;
      if (Array.isArray(parsed.issues)) {
        outcome.counts.issues = await saveItemIssues(source, parsed.issues, { db, now });
      }

      // Store connectors with order support share one idempotent persistence path.
      if (
        isStore(connector) &&
        credentials &&
        storeRequest &&
        typeof connector.syncOrders === 'function'
      ) {
        outcome.counts.orders = await syncStoreOrders(source, connector, {
          // The orders get their own deadline: a large catalog's read can't
          // spend the time they need.
          request: withDeadline(request, readMs),
          credentials,
          db,
          now,
          at,
        });
      }
    }
  } catch (err) {
    outcome = failureOf(err, connector);
    const told = err instanceof PageFetchError || err instanceof ConnectorHttpError;
    if (outcome.status === 'failed' && !told) {
      logger.error(
        {
          err: { name: err?.name, message: redact(err?.message, credentials) },
          sourceId: source.id,
        },
        '[catalog] sync failed',
      );
    }
  }
  await record(db, source.id, at, outcome);
  return outcome;
}

/** What a source of a workspace without an active subscription records, instead of a read. */
export const NOT_READ_INACTIVE = {
  status: 'failed',
  error: "Not read: this workspace's subscription isn't active.",
};

/**
 * The daily run: feeds and stores not read for SYNC_EVERY_MS, the longest
 * waiting first, SWEEP_LIMIT a run, one at a time, until SWEEP_DEADLINE_MS.
 * On the managed cloud, only workspaces with an active subscription are
 * read. A source of any other workspace records that it wasn't read, which
 * also moves it to the back of the line: left untouched, those sources would
 * stay first in line every day and could fill a run's every slot.
 */
export async function sweepCatalogSources({
  db = supabaseAdmin,
  now = new Date(),
  fetch,
  request,
  connectors,
} = {}) {
  const started = Date.now();
  const due = new Date(now.getTime() - SYNC_EVERY_MS).toISOString();
  const { data, error } = await db
    .from('catalog_sources')
    .select(
      'id, brand_id, kind, format, url, account, last_synced_at, last_orders_synced_at, brands!inner(is_demo, organizations!inner(subscription_status))',
    )
    // A demo brand's catalog (00380) is sample data: its sources are never read.
    .eq('brands.is_demo', false)
    .neq('kind', 'upload')
    .or(`last_synced_at.is.null,last_synced_at.lt.${due}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(SWEEP_LIMIT);
  if (error) throw new Error(`catalog_sources read: ${error.message}`);
  let synced = 0;
  let inactive = 0;
  for (const source of data ?? []) {
    if (Date.now() - started > SWEEP_DEADLINE_MS) break;
    try {
      if (!isSubscriptionActive(source.brands?.organizations?.subscription_status)) {
        await record(db, source.id, now.toISOString(), NOT_READ_INACTIVE);
        inactive++;
        continue;
      }
      await syncSource(source, { db, now, fetch, request, connectors });
      synced++;
    } catch (err) {
      logger.error(
        { err: { name: err?.name, message: err?.message }, sourceId: source.id },
        '[catalog] sweep source failed',
      );
    }
  }
  return { due: (data ?? []).length, synced, inactive };
}
