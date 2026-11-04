import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * POST /api/brands/:id/detect-site-type (Step 0, 00379): the brand's kind of
 * site, from its home page, for admins and managers of its organization.
 */

let role;
const assertBrandAccess = vi.fn();
const applySiteTypeDetection = vi.fn();
const checkTrackingSnippet = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: { role }, error: null }) }) }),
    }),
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: (...a) => assertBrandAccess(...a) }));
vi.mock('../lib/brandDelete.js', () => ({ deleteBrand: vi.fn() }));
vi.mock('../lib/siteTypeDetect.js', () => ({
  applySiteTypeDetection: (...a) => applySiteTypeDetection(...a),
}));
vi.mock('../lib/trackingSnippetCheck.js', () => ({
  checkTrackingSnippet: (...a) => checkTrackingSnippet(...a),
}));

const { default: router } = await import('./brands.js');

let server;
let baseUrl;
beforeEach(async () => {
  role = 'admin';
  assertBrandAccess.mockReset().mockResolvedValue(undefined);
  applySiteTypeDetection.mockReset();
  checkTrackingSnippet.mockReset().mockResolvedValue({ status: 'not_found' });
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
    next();
  });
  app.use('/api/brands', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => new Promise((resolve) => server.close(resolve)));

const detect = (id = 'b1') =>
  fetch(`${baseUrl}/api/brands/${id}/detect-site-type`, { method: 'POST' });

describe('POST /api/brands/:id/detect-site-type', () => {
  it('detects and keeps the type for an admin or a manager', async () => {
    applySiteTypeDetection.mockResolvedValue({
      detected: {
        siteType: 'ecommerce',
        industry: 'E-commerce & Retail',
        via: 'page',
        reasons: [],
      },
      industry: 'E-commerce & Retail',
    });
    for (const r of ['admin', 'manager']) {
      role = r;
      const res = await detect();
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        siteType: 'ecommerce',
        industry: 'E-commerce & Retail',
        via: 'page',
      });
    }
    expect(assertBrandAccess).toHaveBeenCalledWith('b1', 'u1');
    expect(applySiteTypeDetection).toHaveBeenCalledWith('b1');
    // Setup's first read looks for the tracking snippet too (00433).
    expect(checkTrackingSnippet).toHaveBeenCalledWith('b1');
  });

  it('answers the same when the snippet check at setup fails', async () => {
    checkTrackingSnippet.mockRejectedValue(new Error('db down'));
    applySiteTypeDetection.mockResolvedValue({ skipped: 'manual' });
    const res = await detect();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ siteType: null, skipped: 'manual' });
  });

  it('refuses the roles that may not change a brand', async () => {
    for (const r of ['analyst', 'agency_partner', 'member']) {
      role = r;
      const res = await detect();
      expect(res.status, r).toBe(403);
    }
    expect(applySiteTypeDetection).not.toHaveBeenCalled();
  });

  it("answers 404 for another organization's brand, reading nothing", async () => {
    assertBrandAccess.mockRejectedValue(
      Object.assign(new Error('Brand not found'), { status: 404 }),
    );
    const res = await detect('other');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Brand not found' });
    expect(applySiteTypeDetection).not.toHaveBeenCalled();
  });

  it('says the type was left alone when the brand has one, or unknown when it could not be told', async () => {
    applySiteTypeDetection.mockResolvedValueOnce({ skipped: 'manual' });
    expect(await (await detect()).json()).toEqual({ siteType: null, skipped: 'manual' });
    applySiteTypeDetection.mockResolvedValueOnce({ detected: null });
    expect(await (await detect()).json()).toEqual({ siteType: null });
  });

  it('answers 500 without the error when the detection fails', async () => {
    applySiteTypeDetection.mockRejectedValue(new Error('db down'));
    const res = await detect();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Failed to detect the site type.' });
  });
});
