// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it } from 'vitest';
import { readBrandIntegrations } from './brandIntegrations';

/**
 * A brand's integrations on the web (BRAND-ACCESS PR 14, 00470): the sign-in
 * the brand uses for each provider, from brand_integrations; before 00470 is
 * applied, its Account's rows, as before.
 */

type Answer = { data: unknown; error: { code?: string; message: string } | null };

const db = {
  answers: {} as Record<string, Answer>,
  reads: [] as { table: string; columns: string; filters: [string, unknown][] }[],
};

function from(table: string) {
  const read = { table, columns: '', filters: [] as [string, unknown][] };
  db.reads.push(read);
  const answer = () => db.answers[table] ?? { data: [], error: null };
  const chain = {
    select: (columns: string) => ((read.columns = columns), chain),
    eq: (column: string, value: unknown) => (read.filters.push([column, value]), chain),
    maybeSingle: async () => answer(),
    then: (resolve: (value: Answer) => unknown) => Promise.resolve(answer()).then(resolve),
  };
  return chain;
}

const client = { from } as unknown as SupabaseClient;

beforeEach(() => {
  db.answers = {};
  db.reads = [];
});

describe('readBrandIntegrations', () => {
  it('reads the sign-in the brand uses for each provider, whatever its status', async () => {
    db.answers.brand_integrations = {
      data: [
        {
          provider: 'google-search-console',
          account: { id: 'a1', label: null, status: 'connected' },
        },
        { provider: 'google-analytics', account: { id: 'a2', label: null, status: 'pending' } },
        { provider: 'webflow', account: { id: 'a3', label: 'Acme blog', status: 'auth_failed' } },
      ],
      error: null,
    };

    const found = await readBrandIntegrations(client, 'b1');
    expect(Object.fromEntries(found)).toEqual({
      'google-search-console': {
        provider: 'google-search-console',
        accountId: 'a1',
        label: null,
        status: 'connected',
        connected: true,
      },
      'google-analytics': {
        provider: 'google-analytics',
        accountId: 'a2',
        label: null,
        status: 'pending',
        connected: false,
      },
      webflow: {
        provider: 'webflow',
        accountId: 'a3',
        label: 'Acme blog',
        status: 'auth_failed',
        connected: false,
      },
    });
    const [read] = db.reads;
    expect(read.table).toBe('brand_integrations');
    // The sign-in by its foreign key's name (embed-hints).
    expect(read.columns).toMatch(/integration_accounts!brand_integrations_account_id_fkey\(/);
    expect(read.filters).toEqual([['brand_id', 'b1']]);
  });

  it('leaves out a provider the brand uses no sign-in for', async () => {
    db.answers.brand_integrations = {
      data: [{ provider: 'google-analytics', account: null }],
      error: null,
    };
    expect((await readBrandIntegrations(client, 'b1')).size).toBe(0);
  });

  it('throws on a failed read', async () => {
    db.answers.brand_integrations = { data: null, error: { code: '57014', message: 'timeout' } };
    await expect(readBrandIntegrations(client, 'b1')).rejects.toThrow('timeout');
  });

  it("reads the brand's Account's rows before 00470 is applied", async () => {
    db.answers.brand_integrations = {
      data: null,
      error: { code: 'PGRST205', message: 'no such table' },
    };
    db.answers.brands = { data: { organization_id: 'org-1' }, error: null };
    db.answers.integration_connections = {
      data: [
        { provider: 'google-search-console', status: 'connected' },
        { provider: 'google-analytics', status: 'disconnected' },
      ],
      error: null,
    };

    const found = await readBrandIntegrations(client, 'b1');
    expect(found.get('google-search-console')).toMatchObject({ accountId: null, connected: true });
    expect(found.get('google-analytics')).toMatchObject({ connected: false });
    expect(db.reads.find((read) => read.table === 'integration_connections')?.filters).toEqual([
      ['organization_id', 'org-1'],
    ]);
  });

  it('reads nothing more for a brand it can’t see before 00470 is applied', async () => {
    db.answers.brand_integrations = { data: null, error: { code: '42P01', message: 'missing' } };
    db.answers.brands = { data: null, error: null };
    expect((await readBrandIntegrations(client, 'b1')).size).toBe(0);
    expect(db.reads.some((read) => read.table === 'integration_connections')).toBe(false);
  });
});
