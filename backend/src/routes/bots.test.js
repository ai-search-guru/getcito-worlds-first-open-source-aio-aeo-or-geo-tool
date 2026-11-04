import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The AI bot report's connections (AT-010): made and revoked by admins and
 * managers on plans with the report; the secret is returned once, with the
 * endpoint and, for a Cloudflare Worker, its script.
 */

let role;
let cap;
// What getBotCaps answers a read once the plan has ended (readOnly).
let noPlan;
const capReads = [];
const inserted = [];
const updates = [];

function table(name) {
  const state = { name, filters: {} };
  const result = () => {
    if (name === 'brands') return { data: { id: 'b1', organization_id: 'o1' }, error: null };
    if (name === 'profiles') return { data: { organization_id: 'o1', role }, error: null };
    if (name === 'ai_bot_connections') {
      if (state.update)
        return { data: state.filters.id === 'gone' ? [] : [{ id: 'c1' }], error: null };
      if (state.insert)
        return {
          data: { id: 'c1', kind: state.insert.kind, created_at: 'now', last_event_at: null },
          error: null,
        };
      return {
        data: [{ id: 'c1', kind: 'cloudflare_worker', created_at: 'then', last_event_at: null }],
        error: null,
      };
    }
    if (name === 'ai_bot_usage')
      return {
        data: {
          stored_events: 12,
          counted_events: 15,
          capped_at: null,
          raw_records: 20_000_400,
          raw_capped_at: '2026-10-18T09:00:00Z',
        },
        error: null,
      };
    return { data: null, error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then')
          return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        if (prop === 'single' || prop === 'maybeSingle') return async () => result();
        if (prop === 'insert')
          return (row) => {
            state.insert = row;
            inserted.push(row);
            return chain;
          };
        if (prop === 'update')
          return (row) => {
            state.update = row;
            updates.push(row);
            return chain;
          };
        if (prop === 'eq')
          return (col, val) => {
            state.filters[col] = val;
            return chain;
          };
        return () => chain;
      },
    },
  );
  return chain;
}

vi.mock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../lib/planGuard.js', async () => {
  class PlanLimitError extends Error {
    constructor(message, statusCode = 403) {
      super(message);
      this.statusCode = statusCode;
    }
  }
  return {
    PlanLimitError,
    getOrgIdForUser: async () => 'o1',
    getBotEventCap: async () => cap,
    getBotCaps: async (orgId, options) => {
      capReads.push([orgId, options]);
      return noPlan ? { cap: 0, rawCap: 0, noPlan: true } : { cap, rawCap: 20_000_000 };
    },
  };
});

const { default: router } = await import('./bots.js');

let server;
let baseUrl;

beforeEach(async () => {
  vi.stubEnv('PUBLIC_SERVER_URL', 'https://api.example.com');
  role = 'admin';
  cap = 2_000_000;
  noPlan = false;
  capReads.length = 0;
  inserted.length = 0;
  updates.length = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/bots', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/bots`;
});

afterEach(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => server.close(resolve));
});

const create = (body) =>
  fetch(`${baseUrl}/connections/b1`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('AI bot connections', () => {
  it('makes a connection and returns its secret once, with the Worker for Cloudflare', async () => {
    const res = await create({ kind: 'cloudflare_worker' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toMatch(/^getcito_bot_/);
    // The API's public address, not the Host the web server reached it on.
    expect(body.endpoint).toBe('https://api.example.com/bots/ingest');
    // The Worker reads the secret from a Worker Secret, so its code doesn't hold it.
    expect(body.workerScript).not.toContain(body.secret);
    expect(body.workerScript).toContain(body.endpoint);
    expect(body.workerSecretName).toBe('GETCITO_BOT_SECRET');
    expect(inserted[0]).toMatchObject({
      brand_id: 'b1',
      kind: 'cloudflare_worker',
      created_by: 'u1',
    });
    expect(inserted[0].secret_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(inserted[0])).not.toContain(body.secret);

    const drain = await (await create({ kind: 'vercel_drain' })).json();
    expect(drain.workerScript).toBeNull();
    expect(drain.workerSecretName).toBeNull();
    expect(drain.vercelDrain.headers).toEqual([`Authorization: Bearer ${drain.secret}`]);

    const logpush = await (await create({ kind: 'cloudflare_logpush' })).json();
    expect(logpush.logpushJob.destination_conf).toContain(encodeURIComponent(logpush.secret));
    expect(logpush.vercelDrain).toBeNull();
  });

  it('makes no connection while the server has no public https address', async () => {
    vi.stubEnv('PUBLIC_SERVER_URL', 'http://api.example.com');
    const res = await create({ kind: 'cloudflare_worker' });
    expect(res.status).toBe(503);
    expect(inserted).toHaveLength(0);
  });

  it('refuses Starter, members and unknown kinds', async () => {
    cap = 0;
    const starter = await create({ kind: 'cloudflare_worker' });
    expect(starter.status).toBe(403);
    expect((await starter.json()).error).toBe('plan_limit');

    cap = 2_000_000;
    role = 'member';
    expect((await create({ kind: 'cloudflare_worker' })).status).toBe(403);
    role = 'admin';
    expect((await create({ kind: 'ftp' })).status).toBe(400);
    expect(inserted).toHaveLength(0);
  });

  it("lists the brand's connections with this month's use", async () => {
    const res = await fetch(`${baseUrl}/connections/b1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toEqual([
      { id: 'c1', kind: 'cloudflare_worker', created_at: 'then', last_event_at: null },
    ]);
    expect(body.usage).toMatchObject({ stored: 12, counted: 15, cappedAt: null, cap: 2_000_000 });
    // Log records against the raw cap, which stops a log sender's report mid-month.
    expect(body.usage).toMatchObject({
      raw: 20_000_400,
      rawCappedAt: '2026-10-18T09:00:00Z',
      rawCap: 20_000_000,
    });
    expect(body.usage.month).toMatch(/^\d{4}-\d{2}-01$/);
    expect(body.usage).not.toHaveProperty('noPlan');
    // A read: a plan that ended doesn't refuse it.
    expect(capReads).toEqual([['o1', { readOnly: true }]]);
  });

  it('still lists the connections and their use once the plan has ended', async () => {
    noPlan = true;
    const res = await fetch(`${baseUrl}/connections/b1`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.connections).toHaveLength(1);
    expect(body.usage).toMatchObject({ stored: 12, counted: 15, raw: 20_000_400 });
    expect(body.usage).toMatchObject({ cap: 0, rawCap: 0, noPlan: true });
  });

  it('revokes a connection, and says when there is none', async () => {
    const ok = await fetch(`${baseUrl}/connections/b1/c1`, { method: 'DELETE' });
    expect(ok.status).toBe(204);
    expect(updates[0].revoked_at).toBeTruthy();
    expect((await fetch(`${baseUrl}/connections/b1/gone`, { method: 'DELETE' })).status).toBe(404);
  });
});
