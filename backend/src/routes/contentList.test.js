import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Route-level tests for the Content Opportunities list's order.
 *
 * One generation writes many opportunities at the same moment, often with
 * the same score, so the chosen order alone leaves ties the database may
 * break differently on each page. What's checked here is that every order
 * ends on the row's id, so paging never repeats or skips a row.
 */

let orders;
let server;
let baseUrl;

async function startApp() {
  vi.resetModules();
  vi.doMock('../lib/planGuard.js', () => ({
    PlanLimitError: class PlanLimitError extends Error {},
    requireFeature: () => (req, res, next) => next(),
    enforceBriefQuota: vi.fn(),
    getBriefQuotaStatus: vi.fn(),
    getContentUsage: vi.fn(),
    getOpportunityRequestAllowance: vi.fn(),
    getOrgIdForUser: vi.fn(),
  }));
  vi.doMock('../lib/access.js', () => ({
    assertBrandAccess: vi.fn(),
    assertOpportunitiesAccess: vi.fn(),
    assertOpportunityAccess: vi.fn(),
    assertPromptAccess: vi.fn(),
  }));
  vi.doMock('../lib/jobManager.js', () => ({ createJob: vi.fn(), getJob: vi.fn() }));
  vi.doMock('../lib/jobRunner.js', () => ({ runContentJob: vi.fn() }));
  // Every query resolves to an empty page; only the order() calls are kept.
  vi.doMock('../config/supabase.js', () => {
    const chain = new Proxy(
      {},
      {
        get: (_t, op) => {
          if (op === 'then') return (resolve) => resolve({ data: [], error: null, count: 0 });
          if (op === 'order') {
            return (column, options) => {
              orders.push([column, options?.ascending]);
              return chain;
            };
          }
          return () => chain;
        },
      },
    );
    return { default: { from: () => chain, rpc: async () => ({ data: [], error: null }) } };
  });
  vi.doMock('../lib/promptClusters.js', () => ({ loadClusters: vi.fn() }));
  vi.doMock('../lib/action-center/fromOpportunity.js', () => ({ sendToActionCenter: vi.fn() }));
  vi.doMock('../lib/aiProvider.js', () => ({ resolveModel: vi.fn() }));
  vi.doMock('../lib/logger.js', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() };
    return { default: logger, logger };
  });

  const { default: router } = await import('./content.js');
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn() };
    next();
  });
  app.use('/api/content', router);

  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content`;
}

const list = (query = '') => fetch(`${baseUrl}/brand/b1${query}`);

beforeEach(async () => {
  orders = [];
  await startApp();
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('GET /brand/:brandId order', () => {
  it('lists the newest first, ties in id order', async () => {
    const res = await list('?sort=newest');

    expect(res.status).toBe(200);
    expect(orders).toEqual([
      ['created_at', false],
      ['id', true],
    ]);
  });

  it('lists the oldest first, ties in id order', async () => {
    await list('?sort=oldest');

    expect(orders).toEqual([
      ['created_at', true],
      ['id', true],
    ]);
  });

  it('keeps the highest score first when no order is asked for, ties in id order', async () => {
    await list();

    expect(orders).toEqual([
      ['opportunity_score', false],
      ['id', true],
    ]);
  });
});
