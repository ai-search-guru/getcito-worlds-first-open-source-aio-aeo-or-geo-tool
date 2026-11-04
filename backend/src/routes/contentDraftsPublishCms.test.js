import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/content-drafts/publish-cms (AUTONOMOUS-GO-LIVE PR 9, Chat's
 * publish_cms): admins and managers put a new page of their brand live in
 * its CMS, a manager only while publishing is on for Managers; the reasons
 * a page can't go live keep their codes.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let role;
let managerOff;
const assertBrandAccess = vi.fn();
const publishContentPage = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { role }, error: null }),
        maybeSingle: async () => ({
          data: table === 'chat_settings' ? { manager_execute_off: managerOff } : null,
          error: null,
        }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('../lib/cmsPublish.js', () => ({
  publishContentPage: (...args) => publishContentPage(...args),
}));

const { default: router } = await import('./contentDrafts.js');
const { DeliveryError } = await import('../lib/contentDelivery.js');

let server;
let baseUrl;

beforeEach(async () => {
  role = 'manager';
  managerOff = [];
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  publishContentPage.mockReset().mockResolvedValue({
    delivery: { id: 'd1', status: 'published', published_url: 'https://acme.example/blog/x' },
    published: true,
    url: 'https://acme.example/blog/x',
  });
  const app = express();
  app.use(express.json({ limit: '5mb' }));
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

const page = { draftId: DRAFT, title: 'Best AEO tools', slug: 'best-aeo-tools', html: '<p>Hi</p>' };
const publish = (body) =>
  fetch(`${baseUrl}/publish-cms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-drafts/publish-cms', () => {
  it('puts the page live as the person, and answers its send and address', async () => {
    const res = await publish({ brandId: BRAND, target: 'webflow', page });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      delivery: { id: 'd1', status: 'published', published_url: 'https://acme.example/blog/x' },
      url: 'https://acme.example/blog/x',
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(publishContentPage).toHaveBeenCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      userId: 'u1',
      target: 'webflow',
      page: expect.objectContaining({ draftId: DRAFT, slug: 'best-aeo-tools' }),
    });
  });

  it('keeps it to admins and managers, and to managers while publishing is on for them', async () => {
    role = 'analyst';
    const analyst = await publish({ brandId: BRAND, target: 'wix', page });
    expect(analyst.status).toBe(403);
    role = 'manager';
    managerOff = ['publishing'];
    const off = await publish({ brandId: BRAND, target: 'wix', page });
    expect(off.status).toBe(403);
    expect(await off.json()).toMatchObject({ code: 'execute_off' });
    role = 'admin';
    expect((await publish({ brandId: BRAND, target: 'wix', page })).status).toBe(200);
    expect(publishContentPage).toHaveBeenCalledTimes(1);
  });

  it('refuses a body it can’t read, and answers a page it can’t put live with its code', async () => {
    expect((await publish({ brandId: BRAND, target: 'webhook', page })).status).toBe(400);
    expect((await publish({ brandId: 'x', target: 'webflow', page })).status).toBe(400);
    publishContentPage.mockRejectedValueOnce(
      new DeliveryError('framer_site_publish', 'Framer publishes the whole site at once.', 409),
    );
    const framer = await publish({ brandId: BRAND, target: 'framer', page });
    expect(framer.status).toBe(409);
    expect(await framer.json()).toEqual({
      error: 'Framer publishes the whole site at once.',
      code: 'framer_site_publish',
    });
    publishContentPage.mockRejectedValueOnce(new Error('boom'));
    const failed = await publish({ brandId: BRAND, target: 'webflow', page });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: 'failed' });
  });
});
