import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/supabase.js', () => ({ default: {} }));

const { AUDIT_ROUNDS, site, siteRows } = await import('./site.js');
const { AUDITED_PAGES } = await import('./siteWorld.js');
const { TOTAL_SIGNALS, signalsByKey } = await import('../audit/rubric.js');
const { buildAuditPages } = await import('../audit/history.js');
const { buildOverview, primaryPages } = await import('../audit/overview.js');

/**
 * The demo brand's Site Audit (demo-site): Brewline's pages scored by the
 * audit engine itself over three rounds, its page inventory, site trust and
 * brand facts.
 */

const BRAND_ID = '11111111-2222-4333-8444-555555555555';
const NOW = new Date('2026-10-28T12:00:00Z');
const DAY = 86_400_000;
const rows = await siteRows({ brandId: BRAND_ID, now: NOW });

const path = (url) => new URL(url).pathname;
const latest = rows.audits.filter((a) => a.created_at.startsWith('2026-10-26'));

describe('siteRows: audits', () => {
  it('audits six key pages three times and every page in the latest round', () => {
    const perRound = AUDIT_ROUNDS.map(
      (_, round) => AUDITED_PAGES.filter((p) => p.rounds.includes(round)).length,
    );
    expect(perRound).toEqual([6, 6, AUDITED_PAGES.length]);
    expect(rows.audits).toHaveLength(6 + 6 + AUDITED_PAGES.length);
    expect(latest).toHaveLength(AUDITED_PAGES.length);
    expect(rows.audits.map((a) => a.source)).toContain('user');
    for (const audit of rows.audits) {
      expect(audit).toMatchObject({ brand_id: BRAND_ID, status: 'completed', error: null });
      expect(audit.url).toMatch(/^https:\/\/brewline\.example(\/|$)/);
      expect(audit.signals_total).toBe(TOTAL_SIGNALS);
      expect(Date.parse(audit.completed_at)).toBeLessThan(NOW.getTime());
      expect(NOW.getTime() - Date.parse(audit.created_at)).toBeLessThan(25 * DAY);
    }
  });

  it('stores every rubric signal of an audit, scored as the scorer reads it', () => {
    for (const audit of rows.audits) {
      const signals = rows.signals.filter((s) => s.audit_id === audit.id);
      expect(signals.map((s) => s.signal_key).sort()).toEqual(Object.keys(signalsByKey).sort());
      expect(audit.signals_evaluated).toBe(signals.filter((s) => s.status !== 'na').length);
      for (const s of signals) {
        expect(['pass', 'warn', 'fail', 'na']).toContain(s.status);
        expect(s.status === 'na' ? s.score : typeof s.score).toBe(
          s.status === 'na' ? null : 'number',
        );
        expect(s.category).toBe(signalsByKey[s.signal_key].category);
      }
    }
    // The model-judged signals say why, and Wikidata knows no fictional brand.
    const direct = rows.signals.find((s) => s.signal_key === 'direct-answer');
    expect(direct.evidence.reason.length).toBeGreaterThan(10);
    const entity = rows.signals.filter((s) => s.signal_key === 'brand-entity');
    expect(entity.every((s) => s.status === 'fail')).toBe(true);
  });

  it('shows the key pages improving, a few good pages and some that need work', () => {
    const pages = buildAuditPages(
      [...rows.audits].sort((a, b) => b.created_at.localeCompare(a.created_at)),
      NOW.getTime(),
    );
    const status = (p) => pages.find((x) => x.path === p).status;
    for (const p of AUDITED_PAGES.filter((x) => x.rounds.length === 3)) {
      const page = pages.find((x) => x.path === p.path);
      expect(page.trend).toHaveLength(3);
      expect(page.trend.at(-1)).toBeGreaterThan(page.trend[0]);
    }
    const statuses = pages.map((p) => p.status);
    expect(statuses).toContain('good');
    expect(statuses).toContain('improving');
    expect(statuses).toContain('needs_work');
    expect(status('/blog/how-fresh-should-coffee-beans-be')).toBe('good');

    const { own } = primaryPages(pages, 'brewline.example');
    const overview = buildOverview(
      own,
      new Map(rows.audits.map((a) => [a.id, a.category_scores])),
      [],
    );
    expect(overview.pages).toBe(AUDITED_PAGES.length);
    expect(overview.siteScore).toBeGreaterThan(0.5);
    expect(overview.siteScore).toBeLessThan(0.75);
    // Against each page's previous audit: up a few points.
    expect(overview.siteScoreChange).toBeGreaterThan(0);
  });

  it('recommends fixes in the stored shape, fitting the page, with no fact made up', () => {
    const keys = ['signalKey', 'label', 'category', 'priority', 'recommendation', 'draft', 'code'];
    for (const audit of rows.audits) {
      expect(audit.recommendations.length).toBeGreaterThan(0);
      expect(audit.recommendations.length).toBeLessThanOrEqual(5);
      for (const r of audit.recommendations) {
        expect(Object.keys(r).sort()).toEqual([...keys].sort());
        expect(['high', 'medium', 'low']).toContain(r.priority);
        expect(r.recommendation.length).toBeLessThanOrEqual(150);
        // No address outside the demo's fictional sites.
        expect(`${r.draft ?? ''} ${r.code ?? ''}`).not.toMatch(
          /https?:\/\/(?!schema\.org)(?![\w.-]*\.example\b)/,
        );
      }
    }
    const product = latest.find((a) => path(a.url) === '/coffee/colombia-huila');
    const keysOf = (a) => a.recommendations.map((r) => r.signalKey);
    expect(keysOf(product)).not.toContain('author-byline');
    expect(keysOf(product)).toContain('json-ld-relevance');
  });

  // Audits 30 pages again: allowed more than the default 5 s on a busy machine.
  it('is the same every time but for its dates, and its ids are its brand’s own', async () => {
    const other = await siteRows({
      brandId: '99999999-2222-4333-8444-555555555555',
      now: new Date(NOW.getTime() + 2 * DAY),
    });
    expect(other.audits[0].id).not.toBe(rows.audits[0].id);
    const strip = ({ id: _i, brand_id: _b, created_at: _c, completed_at: _d, ...a }) => a;
    expect(other.audits.map(strip)).toEqual(rows.audits.map(strip));
  }, 30_000);
});

describe('siteRows: pages, trust and facts', () => {
  it("lists the site's pages as the page inventory keeps them, cited and visited first", () => {
    const urls = rows.sitePages.map((p) => p.url);
    expect(new Set(urls).size).toBe(urls.length);
    for (const p of AUDITED_PAGES)
      expect(urls).toContain(`https://brewline.example${p.path === '/' ? '' : p.path}`);
    expect(urls.some((u) => /privacy|terms|cart/.test(u))).toBe(false);
    expect(rows.sitePages[0].sources).toContain('citation');
    const subscriptions = rows.sitePages.find((p) => path(p.url) === '/subscriptions');
    expect(subscriptions.ai_citations).toBeGreaterThan(0);
    expect(subscriptions.ga_sessions).toBeGreaterThan(0);
    expect(subscriptions.title).toBe('Coffee Subscriptions | Brewline Coffee');
    for (const page of rows.sitePages) {
      expect(page).toMatchObject({ brand_id: BRAND_ID, fetch_status: 200, fetched_via: 'direct' });
      expect(page.title).toBeTruthy();
    }
  });

  it('reads site trust 4 of 5: no editorial policy page', () => {
    expect(rows.siteTrust.score).toBe(4);
    expect(rows.siteTrust.checks.editorial.ok).toBe(false);
    expect(rows.siteTrust.checks.organizationSchema.ok).toBe(true);
    expect(rows.siteTrust.checks.authorPages.authors.map((a) => a.url)).toEqual([
      'https://brewline.example/authors/maya-okafor',
      'https://brewline.example/authors/daniel-reyes',
    ]);
  });

  it('keeps the brand facts the pages say, mostly approved, a few to review', () => {
    expect(rows.factPages.map((p) => p.kind).sort()).toEqual(['about', 'pricing', 'product']);
    for (const page of rows.factPages) expect(page.text_hash).toMatch(/^[0-9a-f]{16}$/);
    const prices = rows.facts.filter((f) => f.kind === 'price');
    expect(prices.map((f) => [f.value.plan, f.value.amount])).toEqual([
      ['House Blend Subscription', 18],
      ['Single Origin Club', 22],
      ['Espresso Club', 20],
      ['12 oz', 16.5],
      ['2 lb', 38],
    ]);
    expect(rows.facts.find((f) => f.kind === 'founded').value).toEqual({ year: 2016 });
    const statuses = rows.facts.map((f) => f.status);
    expect(statuses.filter((s) => s === 'pending').length).toBeGreaterThan(0);
    expect(statuses.filter((s) => s === 'approved').length).toBeGreaterThan(5);
  });

  it('keeps one exclude pattern and a few pinned or excluded pages', () => {
    expect(rows.settings.exclude_patterns).toEqual(['/brewing/*']);
    expect(rows.prefs.map((p) => [p.page_key, p.state])).toEqual([
      ['brewline.example/coffee/espresso-roast', 'pinned'],
      ['brewline.example/subscriptions/espresso-club', 'pinned'],
      ['brewline.example/shipping', 'excluded'],
    ]);
  });
});

describe('site.build', () => {
  it('writes only its own tables (and the audits’ signals), the signals after their audits', async () => {
    const writes = [];
    const keys = {};
    const db = {
      from: (table) => ({
        upsert: async (list, { onConflict }) => {
          writes.push([table, list.length]);
          keys[table] = onConflict;
          return { error: null };
        },
      }),
    };
    const built = await site.build({ brandId: BRAND_ID, now: NOW, db });
    const tables = [...new Set(writes.map(([t]) => t))];
    expect(tables).toEqual([
      'site_pages',
      'site_audits',
      'site_trust',
      'site_audit_brand_settings',
      'site_audit_page_prefs',
      'brand_fact_pages',
      'brand_facts',
      'audit_signal_results',
    ]);
    expect(keys).toMatchObject({
      site_pages: 'brand_id,url',
      site_audits: 'id',
      audit_signal_results: 'audit_id,signal_key',
      site_trust: 'brand_id',
      brand_fact_pages: 'brand_id,kind',
    });
    expect(tables.filter((t) => !site.tables.includes(t))).toEqual(['audit_signal_results']);
    expect(built.signals).toBe(built.audits * TOTAL_SIGNALS);
  });
});
