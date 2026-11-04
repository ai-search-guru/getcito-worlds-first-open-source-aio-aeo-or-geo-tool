import supabaseAdmin from '../../config/supabase.js';
import { ConnectError } from '../../connectors/errors.js';
import { ConnectorHttpError, requestJson } from '../../connectors/http.js';
import { connectorFor, isSignIn, isStore } from '../../connectors/index.js';
import { isComposioConfigured } from '../composio.js';
import { logger } from '../logger.js';
import { credentialsConfigured, readCredentials, saveCredentials } from './credentials.js';
import { brandSignIn, signInRequest as workspaceSignIn } from './signIn.js';

/**
 * Connecting a brand's store as a catalog source (#1263, 00282): the
 * connector checks what the person typed with the store, then the source is
 * made and its sign-in kept, encrypted. Replacing the sign-in and removing
 * the store go through here too, so the sign-in is never handled anywhere
 * else. A platform read with the workspace's own sign-in (Google Merchant
 * Center, #1270) is connected here too, with no sign-in of its own to keep:
 * the person picks one of the accounts that sign-in opens.
 *
 * What the person typed never goes in a log or an error: a StoreError's
 * message is the words they see.
 */

export class StoreError extends Error {
  /**
   * @param {number} status the HTTP status the route answers
   * @param {'invalid'|'not_found'|'not_configured'|'not_connected'|'connect_failed'|'auth_failed'|'unreachable'|'duplicate'|'too_many'|'other_account'} code
   * @param {string} message
   */
  constructor(status, code, message) {
    super(message);
    this.name = 'StoreError';
    this.status = status;
    this.code = code;
  }
}

/** A field's value at most this long. */
export const FIELD_MAX = 2000;

const SOURCE_COLUMNS = 'id, brand_id, kind, format, url, account, label';

function storeConnector(kind, connectors) {
  const connector = connectorFor(kind, connectors);
  if (!isStore(connector))
    throw new StoreError(404, 'not_found', 'There is no such store to connect.');
  return connector;
}

function ready() {
  if (!credentialsConfigured()) {
    throw new StoreError(
      503,
      'not_configured',
      "Store connections aren't set up on this server yet.",
    );
  }
}

/** What the person typed, by the connector's fields: strings, each FIELD_MAX at most. */
export function readInput(connector, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new StoreError(400, 'invalid', 'Fill in the fields to connect the store.');
  }
  const out = {};
  for (const field of connector.fields ?? []) {
    const value = input[field.name] ?? '';
    if (typeof value !== 'string' || value.length > FIELD_MAX) {
      throw new StoreError(400, 'invalid', `${field.label} isn't valid.`);
    }
    out[field.name] = value;
  }
  return out;
}

const text = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** What `connect` returned, checked: the plumbing never keeps a malformed one. */
function checkResult(result) {
  const account = text(result?.account, 200);
  const credentials = result?.credentials;
  const url = text(result?.url, 2048);
  if (
    !account ||
    !credentials ||
    typeof credentials !== 'object' ||
    !Object.values(credentials).every((v) => typeof v === 'string') ||
    (url && !/^https?:\/\//i.test(url))
  ) {
    throw new Error('connect returned no account, credentials of strings, or an http(s) url');
  }
  return { account, url, label: text(result.label, 200), credentials };
}

/** The connector's `connect`, its failures as the person should read them. */
async function checkWithStore(connector, input, request) {
  try {
    return checkResult(await connector.connect(input, { request }));
  } catch (err) {
    if (err instanceof ConnectError) throw new StoreError(400, 'connect_failed', err.message);
    if (err instanceof ConnectorHttpError) {
      if (err.code === 'auth') {
        throw new StoreError(
          400,
          'auth_failed',
          'The store refused this sign-in. Check it and try again.',
        );
      }
      if (err.code === 'blocked' || err.code === 'invalid_url') {
        throw new StoreError(
          400,
          'connect_failed',
          "The store's address isn't a public https address.",
        );
      }
      throw new StoreError(
        502,
        'unreachable',
        "The store couldn't be reached. Try again in a moment.",
      );
    }
    // Its message may hold what the person typed: only its name is logged.
    logger.error(
      { err: { name: err?.name }, kind: connector.kind },
      '[catalog] store connect failed',
    );
    throw new StoreError(
      502,
      'unreachable',
      "The store couldn't be checked. Try again in a moment.",
    );
  }
}

/**
 * Connects a store to a brand: checked with the store, made a source, its
 * sign-in kept. The caller has checked the person may.
 *
 * @returns {Promise<{ id: string, brand_id: string, kind: string, format: string, url: string|null, account: string, label: string|null }>}
 */
export async function connectStore(
  { brandId, kind, input, userId },
  { db = supabaseAdmin, connectors, request = requestJson } = {},
) {
  const connector = storeConnector(kind, connectors);
  ready();
  const result = await checkWithStore(connector, readInput(connector, input), request);
  const { data: existing } = await db
    .from('catalog_sources')
    .select('id')
    .eq('brand_id', brandId)
    .eq('kind', kind)
    .eq('account', result.account)
    .maybeSingle();
  if (existing) throw new StoreError(409, 'duplicate', 'This store is connected already.');
  const { data: source, error } = await db
    .from('catalog_sources')
    .insert({
      brand_id: brandId,
      kind,
      account: result.account,
      url: result.url,
      label: result.label,
      created_by: userId,
    })
    .select(SOURCE_COLUMNS)
    .single();
  if (error?.code === '23514') {
    throw new StoreError(409, 'too_many', 'A brand has 10 catalog sources at most.');
  }
  if (error?.code === '23505')
    throw new StoreError(409, 'duplicate', 'This store is connected already.');
  if (error || !source) throw new Error(`catalog_sources write: ${error?.code ?? 'no row'}`);
  try {
    await saveCredentials(source.id, result.credentials, { setBy: userId, db });
  } catch (err) {
    // A store source never stays without its sign-in.
    await db.from('catalog_sources').delete().eq('id', source.id);
    throw err;
  }
  return source;
}

/** Listing or checking a sign-in platform's accounts stops calling it after this: the person waits. */
export const SIGN_IN_CALLS_MS = 30_000;

/** The platform read with the workspace's sign-in, ready to call; or a StoreError. */
async function signedIn(kind, brandId, { db, connectors, signInRequest, callsMs }) {
  const connector = connectorFor(kind, connectors);
  if (!isSignIn(connector)) throw new StoreError(404, 'not_found', 'There is no such source.');
  if (!isComposioConfigured(connector.signIn)) {
    throw new StoreError(
      503,
      'not_configured',
      `${connector.label} isn't set up on this server yet.`,
    );
  }
  const signIn = await brandSignIn(brandId, connector.signIn, { db });
  const signed = signInRequest(connector.signIn, signIn, {
    hosts: connector.hosts,
  });
  // Every call stops at one deadline, however many the listing takes.
  const deadline = AbortSignal.timeout(callsMs);
  const request = (address, opts = {}) => signed(address, { ...opts, signal: deadline });
  return { connector, request };
}

/** A sign-in platform's failure, as the person should read it. */
function signInFailure(connector, err) {
  if (err instanceof ConnectError) return new StoreError(400, 'connect_failed', err.message);
  if (err instanceof ConnectorHttpError && err.code === 'auth') {
    return new StoreError(
      409,
      'not_connected',
      `Connect ${connector.label} with Google in Settings › Integrations first.`,
    );
  }
  if (err instanceof ConnectorHttpError && err.code === 'not_set_up') {
    // Logged where it was refused (signIn.js): reconnecting wouldn't help.
    return new StoreError(
      503,
      'not_configured',
      `${connector.label} isn't set up correctly on this server yet. Try again later.`,
    );
  }
  if (!(err instanceof ConnectorHttpError)) {
    logger.error(
      { err: { name: err?.name }, kind: connector.kind },
      '[catalog] sign-in call failed',
    );
  }
  return new StoreError(
    502,
    'unreachable',
    `${connector.label} couldn't be reached. Try again in a moment.`,
  );
}

/**
 * The accounts a brand's workspace sign-in opens on a platform read with it
 * (#1270), for the person to pick one. The caller has checked the person may.
 *
 * @returns {Promise<{ id: string, name: string|null }[]>}
 */
export async function listSignInAccounts(
  { brandId, kind },
  {
    db = supabaseAdmin,
    connectors,
    signInRequest = workspaceSignIn,
    callsMs = SIGN_IN_CALLS_MS,
  } = {},
) {
  const { connector, request } = await signedIn(kind, brandId, {
    db,
    connectors,
    signInRequest,
    callsMs,
  });
  try {
    return await connector.listAccounts({ request });
  } catch (err) {
    throw signInFailure(connector, err);
  }
}

/**
 * Connects an account of a platform read with the workspace's sign-in to a
 * brand: checked with the platform, then made a source. No sign-in is kept:
 * it is the workspace's. The caller has checked the person may.
 */
export async function connectSignInSource(
  { brandId, kind, input, userId },
  {
    db = supabaseAdmin,
    connectors,
    signInRequest = workspaceSignIn,
    callsMs = SIGN_IN_CALLS_MS,
  } = {},
) {
  const value = input?.account;
  if (typeof value !== 'string' || !value.trim() || value.length > FIELD_MAX) {
    throw new StoreError(400, 'invalid', 'Pick an account to connect.');
  }
  const { connector, request } = await signedIn(kind, brandId, {
    db,
    connectors,
    signInRequest,
    callsMs,
  });
  let result;
  try {
    result = await connector.checkAccount(value, { request });
  } catch (err) {
    throw signInFailure(connector, err);
  }
  const account = text(result?.account, 200);
  if (!account) throw new Error('checkAccount returned no account');
  const url = text(result.url, 2048);
  const { data: existing } = await db
    .from('catalog_sources')
    .select('id')
    .eq('brand_id', brandId)
    .eq('kind', kind)
    .eq('account', account)
    .maybeSingle();
  if (existing) throw new StoreError(409, 'duplicate', 'This account is connected already.');
  const { data: source, error } = await db
    .from('catalog_sources')
    .insert({
      brand_id: brandId,
      kind,
      account,
      url: url && /^https?:\/\//i.test(url) ? url : null,
      label: text(result.label, 200),
      created_by: userId,
    })
    .select(SOURCE_COLUMNS)
    .single();
  if (error?.code === '23514') {
    throw new StoreError(409, 'too_many', 'A brand has 10 catalog sources at most.');
  }
  if (error?.code === '23505')
    throw new StoreError(409, 'duplicate', 'This account is connected already.');
  if (error || !source) throw new Error(`catalog_sources write: ${error?.code ?? 'no row'}`);
  return source;
}

/** Replaces a store's sign-in, for the same store's account only. */
export async function reconnectStore(
  { source, input, userId },
  { db = supabaseAdmin, connectors, request = requestJson } = {},
) {
  const connector = storeConnector(source.kind, connectors);
  ready();
  const result = await checkWithStore(connector, readInput(connector, input), request);
  if (source.account && result.account !== source.account) {
    throw new StoreError(
      409,
      'other_account',
      'This sign-in is for another store. Add that store as a new source.',
    );
  }
  await saveCredentials(source.id, result.credentials, { setBy: userId, db });
  const { error } = await db
    .from('catalog_sources')
    .update({ url: result.url ?? source.url, last_status: null, last_error: null })
    .eq('id', source.id);
  if (error) throw new Error(`catalog_sources write: ${error.code ?? 'error'}`);
}

/**
 * Removes a store: its sign-in revoked at the store where the connector can
 * (best effort), then the source, which takes its sign-in and its products
 * with it (00279, 00282).
 */
export async function disconnectStore(
  source,
  { db = supabaseAdmin, connectors, request = requestJson } = {},
) {
  const connector = connectorFor(source.kind, connectors);
  if (isStore(connector) && typeof connector.disconnect === 'function') {
    try {
      const credentials = await readCredentials(source.id, { db });
      if (credentials) await connector.disconnect(source, { request, credentials });
    } catch (err) {
      logger.warn(
        { err: { name: err?.name }, sourceId: source.id },
        '[catalog] store disconnect failed',
      );
    }
  }
  const { error } = await db.from('catalog_sources').delete().eq('id', source.id);
  if (error) throw new Error(`catalog_sources delete: ${error.code ?? 'error'}`);
}
