import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * /api/cms/brands/:brandId/wix (Send to CMS, #1331 phase 2, 00372): a
 * brand's Wix connection. Members read it; admins and managers connect a
 * site with its owner's API key, checked with Wix first, and disconnect; the
 * key is never kept in the clear, logged or sent back.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const API_KEY = 'IST.eyJraWQiOiJQb3pIX2FDMiJ9.secret-wix-key';
const SITE = '2f8a1c3e-1111-4222-8333-944455556666';
const MEMBER = 'c00e8a5c-322b-4e77-8813-002e3ea7e811';

let role;
let rows;
let configured;
const assertBrandAccess = vi.fn();
const credentials = { save: vi.fn(), read: vi.fn() };
const wix = { checkSite: vi.fn() };

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
vi.mock('../lib/cms/wix.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkSite: (...args) => wix.checkSite(...args),
}));
vi.mock('../middleware/rateLimiter.js', () => ({ cmsLimiter: (_req, _res, next) => next() }));

const { default: router } = await import('./cmsWix.js');
const { WixError } = await import('../lib/cms/wix.js');

let server;
let base;
let logged;

beforeEach(async () => {
  role = 'manager';
  rows = [];
  logged = [];
  configured = true;
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  credentials.save.mockReset().mockResolvedValue(undefined);
  credentials.read.mockReset().mockResolvedValue({ apiKey: API_KEY });
  wix.checkSite.mockReset().mockResolvedValue({ siteName: 'Acme Coffee', memberId: MEMBER });
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
  base = `http://127.0.0.1:${server.address().port}/api/cms/brands/${BRAND}/wix`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const call = (method, body) =>
  fetch(base, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const input = { siteId: `https://manage.wix.com/dashboard/${SITE}/home`, apiKey: API_KEY };
const connectedRow = (extra = {}) => ({
  id: 'cn1',
  brand_id: BRAND,
  provider: 'wix',
  status: 'connected',
  site_id: SITE,
  site_name: 'Acme Coffee',
  account: MEMBER,
  created_at: '2026-10-20T10:00:00Z',
  updated_at: '2026-10-20T10:00:00Z',
  ...extra,
});

describe('GET', () => {
  it('shows a member the connection, never its key', async () => {
    rows = [connectedRow()];
    const res = await call('GET');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      configured: true,
      connection: {
        status: 'connected',
        siteId: SITE,
        siteName: 'Acme Coffee',
        connectedAt: '2026-10-20T10:00:00Z',
        updatedAt: '2026-10-20T10:00:00Z',
      },
    });
    expect(JSON.stringify(body)).not.toContain(API_KEY);
  });
});

describe('POST', () => {
  it('checks the site with Wix, then keeps the connection and seals its key', async () => {
    const res = await call('POST', input);
    expect(res.status).toBe(200);
    // The site's id read from its dashboard's address.
    expect(wix.checkSite).toHaveBeenCalledWith(SITE, API_KEY);
    expect(rows[0]).toMatchObject({
      provider: 'wix',
      site_id: SITE,
      site_name: 'Acme Coffee',
      account: MEMBER,
      status: 'connected',
    });
    expect(credentials.save).toHaveBeenCalledWith('cn1', { apiKey: API_KEY }, { setBy: 'u1' });
    expect(JSON.stringify(await res.json())).not.toContain(API_KEY);
  });

  it('refuses a member who is neither an admin nor a manager, and input it can’t read', async () => {
    role = 'member';
    expect((await call('POST', input)).status).toBe(403);
    role = 'manager';
    expect((await call('POST', { siteId: 'x', apiKey: 'short' })).status).toBe(400);
    expect((await call('POST', { ...input, siteId: 'no id here' })).status).toBe(400);
    expect(wix.checkSite).not.toHaveBeenCalled();
  });

  it('says what Wix answered, and keeps nothing', async () => {
    wix.checkSite.mockRejectedValue(new WixError('no_blog', 'This site has no Wix Blog.'));
    const res = await call('POST', input);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'This site has no Wix Blog.', code: 'no_blog' });
    expect(rows).toEqual([]);
    expect(credentials.save).not.toHaveBeenCalled();
  });

  it('marks the connection refused when its key can’t be kept, and says it isn’t set up without the key store', async () => {
    credentials.save.mockRejectedValue(new Error('brand_cms_credentials write: error'));
    expect((await call('POST', input)).status).toBe(500);
    expect(rows[0].status).toBe('auth_failed');
    expect(logged.join('')).not.toContain(API_KEY);

    configured = false;
    expect((await call('POST', input)).status).toBe(503);
  });
});

describe('DELETE', () => {
  it('disconnects, its key with it', async () => {
    rows = [connectedRow()];
    const res = await call('DELETE');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(rows).toEqual([]);
  });
});
