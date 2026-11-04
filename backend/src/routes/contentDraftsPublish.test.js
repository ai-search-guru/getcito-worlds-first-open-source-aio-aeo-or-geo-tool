import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/content-drafts/:draftId/publish (CE-013): a member marks a page
 * Published at its live address.
 */

const DRAFT = '77777777-7777-7777-7777-777777777777';

let draftRow;
const assertBrandAccess = vi.fn();
const publishDraft = vi.fn();
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: draftRow, error: null }),
        single: async () => ({ data: { role: 'member' }, error: null }),
        then: (resolve) =>
          resolve(
            table === 'brand_domains'
              ? { data: [{ domain: 'acme.example' }], error: null }
              : { data: null, error: null },
          ),
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...args) => assertBrandAccess(...args) }));
vi.mock('../lib/contentPublished.js', async (importOriginal) => ({
  ...(await importOriginal()),
  publishDraft: (...args) => publishDraft(...args),
}));

const { default: router } = await import('./contentDrafts.js');

let server;
let baseUrl;

beforeEach(async () => {
  draftRow = { id: DRAFT, brand_id: 'b1', action_id: 'a1', archived_at: null };
  assertBrandAccess.mockReset().mockResolvedValue({ orgId: 'o1' });
  publishDraft.mockReset().mockImplementation(async (_draft, url) => ({
    publishedUrl: url,
    publishedAt: '2026-10-25T10:00:00Z',
    taskCompleted: true,
    onBrandDomain: url.includes('acme.example'),
  }));
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

const publish = (body, id = DRAFT) =>
  fetch(`${baseUrl}/${id}/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/content-drafts/:draftId/publish', () => {
  it('publishes the page at its address for a member of the brand’s workspace', async () => {
    const res = await publish({ url: ' https://www.acme.example/blog/cold-brew ' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      publishedUrl: 'https://www.acme.example/blog/cold-brew',
      publishedAt: '2026-10-25T10:00:00Z',
      taskCompleted: true,
      onBrandDomain: true,
    });
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');
    expect(publishDraft).toHaveBeenCalledWith(
      draftRow,
      'https://www.acme.example/blog/cold-brew',
      'u1',
    );
  });

  it('answers a failure to publish in plain words', async () => {
    publishDraft.mockRejectedValueOnce(new Error('db down'));
    const res = await publish({ url: 'https://medium.com/@acme/cold-brew' });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ code: 'failed' });
  });

  it('refuses an address that isn’t one, a page archived or gone, and another workspace’s', async () => {
    const bad = await publish({ url: 'javascript:alert(1)' });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: 'invalid_url' });
    expect((await publish({ url: 'https://user:pw@acme.example/x' })).status).toBe(400);
    expect((await publish({ url: 'https://acme.example/x' }, 'not-a-draft')).status).toBe(400);

    draftRow = { ...draftRow, archived_at: '2026-10-24T10:00:00Z' };
    expect((await publish({ url: 'https://acme.example/x' })).status).toBe(404);
    draftRow = null;
    expect((await publish({ url: 'https://acme.example/x' })).status).toBe(404);

    draftRow = { id: DRAFT, brand_id: 'b2', action_id: null, archived_at: null };
    assertBrandAccess.mockRejectedValueOnce(
      Object.assign(new Error('nope'), { status: 403, code: 'not_in_workspace' }),
    );
    const other = await publish({ url: 'https://acme.example/x' });
    expect(other.status).toBe(403);
    expect(await other.json()).toMatchObject({ code: 'not_in_workspace' });
    expect(publishDraft).not.toHaveBeenCalled();
  });
});
