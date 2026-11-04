import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * /api/cms/brands/:brandId/wordpress (Send to CMS, #1331 phase 2, 00294): a
 * brand's WordPress connection. Members read it; admins and managers connect
 * a site with a user's Application Password, checked with the site first,
 * and disconnect; the password is never kept in the clear, logged or sent
 * back.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const PASSWORD = 'abcd efgh ijkl mnop qrst uvwx';

let role;
let rows;
let configured;
const assertBrandAccess = vi.fn();
const credentials = { save: vi.fn(), read: vi.fn() };
const wordpress = { checkSite: vi.fn(), revokePassword: vi.fn() };

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
vi.mock('../lib/cms/wordpress.js', async (importOriginal) => ({
  ...(await importOriginal()),
  checkSite: (...args) => wordpress.checkSite(...args),
  revokePassword: (...args) => wordpress.revokePassword(...args),
}));
vi.mock('../middleware/rateLimiter.js', () => ({ cmsLimiter: (_req, _res, next) => next() }));

const { default: router } = await import('./cmsWordpress.js');
const { WordPressError } = await import('../lib/cms/wordpress.js');

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
  credentials.read.mockReset().mockResolvedValue({ username: 'editor', password: PASSWORD });
  wordpress.checkSite
    .mockReset()
    .mockResolvedValue({ siteName: 'Acme Coffee Blog', account: 'editor' });
  wordpress.revokePassword.mockReset().mockResolvedValue(true);
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
  base = `http://127.0.0.1:${server.address().port}/api/cms/brands/${BRAND}/wordpress`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const call = (method, body) =>
  fetch(base, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const input = { siteUrl: 'blog.acme.example/wp-admin/', username: 'editor', password: PASSWORD };
const connectedRow = (extra = {}) => ({
  id: 'cn1',
  brand_id: BRAND,
  provider: 'wordpress',
  status: 'connected',
  site_url: 'https://blog.acme.example',
  site_name: 'Acme Coffee Blog',
  account: 'editor',
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
        siteUrl: 'https://blog.acme.example',
        siteName: 'Acme Coffee Blog',
        account: 'editor',
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
  it('checks the site, keeps the connection and seals the sign-in, never answering with it', async () => {
    const res = await call('POST', input);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain('abcd');
    expect(JSON.parse(text).connection).toMatchObject({
      status: 'connected',
      siteUrl: 'https://blog.acme.example',
      siteName: 'Acme Coffee Blog',
      account: 'editor',
    });
    expect(wordpress.checkSite).toHaveBeenCalledWith('https://blog.acme.example', {
      username: 'editor',
      password: PASSWORD,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        brand_id: BRAND,
        provider: 'wordpress',
        site_url: 'https://blog.acme.example',
        status: 'connected',
        connected_by: 'u1',
      }),
    ]);
    expect(rows[0]).not.toHaveProperty('password');
    expect(credentials.save).toHaveBeenCalledWith(
      'cn1',
      { username: 'editor', password: PASSWORD },
      { setBy: 'u1' },
    );
  });

  it('replaces a refused sign-in, connected again, and revokes the password it replaces', async () => {
    rows = [connectedRow({ status: 'auth_failed' })];
    const old = { username: 'editor', password: 'zzzz yyyy xxxx wwww vvvv uuuu' };
    credentials.read.mockResolvedValueOnce(old);
    await call('POST', input);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('connected');
    expect(credentials.save.mock.calls[0][0]).toBe('cn1');
    expect(wordpress.revokePassword).toHaveBeenCalledWith('https://blog.acme.example', old);
  });

  it('revokes nothing when the same sign-in is typed again', async () => {
    rows = [connectedRow()];
    credentials.read.mockResolvedValueOnce({
      username: 'editor',
      password: PASSWORD.replace(/ /g, ''),
    });
    await call('POST', input);
    expect(wordpress.revokePassword).not.toHaveBeenCalled();
  });

  it('asks to connect again when the sign-in can’t be kept', async () => {
    credentials.save.mockRejectedValueOnce(new Error('brand_cms_credentials write: 42501'));
    const res = await call('POST', input);
    expect(res.status).toBe(500);
    expect(rows[0].status).toBe('auth_failed');
    expect(wordpress.revokePassword).not.toHaveBeenCalled();
  });

  it('keeps nothing when the site refuses, and says why in its words', async () => {
    wordpress.checkSite.mockRejectedValueOnce(
      new WordPressError('auth_failed', 'WordPress refused the user or the Application Password.'),
    );
    const res = await call('POST', input);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: 'WordPress refused the user or the Application Password.',
      code: 'auth_failed',
    });
    expect(rows).toEqual([]);
    expect(credentials.save).not.toHaveBeenCalled();
  });

  it('refuses an http address before calling the site', async () => {
    const res = await call('POST', { ...input, siteUrl: 'http://blog.acme.example' });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('invalid');
    expect(wordpress.checkSite).not.toHaveBeenCalled();
  });

  it('asks for the three fields', async () => {
    for (const body of [{}, { ...input, password: 'short' }, { ...input, username: '' }]) {
      const res = await call('POST', body);
      expect(res.status).toBe(400);
    }
    expect(wordpress.checkSite).not.toHaveBeenCalled();
  });

  it('is for admins and managers', async () => {
    role = 'analyst';
    const res = await call('POST', input);
    expect(res.status).toBe(403);
    expect(wordpress.checkSite).not.toHaveBeenCalled();
  });

  it('says WordPress isn’t set up on a server that can’t keep a sign-in', async () => {
    configured = false;
    const res = await call('POST', input);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('not_configured');
  });

  it('logs a crash by name only', async () => {
    wordpress.checkSite.mockRejectedValueOnce(new Error(`bad ${PASSWORD}`));
    const res = await call('POST', input);
    expect(res.status).toBe(500);
    expect(logged.join('')).not.toContain('abcd');
  });
});

describe('DELETE', () => {
  it('revokes the Application Password, then removes the connection', async () => {
    rows = [connectedRow()];
    const res = await call('DELETE');
    expect(await res.json()).toEqual({ success: true, revoked: true });
    expect(wordpress.revokePassword).toHaveBeenCalledWith('https://blog.acme.example', {
      username: 'editor',
      password: PASSWORD,
    });
    expect(rows).toEqual([]);
  });

  it('removes the connection when the password can’t be revoked, and says so', async () => {
    rows = [connectedRow()];
    wordpress.revokePassword.mockResolvedValueOnce(false);
    expect(await (await call('DELETE')).json()).toEqual({ success: true, revoked: false });
    expect(rows).toEqual([]);
    rows = [connectedRow()];
    credentials.read.mockResolvedValueOnce(null);
    expect(await (await call('DELETE')).json()).toEqual({ success: true, revoked: false });
    expect(rows).toEqual([]);
  });

  it('is for admins and managers', async () => {
    role = 'analyst';
    rows = [connectedRow()];
    expect((await call('DELETE')).status).toBe(403);
    expect(rows).toHaveLength(1);
  });
});
