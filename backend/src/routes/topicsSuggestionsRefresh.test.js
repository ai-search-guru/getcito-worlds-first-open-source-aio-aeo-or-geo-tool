import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/topics/suggestions/:brandId/refresh puts the new batch in before
 * it removes the undecided one, so a failed insert leaves the list as it was
 * rather than empty. The model is a stub.
 */

const generateObject = vi.fn();
let db;

function table(name) {
  let op = 'select';
  let row = null;
  const filters = [];
  const result = () => {
    if (op === 'insert') {
      db.inserts.push(row);
      if (db.insertError) return { data: null, error: db.insertError };
      return { data: row.map((r, i) => ({ id: `new-${i}`, ...r })), error: null };
    }
    if (op === 'delete') {
      db.deletes.push(filters);
      return { data: null, error: null };
    }
    if (name === 'brands') return { data: { name: 'Acme', language: 'en' }, error: null };
    return { data: null, error: null };
  };
  const chain = new Proxy(
    {},
    {
      get: (_t, prop) => {
        if (prop === 'then') {
          return (resolve, reject) => Promise.resolve(result()).then(resolve, reject);
        }
        if (prop === 'single' || prop === 'maybeSingle') return async () => result();
        if (prop === 'insert') {
          return (r) => {
            op = 'insert';
            row = r;
            return chain;
          };
        }
        if (prop === 'delete') {
          return () => {
            op = 'delete';
            return chain;
          };
        }
        if (prop === 'eq' || prop === 'not') {
          return (...args) => {
            filters.push([prop, ...args]);
            return chain;
          };
        }
        return () => chain;
      },
    },
  );
  return chain;
}

let server;
let baseUrl;

beforeEach(async () => {
  vi.clearAllMocks();
  vi.resetModules();
  db = { inserts: [], deletes: [], insertError: null };
  generateObject.mockResolvedValue({
    object: { topics: [{ name: 'Coffee subscriptions' }, { name: 'Office coffee' }] },
  });
  vi.doMock('ai', () => ({ generateObject }));
  vi.doMock('../lib/access.js', () => ({
    MANAGER_ROLES: ['admin', 'manager'],
    assertBrandAccess: vi.fn(),
    assertRole: vi.fn(async () => 'manager'),
  }));
  vi.doMock('../lib/action-center/fromTopicOpportunity.js', () => ({
    sendTopicOpportunityToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/action-center/fromTopicGap.js', () => ({
    sendTopicGapToActionCenter: vi.fn(),
  }));
  vi.doMock('../lib/planGuard.js', () => ({ requireFeature: () => (req, res, next) => next() }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/webResearch.js', () => ({
    webResearch: vi.fn(async () => ({ text: 'research', searched: true, sources: [] })),
  }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });
  vi.doMock('../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));

  const { default: router } = await import('./topics.js');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/topics', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/topics`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const refresh = () => fetch(`${baseUrl}/suggestions/b1/refresh`, { method: 'POST' });

describe('POST /api/topics/suggestions/:brandId/refresh', () => {
  it('adds the new batch, then removes the undecided rows it didn’t just add', async () => {
    const res = await refresh();

    expect(res.status).toBe(200);
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].map((r) => r.name)).toEqual(['Coffee subscriptions', 'Office coffee']);
    expect(db.deletes).toEqual([
      [
        ['eq', 'brand_id', 'b1'],
        ['eq', 'status', 'new'],
        ['not', 'id', 'in', '(new-0,new-1)'],
      ],
    ]);
    const { suggestions } = await res.json();
    expect(suggestions.map((s) => s.id)).toEqual(['new-0', 'new-1']);
  });

  it('leaves the undecided batch in place when the insert fails', async () => {
    db.insertError = { code: '57014', message: 'canceling statement due to statement timeout' };

    expect((await refresh()).status).toBe(500);
    expect(db.deletes).toEqual([]);
  });
});
