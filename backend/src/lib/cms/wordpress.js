import * as cheerio from 'cheerio';
import { ConnectorHttpError, requestJson } from '../../connectors/http.js';

/**
 * WordPress for Send to CMS (#1331, phase 2; 00294): the site's REST API
 * (`/wp-json/`), signed in with a user's Application Password (WordPress
 * 5.6+, Users › Profile › Application Passwords) in an Authorization header.
 *
 * Every call goes through the connectors' HTTP client (connectors/http.js):
 * public https addresses only, so the password never crosses the network in
 * the clear, no redirect followed, and a POST never sent twice. Pages go as
 * draft posts: nothing here publishes.
 *
 * The password is never put in a message, a log or an answer, and goes only
 * to a site that answers as WordPress (checkSite).
 */

export class WordPressError extends Error {
  /**
   * @param {'invalid'|'not_wordpress'|'no_app_passwords'|'auth_failed'|'header_dropped'|
   *   'users_hidden'|'site_refused'|'redirect'|'no_access'|'not_found'|'unreachable'|'failed'} code
   *   'auth_failed': the user or password is refused (the person connects again)
   * @param {string} message
   * @param {number} [status] the HTTP status WordPress answered, when it did
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'WordPressError';
    this.code = code;
    this.status = status;
  }
}

/** The longest site address kept (brand_cms_connections.site_url). */
export const SITE_URL_MAX = 2048;

/**
 * The site's address as the person typed it, as the API is reached at:
 * https (added when left out) on its standard port, no user, query or hash,
 * and no `/wp-admin`, `/wp-json` or trailing slash copied with it. A site in
 * a folder keeps it.
 */
export function siteAddress(input) {
  let text = String(input ?? '').trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new WordPressError('invalid', 'That isn’t a web address.');
  }
  if (url.protocol !== 'https:') {
    throw new WordPressError(
      'invalid',
      'WordPress takes an Application Password over https only: use the site’s https address.',
    );
  }
  if (url.username || url.password) {
    throw new WordPressError('invalid', 'Leave the user and password out of the address.');
  }
  // The connectors' client reaches the standard port only.
  if (url.port) {
    throw new WordPressError('invalid', 'Use the site’s address without a port.');
  }
  const path = url.pathname.replace(/\/(wp-admin|wp-json|wp-login\.php)(\/.*)?$/i, '');
  const address = `${url.origin}${path.replace(/\/+$/, '')}`;
  if (address.length > SITE_URL_MAX) {
    throw new WordPressError('invalid', 'That address is too long.');
  }
  return address;
}

/** The Basic sign-in WordPress takes an Application Password with; its spaces are its own. */
function authorization({ username, password }) {
  const clear = `${username}:${String(password).replace(/\s+/g, '')}`;
  return `Basic ${Buffer.from(clear, 'utf8').toString('base64')}`;
}

/** WordPress's answer to a call that failed, in our words. */
function wordPressError(err) {
  if (err instanceof WordPressError) return err;
  if (!(err instanceof ConnectorHttpError)) return err;
  const { status } = err;
  switch (err.code) {
    case 'auth':
      return status === 403
        ? new WordPressError(
            'no_access',
            'The connected user isn’t allowed to do that on this site.',
            status,
          )
        : new WordPressError(
            'auth_failed',
            'WordPress refused the user or the Application Password.',
            status,
          );
    case 'invalid_url':
    case 'blocked':
      return new WordPressError('unreachable', err.message);
    case 'timeout':
    case 'unreachable':
      return new WordPressError('unreachable', 'WordPress couldn’t be reached.');
    case 'rate_limited':
      return new WordPressError('unreachable', 'WordPress asked to wait. Try again later.', status);
    case 'http_error':
      if (status >= 300 && status < 400) {
        return new WordPressError(
          'redirect',
          'The site sends the request on to another address. Use the address it goes to (with or without www).',
          status,
        );
      }
      if (status === 404 || status === 410) {
        return new WordPressError('not_found', 'WordPress has no such post.', status);
      }
      return new WordPressError('failed', `WordPress answered ${status}.`, status);
    default:
      return new WordPressError('failed', 'WordPress didn’t answer as expected.', status);
  }
}

/**
 * One call to the site's REST API. `request` replaces the HTTP client in
 * tests (connectors/testing.js).
 */
async function call(site, route, { credentials, method = 'GET', query, body, request }) {
  const headers = credentials ? { authorization: authorization(credentials) } : {};
  try {
    const { data } = await (request ?? requestJson)(`${site}/wp-json${route}`, {
      method,
      headers,
      query,
      body,
    });
    return data;
  } catch (err) {
    throw wordPressError(err);
  }
}

/** What the site check reads of the REST index (it can run to megabytes with many plugins). */
const INDEX = { _fields: 'name,namespaces,authentication' };

const notWordPress = (site) =>
  new WordPressError(
    'not_wordpress',
    `There’s no WordPress REST API at ${site}/wp-json/. Check the address, and that Settings › Permalinks isn’t set to Plain.`,
  );

/** A failed read of the REST index, in the words of that step. */
function indexError(site, err) {
  if (!(err instanceof WordPressError)) return err;
  if (['redirect', 'unreachable', 'auth_failed'].includes(err.code)) return err;
  if (err.code === 'no_access') {
    return new WordPressError(
      'site_refused',
      'The site refused the request: a firewall or a security plugin may block its REST API.',
      err.status,
    );
  }
  if (err.code === 'failed' && err.status >= 500) return err;
  return notWordPress(site);
}

/** The index of a WordPress site, or why it isn't one. */
function assertWordPress(site, index) {
  if (!Array.isArray(index?.namespaces) || !index.namespaces.includes('wp/v2')) {
    throw notWordPress(site);
  }
  return index;
}

/** The site's name as WordPress shows it, its HTML entities read (WordPress keeps it escaped). */
function siteNameOf(index) {
  if (typeof index.name !== 'string') return null;
  const name = cheerio.load(index.name, null, false).text().trim().slice(0, 300);
  return name || null;
}

/**
 * Checks a site and a sign-in before they're kept: the site answers as
 * WordPress, takes Application Passwords, and the user can write posts.
 * The password is sent only once the site has answered as WordPress, or
 * keeps its API from visitors (401, 403).
 *
 * @param {string} site from siteAddress()
 * @param {{ username: string, password: string }} credentials
 * @returns {Promise<{ siteName: string|null, account: string }>}
 */
export async function checkSite(site, credentials, { request } = {}) {
  let index = null;
  try {
    index = assertWordPress(site, await call(site, '/', { query: INDEX, request }));
  } catch (err) {
    // A site that keeps its API from visitors is asked again, signed in.
    if (!(err instanceof WordPressError && ['auth_failed', 'no_access'].includes(err.code))) {
      throw indexError(site, err);
    }
  }
  if (!index) {
    try {
      index = assertWordPress(site, await call(site, '/', { credentials, query: INDEX, request }));
    } catch (err) {
      throw indexError(site, err);
    }
  }
  if (!index.authentication?.['application-passwords']) {
    throw new WordPressError(
      'no_app_passwords',
      'This site has Application Passwords turned off. WordPress 5.6 and later have them; a security plugin may turn them off.',
    );
  }
  let me;
  try {
    me = await call(site, '/wp/v2/users/me', { credentials, query: { context: 'edit' }, request });
  } catch (err) {
    if (err instanceof WordPressError && err.code === 'auth_failed') {
      // A wrong password fails every call to the API. One only this call
      // refuses never reached WordPress: the server dropped the header.
      const reached = await call(site, '/', { credentials, query: INDEX, request }).then(
        () => true,
        () => false,
      );
      if (reached) {
        throw new WordPressError(
          'header_dropped',
          'The site’s server didn’t pass the sign-in on to WordPress. Save Settings › Permalinks once, or ask your host to pass the Authorization header (Apache: SetEnvIf Authorization "(.*)" HTTP_AUTHORIZATION=$1 in .htaccess).',
          err.status,
        );
      }
    }
    if (err instanceof WordPressError && err.code === 'not_found') {
      throw new WordPressError(
        'users_hidden',
        'The site hides its users from the REST API (a security plugin may). Let signed-in users reach /wp-json/wp/v2/users/me.',
        err.status,
      );
    }
    throw err;
  }
  if (!me?.capabilities?.edit_posts) {
    throw new WordPressError(
      'no_access',
      'This user can’t write posts on the site. Use an Author, an Editor or an Administrator.',
    );
  }
  return { siteName: siteNameOf(index), account: credentials.username };
}

/** A post as Send to CMS keeps it. */
const postOf = (data) => ({
  id: Number(data?.id),
  status: typeof data?.status === 'string' ? data.status : null,
  link: typeof data?.link === 'string' ? data.link : null,
});

/** A post id as WordPress takes it in a path, or null. */
const postId = (id) => (/^[1-9]\d{0,18}$/.test(String(id)) ? String(id) : null);

/**
 * A new draft post.
 * @param {{ title: string, slug?: string|null, content: string, excerpt?: string }} post
 */
export async function createPost(site, credentials, post, { request } = {}) {
  const data = await call(site, '/wp/v2/posts', {
    credentials,
    method: 'POST',
    body: { ...post, status: 'draft' },
    request,
  });
  const created = postOf(data);
  if (!Number.isInteger(created.id) || created.id <= 0) {
    throw new WordPressError('failed', 'WordPress didn’t say which post it made.');
  }
  return created;
}

/** A post as it stands, or null when it's gone (deleted for good, never there) or not the user's to edit. */
export async function readPost(site, credentials, id, { request } = {}) {
  const path = postId(id);
  if (!path) return null;
  try {
    return postOf(
      await call(site, `/wp/v2/posts/${path}`, {
        credentials,
        query: { context: 'edit' },
        request,
      }),
    );
  } catch (err) {
    // Gone, or another user's that this one can't edit: not this connection's post.
    if (err instanceof WordPressError && ['not_found', 'no_access'].includes(err.code)) return null;
    throw err;
  }
}

/**
 * A post's status and link, for the published check (cms/wordpressStatus.js):
 * null when it's gone (404, 410). A post this user can't read to edit, as
 * a Contributor's once an Editor published it, is read as the public sees
 * it; one it can't read either throws ('failed'), so its send stays open.
 */
export async function readPostState(site, credentials, id, { request } = {}) {
  const path = postId(id);
  if (!path) return null;
  try {
    return postOf(
      await call(site, `/wp/v2/posts/${path}`, {
        credentials,
        query: { context: 'edit' },
        request,
      }),
    );
  } catch (err) {
    if (err instanceof WordPressError && err.code === 'not_found') return null;
    if (!(err instanceof WordPressError && err.code === 'no_access')) throw err;
  }
  try {
    return postOf(
      await call(site, `/wp/v2/posts/${path}`, {
        credentials,
        query: { context: 'view' },
        request,
      }),
    );
  } catch (err) {
    throw new WordPressError('failed', 'This user can’t read the post.', err?.status);
  }
}

/**
 * Whether the site answers as WordPress now, signed in: before a post's
 * 404 closes its send, as a site moved, or its permalinks set to Plain,
 * answers 404 for every post.
 */
export async function answersAsWordPress(site, credentials, { request } = {}) {
  try {
    const index = await call(site, '/', {
      credentials,
      query: { _fields: 'namespaces' },
      request,
    });
    return Array.isArray(index?.namespaces) && index.namespaces.includes('wp/v2');
  } catch {
    return false;
  }
}

/** Writes a post's title, slug, content and excerpt; its status stays as it is. */
export async function updatePost(site, credentials, id, post, { request } = {}) {
  const path = postId(id);
  if (!path) throw new WordPressError('not_found', 'WordPress has no such post.');
  return postOf(
    await call(site, `/wp/v2/posts/${path}`, { credentials, method: 'POST', body: post, request }),
  );
}

/**
 * Puts a post live (AUTONOMOUS-GO-LIVE PR 9): its status `publish`, its
 * content as it was written. The post as WordPress answers, with its link.
 */
export async function publishPost(site, credentials, id, { request } = {}) {
  const path = postId(id);
  if (!path) throw new WordPressError('not_found', 'WordPress has no such post.');
  return postOf(
    await call(site, `/wp/v2/posts/${path}`, {
      credentials,
      method: 'POST',
      body: { status: 'publish' },
      request,
    }),
  );
}

/**
 * Takes a post down (AUTONOMOUS-GO-LIVE PR 10): its status `draft` again,
 * so its address stops working; its content stays. The post as WordPress
 * answers.
 */
export async function unpublishPost(site, credentials, id, { request } = {}) {
  const path = postId(id);
  if (!path) throw new WordPressError('not_found', 'WordPress has no such post.');
  return postOf(
    await call(site, `/wp/v2/posts/${path}`, {
      credentials,
      method: 'POST',
      body: { status: 'draft' },
      request,
    }),
  );
}

/**
 * Revokes the Application Password the connection signs in with, where the
 * site allows it (WordPress 5.7+ tells a password its own id). Best effort:
 * false when it couldn't, and the connection goes anyway.
 */
export async function revokePassword(site, credentials, { request } = {}) {
  try {
    const own = await call(site, '/wp/v2/users/me/application-passwords/introspect', {
      credentials,
      request,
    });
    const uuid =
      typeof own?.uuid === 'string' && /^[0-9a-f-]{36}$/i.test(own.uuid) ? own.uuid : null;
    if (!uuid) return false;
    await call(site, `/wp/v2/users/me/application-passwords/${uuid}`, {
      credentials,
      method: 'DELETE',
      request,
    });
    return true;
  } catch {
    return false;
  }
}
