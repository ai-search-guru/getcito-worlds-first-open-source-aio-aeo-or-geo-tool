import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * The organization's demo brand (00380): POST opens it (created or rebuilt
 * when it has to be), PATCH hides or shows it for admins and managers.
 */

let profile;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: profile, error: null }),
      };
      return chain;
    },
  },
}));
const ensureDemoBrand = vi.fn();
const setDemoHidden = vi.fn();
vi.mock('../lib/demo/index.js', () => ({
  ensureDemoBrand: (...a) => ensureDemoBrand(...a),
  setDemoHidden: (...a) => setDemoHidden(...a),
}));

const { default: router } = await import('./demo.js');

let server;
let baseUrl;

beforeEach(async () => {
  profile = { organization_id: 'org-1', role: 'admin' };
  ensureDemoBrand.mockReset().mockResolvedValue({ brandId: 'demo-1', version: 1, rebuilt: true });
  setDemoHidden
    .mockReset()
    .mockImplementation(async ({ hidden }) => ({ brandId: 'demo-1', hidden }));
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/demo', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/demo`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const post = () => fetch(baseUrl, { method: 'POST' });
const patch = (body) =>
  fetch(baseUrl, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('POST /api/demo', () => {
  it("opens the organization's demo brand for any member", async () => {
    profile = { organization_id: 'org-1', role: 'analyst' };
    const res = await post();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brandId: 'demo-1', version: 1, rebuilt: true });
    expect(ensureDemoBrand).toHaveBeenCalledWith({ organizationId: 'org-1' });
    expect(setDemoHidden).not.toHaveBeenCalled();
  });

  it('needs a workspace', async () => {
    profile = { organization_id: null, role: 'admin' };
    const res = await post();
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'no_organization' });
    expect(ensureDemoBrand).not.toHaveBeenCalled();
  });

  it('answers 500 when the demo could not be built', async () => {
    ensureDemoBrand.mockRejectedValue(new Error('insert failed'));
    const res = await post();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'The demo brand could not be opened.',
      code: 'failed',
    });
  });
});

describe('PATCH /api/demo', () => {
  it('hides and shows the demo brand for admins and managers', async () => {
    let res = await patch({ hidden: true });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brandId: 'demo-1', hidden: true });
    expect(setDemoHidden).toHaveBeenLastCalledWith({ organizationId: 'org-1', hidden: true });

    profile = { organization_id: 'org-1', role: 'manager' };
    res = await patch({ hidden: false });
    expect(await res.json()).toEqual({ brandId: 'demo-1', hidden: false });
  });

  it('refuses other roles', async () => {
    profile = { organization_id: 'org-1', role: 'analyst' };
    const res = await patch({ hidden: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'forbidden' });
    expect(setDemoHidden).not.toHaveBeenCalled();
  });

  it('answers 404 without a demo brand', async () => {
    setDemoHidden.mockResolvedValue(null);
    const res = await patch({ hidden: true });
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'no_demo' });
  });

  it('takes only { hidden: boolean }', async () => {
    for (const body of [{}, { hidden: 'yes' }, { hidden: null }]) {
      const res = await patch(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(setDemoHidden).not.toHaveBeenCalled();
  });
});
