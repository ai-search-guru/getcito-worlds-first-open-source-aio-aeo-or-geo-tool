import supabaseAdmin from '../../config/supabase.js';
import { ConnectorHttpError, MAX_WAIT_MS, RETRIES, retryAfterMs } from '../../connectors/http.js';
import { brandConnection } from '../brandIntegrations.js';
import { entityIdFor, getActiveConnection, proxyRequest } from '../composio.js';
import { logger } from '../logger.js';

/**
 * Catalog sources read with the workspace's own sign-in to a platform
 * (#1270): a Google Merchant Center account, through the Google connection
 * the workspace made in Settings › Integrations, which Composio keeps
 * (integration_connections, 00045). Such a source has no credentials of its
 * own (00282): its connector's `signIn` names the Composio provider, and its
 * calls go through Composio's proxy (composio.js proxyRequest), so the token
 * never reaches us. They reach only the hosts the connector names (`hosts`).
 *
 * The request it gives a connector answers like the HTTP client's
 * (connectors/http.js requestJson): `{ status, headers, data }` for a 2xx,
 * else a ConnectorHttpError:
 *   - 'auth': the sign-in is gone or refused: no active connection, Composio
 *     saying the connection expired or was revoked, or the API's 401;
 *   - 'not_set_up': this server's setup is refused, not the sign-in:
 *     Composio's own 401 or 403 (its API key, or a key without the "Proxy
 *     execute" permission), the API's 403 (the Google Cloud project not
 *     registered with Merchant Center, a scope missing), or its 401 when it
 *     says the project isn't registered;
 *   - 'rate_limited': still 429 after RETRIES waits, or asked to wait longer
 *     than MAX_WAIT_MS;
 *   - 'http_error': any other status;
 *   - 'blocked': an address on a host the connector didn't name;
 *   - 'unreachable' or 'timeout': Composio couldn't be reached in time.
 * Only the API's own answers carry a `status`: Composio's refusals don't.
 * It waits and tries again on 429 and 5xx, as long as Retry-After says,
 * else 1, 2, 4 seconds. Errors name the host and path only.
 *
 * Every refusal by Composio or the API ('auth', 'not_set_up') is logged as
 * a warning, for whoever runs the server: the error's name and status, and
 * the API's own status and reason. Never the token, the query or the
 * account. A workspace with no connection at all isn't: it's not connected yet.
 */

/**
 * The sign-in a brand reads its catalog with (BRAND-ACCESS PR 16): the one
 * it uses for `provider` (lib/brandIntegrations.js, 00470), by its
 * Composio entity and connected account: several sign-ins may share an
 * entity. Every brand uses the workspace's Merchant Center connection, so
 * nothing changes yet. A brand with none (or before 00470) reads with its
 * workspace's entity, as before, and finds no active account there.
 */
export async function brandSignIn(brandId, provider, { db = supabaseAdmin } = {}) {
  const connection = await brandConnection(brandId, provider);
  if (connection?.entityId) {
    return { entityId: connection.entityId, accountId: connection.composioAccountId ?? null };
  }
  return { entityId: await workspaceEntity(brandId, { db }), accountId: null };
}

/** The Composio entity of a brand's workspace: one connection per workspace and provider. */
export async function workspaceEntity(brandId, { db = supabaseAdmin } = {}) {
  const { data, error } = await db
    .from('brands')
    .select('organization_id')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(`brands read: ${error.message}`);
  if (!data?.organization_id) throw new Error('The brand has no workspace.');
  return entityIdFor(data.organization_id);
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
/**
 * Composio's own refusals that mean the workspace's connection is gone (it
 * expired, was revoked or removed), not that this server's setup is wrong:
 * they name the connection.
 */
const SIGN_IN_GONE =
  /^(?=[\s\S]*(connected[\s_-]?account|connection))(?=[\s\S]*(expired|inactive|not[\s_-]?active|revoked|deleted|not[\s_-]?found))|invalid_grant|re-?auth/i;
/** Google's 401 when the Google Cloud project isn't registered with Merchant Center (registerGcp). */
const NOT_REGISTERED = /not registered|registerGcp/i;

/** A wait that ends early when `signal` aborts. */
function sleep(ms, signal) {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/** Header names in lower case, as retryAfterMs reads them. */
function lowerKeys(headers) {
  return Object.fromEntries(
    Object.entries(headers ?? {}).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

const clip = (value, max = 100) => (typeof value === 'string' ? value.slice(0, max) : undefined);

/** Why Google refused, from its error body: `details[].reason`, or the older `errors[].reason`. */
function reasonOf(error) {
  const detail = Array.isArray(error?.details)
    ? error.details.find((d) => typeof d?.reason === 'string')
    : undefined;
  return clip(detail?.reason ?? error?.errors?.[0]?.reason);
}

/** A refusal, logged: what refused and why. No token, query or account id. */
function logRefusal(code, { provider, url, name, status, data }) {
  const error = data?.error;
  logger.warn(
    {
      provider,
      code,
      host: url.host,
      // The path's ids (an account's) left out.
      path: url.pathname.replace(/\/\d+(?=[/:]|$)/g, '/:id'),
      err: { name, status },
      ...(error && typeof error === 'object'
        ? { google: { status: clip(error.status), reason: reasonOf(error) } }
        : {}),
    },
    '[catalog] sign-in call refused',
  );
}

/**
 * A connector's request for the brand's sign-in to `provider`. The
 * connection is looked up once, on the first call: the named connected
 * account when the sign-in names one (brandSignIn), else the entity's.
 *
 * @param {string} provider a Composio provider (composio.js PROVIDERS)
 * @param {{ entityId: string, accountId?: string|null } | string} signIn the brand's sign-in
 *   (brandSignIn), or an entity alone (workspaceEntity)
 * @param {{ hosts?: string[], active?: Function, proxy?: Function, wait?: Function }} [options]
 *   `hosts`: the only hosts it calls, over https (the connector's `hosts`);
 *   `active`, `proxy` and `wait` are the tests' stand-ins
 */
export function signInRequest(
  provider,
  signIn,
  { hosts = [], active = getActiveConnection, proxy = proxyRequest, wait = sleep } = {},
) {
  const { entityId, accountId: named = null } =
    typeof signIn === 'string' ? { entityId: signIn } : signIn;
  const allowed = new Set(hosts.map((host) => host.toLowerCase()));
  let accountId = null;
  return async function request(address, { query, signal } = {}) {
    let url;
    try {
      url = new URL(address);
    } catch {
      throw new ConnectorHttpError('invalid_url', "The address isn't a valid one");
    }
    const where = `GET ${url.host}${url.pathname}`;
    // url.host carries a port that isn't https's own: such an address isn't allowed either.
    if (url.protocol !== 'https:' || !allowed.has(url.host)) {
      // A connector's mistake, not the source's: logged, as the person can't fix it.
      logger.error({ provider, host: url.host }, '[catalog] sign-in call to a host not allowed');
      throw new ConnectorHttpError('blocked', `${where}: not a host ${provider} is read at`);
    }
    if (!accountId) {
      let account;
      try {
        account = await active(provider, entityId, named);
      } catch {
        throw new ConnectorHttpError('unreachable', `${where}: the sign-in couldn't be looked up`);
      }
      if (!account?.id) throw new ConnectorHttpError('auth', `${where}: no active sign-in`);
      accountId = account.id;
    }
    for (let attempt = 0; ; attempt += 1) {
      if (signal?.aborted) throw new ConnectorHttpError('timeout', `${where} took too long`);
      let res;
      try {
        res = await proxy(accountId, { endpoint: url.href, query, signal });
      } catch (err) {
        if (signal?.aborted) throw new ConnectorHttpError('timeout', `${where} took too long`);
        const status = err?.status ?? err?.statusCode;
        const refused = { provider, url, name: clip(err?.name), status };
        if (SIGN_IN_GONE.test(String(err?.message ?? ''))) {
          logRefusal('auth', refused);
          throw new ConnectorHttpError('auth', `${where}: the sign-in is gone`);
        }
        if (status === 401 || status === 403) {
          logRefusal('not_set_up', refused);
          throw new ConnectorHttpError('not_set_up', `${where}: Composio refused this server`);
        }
        throw new ConnectorHttpError('unreachable', `${where} couldn't be reached`);
      }
      if (res.status >= 200 && res.status < 300) return res;
      if (res.status === 401 || res.status === 403) {
        const refused = { provider, url, status: res.status, data: res.data };
        const notRegistered = NOT_REGISTERED.test(String(res.data?.error?.message ?? ''));
        const code = res.status === 401 && !notRegistered ? 'auth' : 'not_set_up';
        logRefusal(code, refused);
        throw new ConnectorHttpError(code, `${where} answered ${res.status}`, {
          status: res.status,
        });
      }
      if (RETRY_STATUSES.has(res.status) && attempt < RETRIES) {
        const ms = retryAfterMs(lowerKeys(res.headers)) ?? 1000 * 2 ** attempt;
        if (ms <= MAX_WAIT_MS) {
          await wait(ms, signal);
          continue;
        }
      }
      if (res.status === 429) {
        throw new ConnectorHttpError('rate_limited', `${where} asked to wait`, { status: 429 });
      }
      throw new ConnectorHttpError('http_error', `${where} answered ${res.status}`, {
        status: res.status,
      });
    }
  };
}
