import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/supabase';
import { insertOrganization } from './organizationInsert';

type Row = { id: string; name: string; slug: string };

function client(results: ({ code?: string; message: string } | null)[]) {
  const inserted: Row[] = [];
  const insert = vi.fn(async (row: Row) => {
    inserted.push(row);
    return { error: results.shift() ?? null };
  });
  const from = vi.fn(() => ({ insert }));
  return { supabase: { from } as unknown as SupabaseClient<Database>, inserted, from };
}

describe('insertOrganization', () => {
  it('inserts the name and slug with an id of its own, without reading the row back', async () => {
    const { supabase, inserted, from } = client([null]);
    const id = await insertOrganization(supabase, '  Acme Shoes ');
    expect(from).toHaveBeenCalledWith('organizations');
    expect(inserted).toEqual([{ id, name: 'Acme Shoes', slug: 'acme-shoes' }]);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('tries a taken slug once more with a suffix', async () => {
    const { supabase, inserted } = client([{ code: '23505', message: 'duplicate key' }, null]);
    const id = await insertOrganization(supabase, 'Acme');
    expect(inserted).toHaveLength(2);
    expect(inserted[1].slug).toMatch(/^acme-\d+$/);
    expect(inserted[1].id).toBe(id);
    expect(inserted[0].id).not.toBe(id);
  });

  it('throws any other error as is', async () => {
    const { supabase } = client([{ code: '42501', message: 'not allowed' }]);
    await expect(insertOrganization(supabase, 'Acme')).rejects.toThrow('not allowed');
  });

  it('gives up after the second taken slug', async () => {
    const taken = { code: '23505', message: 'duplicate key' };
    const { supabase } = client([taken, taken]);
    await expect(insertOrganization(supabase, 'Acme')).rejects.toThrow(
      'Failed to create organization',
    );
  });

  it('falls back to a generated slug for a name without letters', async () => {
    const { supabase, inserted } = client([null]);
    await insertOrganization(supabase, '***');
    expect(inserted[0].slug).toMatch(/^org-\d+$/);
  });
});
