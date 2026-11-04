import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * /api/cms/brands/:brandId/framer (Send to CMS, #1331 phase 2, 00295): a
 * brand's Framer connection. Members read it; admins and managers connect a
 * project with an API key made in it, checked with Framer first, pick the
 * collection and its fields, and disconnect; the key is never kept in the
 * clear, logged or sent back.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const PROJECT = 'AbCdEfGhIj0123456789';
const OTHER_PROJECT = 'ZzYyXxWwVv9876543210';
const KEY = 'fr_key_0123456789abcdefSECRET';

let role;
let rows;
let configured;
const assertBrandAccess = vi.fn();
const credentials = { save: vi.fn(), read: vi.fn() };
const framer = { checkProject: vi.fn(), listCollections: vi.fn(), collectionOf: vi.fn() };

/** brand_cms_connections in memory: the queries the routes make. */
function table() {
  let filters = [];
  let write = null;
  const matches = (row) => filters.every(([col, value]) => row[col] === value);
  const run = () => {
    if (write?.kind === 'upsert') {
      const at = rows.findIndex(
        (r) => r.brand_id === write.row.brand_id && r.provider === write.row.provider,
      );
      const row = {
        id: 'cn1',
        created_at: '2026-10-27T10:00:00Z',
        ...(at >= 0 ? rows[at] : {}),
        ...write.row,
      };
      if (at >= 0) rows[at] = row;
      else rows.push(row);
      return [row];
    }
    if (write?.kind === 'update') {
      const hit = rows.filter(matches);
      for (const row of hit) Object.assign(row, write.fields);
      return hit;
    }
    if (write?.kind === 'delete') {
      const hit = rows.filter(matches);
      rows = rows.filter((r) => !matches(r));
      return hit;
    }
    return rows.filter(matches);
  };
  const answer = () => run().map((row) => ({ ...row }));
  const chain = {
    select: () => chain,
    eq: (col, value) => {
      filters.push([col, value]);
      return chain;
    },
    upsert: (row) => {
      write = { kind: 'upsert', row };
      return chain;
    },
    update: (fields) => {
      write = { kind: 'update', fields };
      return chain;
    },
    delete: () => {
      write = { kind: 'delete' };
      return chain;
    },
    maybeSingle: async () => ({ data: answer()[0] ?? null, error: null }),
    single: async () => ({ data: answer()[0] ?? null, error: null }),
    then: (resolve) => resolve({ data: answer(), error: null }),
  };
  return chain;
}

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (name) => {
      if (name === 'profiles') {
        const chain = {
          select: () => chain,
          eq: () => chain,
          single: async () => ({ data: { role } }),
        };
        return chain;
      }
      return table();
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('../lib/composio.js', () => ({
  isWebflowConfigured: () => false,
  connectWebflowToken: vi.fn(),
  deleteConnection: vi.fn(),
  forgetWebflowAccounts: vi.fn(),
}));
vi.mock('../lib/catalog/credentials.js', () => ({ credentialsConfigured: () => configured }));
vi.mock('../lib/cms/credentials.js', () => ({
  saveCmsCredentials: (...args) => credentials.save(...args),
  readCmsCredentials: (...args) => credentials.read(...args),
}));
vi.mock('../lib/cms/framer.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkProject: (...args) => framer.checkProject(...args),
  listCollections: (...args) => framer.listCollections(...args),
  collectionOf: (...args) => framer.collectionOf(...args),
}));
vi.mock('../middleware/rateLimiter.js', () => ({ cmsLimiter: (_req, _res, next) => next() }));

const { default: router } = await import('./cmsFramer.js');
const { FramerError } = await import('../lib/cms/framer.js');

let server;
let base;
let logged;

const BLOG = {
  id: 'cBlog',
  name: 'Blog',
  titleField: 'fTitle',
  fields: [
    { id: 'fTitle', name: 'Title', type: 'string' },
    { id: 'fBody', name: 'Content', type: 'formattedText' },
    { id: 'fSeo', name: 'SEO Title', type: 'string' },
    { id: 'fCover', name: 'Cover', type: 'image' },
    { id: 'fReviewer', name: 'Reviewed by', type: 'string' },
  ],
};

beforeEach(async () => {
  role = 'manager';
  rows = [];
  logged = [];
  configured = true;
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  credentials.save.mockReset().mockResolvedValue(undefined);
  credentials.read.mockReset().mockResolvedValue({ apiKey: KEY });
  framer.checkProject.mockReset().mockResolvedValue({
    projectId: PROJECT,
    projectName: 'Acme Coffee',
    account: 'Ada Editor',
    siteUrl: 'https://acme.framer.website',
  });
  framer.listCollections.mockReset().mockResolvedValue([BLOG]);
  framer.collectionOf.mockReset().mockResolvedValue(BLOG);
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    const log = (...args) => logged.push(JSON.stringify(args));
    req.log = { error: log, warn: log, info: log };
    next();
  });
  app.use('/api/cms', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/cms/brands/${BRAND}/framer`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const call = (method, body, path = '') =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const input = { project: `https://framer.com/projects/Acme-Site--${PROJECT}`, apiKey: KEY };
const connectedRow = (extra = {}) => ({
  id: 'cn1',
  brand_id: BRAND,
  provider: 'framer',
  status: 'connected',
  site_id: PROJECT,
  site_name: 'Acme Coffee',
  site_url: 'https://acme.framer.website',
  account: 'Ada Editor',
  collection_id: 'cBlog',
  collection_name: 'Blog',
  field_map: { title: 'fTitle', body: 'fBody' },
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
  ...extra,
});

describe('GET', () => {
  it('reads the brand’s connection for any member, and says whether the server can keep one', async () => {
    role = 'analyst';
    rows = [connectedRow()];
    const res = await call('GET');
    expect(await res.json()).toEqual({
      configured: true,
      connection: {
        status: 'connected',
        projectId: PROJECT,
        projectName: 'Acme Coffee',
        siteUrl: 'https://acme.framer.website',
        account: 'Ada Editor',
        collectionId: 'cBlog',
        collectionName: 'Blog',
        fieldMap: { title: 'fTitle', body: 'fBody' },
        connectedAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
      },
    });
    configured = false;
    rows = [];
    expect(await (await call('GET')).json()).toEqual({ configured: false, connection: null });
  });
});

describe('POST', () => {
  it('checks the project, keeps the connection and seals the key, never answering with it', async () => {
    const res = await call('POST', input);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text).connection).toMatchObject({
      status: 'connected',
      projectId: PROJECT,
      projectName: 'Acme Coffee',
      siteUrl: 'https://acme.framer.website',
      account: 'Ada Editor',
      collectionId: null,
      fieldMap: {},
    });
    expect(framer.checkProject).toHaveBeenCalledWith(PROJECT, KEY);
    expect(rows).toEqual([
      expect.objectContaining({
        brand_id: BRAND,
        provider: 'framer',
        site_id: PROJECT,
        status: 'connected',
        connected_by: 'u1',
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain(KEY);
    expect(credentials.save).toHaveBeenCalledWith('cn1', { apiKey: KEY }, { setBy: 'u1' });
  });

  it('keeps the collection and its fields for a new key to the same project', async () => {
    rows = [connectedRow({ status: 'auth_failed' })];
    await call('POST', input);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'connected',
      collection_id: 'cBlog',
      collection_name: 'Blog',
      field_map: { title: 'fTitle', body: 'fBody' },
    });
  });

  it('starts over for another project', async () => {
    rows = [connectedRow()];
    framer.checkProject.mockResolvedValueOnce({
      projectId: OTHER_PROJECT,
      projectName: 'Other',
      account: 'Ada Editor',
      siteUrl: null,
    });
    const res = await call('POST', { ...input, project: OTHER_PROJECT });
    expect((await res.json()).connection).toMatchObject({
      projectId: OTHER_PROJECT,
      siteUrl: null,
      collectionId: null,
      collectionName: null,
      fieldMap: {},
    });
    expect(framer.checkProject).toHaveBeenCalledWith(OTHER_PROJECT, KEY);
  });

  it('asks to connect again when the key can’t be kept', async () => {
    credentials.save.mockRejectedValueOnce(new Error('brand_cms_credentials write: 42501'));
    const res = await call('POST', input);
    expect(res.status).toBe(500);
    expect(rows[0].status).toBe('auth_failed');
  });

  it('keeps nothing when Framer refuses, and says why in its words', async () => {
    framer.checkProject.mockRejectedValueOnce(
      new FramerError('auth_failed', 'Framer refused the API key.'),
    );
    const res = await call('POST', input);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Framer refused the API key.', code: 'auth_failed' });
    expect(rows).toEqual([]);
    expect(credentials.save).not.toHaveBeenCalled();
  });

  it('answers Framer’s other failures with their own statuses', async () => {
    for (const [code, status] of [
      ['invalid', 400],
      ['no_access', 403],
      ['not_found', 404],
      ['busy', 429],
      ['unreachable', 502],
      ['failed', 502],
    ]) {
      framer.checkProject.mockRejectedValueOnce(new FramerError(code, 'no'));
      const res = await call('POST', input);
      expect(res.status, code).toBe(status);
      expect((await res.json()).code).toBe(code);
    }
  });

  it('refuses an address that isn’t a Framer project’s before calling Framer', async () => {
    const res = await call('POST', {
      ...input,
      project: `https://evil.example/projects/${PROJECT}`,
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid');
    expect(framer.checkProject).not.toHaveBeenCalled();
  });

  it('asks for the project and a key', async () => {
    for (const body of [
      {},
      { project: input.project },
      { ...input, apiKey: 'short' },
      { ...input, apiKey: 'has a space in it' },
      { ...input, project: '' },
    ]) {
      const res = await call('POST', body);
      expect(res.status).toBe(400);
    }
    expect(framer.checkProject).not.toHaveBeenCalled();
  });

  it('is for admins and managers', async () => {
    role = 'analyst';
    const res = await call('POST', input);
    expect(res.status).toBe(403);
    expect(framer.checkProject).not.toHaveBeenCalled();
  });

  it('says Framer isn’t set up on a server that can’t keep a key', async () => {
    configured = false;
    const res = await call('POST', input);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('not_configured');
    expect(framer.checkProject).not.toHaveBeenCalled();
  });

  it('logs a crash by name only', async () => {
    framer.checkProject.mockRejectedValueOnce(new Error(`bad ${KEY}`));
    const res = await call('POST', input);
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(KEY);
    expect(logged.join('')).not.toContain(KEY);
  });
});

describe('GET collections', () => {
  it('lists the project’s collections with the kept key', async () => {
    rows = [connectedRow()];
    const res = await call('GET', undefined, '/collections');
    expect(await res.json()).toEqual({ collections: [BLOG] });
    expect(credentials.read).toHaveBeenCalledWith('cn1');
    expect(framer.listCollections).toHaveBeenCalledWith(PROJECT, KEY);
  });

  it('marks the connection refused when Framer refuses its key', async () => {
    rows = [connectedRow()];
    framer.listCollections.mockRejectedValueOnce(
      new FramerError('auth_failed', 'Framer refused the API key.'),
    );
    const res = await call('GET', undefined, '/collections');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('auth_failed');
    expect(rows[0].status).toBe('auth_failed');
  });

  it('leaves a connection made again meanwhile as it is', async () => {
    rows = [connectedRow()];
    framer.listCollections.mockImplementationOnce(async () => {
      rows[0].updated_at = '2026-10-27T11:00:00Z';
      throw new FramerError('auth_failed', 'Framer refused the API key.');
    });
    await call('GET', undefined, '/collections');
    expect(rows[0].status).toBe('connected');
  });

  it('marks it refused when its key can’t be read', async () => {
    rows = [connectedRow()];
    credentials.read.mockResolvedValueOnce(null);
    const res = await call('GET', undefined, '/collections');
    expect(res.status).toBe(409);
    expect(rows[0].status).toBe('auth_failed');
    expect(framer.listCollections).not.toHaveBeenCalled();
  });

  it('answers a failed read of the key as a crash, the connection left as it is', async () => {
    rows = [connectedRow()];
    credentials.read.mockRejectedValueOnce(new Error('brand_cms_credentials read: 57014'));
    const res = await call('GET', undefined, '/collections');
    expect(res.status).toBe(500);
    expect(rows[0].status).toBe('connected');
    expect(framer.listCollections).not.toHaveBeenCalled();
  });

  it('connects a refused connection again once Framer takes its key', async () => {
    rows = [connectedRow({ status: 'auth_failed' })];
    expect((await call('GET', undefined, '/collections')).status).toBe(200);
    expect(rows[0].status).toBe('connected');
  });

  it('asks to connect first, and is for admins and managers', async () => {
    const res = await call('GET', undefined, '/collections');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('not_connected');
    role = 'analyst';
    rows = [connectedRow()];
    expect((await call('GET', undefined, '/collections')).status).toBe(403);
    expect(framer.listCollections).not.toHaveBeenCalled();
  });
});

describe('PUT where pages go', () => {
  it('keeps a field map that fits the collection, with its name', async () => {
    rows = [connectedRow({ collection_id: null, collection_name: null, field_map: {} })];
    const res = await call('PUT', {
      collectionId: 'cBlog',
      fieldMap: {
        title: 'fTitle',
        body: 'fBody',
        metaTitle: 'fSeo',
        metaDescription: null,
        reviewer: 'fReviewer',
      },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).connection).toMatchObject({
      collectionId: 'cBlog',
      collectionName: 'Blog',
      fieldMap: { title: 'fTitle', body: 'fBody', metaTitle: 'fSeo', reviewer: 'fReviewer' },
    });
    expect(framer.collectionOf).toHaveBeenCalledWith(PROJECT, KEY, 'cBlog');
  });

  it('refuses a part on a field of the wrong type, and a field taken twice', async () => {
    rows = [connectedRow()];
    const wrong = await call('PUT', {
      collectionId: 'cBlog',
      fieldMap: { title: 'fTitle', body: 'fCover' },
    });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({
      code: 'invalid_map',
      problems: ['body: Cover is image, not formattedText'],
    });
    const twice = await call('PUT', {
      collectionId: 'cBlog',
      fieldMap: { title: 'fTitle', body: 'fBody', metaTitle: 'fTitle' },
    });
    expect(twice.status).toBe(400);
    expect((await twice.json()).problems).toEqual(['metaTitle: Title already takes another part']);
    expect(rows[0].field_map).toEqual({ title: 'fTitle', body: 'fBody' });
  });

  it('refuses a collection that isn’t one pages may go to', async () => {
    rows = [connectedRow()];
    framer.collectionOf.mockRejectedValueOnce(
      new FramerError('not_found', 'The project has no such collection.'),
    );
    const res = await call('PUT', { collectionId: 'cSynced', fieldMap: {} });
    expect(res.status).toBe(404);
    expect(rows[0].collection_id).toBe('cBlog');
  });

  it('refuses settings that aren’t a collection and a map of the page’s parts', async () => {
    rows = [connectedRow()];
    for (const body of [
      {},
      { collectionId: '', fieldMap: {} },
      { collectionId: 'cBlog' },
      { collectionId: 'cBlog', fieldMap: { title: 'fTitle', body: 'fBody', author: 'fSeo' } },
      { collectionId: 'cBlog', fieldMap: { title: 'f Title', body: 'fBody' } },
    ]) {
      const res = await call('PUT', body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('invalid');
    }
    expect(framer.collectionOf).not.toHaveBeenCalled();
  });

  it('marks the connection refused when Framer refuses its key', async () => {
    rows = [connectedRow()];
    framer.collectionOf.mockRejectedValueOnce(
      new FramerError('auth_failed', 'Framer refused the API key.'),
    );
    const res = await call('PUT', {
      collectionId: 'cBlog',
      fieldMap: { title: 'fTitle', body: 'fBody' },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('auth_failed');
    expect(rows[0].status).toBe('auth_failed');
  });

  it('asks to connect first, is for admins and managers, and needs a server that keeps keys', async () => {
    const body = { collectionId: 'cBlog', fieldMap: { title: 'fTitle', body: 'fBody' } };
    const none = await call('PUT', body);
    expect(none.status).toBe(409);
    expect((await none.json()).code).toBe('not_connected');
    rows = [connectedRow()];
    role = 'analyst';
    expect((await call('PUT', body)).status).toBe(403);
    role = 'manager';
    configured = false;
    const off = await call('PUT', body);
    expect(off.status).toBe(503);
    expect((await off.json()).code).toBe('not_configured');
    expect(framer.collectionOf).not.toHaveBeenCalled();
  });

  it('doesn’t overwrite a connection made again meanwhile', async () => {
    rows = [connectedRow()];
    framer.collectionOf.mockImplementationOnce(async () => {
      rows[0].updated_at = '2026-10-27T11:00:00Z';
      return BLOG;
    });
    const res = await call('PUT', {
      collectionId: 'cBlog',
      fieldMap: { title: 'fTitle', body: 'fBody', metaTitle: 'fSeo' },
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('changed');
    expect(rows[0].field_map).toEqual({ title: 'fTitle', body: 'fBody' });
  });
});

describe('DELETE', () => {
  it('removes the connection, and says Framer’s key isn’t revoked', async () => {
    rows = [connectedRow()];
    const res = await call('DELETE');
    expect(await res.json()).toEqual({ success: true, revoked: false });
    expect(rows).toEqual([]);
    expect(await (await call('DELETE')).json()).toEqual({ success: true, revoked: false });
  });

  it('is for admins and managers', async () => {
    role = 'analyst';
    rows = [connectedRow()];
    expect((await call('DELETE')).status).toBe(403);
    expect(rows).toHaveLength(1);
  });
});
