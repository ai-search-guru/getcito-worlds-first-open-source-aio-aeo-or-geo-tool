import {
  FramerAPIError,
  FramerPluginClosedError,
  FramerPluginError,
  connect as framerConnect,
} from 'framer-api';

/**
 * Framer for Send to CMS (#1331, phase 2; 00295): a project's CMS through
 * Framer's Server API (framer-api), with an API key made in the project
 * (Site Settings › General). The key reaches that project only and acts as
 * the user who made it; Framer has no API to revoke it.
 *
 * Each use opens a WebSocket to Framer (wss://api.framer.com) and closes it
 * once done (withProject): one left open keeps the process from exiting.
 * Pages published since a send are read the same way (readPublished,
 * framerStatus.js).
 *
 * The key is never put in a message, a log or an answer. Our answers and
 * logs carry our own words, never Framer's messages; framer-api's own
 * console output (FRAMER_API_LOG_LEVEL, backend/.env.example) is apart.
 */

export class FramerError extends Error {
  /**
   * @param {'invalid'|'auth_failed'|'no_access'|'not_found'|'busy'|'unreachable'|'slug_taken'|
   *   'failed'} code
   *   'auth_failed': Framer refused the key (the person connects again); 'slug_taken': another
   *   item has the page's slug (a send's, never a route's)
   * @param {string} message
   */
  constructor(code, message) {
    super(message);
    this.name = 'FramerError';
    this.code = code;
  }
}

/** The longest published address kept (brand_cms_connections.site_url). */
export const SITE_URL_MAX = 2048;

/** How long one use of a project may take, its connection included. */
const TIMEOUT_MS = 30_000;
/** How long closing waits for Framer's goodbye (framer-api waits up to 15 s) before the answer goes. */
const CLOSE_WAIT_MS = 5_000;

/** A project id as framer-api (5.1.0) reads it: 20 letters and digits. */
const PROJECT_ID = /^[A-Za-z0-9]{20}$/;
const FRAMER_HOSTS = new Set(['framer.com', 'www.framer.com']);

/**
 * The project the person pasted, as Framer connects to it: its id, from
 * the project's address (https://framer.com/projects/Name--<id>…, as the
 * editor shows it) or the id itself. Anything else is refused before Framer
 * is called. A branch in the address is left out: pages go to the main one.
 */
export function projectRef(input) {
  const text = String(input ?? '').trim();
  if (PROJECT_ID.test(text)) return text;
  const invalid = new FramerError(
    'invalid',
    'Paste the project’s address from Framer (framer.com/projects/…) or its id.',
  );
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    throw invalid;
  }
  if (
    url.protocol !== 'https:' ||
    !FRAMER_HOSTS.has(url.hostname) ||
    url.username ||
    url.password ||
    url.port
  ) {
    throw invalid;
  }
  const [first, second] = url.pathname.split('/').filter(Boolean);
  if (first?.toLowerCase() !== 'projects' || !second) throw invalid;
  let segment;
  try {
    segment = decodeURIComponent(second);
  } catch {
    throw invalid;
  }
  // "Name--<id>", maybe with more after the id: read as framer-api reads it.
  const id = segment.match(/^.+--([A-Za-z0-9]+)/)?.[1] ?? segment;
  if (!PROJECT_ID.test(id)) throw invalid;
  return id;
}

/** framer-api's error codes, in our words. */
const API_ERRORS = {
  UNAUTHORIZED: [
    'auth_failed',
    'Framer refused the API key. Make a new one in the project’s Site Settings › General.',
  ],
  PROJECT_CLOSED: [
    'not_found',
    'Framer couldn’t open the project. Check its address, and that the API key was made in it.',
  ],
  NODE_NOT_FOUND: [
    'not_found',
    'Framer couldn’t find that in the project: it may have been removed.',
  ],
  TOKEN_SESSION_LIMIT: [
    'busy',
    'Framer has too many connections open with this key. Try again in a minute.',
  ],
  POOL_EXHAUSTED: ['busy', 'Framer is busy. Try again in a minute.'],
  TIMEOUT: ['unreachable', 'Framer didn’t answer in time. Try again.'],
  INVALID_REQUEST: [
    'invalid',
    'Framer didn’t take the request. Check the project’s address and the API key.',
  ],
};

const CLOSED = 'Framer closed the connection. Try again.';

/**
 * A failed call to Framer, in our words; an error of our own code goes on
 * as it is. `opened`: the connection was open, so a project closed is a
 * connection dropped mid-call, not a project Framer couldn't open.
 */
function framerError(err, opened) {
  if (err instanceof FramerError) return err;
  if (err instanceof FramerAPIError) {
    if (opened && err.code === 'PROJECT_CLOSED') return new FramerError('unreachable', CLOSED);
    const [code, message] = API_ERRORS[err.code] ?? [
      'failed',
      'Framer didn’t answer as expected. Try again.',
    ];
    return new FramerError(code, message);
  }
  if (err instanceof FramerPluginClosedError) return new FramerError('unreachable', CLOSED);
  // A call Framer refused: its message is Framer's, so it stays out.
  if (err instanceof FramerPluginError) {
    return new FramerError('failed', 'Framer didn’t answer as expected. Try again.');
  }
  return err;
}

/** Closes a connection, its failure aside; the answer doesn't wait long for Framer's goodbye. */
async function close(framer) {
  let timer;
  await Promise.race([
    Promise.resolve()
      .then(() => framer.disconnect())
      .catch(() => {}),
    new Promise((resolve) => {
      timer = setTimeout(resolve, CLOSE_WAIT_MS);
      timer.unref?.();
    }),
  ]);
  clearTimeout(timer);
}

/**
 * Connects to a project, runs `fn` with it and closes the connection,
 * whatever happened. A use that takes longer than `timeoutMs` fails
 * ('unreachable'), and a connection that opens after that is closed as it
 * opens. `connect` replaces framer-api's in tests.
 *
 * @template T
 * @param {string} project from projectRef()
 * @param {string} apiKey
 * @param {(framer: import('framer-api').Framer) => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withProject(
  project,
  apiKey,
  fn,
  { connect = framerConnect, timeoutMs = TIMEOUT_MS } = {},
) {
  let framer = null;
  let late = false;
  let timer;
  const work = (async () => {
    const opened = await connect(project, apiKey);
    if (late) {
      await close(opened);
      return undefined;
    }
    framer = opened;
    return fn(opened);
  })();
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      late = true;
      reject(new FramerError('unreachable', 'Framer didn’t answer in time. Try again.'));
    }, timeoutMs);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (err) {
    throw framerError(err, framer !== null);
  } finally {
    clearTimeout(timer);
    // A use that timed out still settles: its end is nobody's to read.
    work.catch(() => {});
    if (framer) await close(framer);
  }
}

/** A name as kept: trimmed, cut to `max`, or null. */
const nameOf = (value, max) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;

/** The project's published address (https only, as site_url keeps it), or null. */
function siteUrlOf(publish) {
  const raw = typeof publish?.url === 'string' ? publish.url.trim() : '';
  if (!raw) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== 'https:') return null;
    const address = `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
    return address.length <= SITE_URL_MAX ? address : null;
  } catch {
    return null;
  }
}

/** What a send needs to do to a user's collection. */
const EDIT_CMS = ['Collection.addItems', 'CollectionItem.setAttributes'];

/**
 * Checks a project and a key before they're kept: Framer opens the project
 * with the key, and the key's user can edit its CMS. framer-api 5.1.0 keeps
 * `isAllowedTo` to plugins: when the connection has none, the check is
 * left to the send.
 *
 * @param {string} project from projectRef()
 * @returns {Promise<{ projectId: string, projectName: string|null, account: string|null,
 *   siteUrl: string|null }>} projectId: the id Framer connects to, as given
 */
export async function checkProject(project, apiKey, opts) {
  return withProject(
    project,
    apiKey,
    async (framer) => {
      if (typeof framer.isAllowedTo === 'function' && !framer.isAllowedTo(...EDIT_CMS)) {
        throw new FramerError(
          'no_access',
          'This key’s user can’t edit the CMS of the project. Make the key as a user who can.',
        );
      }
      const [info, user, published] = await Promise.all([
        framer.getProjectInfo(),
        framer.getCurrentUser(),
        framer.getPublishInfo(),
      ]);
      return {
        projectId: project,
        projectName: nameOf(info?.name, 300),
        account: nameOf(user?.name, 200),
        siteUrl: siteUrlOf(published?.production),
      };
    },
    opts,
  );
}

/**
 * A collection as Send to CMS shows it: its fields with their Framer types
 * as they are (the web offers the ones a part may go to), dividers left out,
 * and whether each is required (the types that can't be have no flag).
 * `titleField`: the field its items' slugs are made from.
 */
async function collectionShape(collection) {
  const fields = await collection.getFields();
  return {
    id: collection.id,
    name: nameOf(collection.name, 300) ?? collection.id,
    titleField: collection.slugFieldBasedOn ?? null,
    fields: fields
      .filter((f) => f.type !== 'divider')
      .map((f) => ({ id: f.id, name: f.name, type: f.type, required: f.required === true })),
  };
}

/** The user's collections: a plugin's are read-only, so pages can't go to them. */
const usersOwn = (collections) => collections.filter((c) => c.managedBy === 'user');

/** The project's collections pages may go to, with their fields. */
export async function listCollections(project, apiKey, opts) {
  return withProject(
    project,
    apiKey,
    async (framer) => Promise.all(usersOwn(await framer.getCollections()).map(collectionShape)),
    opts,
  );
}

/**
 * One of the project's collections pages may go to, with its fields; read
 * from the list, so an id that isn't one of them never reaches Framer as one.
 */
export async function collectionOf(project, apiKey, collectionId, opts) {
  return withProject(
    project,
    apiKey,
    async (framer) => {
      const collection = usersOwn(await framer.getCollections()).find((c) => c.id === collectionId);
      if (!collection) {
        throw new FramerError(
          'not_found',
          'The project has no such collection, or a plugin manages it. Pick another.',
        );
      }
      return collectionShape(collection);
    },
    opts,
  );
}

/** The collection's items once more: a read changes nothing, so a failed one is tried again, once. */
async function itemsAgain(collection) {
  try {
    return await collection.getItems();
  } catch {
    return collection.getItems();
  }
}

/**
 * Whether the item holding the page's slug is one a send of this page made
 * and couldn't keep the id of (the connection dropped, or Framer's list
 * didn't answer, after the item was added): still a draft, with the very
 * title this send writes in the title field. Taking it over is safe: the
 * slug and title are this page's, and a draft isn't on the site, so writing
 * to it changes nothing anyone sees (a draft made by hand with this slug
 * and title would be taken too, and written with this page). Any other
 * item keeps its slug.
 */
function halfSent(item, fieldData, titleField) {
  const title = titleField ? fieldData[titleField]?.value : undefined;
  return (
    item.draft === true &&
    typeof title === 'string' &&
    item.fieldData?.[titleField]?.value === title
  );
}

/**
 * Writes a page's item in one connection (framerDelivery.js): the item
 * the page's last send made (`before`) is updated while it's in the
 * collection, its draft state as it is; else a draft its half-done send
 * left (halfSent) is; else a new draft item is made. A slug another item
 * has is refused before anything is written.
 *
 * Framer doesn't say which item it made: it is the one new item with the
 * slug, among those the first read didn't have.
 *
 * @param {string} project the connection's project (site_id)
 * @param {{ before: string|null, slug: string, fieldData: object, titleField?: string|null }}
 *   item titleField: the field the page's title goes to (field_map.title)
 * @returns {Promise<{ id: string, updated: boolean, live: boolean }>} live: the item
 *   updated isn't a draft, so the page goes live with the site's next publish
 */
export async function writeItem(
  project,
  apiKey,
  collectionId,
  { before, slug, fieldData, titleField = null },
  opts,
) {
  return withProject(
    project,
    apiKey,
    async (framer) => {
      const collection = usersOwn(await framer.getCollections()).find((c) => c.id === collectionId);
      if (!collection) {
        throw new FramerError(
          'not_found',
          'The collection pages go to is gone from the project: pick another in Settings › Integrations.',
        );
      }
      const items = await collection.getItems();
      const current = before ? (items.find((item) => item.id === before) ?? null) : null;
      const holder = items.find((item) => item.slug === slug && item.id !== current?.id) ?? null;
      if (holder && (current || !halfSent(holder, fieldData, titleField))) {
        throw new FramerError(
          'slug_taken',
          `Another item in ${collection.name} has the slug "${slug}": change the page’s slug, or that item’s.`,
        );
      }
      const own = current ?? holder;
      if (own) {
        // No draft: the item stays a draft, or live, as it is.
        await collection.addItems([{ id: own.id, slug, fieldData }]);
        return { id: own.id, updated: true, live: !own.draft };
      }
      const known = new Set(items.map((item) => item.id));
      await collection.addItems([{ slug, draft: true, fieldData }]);
      const made = (await itemsAgain(collection)).filter(
        (item) => !known.has(item.id) && item.slug === slug,
      );
      if (made.length !== 1)
        throw new FramerError('failed', 'Framer didn’t say which item it made.');
      return { id: made[0].id, updated: false, live: false };
    },
    opts,
  );
}

/** A publish time further ahead than this is a unit read wrong: nothing is marked on it. */
const AHEAD_MS = 10 * 60 * 1000;

/**
 * When the site was last published, in ms, or null. The unit of
 * `deploymentTime` is undocumented by Framer: framer-api (5.1.0) types it as
 * a plain number, so this is a guess. One too small to be ms since 1970
 * (before 1973) is read as seconds; a time read as more than ten minutes
 * ahead is none, so a wrong guess marks nothing published.
 */
function deployedAtOf(production) {
  const time = production?.deploymentTime;
  if (typeof time !== 'number' || !Number.isFinite(time) || time <= 0) return null;
  const ms = time < 1e11 ? time * 1000 : time;
  return ms > Date.now() + AHEAD_MS ? null : ms;
}

/**
 * The path of the collection's detail page ("/blog/:slug"), a draft page
 * left out (it isn't published); of more than one, the shortest.
 */
function detailPathOf(pages, collectionId) {
  let best = null;
  for (const page of pages ?? []) {
    const path = typeof page?.path === 'string' ? page.path.trim() : '';
    if (page?.collectionId !== collectionId || page.draft || !path) continue;
    if (best === null || path.length < best.length) best = path;
  }
  return best;
}

/**
 * What tells whether the items pages were sent as are live (framerStatus.js),
 * read in one connection: the site's published address and when it was last
 * published (production; none while the site isn't), the path of the
 * collection's detail page, and the asked-for items' slugs, draft state and
 * last change. An item gone from the collection isn't in the map.
 *
 * @param {string} project the connection's project (site_id)
 * @param {string[]} itemIds
 * @returns {Promise<{ siteUrl: string|null, deployedAt: number|null, detailPath: string|null,
 *   items: Map<string, { slug: string, draft: boolean, updatedAt: string|null }> }>}
 *   deployedAt: in ms; updatedAt: the item's ISO time, when Framer gives it
 */
export async function readPublished(project, apiKey, collectionId, itemIds, opts) {
  return withProject(
    project,
    apiKey,
    async (framer) => {
      const collection = usersOwn(await framer.getCollections()).find((c) => c.id === collectionId);
      if (!collection) {
        throw new FramerError(
          'not_found',
          'The collection pages go to is gone from the project: pick another in Settings › Integrations.',
        );
      }
      const [items, publish, pages] = await Promise.all([
        collection.getItems(),
        framer.getPublishInfo(),
        framer.getNodesWithType('WebPageNode'),
      ]);
      const wanted = new Set(itemIds);
      const production = publish?.production ?? null;
      return {
        siteUrl: siteUrlOf(production),
        deployedAt: deployedAtOf(production),
        detailPath: detailPathOf(pages, collectionId),
        // A draft state Framer doesn't give is read as a draft: nothing is marked live on a guess.
        items: new Map(
          items
            .filter((item) => wanted.has(item.id))
            .map((item) => [
              item.id,
              {
                slug: item.slug,
                draft: item.draft !== false,
                updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : null,
              },
            ]),
        ),
      };
    },
    opts,
  );
}

/** The parts of a page a field map places, and the Framer field types each may go to. */
const PART_TYPES = {
  title: ['string'],
  body: ['formattedText'],
  metaTitle: ['string'],
  metaDescription: ['string'],
  jsonLd: ['string'],
  reviewer: ['string'],
};
const PAGE_PARTS = Object.keys(PART_TYPES);
/** The parts every map places. */
const NEEDED = {
  title: 'title: pick the text field a page’s title goes to',
  body: 'body: pick the formatted text field a page goes to',
};
/**
 * The parts every page has: its meta title falls back to its title, its
 * meta description to its opening words. A page may have no JSON-LD, so
 * that field can't be one the collection requires.
 */
const ALWAYS_FILLED = new Set(['title', 'body', 'metaTitle', 'metaDescription']);

/**
 * Whether a field map fits the collection: a page's title and body each
 * have a field, each part a field of its own of a type it may go to, and
 * every field the collection requires is one Send to CMS always fills.
 *
 * @param {Record<string, string|null|undefined>} fieldMap part → field id
 * @param {{ id: string, name: string, type: string, required?: boolean }[]} fields
 * @returns {{ ok: true, map: Record<string, string> } | { ok: false, problems: string[] }}
 */
export function checkFieldMap(fieldMap, fields) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  const problems = [];
  const map = {};
  const used = new Set();
  for (const part of PAGE_PARTS) {
    const id = fieldMap?.[part];
    if (id === undefined || id === null || id === '') {
      if (NEEDED[part]) problems.push(NEEDED[part]);
      continue;
    }
    const field = byId.get(id);
    if (!field) {
      problems.push(`${part}: the collection has no field "${String(id).slice(0, 100)}"`);
    } else if (!PART_TYPES[part].includes(field.type)) {
      problems.push(
        `${part}: ${field.name} is ${field.type}, not ${PART_TYPES[part].join(' or ')}`,
      );
    } else if (used.has(id)) {
      problems.push(`${part}: ${field.name} already takes another part`);
    } else {
      map[part] = id;
      used.add(id);
    }
  }
  const filled = new Set(
    Object.entries(map)
      .filter(([part]) => ALWAYS_FILLED.has(part))
      .map(([, id]) => id),
  );
  const unfilled = fields.filter((f) => f.required && !filled.has(f.id));
  if (unfilled.length) {
    problems.push(
      `The collection requires ${unfilled.map((f) => f.name).join(', ')}, which Send to CMS doesn’t fill: make ${unfilled.length === 1 ? 'it' : 'them'} optional in Framer, or pick another collection`,
    );
  }
  return problems.length ? { ok: false, problems } : { ok: true, map };
}
