import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/content-drafts/send (Send to CMS, #1331): admins and managers
 * send pages of their brand; the reasons a send can't go keep their codes.
 */

const BRAND = '33333333-3333-3333-3333-333333333333';
const DRAFT = '77777777-7777-7777-7777-777777777777';

let role;
const assertBrandAccess = vi.fn();
const sendContentPages = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { role }, error: null }),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
const checkWebflowPublished = vi.fn();
vi.mock('../lib/cms/webflowStatus.js', () => ({
  checkWebflowPublished: (...args) => checkWebflowPublished(...args),
}));
const checkWordPressPublished = vi.fn();
vi.mock('../lib/cms/wordpressStatus.js', () => ({
  checkWordPressPublished: (...args) => checkWordPressPublished(...args),
}));
const checkFramerPublished = vi.fn();
vi.mock('../lib/cms/framerStatus.js', () => ({
  checkFramerPublished: (...args) => checkFramerPublished(...args),
}));
const checkWixPublished = vi.fn();
vi.mock('../lib/cms/wixStatus.js', () => ({
  checkWixPublished: (...args) => checkWixPublished(...args),
}));
vi.mock('../lib/contentDelivery.js', async (importOriginal) => ({
  ...(await importOriginal()),
  sendContentPages: (...args) => sendContentPages(...args),
}));

const { default: router } = await import('./contentDrafts.js');
const { DeliveryError } = await import('../lib/contentDelivery.js');

let server;
let baseUrl;

beforeEach(async () => {
  role = 'manager';
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  sendContentPages
    .mockReset()
    .mockResolvedValue({ batchId: null, skipped: 0, deliveries: [{ id: 'd1', status: 'sent' }] });
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

const page = {
  draftId: DRAFT,
  title: 'Best AEO tools',
  slug: 'best-aeo-tools',
  html: '<p>Hi</p>',
};
const send = (body) =>
  fetch(`${baseUrl}/send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-drafts/send', () => {
  it('sends the brand’s pages for a manager, with the defaults filled in', async () => {
    const res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      batchId: null,
      skipped: 0,
      deliveries: [{ id: 'd1', status: 'sent' }],
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(BRAND, 'u1');
    expect(sendContentPages).toHaveBeenCalledWith({
      orgId: 'o1',
      brandId: BRAND,
      userId: 'u1',
      pages: [
        {
          ...page,
          metaTitle: '',
          metaDescription: '',
          author: null,
          reviewer: null,
          featuredImage: null,
        },
      ],
      target: 'webhook',
    });
  });

  it('leaves it to admins and managers', async () => {
    role = 'analyst';
    const res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
    expect(sendContentPages).not.toHaveBeenCalled();
  });

  it.each([
    [{ brandId: BRAND, pages: [] }],
    [{ brandId: BRAND, pages: Array.from({ length: 26 }, () => page) }],
    [{ brandId: BRAND, pages: [{ ...page, slug: 'a/b' }] }],
    [
      {
        brandId: BRAND,
        pages: [{ ...page, featuredImage: { src: 'http://x.example/a.png', alt: '' } }],
      },
    ],
    [{ brandId: 'nope', pages: [page] }],
  ])('turns away a send it can’t take', async (body) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expect(sendContentPages).not.toHaveBeenCalled();
  });

  it('answers why a send can’t go, with its code', async () => {
    sendContentPages.mockRejectedValue(
      new DeliveryError('webhook_not_subscribed', 'Not subscribed', 409),
    );
    let res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Not subscribed', code: 'webhook_not_subscribed' });

    sendContentPages.mockRejectedValue(new DeliveryError('daily_limit', 'Try later', 429));
    res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(429);

    sendContentPages.mockRejectedValue(new Error('db down'));
    res = await send({ brandId: BRAND, pages: [page] });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'failed' });
  });
});

describe('POST /api/content-drafts/webflow-status', () => {
  const check = (body) =>
    fetch(`${baseUrl}/webflow-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('reads the brand’s Webflow pages for any member, a brand at most every two minutes', async () => {
    role = 'member';
    const brand = '44444444-4444-4444-4444-444444444444';
    checkWebflowPublished.mockReset().mockResolvedValue({
      checked: 1,
      published: [{ draftId: DRAFT, url: 'https://a.example/b/c' }],
    });
    const first = await check({ brandId: brand });
    expect(await first.json()).toEqual({
      checked: 1,
      published: [{ draftId: DRAFT, url: 'https://a.example/b/c' }],
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(brand, 'u1');
    expect(await (await check({ brandId: brand })).json()).toEqual({
      checked: 0,
      published: [],
      recent: true,
    });
    expect(checkWebflowPublished).toHaveBeenCalledTimes(1);
  });

  it('refuses another workspace’s brand and a malformed one, and names a failure', async () => {
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { status: 403, code: 'not_in_workspace' }),
    );
    const other = await check({ brandId: '55555555-5555-5555-5555-555555555555' });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: 'not_in_workspace' });
    expect((await check({ brandId: 'x' })).status).toBe(400);
    checkWebflowPublished.mockReset().mockRejectedValue(new Error('down'));
    const failed = await check({ brandId: '66666666-6666-6666-6666-666666666666' });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toMatchObject({ code: 'failed' });
  });
});

describe('POST /api/content-drafts/wordpress-status (00294)', () => {
  const check = (body) =>
    fetch(`${baseUrl}/wordpress-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('reads the brand’s WordPress posts for any member, a brand at most every two minutes', async () => {
    role = 'member';
    const brand = '77777777-7777-7777-7777-777777777777';
    checkWordPressPublished.mockReset().mockResolvedValue({
      checked: 1,
      published: [{ draftId: DRAFT, url: 'https://blog.acme.example/cold-brew/' }],
    });
    expect(await (await check({ brandId: brand })).json()).toEqual({
      checked: 1,
      published: [{ draftId: DRAFT, url: 'https://blog.acme.example/cold-brew/' }],
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(brand, 'u1');
    expect(await (await check({ brandId: brand })).json()).toEqual({
      checked: 0,
      published: [],
      recent: true,
    });
    expect(checkWordPressPublished).toHaveBeenCalledTimes(1);
  });

  it('refuses another workspace’s brand and a malformed one, and names a failure', async () => {
    checkWordPressPublished.mockReset();
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { status: 403, code: 'not_in_workspace' }),
    );
    const other = await check({ brandId: '99999999-9999-9999-9999-999999999999' });
    expect(other.status).toBe(403);
    expect(checkWordPressPublished).not.toHaveBeenCalled();
    expect((await check({ brandId: 'x' })).status).toBe(400);
    checkWordPressPublished.mockReset().mockRejectedValue(new Error('down'));
    const failed = await check({ brandId: '88888888-8888-8888-8888-888888888888' });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'WordPress could not be read', code: 'failed' });
  });
});

describe('POST /api/content-drafts/framer-status (00295)', () => {
  const check = (body) =>
    fetch(`${baseUrl}/framer-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('reads the brand’s Framer items for any member, a brand at most every two minutes', async () => {
    role = 'member';
    const brand = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    checkFramerPublished.mockReset().mockResolvedValue({
      checked: 1,
      published: [{ draftId: DRAFT, url: 'https://www.acme.example/blog/cold-brew' }],
    });
    expect(await (await check({ brandId: brand })).json()).toEqual({
      checked: 1,
      published: [{ draftId: DRAFT, url: 'https://www.acme.example/blog/cold-brew' }],
    });
    expect(assertBrandAccess).toHaveBeenCalledWith(brand, 'u1');
    expect(checkFramerPublished).toHaveBeenCalledWith(brand);
    expect(await (await check({ brandId: brand })).json()).toEqual({
      checked: 0,
      published: [],
      recent: true,
    });
    expect(checkFramerPublished).toHaveBeenCalledTimes(1);
  });

  it('refuses another workspace’s brand and a malformed one, and names a failure', async () => {
    checkFramerPublished.mockReset();
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { status: 403, code: 'not_in_workspace' }),
    );
    const other = await check({ brandId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: 'not_in_workspace' });
    expect(checkFramerPublished).not.toHaveBeenCalled();
    expect((await check({ brandId: 'x' })).status).toBe(400);
    expect((await check({})).status).toBe(400);
    checkFramerPublished.mockReset().mockRejectedValue(new Error('down'));
    const failed = await check({ brandId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'Framer could not be read', code: 'failed' });
  });
});

describe('POST /api/content-drafts/wix-status (00372)', () => {
  const check = (body) =>
    fetch(`${baseUrl}/wix-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  it('reads the brand’s Wix posts for any member, a brand at most every two minutes', async () => {
    role = 'member';
    const brand = '66666666-6666-6666-6666-666666666666';
    checkWixPublished.mockReset().mockResolvedValue({
      checked: 1,
      published: [{ draftId: DRAFT, url: 'https://acme.example/post/cold-brew' }],
    });
    expect(await (await check({ brandId: brand })).json()).toEqual({
      checked: 1,
      published: [{ draftId: DRAFT, url: 'https://acme.example/post/cold-brew' }],
    });
    expect(await (await check({ brandId: brand })).json()).toEqual({
      checked: 0,
      published: [],
      recent: true,
    });
    expect(checkWixPublished).toHaveBeenCalledTimes(1);
  });

  it('names a failure in our words', async () => {
    checkWixPublished.mockReset().mockRejectedValue(new Error('down'));
    const failed = await check({ brandId: '55555555-5555-5555-5555-555555555555' });
    expect(failed.status).toBe(502);
    expect(await failed.json()).toEqual({ error: 'Wix could not be read', code: 'failed' });
  });
});
