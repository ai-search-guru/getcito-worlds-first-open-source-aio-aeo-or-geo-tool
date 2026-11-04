import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

/**
 * Deleting a brand (admins only), never the demo brand (00380): it is
 * hidden, not deleted.
 */

let brand;
let role;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () =>
          table === 'profiles'
            ? { data: { role }, error: null }
            : { data: { is_demo: brand.is_demo }, error: null },
      };
      return chain;
    },
  },
}));
vi.mock('../lib/access.js', () => ({ assertBrandAccess: vi.fn(async () => ({ orgId: 'o1' })) }));
const deleteBrand = vi.fn(async () => {});
vi.mock('../lib/brandDelete.js', () => ({ deleteBrand: (...a) => deleteBrand(...a) }));
vi.mock('../lib/trackingSnippetCheck.js', () => ({ checkTrackingSnippet: vi.fn() }));

const { default: router } = await import('./brands.js');

let server;
let baseUrl;

beforeEach(async () => {
  brand = { is_demo: false };
  role = 'admin';
  deleteBrand.mockClear();
  const app = express();
  app.use((req, _res, next) => {
    req.user = { id: 'u1' };
    req.log = { error: vi.fn() };
    next();
  });
  app.use('/api/brands', router);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/brands`;
});

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

describe('DELETE /api/brands/:id', () => {
  it('deletes a brand for an admin', async () => {
    const res = await fetch(`${baseUrl}/b1`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ deleted: true });
    expect(deleteBrand).toHaveBeenCalledWith('b1');
  });

  it('refuses the demo brand, which is hidden instead', async () => {
    brand = { is_demo: true };
    const res = await fetch(`${baseUrl}/b1`, { method: 'DELETE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'demo_brand' });
    expect(deleteBrand).not.toHaveBeenCalled();
  });
});
