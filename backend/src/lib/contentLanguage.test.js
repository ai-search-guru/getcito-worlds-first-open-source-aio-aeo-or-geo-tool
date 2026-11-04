import { beforeEach, describe, expect, it, vi } from 'vitest';

/** A page's language, as the editor and the CMS send read it. */

let rows;
let reads;
vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      const call = { table, filters: [] };
      reads.push(call);
      const chain = {
        select: () => chain,
        eq: (col, v) => (call.filters.push([col, v]), chain),
        maybeSingle: async () => rows[table] ?? { data: null, error: null },
      };
      return chain;
    },
  },
}));
vi.mock('./logger.js', () => ({ logger: { warn: vi.fn() } }));

const { brandSiteType, draftLanguage, rulesLanguage, untouchedRules } =
  await import('./contentLanguage.js');
const brand = (over = {}) => ({ organization_id: 'org-1', language: 'en', ...over });

beforeEach(() => {
  rows = {};
  reads = [];
});

describe('rulesLanguage', () => {
  it('reads the Language rule while it is on, else the brand’s', () => {
    expect(rulesLanguage({ overrides: { language: { value: 'German' } } }, 'en')).toBe('de');
    expect(rulesLanguage({ overrides: { language: { value: 'English (US)' } } }, 'tr')).toBe('en');
    expect(rulesLanguage({ overrides: { language: { value: 'German', on: false } } }, 'tr')).toBe(
      'tr',
    );
    expect(rulesLanguage(null, 'Turkish')).toBe('tr');
    expect(rulesLanguage(null, null)).toBeNull();
  });
});

describe('untouchedRules', () => {
  it('is a draft no one has set rules on', () => {
    expect(untouchedRules(null)).toBe(true);
    expect(untouchedRules({ set: 'guide', overrides: {}, textRules: [] })).toBe(true);
    expect(untouchedRules({ overrides: { language: { value: 'German' } } })).toBe(false);
    expect(untouchedRules({ source: 'import' })).toBe(false);
  });
});

describe('draftLanguage', () => {
  it('reads the draft’s own rules, without My rules', async () => {
    const draft = { page_type: 'guide', rules: { overrides: { language: { value: 'German' } } } };
    expect(await draftLanguage(draft, brand())).toBe('de');
    expect(reads).toEqual([]);
  });

  it('reads My rules for its page type when it has none of its own', async () => {
    rows.content_rule_sets = {
      data: { overrides: { language: { value: 'German' } } },
      error: null,
    };
    expect(
      await draftLanguage(
        { page_type: 'guide', rules: null },
        brand({ shopping_mode_enabled: true }),
      ),
    ).toBe('de');
    // Keyed by the brand's kind of site too (00227), as the editor reads them.
    expect(reads[0]).toEqual({
      table: 'content_rule_sets',
      filters: [
        ['organization_id', 'org-1'],
        ['site_type', 'ecommerce'],
        ['page_type', 'guide'],
      ],
    });
    // The set a draft's rules name, over its page type.
    await draftLanguage({ page_type: 'guide', rules: { set: 'best_of' } }, brand());
    expect(reads[1].filters[2]).toEqual(['page_type', 'best_of']);
  });

  it('keeps the brand’s when My rules can’t be read', async () => {
    rows.content_rule_sets = { data: null, error: new Error('down') };
    expect(
      await draftLanguage({ page_type: 'guide', rules: null }, brand({ language: 'tr' })),
    ).toBe('tr');
  });
});

describe('brandSiteType', () => {
  it('reads the brand’s kind of site as the editor does', () => {
    expect(brandSiteType({ site_type: 'b2c' })).toBe('b2c');
    expect(brandSiteType({ shopping_mode_enabled: true })).toBe('ecommerce');
    expect(brandSiteType({})).toBe('b2b');
  });
});
