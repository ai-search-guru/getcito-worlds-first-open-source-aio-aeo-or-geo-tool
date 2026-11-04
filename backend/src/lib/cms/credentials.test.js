import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { readCmsCredentials, saveCmsCredentials } = await import('./credentials.js');
const { sealCredentials } = await import('../catalog/credentials.js');

/**
 * A CMS connection's sign-in (00294): sealed by the API as a store's is,
 * bound to its own connection.
 */

const rows = new Map();
const db = {
  from: (table) => ({
    upsert: async (row) => {
      rows.set(row.connection_id, { table, ...row });
      return { error: null };
    },
    select: () => ({
      eq: (_column, id) => ({
        maybeSingle: async () => ({ data: rows.get(id) ?? null, error: null }),
      }),
    }),
  }),
};
const signIn = { username: 'editor', password: 'abcd efgh ijkl mnop qrst uvwx' };

beforeEach(() => {
  rows.clear();
  vi.stubEnv('CONNECTOR_CREDENTIALS_KEY', Buffer.alloc(32, 7).toString('base64'));
});
afterEach(() => vi.unstubAllEnvs());

describe('CMS credentials', () => {
  it('keeps the sign-in sealed, and reads it back', async () => {
    await saveCmsCredentials('cn1', signIn, { setBy: 'u1', db });
    const kept = rows.get('cn1');
    expect(kept).toMatchObject({ table: 'brand_cms_credentials', set_by: 'u1' });
    expect(kept.secret).not.toContain('abcd');
    expect(kept.secret).not.toContain('editor');
    expect(await readCmsCredentials('cn1', { db })).toEqual(signIn);
  });

  it('opens on its own connection only, never as another’s nor as a store’s', async () => {
    await saveCmsCredentials('cn1', signIn, { db });
    rows.set('cn2', { ...rows.get('cn1'), connection_id: 'cn2' });
    expect(await readCmsCredentials('cn2', { db })).toBeNull();
    // A store source's envelope, for the same id, isn't a CMS sign-in.
    rows.set('cn3', { connection_id: 'cn3', secret: sealCredentials('cn3', signIn) });
    expect(await readCmsCredentials('cn3', { db })).toBeNull();
  });

  it('reads none for a connection with none kept', async () => {
    expect(await readCmsCredentials('cn9', { db })).toBeNull();
  });
});
