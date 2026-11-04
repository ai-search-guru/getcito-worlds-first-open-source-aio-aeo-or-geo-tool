// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrandFact } from './brandFacts';
import type { QualityState } from './qualityInputs';

/**
 * The quality gate a page passes to go live on its own (AUTONOMOUS-GO-LIVE
 * §6.2, PR 2b-2): each score 60+ and their average 75+, no fact that differs
 * from the brand's approved ones, nothing the page states unchecked, and
 * every read the scores need made; else the page waits for a click, with
 * why. Run in Node, with the server's own DOM (withContentDom), as the gate
 * runs: a page reader that needs the browser's globals fails here.
 */

const pkg = vi.hoisted(() => ({ value: {} as unknown }));
vi.mock('@/lib/mcp/contentPackage', () => ({
  getContentDraftPackageFor: async () => pkg.value,
}));
const authors = vi.hoisted(() => ({
  value: { authors: [], brands: [], me: null } as unknown,
}));
vi.mock('./authorsRead', () => ({ readContentAuthors: async () => authors.value }));
vi.mock('./catalogMatch', () => ({ catalogMatchFor: async () => null }));

/** The admin client's reads: a table's rows, a query's one row, an RPC's answer. */
const db = vi.hoisted(() => ({ tables: {} as Record<string, unknown>, rpc: {} as unknown }));
vi.mock('@/lib/supabase/admin', () => {
  const query = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const op of ['select', 'eq', 'in', 'is', 'limit', 'order']) chain[op] = () => chain;
    chain.maybeSingle = async () => ({ data: db.tables[table] ?? null, error: null });
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve({ data: db.tables[table] ?? [], error: null });
    return chain;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => query(table),
      rpc: async () => ({ data: db.rpc, error: null }),
    },
  };
});
vi.mock('@/config/api', () => ({ API_BASE_URL: 'http://api.test' }));

const { gateVerdict, goLiveGate, statesBrandFacts, GATE_MIN_AVERAGE, GATE_MIN_EACH } =
  await import('./goLiveGate');

const ORG = '22222222-2222-4222-8222-222222222222';
const DRAFT = '44444444-4444-4444-8444-444444444444';
const INPUT = {
  organizationId: ORG,
  draftId: DRAFT,
  agentRunId: '66666666-6666-4666-8666-666666666666',
  runId: '77777777-7777-4777-8777-777777777777',
  actingUserId: '88888888-8888-4888-8888-888888888888',
  actingRole: 'admin' as const,
};

const fact = (over: Partial<BrandFact> = {}): BrandFact => ({
  id: 'f1',
  kind: 'price',
  value: { plan: 'Pro', amount: 49, currency: 'USD', period: 'month', billed: null, per: null },
  quote: 'Pro is $49 a month.',
  sourceUrl: 'https://acme.com/pricing',
  sourceKind: 'pricing',
  status: 'approved',
  reviewedAt: null,
  firstSeenAt: '2026-10-01T00:00:00Z',
  gone: false,
  replaces: null,
  ...over,
});

/** A state with just what the verdict reads. */
const state = (
  scores: { eeat?: number | null; trust?: number | null; readability?: number | null },
  mismatches: { page: string; fact: string }[] = [],
) =>
  ({
    eeatScore: scores.eeat === null ? null : { score: scores.eeat ?? 90 },
    trustScore: scores.trust === null ? null : { score: scores.trust ?? 90 },
    readable: scores.readability === null ? null : { score: scores.readability ?? 90 },
    factCheck: { compared: mismatches.length, mismatches },
  }) as unknown as QualityState;

describe('gateVerdict', () => {
  it('passes each score 60+ with an average of 75+, and says the scores', () => {
    expect(GATE_MIN_EACH).toBe(60);
    expect(GATE_MIN_AVERAGE).toBe(75);
    expect(
      gateVerdict({
        state: state({ eeat: 80, trust: 75, readability: 70 }),
        facts: [fact()],
        sentences: [],
      }),
    ).toEqual({
      pass: true,
      scores: { eeat: 80, trust: 75, readability: 70, average: 75 },
    });
  });

  it('names the lowest score under 60, else the average under 75', () => {
    expect(
      gateVerdict({
        state: state({ eeat: 95, trust: 59, readability: 95 }),
        facts: [],
        sentences: [],
      }),
    ).toEqual({ pass: false, hold: 'qualityLow', check: 'trust', score: 59 });
    expect(
      gateVerdict({
        state: state({ eeat: 74, trust: 74, readability: 74 }),
        facts: [],
        sentences: [],
      }),
    ).toEqual({ pass: false, hold: 'quality', score: 74 });
  });

  it('leaves out a score with nothing to judge, as the editor’s average, but holds none at all', () => {
    expect(gateVerdict({ state: state({ trust: null }), facts: [], sentences: [] })).toEqual({
      pass: true,
      scores: { eeat: 90, trust: null, readability: 90, average: 90 },
    });
    expect(
      gateVerdict({
        state: state({ eeat: null, trust: null, readability: null }),
        facts: [],
        sentences: [],
      }),
    ).toEqual({ pass: false, hold: 'quality_unread', read: 'scores', why: 'none' });
  });

  it('holds a fact that differs from the brand’s, before the scores', () => {
    expect(
      gateVerdict({
        state: state({ eeat: 20 }, [{ page: '$59', fact: '$49 a month (Pro)' }]),
        facts: [fact()],
        sentences: [],
      }),
    ).toEqual({ pass: false, hold: 'facts', page: '$59', fact: '$49 a month (Pro)' });
  });

  it('holds a page stating a price, a trial or a year with no approved facts to check it against', () => {
    const pending = [fact({ status: 'pending' })];
    expect(
      gateVerdict({ state: state({}), facts: pending, sentences: ['Acme costs $29 a month.'] }),
    ).toEqual({ pass: false, hold: 'facts_unchecked' });
    expect(
      gateVerdict({ state: state({}), facts: [], sentences: ['Brew it slowly.'] }),
    ).toMatchObject({
      pass: true,
    });
  });
});

describe('statesBrandFacts', () => {
  it('reads a price, a trial and a founding year, wide', () => {
    expect(statesBrandFacts(['Plans start at $19 a month.'])).toBe(true);
    expect(statesBrandFacts(['Start a 14-day free trial today.'])).toBe(true);
    expect(statesBrandFacts(['Your trial lasts 30 days.'])).toBe(true);
    expect(statesBrandFacts(['We were founded in 2019 in Austin.'])).toBe(true);
    expect(statesBrandFacts(['Grind fresh, pour slowly.', 'Free shipping on everything.'])).toBe(
      false,
    );
  });
});

describe('the page readers the gate runs on the server', () => {
  it('read a page with the content DOM, never the browser’s globals', async () => {
    const { withContentDom } = await import('./serverDom');
    const { trustBlocks, shippingOnPage } = await import('./qualityChecks');
    const { readPage, pageTextLength } = await import('./rules');
    const { pageImages } = await import('./pageRead');
    const { introFacts } = await import('./introFacts');
    const { pageDoc } = await import('./docText');
    await withContentDom();
    expect(typeof (globalThis as { DOMParser?: unknown }).DOMParser).toBe('undefined');
    const html =
      '<h2>Can I get a refund?</h2><p>Yes, within 30 days. <a href="https://acme.example/returns">Returns</a></p><p><img src="https://acme.example/a.png" alt="A"></p>';
    expect(trustBlocks(html)).toEqual([
      { tag: 'p', text: 'Yes, within 30 days. Returns', links: ['https://acme.example/returns'] },
    ]);
    expect(readPage(html, pageTextLength(html)).blocks[0]).toMatchObject({ tag: 'h2' });
    expect(shippingOnPage(html)).toMatchObject({ returns: true });
    expect(pageImages(html)).toEqual([{ src: 'https://acme.example/a.png', alt: 'A' }]);
    expect(Array.isArray(introFacts(html))).toBe(true);
    expect(pageDoc(html).childCount).toBeGreaterThan(0);
  });
});

describe('goLiveGate', () => {
  const HTML = '<h1>Pour-over guide</h1><p>Grind fresh, then pour slowly in circles.</p>';
  const ok = <T>(value: T) => ({ ok: true, value });
  let reads: Record<string, unknown>;
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '2');
    vi.stubEnv('CRON_SECRET', 'shh');
    pkg.value = { draft_id: DRAFT, html: HTML };
    authors.value = { authors: [], brands: [], me: null };
    db.tables = {
      content_drafts: {
        id: DRAFT,
        brand_id: 'b1',
        title: 'Pour-over guide',
        body_html: HTML,
        page_type: 'guide',
        author_id: null,
        author_real_at: null,
        author_profile_at: null,
        rules: null,
        kept_sources: [],
        brands: {
          organization_id: ORG,
          name: 'Acme',
          language: 'en',
          site_type: 'b2c',
          industry: null,
          shopping_mode_enabled: false,
        },
      },
      content_draft_suggestions: [],
      content_rule_sets: [],
      content_draft_own_images: [],
      content_draft_confirmations: [],
      content_draft_inputs: null,
    };
    db.rpc = { brandDomains: ['acme.com'], competitorDomains: ['rival.com'] };
    reads = {
      links: ok({ links: [], skipped: [] }),
      claims: ok({ paragraphs: [], pending: 0, limited: false }),
      page: ok({
        spots: [],
        proofs: [],
        regulated: null,
        checks: null,
        pending: false,
        limited: false,
        paused: false,
      }),
      classes: ok({ classes: [], limited: false }),
      facts: ok({ facts: [] }),
      siteTrust: ok(null),
    };
    fetchMock
      .mockReset()
      .mockImplementation(
        async () => new Response(JSON.stringify({ success: true, ...reads }), { status: 200 }),
      );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('holds everything with Content Quality off', async () => {
    vi.stubEnv('NEXT_PUBLIC_CONTENT_QUALITY_PHASE', '0');
    expect(await goLiveGate(INPUT)).toEqual({ pass: false, hold: 'quality_off' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('holds a page with placeholders or fields a CMS won’t take, as Send to CMS says', async () => {
    pkg.value = { error: 'not_ready', problem: 'placeholders', message: '' };
    expect(await goLiveGate(INPUT)).toEqual({ pass: false, hold: 'placeholders' });
    pkg.value = { error: 'not_ready', problem: 'slug', message: '' };
    expect(await goLiveGate(INPUT)).toEqual({ pass: false, hold: 'fields' });
  });

  it('holds a draft whose suggestions still wait for review', async () => {
    db.tables.content_draft_suggestions = [{ id: 's1' }];
    expect(await goLiveGate(INPUT)).toEqual({ pass: false, hold: 'suggestions' });
  });

  it('asks the server for the reads as the run, with the sites the rules can’t place', async () => {
    db.tables.content_drafts = {
      ...(db.tables.content_drafts as object),
      body_html: '<p>See <a href="https://blog.example/a">a blog</a> on brewing.</p>',
    };
    await goLiveGate(INPUT);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/api/internal/chat/go-live/quality-reads');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer shh' });
    expect(JSON.parse(init.body)).toEqual({
      orgId: ORG,
      agentRunId: INPUT.agentRunId,
      runId: INPUT.runId,
      actingUserId: INPUT.actingUserId,
      draftId: DRAFT,
      sites: ['blog.example'],
    });
  });

  it('holds the page when a read failed, reached the run’s cap, or isn’t whole', async () => {
    reads.claims = { ok: false, code: 'run_cap' };
    expect(await goLiveGate(INPUT)).toEqual({
      pass: false,
      hold: 'quality_unread',
      read: 'claims',
      why: 'run_cap',
    });
    reads.claims = ok({ paragraphs: [], pending: 2, limited: false });
    expect(await goLiveGate(INPUT)).toMatchObject({ hold: 'quality_unread', read: 'claims' });
    reads.claims = ok({ paragraphs: [], pending: 0, limited: false });
    reads.page = ok({
      spots: [],
      proofs: [],
      regulated: null,
      checks: null,
      pending: false,
      limited: false,
      paused: true,
    });
    expect(await goLiveGate(INPUT)).toEqual({
      pass: false,
      hold: 'quality_unread',
      read: 'page',
      why: 'ai_budget',
    });
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 500 }));
    expect(await goLiveGate(INPUT)).toMatchObject({ hold: 'quality_unread', read: 'links' });
  });

  it('counts the visual proof spots still open in the editor’s own document', async () => {
    db.tables.content_drafts = {
      ...(db.tables.content_drafts as object),
      body_html:
        '<p>The Ridge 28 keeps your gear dry in any weather.</p><p>Every seam is welded seams-first and taped.</p><img src="https://acme.com/seams.jpg" alt="Seams">',
    };
    reads.page = ok({
      spots: [
        {
          passage: 'keeps your gear dry in any weather',
          block: 'The Ridge 28 keeps your gear dry in any weather.',
          image: 'On a wet hike',
          alt: 'Wet hike',
        },
        {
          passage: 'welded seams',
          block: 'Every seam is welded seams-first and taped.',
          image: 'The seams',
          alt: 'Seams',
        },
      ],
      proofs: [],
      regulated: null,
      checks: null,
      pending: false,
      limited: false,
      paused: false,
    });
    // The second spot's paragraph has its image after it: one stays open.
    const result = await goLiveGate(INPUT);
    expect(result).not.toMatchObject({ read: 'spots' });
  });

  it('gives a verdict on the scores once every read is in', async () => {
    const result = await goLiveGate(INPUT);
    expect(
      result.pass === true ||
        ['qualityLow', 'quality', 'facts_unchecked'].includes((result as { hold: string }).hold),
    ).toBe(true);
  });
});
