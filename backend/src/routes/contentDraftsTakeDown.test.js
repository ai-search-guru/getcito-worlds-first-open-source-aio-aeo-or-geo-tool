import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/content-drafts/:draftId/take-down (AUTONOMOUS-GO-LIVE PR 10,
 * Chat's unpublish_cms): admins and managers take a published page of their
 * brand down to a draft in its CMS, a manager even while publishing is off
 * for Managers; the reasons a page can't be taken down keep their codes.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let role;
let draft;
const assertBrandAccess = vi.fn();
const takeDownContentPage = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { role }, error: null }),
        maybeSingle: async () => ({
          data:
            table === 'content_drafts'
              ? draft
              : table === 'chat_settings'
                ? { manager_execute_off: ['publishing'] }
                : null,
          error: null,
        }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('../lib/cmsTakeDown.js', () => ({
  takeDownContentPage: (...args) => takeDownContentPage(...args),
}));

const { default: router } = await import('./contentDrafts.js');
const { DeliveryError } = await import('../lib/contentDelivery.js');

let server;
let baseUrl;

beforeEach(async () => {
  role = 'manager';
  draft = { id: DRAFT, brand_id: BRAND };
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  takeDownContentPage.mockReset().mockResolvedValue({
    delivery: { id: 'd1', status: 'taken_down', taken_down_at: '2026-11-02T12:00:00.000Z' },
    target: 'webflow',
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/content-drafts', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/content-drafts`;
});

afterEach(() => new Promise((resolve) => server.close(resolve)));

const takeDown = (id = DRAFT) => fetch(`${baseUrl}/${id}/take-down`, { method: 'POST' });

describe('POST /api/content-drafts/:draftId/take-down', () => {
  it('takes the page down as the person, a Manager even while publishing is off for Managers', async () => {
    const res = await takeDown();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      delivery: { id: 'd1', status: 'taken_down', taken_down_at: '2026-11-02T12:00:00.000Z' },
      target: 'webflow',
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(takeDownContentPage).toHaveBeenCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      userId: 'u1',
      draftId: DRAFT,
    });
  });

  it('keeps it to admins and managers, of a draft that is there', async () => {
    role = 'analyst';
    expect((await takeDown()).status).toBe(403);
    role = 'admin';
    draft = null;
    expect((await takeDown()).status).toBe(404);
    expect((await takeDown('not-an-id')).status).toBe(400);
    expect(takeDownContentPage).not.toHaveBeenCalled();
  });

  it('answers a page it can’t take down with its code', async () => {
    takeDownContentPage.mockRejectedValueOnce(
      new DeliveryError('not_live', 'This page isn’t live through GetCito.', 409),
    );
    const notLive = await takeDown();
    expect(notLive.status).toBe(409);
    expect(await notLive.json()).toEqual({
      error: 'This page isn’t live through GetCito.',
      code: 'not_live',
    });
    takeDownContentPage.mockRejectedValueOnce(new Error('boom'));
    const failed = await takeDown();
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: 'failed' });
  });
});
