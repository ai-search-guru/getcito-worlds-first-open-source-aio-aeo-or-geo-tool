import * as cheerio from 'cheerio';
import { ConnectorHttpError, requestJson } from '../../connectors/http.js';

/**
 * Wix for Send to CMS (#1331, phase 2; 00372): a site's Blog through Wix's
 * REST API, with an API key the site's owner made in Wix's API Keys Manager
 * (the Wix Blog permissions), sent as `Authorization: <key>` beside
 * `wix-site-id: <site id>`.
 *
 * Every call goes through the connectors' HTTP client (connectors/http.js):
 * https only, no redirect followed, and a POST never sent twice. Pages go as
 * draft posts: nothing here publishes. A page's HTML becomes Wix's rich
 * content (Ricos) through Wix's own converter, in pieces it takes at once.
 *
 * The key is never put in a message, a log or an answer.
 */

/** Wix's REST API; tests reach a fake of it. */
export const WIX_API = 'https://www.wixapis.com';

export class WixError extends Error {
  /**
   * @param {'invalid'|'auth_failed'|'no_access'|'no_ricos_permission'|'no_blog'|'no_member'|
   *   'not_found'|'unreachable'|'failed'} code
   *   'auth_failed': the key is refused (the person connects again);
   *   'no_ricos_permission': the key may write the Blog, not use Wix's converter
   * @param {string} message
   * @param {number} [status] the HTTP status Wix answered, when it did
   */
  constructor(code, message, status) {
    super(message);
    this.name = 'WixError';
    this.code = code;
    this.status = status;
  }
}

const GUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * The site's id as the person gave it: the id itself, or the address of its
 * dashboard (manage.wix.com/dashboard/<site id>/…), where Wix shows it.
 */
export function siteIdOf(input) {
  const match = String(input ?? '')
    .trim()
    .match(GUID);
  if (!match) {
    throw new WixError(
      'invalid',
      'That isn’t a Wix site id. Copy it from the address of the site’s dashboard.',
    );
  }
  return match[0].toLowerCase();
}

/** Wix's answer to a call that failed, in our words. */
function wixError(err) {
  if (err instanceof WixError) return err;
  if (!(err instanceof ConnectorHttpError)) return err;
  const { status } = err;
  switch (err.code) {
    case 'auth':
      return status === 403
        ? new WixError(
            'no_access',
            'The API key isn’t allowed to do that. Give it the Wix Blog permissions in the API Keys Manager.',
            status,
          )
        : new WixError('auth_failed', 'Wix refused the API key.', status);
    case 'timeout':
    case 'unreachable':
    case 'invalid_url':
    case 'blocked':
      return new WixError('unreachable', 'Wix couldn’t be reached.');
    case 'rate_limited':
      return new WixError('unreachable', 'Wix asked to wait. Try again later.', status);
    case 'http_error':
      if (status === 404) return new WixError('not_found', 'Wix has no such post.', status);
      return new WixError('failed', `Wix answered ${status}.`, status);
    default:
      return new WixError('failed', 'Wix didn’t answer as expected.', status);
  }
}

/**
 * One call to Wix's API for the site. `request` replaces the HTTP client and
 * `base` Wix's address in tests (connectors/testing.js).
 */
async function call(path, { siteId, apiKey, method = 'GET', query, body, request, base }) {
  try {
    const { data } = await (request ?? requestJson)(`${base ?? WIX_API}${path}`, {
      method,
      headers: { authorization: apiKey, 'wix-site-id': siteId },
      query,
      body,
    });
    return data;
  } catch (err) {
    throw wixError(err);
  }
}

/**
 * Checks a site and its key before they're kept: the key opens the site's
 * Blog, it may use Wix's converter (a page is sent through it: tried on a
 * line of text, which Wix doesn't keep), and a member can own the posts it
 * writes (Wix's Blog needs one): the owner of its newest post, else its
 * first member. The site's name when the key may read it.
 *
 * @returns {Promise<{ siteName: string|null, memberId: string }>}
 */
export async function checkSite(siteId, apiKey, { request, base } = {}) {
  const opts = { siteId, apiKey, request, base };
  let posts;
  try {
    posts = await call('/blog/v3/posts', { ...opts, query: { 'paging.limit': 1 } });
  } catch (err) {
    if (err instanceof WixError && err.code === 'not_found') {
      throw new WixError(
        'no_blog',
        'This site has no Wix Blog. Add the Blog to the site first.',
        err.status,
      );
    }
    throw err;
  }
  await toRicos(siteId, apiKey, '<p>x</p>', { request, base });
  let memberId = posts?.posts?.[0]?.memberId ?? null;
  if (!memberId) {
    const members = await call('/members/v1/members/query', {
      ...opts,
      method: 'POST',
      body: { query: { paging: { limit: 1 } } },
    }).catch(() => null);
    memberId = members?.members?.[0]?.id ?? null;
  }
  if (typeof memberId !== 'string' || !GUID.test(memberId)) {
    throw new WixError(
      'no_member',
      'Wix needs a site member to own the posts. Write one post on the Blog as the site’s owner, then connect again.',
    );
  }
  const properties = await call('/site-properties/v4/properties', opts).catch(() => null);
  const name = properties?.properties?.siteDisplayName;
  return {
    siteName: typeof name === 'string' && name.trim() ? name.trim().slice(0, 300) : null,
    memberId,
  };
}

/** The most Wix's converter is sent at once: its limit is 30,000 characters. */
export const RICOS_CHUNK = 29_000;
/** What the converter keeps of a page beside paragraphs, lists and text styles. */
const RICOS_PLUGINS = ['HEADING', 'LINK', 'TABLE', 'CODE_BLOCK', 'DIVIDER'];

const escapeText = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Pieces joined, in order, as many as fit in `limit` characters at a time. */
function pack(pieces, limit) {
  const packed = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length > limit) {
      packed.push(current);
      current = '';
    }
    current += piece;
  }
  if (current) packed.push(current);
  return packed;
}

/**
 * Text, escaped, in pieces of at most `limit` characters, cut between
 * words. Only a word longer than that on its own is cut: an escaped
 * character takes up to five, so its parts are a fifth of the limit.
 */
function textPieces(text, limit) {
  const parts = [];
  for (const word of text.match(/\S+\s*|\s+/g) ?? []) {
    let rest = word;
    while (rest) {
      const part =
        escapeText(rest).length <= limit ? rest : rest.slice(0, Math.max(1, Math.floor(limit / 5)));
      parts.push(escapeText(part));
      rest = rest.slice(part.length);
    }
  }
  return pack(parts, limit);
}

/**
 * A node's HTML in pieces of at most `limit` characters, each one whole. A
 * node longer than that is split among its children, each piece in a copy
 * of its tag (a list's items in lists, a table's rows in tables, a
 * paragraph's text in paragraphs, between words). One with nothing to split
 * it by goes as its text, in paragraphs.
 */
function nodePieces($, node, limit) {
  const outer = $.html(node);
  if (outer.length <= limit) return [outer];
  if (node.type === 'text') return textPieces(node.data, limit);
  if (node.type === 'tag' && node.children?.length) {
    const empty = $.html($(node).clone().empty());
    const close = `</${node.name}>`;
    const room = limit - empty.length;
    // A tag that takes up half the room isn't worth copying.
    if (empty.endsWith(close) && room >= limit / 2) {
      const open = empty.slice(0, -close.length);
      const inner = node.children.flatMap((child) => nodePieces($, child, room));
      return pack(inner, room).map((html) => `${open}${html}${close}`);
    }
  }
  const text = $(node).text().replace(/\s+/g, ' ').trim();
  return textPieces(text, limit - '<p></p>'.length).map((piece) => `<p>${piece}</p>`);
}

/**
 * The page's top-level blocks in pieces of at most RICOS_CHUNK characters,
 * in order. A block longer than that on its own is split among its children
 * (nodePieces).
 */
export function ricosChunks(html, limit = RICOS_CHUNK) {
  const $ = cheerio.load(html, null, false);
  const blocks = [];
  for (const node of $.root().contents().toArray()) {
    if (!$.html(node).trim()) continue;
    blocks.push(...nodePieces($, node, limit));
  }
  return pack(blocks, limit);
}

/**
 * The page's HTML as Wix's rich content: its pieces converted one after
 * another, joined. A key refused there has the Blog's permissions, not the
 * converter's (Manage Ricos Document).
 */
export async function toRicos(siteId, apiKey, html, { request, base } = {}) {
  const nodes = [];
  for (const chunk of ricosChunks(html)) {
    const data = await call('/ricos/v1/ricos-document/convert/to-ricos', {
      siteId,
      apiKey,
      method: 'POST',
      body: { html: chunk, options: { plugins: RICOS_PLUGINS } },
      request,
      base,
    }).catch((err) => {
      if (err instanceof WixError && err.code === 'no_access') {
        throw new WixError(
          'no_ricos_permission',
          'The API key needs the Ricos permission (Manage Ricos Document) too. Add it to the key in Wix’s API Keys Manager, then try again.',
          err.status,
        );
      }
      throw err;
    });
    if (!Array.isArray(data?.document?.nodes)) {
      throw new WixError('failed', 'Wix couldn’t read the page’s text.');
    }
    nodes.push(...data.document.nodes);
  }
  return { nodes };
}

/**
 * A post's address, whole: Wix may give it without its scheme
 * (mysite.wixsite.com/mysite/post/x), so it gets https://. Null when it
 * isn't a web address.
 */
export function webAddress(url) {
  const value = typeof url === 'string' ? url.trim() : '';
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith('//')) return `https:${value}`;
  // A host first: example.com/…, mysite.wixsite.com/…
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#]|$)/i.test(value)) return `https://${value}`;
  return null;
}

/** A draft post as Send to CMS keeps it. */
function draftOf(data) {
  const post = data?.draftPost ?? {};
  const url = webAddress(
    typeof post.url === 'string'
      ? post.url
      : post.url?.base && post.url?.path
        ? `${post.url.base.replace(/\/$/, '')}${post.url.path}`
        : null,
  );
  return {
    id: typeof post.id === 'string' ? post.id : null,
    status: typeof post.status === 'string' ? post.status : null,
    url,
    // A published post's changes not published yet (its draft version written to).
    pending: post.hasUnpublishedChanges === true,
  };
}

const postPath = (id) => (GUID.test(String(id)) ? String(id).match(GUID)[0] : null);

/**
 * A new draft post.
 * @param {{ title: string, richContent: object, memberId: string, excerpt?: string,
 *   seoSlug?: string, seoData?: object }} post
 */
export async function createDraftPost(siteId, apiKey, post, { request, base } = {}) {
  const created = draftOf(
    await call('/blog/v3/draft-posts', {
      siteId,
      apiKey,
      method: 'POST',
      body: { draftPost: post, publish: false, fieldsets: ['URL'] },
      request,
      base,
    }),
  );
  if (!created.id) throw new WixError('failed', 'Wix didn’t say which post it made.');
  return created;
}

/** A draft post as it stands, or null when it's gone. */
export async function readDraftPost(siteId, apiKey, id, { request, base } = {}) {
  const path = postPath(id);
  if (!path) return null;
  try {
    return draftOf(
      await call(`/blog/v3/draft-posts/${path}`, {
        siteId,
        apiKey,
        query: { fieldsets: 'URL' },
        request,
        base,
      }),
    );
  } catch (err) {
    if (err instanceof WixError && err.code === 'not_found') return null;
    throw err;
  }
}

/**
 * Writes a draft post. A published one is written as its draft version
 * (UPDATE_PUBLICATION): the post people read stays as it was until the
 * person publishes the changes in Wix.
 */
export async function updateDraftPost(
  siteId,
  apiKey,
  id,
  post,
  { live = false, request, base } = {},
) {
  const path = postPath(id);
  if (!path) throw new WixError('not_found', 'Wix has no such post.');
  return draftOf(
    await call(`/blog/v3/draft-posts/${path}`, {
      siteId,
      apiKey,
      method: 'PATCH',
      body: { draftPost: { ...post, id: path }, action: live ? 'UPDATE_PUBLICATION' : 'UPDATE' },
      request,
      base,
    }),
  );
}

/**
 * Puts a draft post live (AUTONOMOUS-GO-LIVE PR 9): Wix publishes it as it
 * was written, then the draft post read again for its address. The draft
 * post after it.
 */
export async function publishDraftPost(siteId, apiKey, id, { request, base } = {}) {
  const path = postPath(id);
  if (!path) throw new WixError('not_found', 'Wix has no such post.');
  await call(`/blog/v3/draft-posts/${path}/publish`, {
    siteId,
    apiKey,
    method: 'POST',
    body: {},
    request,
    base,
  });
  const after = await readDraftPost(siteId, apiKey, path, { request, base });
  if (!after) throw new WixError('not_found', 'Wix has no such post.');
  return after;
}

/**
 * Takes a published post down (AUTONOMOUS-GO-LIVE PR 10): Wix reverts it to
 * a draft post (UPDATE_REVERT_TO_DRAFT), so it leaves the blog; its content
 * stays. The draft post after it.
 */
export async function revertToDraft(siteId, apiKey, id, { request, base } = {}) {
  const path = postPath(id);
  if (!path) throw new WixError('not_found', 'Wix has no such post.');
  return draftOf(
    await call(`/blog/v3/draft-posts/${path}`, {
      siteId,
      apiKey,
      method: 'PATCH',
      body: { draftPost: { id: path }, action: 'UPDATE_REVERT_TO_DRAFT' },
      request,
      base,
    }),
  );
}
