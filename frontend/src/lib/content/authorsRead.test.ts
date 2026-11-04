import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { readContentAuthors } from './authorsRead';

/**
 * The authors read: with the service role (the MCP's get_content_draft_package),
 * which reads every row, each table keeps to the organization's.
 */

interface Query {
  table: string;
  columns: string;
  filters: [string, unknown][];
}

/** A client answering each table with its rows, and keeping what each query asked. */
function client(rows: Record<string, unknown[]>) {
  const queries: Query[] = [];
  const supabase = {
    from(table: string) {
      const query: Query = { table, columns: '', filters: [] };
      queries.push(query);
      const chain = {
        select: (columns: string) => ((query.columns = columns), chain),
        eq: (column: string, value: unknown) => (query.filters.push([column, value]), chain),
        is: (column: string, value: unknown) => (query.filters.push([column, value]), chain),
        order: () => chain,
        then: (resolve: (result: { data: unknown[]; error: null }) => unknown) =>
          resolve({ data: rows[table] ?? [], error: null }),
      };
      return chain;
    },
  };
  return { supabase: supabase as unknown as SupabaseClient, queries };
}

describe('readContentAuthors', () => {
  it("reads the organization's authors, brands and only its brands' defaults", async () => {
    const { supabase, queries } = client({
      content_authors: [
        {
          id: 'author-1',
          name: 'Ada Lovelace',
          title: 'Head barista',
          bio: null,
          photo_url: null,
          same_as: null,
          user_id: null,
          created_by: 'user-1',
        },
      ],
      brands: [{ id: 'brand-1', name: 'Acme Coffee', content_byline: true }],
      content_author_defaults: [{ brand_id: 'brand-1', author_id: 'author-1' }],
    });
    const read = await readContentAuthors(supabase, 'org-1', {
      me: { id: 'user-1', role: 'analyst' },
    });

    const byTable = Object.fromEntries(queries.map((q) => [q.table, q]));
    expect(byTable.content_authors.filters).toContainEqual(['organization_id', 'org-1']);
    expect(byTable.brands.filters).toContainEqual(['organization_id', 'org-1']);
    expect(byTable.content_author_defaults.columns).toContain('brands!inner(organization_id)');
    expect(byTable.content_author_defaults.filters).toContainEqual([
      'brands.organization_id',
      'org-1',
    ]);
    // No page counts unless asked (Settings' column).
    expect(queries.some((q) => q.table === 'content_drafts')).toBe(false);

    expect(read).toEqual({
      authors: [
        {
          id: 'author-1',
          name: 'Ada Lovelace',
          title: 'Head barista',
          bio: null,
          photoUrl: null,
          sameAs: [],
          userId: null,
          createdBy: 'user-1',
          defaultFor: ['brand-1'],
          pages: null,
        },
      ],
      brands: [{ id: 'brand-1', name: 'Acme Coffee', bylineInContent: true }],
      me: { id: 'user-1', role: 'analyst' },
    });
  });
});
