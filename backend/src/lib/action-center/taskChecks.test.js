import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Automatic checks (AC-010): a task checked `auto` read on its page, fetched
 * again, by what it changes; passed, it is completed and History says so.
 */

let db;
let ops;
let reads;

function table(name) {
  const q = { op: 'select', filters: [], payload: null };
  const run = () => {
    if (q.op === 'select') {
      reads.push({ table: name, filters: q.filters });
      return { data: db[name] ?? [], error: null };
    }
    ops.push({ table: name, op: q.op, payload: q.payload, filters: q.filters });
    if (q.op === 'update' && name === 'action_tasks') {
      return { data: db.moved ? [] : [{ id: 't1' }], error: null };
    }
    return { data: null, error: null };
  };
  const filter =
    (kind) =>
    (...args) => (q.filters.push([kind, ...args]), chain);
  const chain = {
    select: () => chain,
    eq: (col, value) => (q.filters.push([col, value]), chain),
    in: filter('in'),
    is: filter('is'),
    not: filter('not'),
    or: filter('or'),
    order: filter('order'),
    limit: () => chain,
    range: filter('range'),
    maybeSingle: async () => {
      reads.push({ table: name, filters: q.filters });
      const row = db[name];
      return { data: Array.isArray(row) ? (row[0] ?? null) : (row ?? null), error: null };
    },
    insert: (payload) => ((q.op = 'insert'), (q.payload = payload), chain),
    update: (payload) => ((q.op = 'update'), (q.payload = payload), chain),
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return chain;
}

vi.mock('../../config/supabase.js', () => ({ default: { from: (name) => table(name) } }));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// A shopping links task's check: the catalog sync's, on its one draft (shoppingCheck.js).
const checkShoppingDraft = vi.hoisted(() => vi.fn());
vi.mock('../shoppingCheck.js', () => ({ checkShoppingDraft }));

const {
  CHANGED_BELOW,
  MIN_CHANGED_RUNS,
  SKETCH_VERSION,
  SWEEP_PER_BRAND,
  changedRuns,
  checkKind,
  checkPage,
  pageAddress,
  runTaskCheck,
  similarity,
  sketch,
  sweepTaskChecks,
  visibleText,
} = await import('./taskChecks.js');

/**
 * A fetch that answers each address with a page, or fails as the reader
 * does; `{ redirect, html }` answers from another address.
 */
const fetchOf = (pages) =>
  vi.fn(async (url) => {
    const page = pages[url];
    if (page === undefined) throw Object.assign(new Error('timeout'), { code: 'timeout' });
    if (page === 'not_html') throw Object.assign(new Error('html'), { code: 'not_html' });
    if (typeof page === 'number') {
      throw Object.assign(new Error('http'), { code: 'http_error', status: page });
    }
    if (typeof page === 'object') return { url: page.redirect, status: 200, html: page.html };
    return { url, status: 200, html: page };
  });

const PAGE = 'https://acme.example/pricing';
const ROBOTS = 'https://acme.example/robots.txt';
/** Words enough for a page to be read (MIN_WORDS), none a test looks for. */
const FILLER = Array.from({ length: 24 }, (_, i) => `filler${i}`).join(' ');
const html = (body, head = '') =>
  `<html><head><title>Pricing</title>${head}</head><body><main><h1>Pricing</h1><p>${body}</p><p>${FILLER}</p></main></body></html>`;

/** An essay of `n` words, word i reading `w{i}`, with `changes` swapped in at their places. */
const essay = (n, changes = {}) =>
  Array.from({ length: n }, (_, i) => changes[i] ?? `w${i}`).join(' ');

beforeEach(() => {
  db = {
    brand_domains: [{ domain: 'acme.example' }],
    action_tasks: [],
    actions: null,
    moved: false,
  };
  ops = [];
  reads = [];
});

describe('checkKind', () => {
  it('reads a library task by its key, a written one by its new text, only checked auto with a page', () => {
    const auto = { check: 'auto', url: '/pricing' };
    expect(checkKind({ task_key: 'publish_content', details: auto })).toBe('published');
    expect(checkKind({ task_key: 'fix_broken_target', details: auto })).toBe('answers');
    expect(checkKind({ task_key: 'fix_structured_data', details: auto })).toBe('structuredData');
    expect(checkKind({ task_key: 'fix_crawler_access', details: auto })).toBe('crawlers');
    expect(checkKind({ task_key: 'optimize_content', details: auto })).toBe('changed');
    expect(checkKind({ task_key: null, details: { ...auto, change: { after: 'New FAQ' } } })).toBe(
      'text',
    );
    // A Site Audit task, a re-run, no page, no new text: no check here.
    expect(checkKind({ task_key: 'fix_technical_issue', details: auto })).toBeNull();
    expect(
      checkKind({ task_key: 'validate_citations', details: { ...auto, check: 'rerun' } }),
    ).toBeNull();
    expect(checkKind({ task_key: 'publish_content', details: { check: 'auto' } })).toBeNull();
    expect(checkKind({ task_key: null, details: auto })).toBeNull();
    // A shopping links task: checked on its draft's page, as the catalog sync checks it.
    expect(
      checkKind({ task_key: null, details: { ...auto, source: 'shopping_check', draftId: 'd1' } }),
    ).toBe('shoppingLinks');
  });

  it('puts a path on the brand’s domain, and reads a bare host and path as https', () => {
    expect(pageAddress('/pricing', 'acme.example')).toBe(PAGE);
    expect(pageAddress('/pricing', 'www.acme.example')).toBe('https://www.acme.example/pricing');
    expect(pageAddress(PAGE, null)).toBe(PAGE);
    expect(pageAddress('acme.example/pricing', null)).toBe(PAGE);
    expect(pageAddress('//acme.example/pricing', null)).toBe(PAGE);
    expect(pageAddress('çiçek.com/x', null)).toBe(new URL('https://çiçek.com/x').href);
    expect(pageAddress('/pricing', null)).toBeNull();
    expect(pageAddress('pricing', 'acme.example')).toBeNull();
    expect(pageAddress('the pricing page', 'acme.example')).toBeNull();
    // A file's name isn't a domain.
    expect(pageAddress('pricing.html', 'acme.example')).toBeNull();
  });
});

describe('visibleText', () => {
  it('reads the body’s own words, not its menus, footer, forms or furniture', () => {
    const page = `<html><head><title>Pricing</title><meta name="description" content="Plans."></head>
      <body><nav>Home Blog</nav><header>Logo</header><main><h1>Plans</h1><p>Start&nbsp;at $9</p>
      <div class="related-posts">Read next</div><div id="shareButtons">Tweet</div></main>
      <form><button>Buy</button></form><aside>Ad</aside><footer>© 2026</footer>
      <script>var x = 1;</script></body></html>`;
    const read = visibleText(page).replace(/\s+/g, ' ').trim();
    expect(read).toBe('Pricing Plans. Plans Start at $9');
  });

  it('reads a block named as furniture, or a form, that holds most of the page', () => {
    const article = `<html><body><nav>Home</nav><article class="post category-social-media tag-newsletter">
      <h1>Social media plans</h1><p>${FILLER}</p></article><div class="share">Tweet</div></body></html>`;
    const read = visibleText(article);
    expect(read).toContain('Social media plans');
    expect(read).not.toContain('Tweet');
    const form = `<html><body><form id="aspnetForm"><h1>Plans</h1><p>${FILLER}</p></form></body></html>`;
    expect(visibleText(form)).toContain('Plans');
  });

  it('reads a page nested ten thousand deep without running out of stack', () => {
    const deep = `<html><body>${'<div>'.repeat(10_000)}deep words${'</div>'.repeat(10_000)}</body></html>`;
    expect(visibleText(deep)).toContain('deep words');
  });

  it('ends a block’s words with it, before the text after it', () => {
    const read = visibleText('<html><body><h2>Pricing</h2>Plans</body></html>');
    expect(read.replace(/\s+/g, ' ').trim()).toBe('Pricing Plans');
  });

  it('reads blocks that each leave a different formatting element open in time', () => {
    const blocks = Array.from({ length: 2_000 }, (_, i) => `<div><b c${i}>word${i}</div>`);
    const page = `<html><body>${blocks.join('')}</body></html>`;
    const started = Date.now();
    expect(visibleText(page)).toContain('word1999');
    expect(Date.now() - started).toBeLessThan(2_000);
  });
});

describe('sketch and similarity', () => {
  it('keep a page that moved a date, a count or a price near its first look, and one rewritten far', () => {
    const first = sketch(essay(800));
    expect(first.hashes.length).toBe(256);
    expect(first.runs).toBe(797);
    // A date, a reader count and a price moved.
    const moved = sketch(essay(800, { 10: '2027', 300: 'readers512', 600: 'usd19' }));
    expect(similarity(first.hashes, moved.hashes)).toBeGreaterThanOrEqual(CHANGED_BELOW);
    expect(changedRuns(first, moved)).toBeLessThan(MIN_CHANGED_RUNS);
    // A 150-word FAQ added.
    const faq = sketch(
      `${essay(800)} ${Array.from({ length: 150 }, (_, i) => `faq${i}`).join(' ')}`,
    );
    expect(similarity(first.hashes, faq.hashes)).toBeLessThan(CHANGED_BELOW);
    expect(changedRuns(first, faq)).toBeGreaterThanOrEqual(MIN_CHANGED_RUNS);
    // 40% rewritten.
    const rewritten = sketch(
      essay(800, Object.fromEntries(Array.from({ length: 320 }, (_, i) => [i * 2, `n${i}`]))),
    );
    expect(similarity(first.hashes, rewritten.hashes)).toBeLessThan(0.5);
    expect(similarity(first.hashes, first.hashes)).toBe(1);
  });

  it('never call a short page changed by a number or two moving', () => {
    // On a 60-word page one number is a large share of its runs, never MIN_CHANGED_RUNS of them.
    const first = sketch(essay(60));
    const moved = sketch(essay(60, { 30: '2027' }));
    expect(similarity(first.hashes, moved.hashes)).toBeLessThan(CHANGED_BELOW);
    expect(changedRuns(first, moved)).toBeLessThan(MIN_CHANGED_RUNS);
    for (const n of [200, 400]) {
      const a = sketch(essay(n));
      const b = sketch(essay(n, { 5: '2027', [n - 10]: 'usd19', [Math.floor(n / 2)]: 'readers9' }));
      expect(changedRuns(a, b)).toBeLessThan(MIN_CHANGED_RUNS);
    }
  });
});

describe('checkPage', () => {
  it('passes a broken page that answers again; only "not there" is an answer', async () => {
    const read = (page) => checkPage('answers', PAGE, { fetch: fetchOf({ [PAGE]: page }) });
    expect(await read(html('x'))).toEqual({ passed: true, missing: [] });
    for (const status of [404, 410]) {
      expect(await read(status)).toEqual({
        passed: false,
        missing: ['page_error'],
        wasMissing: true,
      });
    }
    // Bot protection, a rate limit, a server error or no answer says nothing.
    for (const status of [403, 429, 503]) expect(await read(status)).toBeNull();
    expect(await checkPage('answers', PAGE, { fetch: fetchOf({}) })).toBeNull();
  });

  it('reads a page redirected off the brand’s site as off the site', async () => {
    const fetch = fetchOf({ [PAGE]: { redirect: 'https://other.example/', html: html('x') } });
    expect(await checkPage('answers', PAGE, { domains: ['acme.example'], fetch })).toEqual({
      passed: false,
      missing: ['off_site'],
    });
  });

  it('passes a published page that was never there before, never one live once', async () => {
    const missing = await checkPage('published', PAGE, { fetch: fetchOf({ [PAGE]: 404 }) });
    const live = fetchOf({ [PAGE]: html(essay(300)) });
    expect(
      await checkPage('published', PAGE, { previous: { ...missing, url: PAGE }, fetch: live }),
    ).toEqual({ passed: true, missing: [] });
    // Live at the first look: kept, and passed once it changes.
    const first = await checkPage('published', PAGE, { fetch: live });
    expect(first).toMatchObject({ passed: false, missing: ['first_look'] });
    // A live page that answered 404 once (a deploy) keeps its first look: no pass.
    const flaky = { ...first, wasMissing: true, url: PAGE };
    expect(await checkPage('published', PAGE, { previous: flaky, fetch: live })).toMatchObject({
      passed: false,
      missing: ['not_changed'],
    });
  });

  it('passes structured data by the audit checks that raised it', async () => {
    const ld = (json) => `<script type="application/ld+json">${json}</script>`;
    const ORG = ld('{"@context":"https://schema.org","@type":"Organization","name":"Acme"}');
    const FAQ = ld(
      '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[{"@type":"Question","name":"a"},{"@type":"Question","name":"b"}]}',
    );
    const check = (head, auditChecks, previous = null) =>
      checkPage('structuredData', PAGE, {
        auditChecks,
        previous,
        fetch: fetchOf({ [PAGE]: html('x', head) }),
      });
    // A FAQ schema fix isn't passed by the site's Organization block.
    expect(await check(ORG, ['faq-schema'])).toEqual({
      passed: false,
      missing: ['no_faq_schema'],
    });
    expect(await check(`${ORG}${FAQ}`, ['faq-schema'])).toEqual({ passed: true, missing: [] });
    // No checks named (another action's fix, #1565 B): the JSON-LD must be
    // valid schema.org, {"foo":1} isn't, and a page valid all along (the
    // site's Organization block) isn't fixed by it…
    expect(await check(ORG, [])).toEqual({ passed: false, missing: ['valid_before'] });
    const failed = await check(ld('{"foo":1}'), []);
    expect(failed).toEqual({
      passed: false,
      missing: ['structured_data_invalid'],
      sawFailing: true,
    });
    // …it passes once a check on this page found it failing.
    expect(await check(ORG, [], { ...failed, url: PAGE })).toEqual({ passed: true, missing: [] });
    expect(await check(ORG, [], { ...failed, url: 'https://acme.example/other' })).toEqual({
      passed: false,
      missing: ['valid_before'],
    });
    expect(await check('', ['json-ld-presence', 'json-ld-validity'])).toEqual({
      passed: false,
      missing: ['no_structured_data', 'structured_data_invalid'],
    });
  });

  it('asks validity for a pass, and relevance only not to fail', async () => {
    const ld = (json) => `<script type="application/ld+json">${json}</script>`;
    const ORG = ld('{"@context":"https://schema.org","@type":"Organization","name":"Acme"}');
    const check = (head, auditChecks) =>
      checkPage('structuredData', PAGE, {
        auditChecks,
        fetch: fetchOf({ [PAGE]: html('x', head) }),
      });
    // A good block beside one that doesn't parse: validity's warn, still open.
    const broken = `${ORG}${ld('{"@type":"Product",')}`;
    for (const auditChecks of [['json-ld-validity'], []]) {
      expect(await check(broken, auditChecks)).toMatchObject({
        passed: false,
        missing: ['structured_data_invalid'],
      });
    }
    expect(await check(ORG, ['json-ld-validity'])).toEqual({ passed: true, missing: [] });
    // Types, none from the high-value list: relevance's warn, passed.
    expect(await check(ORG, ['json-ld-relevance'])).toEqual({ passed: true, missing: [] });
  });

  it('reads robots.txt for the AI crawlers, and the page for noindex', async () => {
    const check = (pages) => checkPage('crawlers', PAGE, { fetch: fetchOf(pages) });
    const allowed = { passed: true, missing: [] };
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: 'User-agent: *\nDisallow: /admin' })).toEqual(
      allowed,
    );
    // None (4xx), or a page served in its place: every crawler in.
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: 404 })).toEqual(allowed);
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: '<!DOCTYPE html><html>App</html>' })).toEqual(
      allowed,
    );
    expect(
      await check({
        [PAGE]: html('x', '<meta name="robots" content="noindex, follow">'),
        [ROBOTS]: 'User-agent: GPTBot\nDisallow: /',
      }),
    ).toEqual({ passed: false, missing: ['crawlers_blocked', 'noindex'] });
    // Asked to wait, a server error, or no answer, says nothing.
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: 429 })).toBeNull();
    expect(await check({ [PAGE]: html('x'), [ROBOTS]: 503 })).toBeNull();
    expect(await check({ [PAGE]: html('x') })).toBeNull();
    // Robots.txt read whatever its type (S3 serves it as octet-stream), at most 512 KB.
    const fetch = fetchOf({ [PAGE]: html('x'), [ROBOTS]: '' });
    await checkPage('crawlers', PAGE, { fetch });
    const options = fetch.mock.calls[1][1];
    expect(options).toMatchObject({ maxBytes: 512 * 1024, truncate: true });
    expect(options.types.test('application/octet-stream')).toBe(true);
    expect(options.types.test('')).toBe(true);
  });

  it('keeps the first look, passes a page rewritten, never one that changed by itself', async () => {
    const look = (body, previous = null, head = '') =>
      checkPage('changed', PAGE, { previous, fetch: fetchOf({ [PAGE]: html(body, head) }) });
    const first = await look(essay(400));
    expect(first).toMatchObject({ passed: false, missing: ['first_look'] });
    expect(first.sketch.hashes).toHaveLength(256);
    const kept = { ...first, url: PAGE };
    // A date and a price moved, and a JSON-LD date: not changed, the first look kept.
    const ld = '<script type="application/ld+json">{"dateModified":"2026-10-27"}</script>';
    expect(await look(essay(400, { 3: '2027', 200: 'usd19' }), kept, ld)).toEqual({
      passed: false,
      missing: ['not_changed'],
      sketch: first.sketch,
    });
    // Two thirds rewritten: passed.
    const rewritten = essay(
      400,
      Object.fromEntries(Array.from({ length: 270 }, (_, i) => [i, `new${i}`])),
    );
    expect((await look(rewritten, kept)).passed).toBe(true);
    // A first look of another page (the URL edited since): a first look again.
    expect(await look(rewritten, { ...kept, url: 'https://acme.example/old' })).toMatchObject({
      missing: ['first_look'],
    });
  });

  it('never passes a short page that changed by itself: a date and a price aren’t enough runs', async () => {
    const look = (body, previous = null) =>
      checkPage('changed', PAGE, { previous, fetch: fetchOf({ [PAGE]: html(body) }) });
    const first = await look(essay(12));
    const moved = await look(essay(12, { 3: '2027', 9: 'usd19' }), { ...first, url: PAGE });
    // A large share of a short page's runs moved, but far fewer than MIN_CHANGED_RUNS.
    expect(moved).toMatchObject({ passed: false, missing: ['not_changed'] });
  });

  describe('what changes by itself (#1565 A)', () => {
    const run = (prefix, n) => Array.from({ length: n }, (_, i) => `${prefix}${i}`).join(' ');
    const block = (attrs, prefix, n) => `<div ${attrs}><p>${run(prefix, n)}</p></div>`;
    /** A 200-word page, with its testimonials and its latest posts. */
    const page = (quotes, posts, extra = '', body = essay(200)) =>
      `<html><head><title>Pricing</title></head><body><main><h1>Pricing</h1><p>${body}</p>` +
      `${block('class="testimonials"', quotes, 28)}${extra}</main>` +
      `${block('id="sidebar" class="latest-posts"', posts, 30)}</body></html>`;
    const look = (body, previous = null) =>
      checkPage('changed', PAGE, { previous, fetch: fetchOf({ [PAGE]: body }) });

    it('never passes a testimonial rotated, the latest posts moved on, or a new short review', async () => {
      const first = await look(page('quoteA', 'postA'));
      const kept = { ...first, url: PAGE };
      expect(await look(page('quoteB', 'postB'), kept)).toMatchObject({
        passed: false,
        missing: ['not_changed'],
      });
      // A 50-word review in a block of its own: fewer than MIN_CHANGED_RUNS runs.
      expect(
        await look(page('quoteA', 'postA', `<p>${run('review', 50)}</p>`), kept),
      ).toMatchObject({ passed: false, missing: ['not_changed'] });
    });

    it('passes a rewritten 60-word paragraph on the same short page', async () => {
      const first = await look(page('quoteA', 'postA'));
      const rewritten = essay(
        200,
        Object.fromEntries(Array.from({ length: 60 }, (_, i) => [70 + i, `new${i}`])),
      );
      expect(
        (await look(page('quoteA', 'postA', '', rewritten), { ...first, url: PAGE })).passed,
      ).toBe(true);
    });

    it('still finds a written task’s text in a testimonial', async () => {
      const fetch = fetchOf({ [PAGE]: page('quoteA', 'postA') });
      expect(await checkPage('text', PAGE, { after: 'quoteA3 quoteA4', fetch })).toMatchObject({
        passed: true,
      });
    });

    it.each([
      [
        'Elementor',
        '<div class="elementor-widget-wrap">',
        (text) =>
          `<div class="elementor-element elementor-widget elementor-widget-text-editor">` +
          `<div class="elementor-widget-container"><p>${text}</p></div></div>`,
      ],
      [
        'HubSpot',
        '<div class="row-fluid">',
        (text) =>
          `<div class="span12 widget-span widget-type-rich_text">` +
          `<div class="cell-wrapper"><p>${text}</p></div></div>`,
      ],
    ])('passes a %s page rewritten in its widgets', async (_, wrap, widget) => {
      const built = (prefix) =>
        `<html><head><title>Pricing</title></head><body>${wrap}` +
        `${[0, 1, 2, 3].map((i) => widget(run(`${prefix}${i}x`, 50))).join('')}</div></body></html>`;
      const first = await look(built('old'));
      expect((await look(built('new'), { ...first, url: PAGE })).passed).toBe(true);
    });

    it('counts a pricing page’s “Most popular” plan, and still leaves out a sidebar', () => {
      const read = visibleText(
        `<html><body><main><h1>Pricing</h1><div class="plan popular"><p>Growth plan words</p></div>` +
          `<p>${FILLER}</p></main><aside class="sidebar"><p>Sidebar words</p></aside>` +
          `<div class="widget-area"><p>Widget area words</p></div>` +
          `<div class="popular-posts"><p>Popular posts words</p></div></body></html>`,
        undefined,
        { steady: true },
      );
      expect(read).toContain('Growth plan words');
      expect(read).not.toContain('Sidebar words');
      expect(read).not.toContain('Widget area words');
      expect(read).not.toContain('Popular posts words');
    });

    it('takes a new first look over one kept before these were left out', async () => {
      const first = await look(page('quoteA', 'postA'));
      expect(first.sketch.v).toBe(SKETCH_VERSION);
      const { hashes, runs } = first.sketch;
      const again = await look(page('quoteA', 'postA'), { url: PAGE, sketch: { hashes, runs } });
      expect(again).toMatchObject({ passed: false, missing: ['first_look'] });
      expect(again.sketch.v).toBe(SKETCH_VERSION);
    });
  });

  it('reads a page with too few words as no answer: an empty shell, or bot protection’s', async () => {
    const empty =
      '<html><head><title>Just a moment</title></head><body><p>Checking your browser</p></body></html>';
    expect(await checkPage('changed', PAGE, { fetch: fetchOf({ [PAGE]: empty }) })).toBeNull();
    expect(
      await checkPage('text', PAGE, { after: 'x', fetch: fetchOf({ [PAGE]: empty }) }),
    ).toBeNull();
  });

  it('reads a page the reader turns away as nested too deep as no answer', async () => {
    const fetch = vi.fn(async () => {
      throw Object.assign(new Error('deep'), { code: 'too_deep' });
    });
    for (const kind of ['answers', 'changed', 'published', 'structuredData', 'crawlers']) {
      expect(await checkPage(kind, PAGE, { fetch })).toBeNull();
    }
    expect(await checkPage('text', PAGE, { after: 'w1', fetch })).toBeNull();
    // Nested as deep as real pages go, it's read.
    const nested = `<html><body>${'<div>'.repeat(500)}<p>${essay(300)}</p>${'</div>'.repeat(500)}</body></html>`;
    expect(await checkPage('changed', PAGE, { fetch: fetchOf({ [PAGE]: nested }) })).toMatchObject({
      passed: false,
      missing: ['first_look'],
    });
  });

  it('finds a written task’s new text on the page, its entities read and whole words only', async () => {
    const check = (after, body, head = '', before = null) =>
      checkPage('text', PAGE, { after, before, fetch: fetchOf({ [PAGE]: html(body, head) }) });
    expect(await check('plans start at $9 a month', 'Plans start at $9 a month.')).toEqual({
      passed: true,
      missing: [],
    });
    expect((await check('Tom & Jerry plans', 'Tom &amp; Jerry&nbsp;plans')).passed).toBe(true);
    // A word inside another isn't it.
    expect(await check('art', 'Start here')).toEqual({
      passed: false,
      missing: ['change_not_found'],
    });
    // The title and the meta description are read too.
    expect(
      (await check('Plans for teams', 'x', '<meta name="description" content="Plans for teams.">'))
        .passed,
    ).toBe(true);
  });

  it('passes a replacement only once the text it replaces is gone', async () => {
    const check = (body) =>
      checkPage('text', PAGE, {
        after: 'Plans from $9',
        before: 'Plans from $12',
        fetch: fetchOf({ [PAGE]: html(body) }),
      });
    expect(await check('Plans from $9. Plans from $12.')).toEqual({
      passed: false,
      missing: ['old_text_still_there'],
    });
    expect(await check('Plans from $9.')).toEqual({ passed: true, missing: [] });
    // New text that holds the old: an addition, passed.
    const added = await checkPage('text', PAGE, {
      after: 'Free shipping on every order',
      before: 'Free shipping',
      fetch: fetchOf({ [PAGE]: html('Free shipping on every order') }),
    });
    expect(added.passed).toBe(true);
  });
});

describe('runTaskCheck', () => {
  const action = { brand_id: 'b1' };
  const task = (over = {}) => ({
    id: 't1',
    action_id: 'a1',
    task_key: 'fix_broken_target',
    title: null,
    status: 'todo',
    updated_at: '2026-10-26T10:00:00Z',
    details: { check: 'auto', url: '/pricing', source: 'template' },
    ...over,
  });
  const now = new Date('2026-10-27T03:00:00Z');
  const at = now.toISOString();
  /** The task's last write: what the check found (the first is its claim, triedAt alone). */
  const lastWrite = () => ops.filter((op) => op.table === 'action_tasks').at(-1);

  it('completes a task that passes, keeps the check on it and tells History', async () => {
    const fetch = fetchOf({ [PAGE]: html('x') });
    const result = await runTaskCheck(task(), action, { fetch, now });
    expect(result).toEqual({
      autoCheck: { at, triedAt: at, url: PAGE, passed: true, missing: [] },
    });
    // A page read up to 512 KB.
    expect(fetch.mock.calls[0][1]).toMatchObject({ maxBytes: 512 * 1024, truncate: true });
    const update = lastWrite();
    expect(update.payload).toMatchObject({
      status: 'completed',
      // The template's mark stays: a check is no one's edit.
      details: { source: 'template', autoCheck: { passed: true } },
    });
    // Only if no one moved or edited it meanwhile: the claim on the task as
    // read, the result on the claim.
    const [claim] = ops.filter((op) => op.table === 'action_tasks');
    expect(claim.payload.details.autoCheck).toEqual({ triedAt: at });
    expect(claim.filters).toContainEqual(['updated_at', '2026-10-26T10:00:00Z']);
    expect(update.filters).toContainEqual(['status', 'todo']);
    expect(update.filters).toContainEqual(['updated_at', at]);
    expect(ops.find((op) => op.table === 'action_events').payload).toMatchObject({
      action_id: 'a1',
      event: 'task_checked',
      data: { taskId: 't1', task: 'fix_broken_target' },
      actor_id: null,
    });
  });

  it('names a renamed task in History by its title alone (#1565)', async () => {
    const renamed = task({ title: 'Fix the pricing link' });
    await runTaskCheck(renamed, action, { fetch: fetchOf({ [PAGE]: html('x') }), now });
    expect(ops.find((op) => op.table === 'action_events').payload.data).toEqual({
      taskId: 't1',
      task: null,
      title: 'Fix the pricing link',
    });
  });

  it('holds a task someone reopened: open, its checks kept, never closed again on that page', async () => {
    const reopened = task({
      details: {
        check: 'auto',
        url: '/pricing',
        autoCheck: { at: 'x', url: PAGE, passed: true, missing: [] },
      },
    });
    const result = await runTaskCheck(reopened, action, {
      fetch: fetchOf({ [PAGE]: html('x') }),
      now,
    });
    expect(result.autoCheck).toMatchObject({ passed: true, url: PAGE, held: true });
    expect(lastWrite().payload).not.toHaveProperty('status');
    expect(ops.some((op) => op.table === 'action_events')).toBe(false);
    // A check that fails meanwhile keeps it held; one that passes again doesn't close it.
    ops = [];
    const failed = await runTaskCheck(
      task({ details: { check: 'auto', url: '/pricing', autoCheck: result.autoCheck } }),
      action,
      { fetch: fetchOf({ [PAGE]: 404 }), now },
    );
    expect(failed.autoCheck).toMatchObject({ passed: false, held: true });
    ops = [];
    const again = await runTaskCheck(
      task({ details: { check: 'auto', url: '/pricing', autoCheck: failed.autoCheck } }),
      action,
      { fetch: fetchOf({ [PAGE]: html('x') }), now },
    );
    expect(again.autoCheck).toMatchObject({ passed: true, held: true });
    expect(lastWrite().payload).not.toHaveProperty('status');
    // Its URL edited since: a new page, checked as one.
    ops = [];
    await runTaskCheck(
      task({ details: { check: 'auto', url: '/plans', autoCheck: again.autoCheck } }),
      action,
      { fetch: fetchOf({ 'https://acme.example/plans': html('x') }), now },
    );
    expect(lastWrite().payload.status).toBe('completed');
  });

  it('marks a task tried before reading anything, so one it can’t check leaves the queue (#1565 C6)', async () => {
    // No address can be made: still tried.
    const typed = task({ details: { check: 'auto', url: 'not an address' } });
    const fetch = fetchOf({});
    expect(await runTaskCheck(typed, action, { fetch, now })).toEqual({ reason: 'no_address' });
    expect(lastWrite().payload.details.autoCheck).toEqual({ triedAt: at });
    expect(fetch).not.toHaveBeenCalled();
    // Claimed by another run meanwhile (the task changed since it was read): left to it.
    ops = [];
    db.moved = true;
    expect(await runTaskCheck(task(), action, { fetch, now })).toEqual({ reason: 'changed' });
    expect(fetch).not.toHaveBeenCalled();
    db.moved = false;
  });

  it('a read that throws still writes triedAt', async () => {
    // The page comes back, then reading it throws: the claim already marked the task tried.
    const fetch = vi.fn(async (url) => ({
      url,
      status: 200,
      get html() {
        throw new Error('unreadable');
      },
    }));
    const written = task({
      task_key: null,
      details: { check: 'auto', url: '/pricing', change: { after: 'Plans from $9' } },
    });
    await expect(runTaskCheck(written, action, { fetch, now })).rejects.toThrow('unreadable');
    expect(fetch).toHaveBeenCalled();
    const writes = ops.filter((op) => op.table === 'action_tasks');
    expect(writes).toHaveLength(1);
    expect(writes[0].payload.details.autoCheck).toEqual({ triedAt: at });
  });

  it('reads only the brand’s own pages', async () => {
    const fetch = fetchOf({ 'https://other.example/pricing': html('x') });
    const result = await runTaskCheck(
      task({ details: { check: 'auto', url: 'https://other.example/pricing' } }),
      action,
      { fetch, now },
    );
    expect(result.autoCheck).toMatchObject({ passed: false, missing: ['off_site'] });
    expect(fetch).not.toHaveBeenCalled();
    // A bare host on the brand's site is read, as https.
    const own = fetchOf({ [PAGE]: html('x') });
    await runTaskCheck(task({ details: { check: 'auto', url: 'acme.example/pricing' } }), action, {
      fetch: own,
      now,
    });
    expect(own).toHaveBeenCalledWith(PAGE, expect.anything());
  });

  it('puts a path on the brand’s stored host, www kept', async () => {
    db.brand_domains = [{ domain: 'https://www.acme.example/' }];
    const fetch = fetchOf({ 'https://www.acme.example/pricing': html('x') });
    expect((await runTaskCheck(task(), action, { fetch, now })).autoCheck.passed).toBe(true);
  });

  it('passes another action’s structured data fix only after a check found the page failing (#1565 B)', async () => {
    // F06's brand-entity raised it: none of its checks is a structured data check.
    db.actions = { targets: [{ id: PAGE, checks: ['brand-entity'] }] };
    const ORG =
      '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme"}</script>';
    const run = (autoCheck, head) =>
      runTaskCheck(
        task({
          task_key: 'fix_structured_data',
          details: {
            check: 'auto',
            url: '/pricing',
            source: 'template',
            ...(autoCheck ? { autoCheck } : {}),
          },
        }),
        action,
        { fetch: fetchOf({ [PAGE]: html('x', head) }), now },
      );
    // The site's Organization block was there all along: not fixed by it.
    const first = await run(null, ORG);
    expect(first.autoCheck).toMatchObject({ passed: false, missing: ['valid_before'] });
    expect(first.autoCheck).not.toHaveProperty('sawFailing');
    // No valid block now: kept as seen failing…
    const broken = await run(first.autoCheck, '');
    expect(broken.autoCheck).toMatchObject({ passed: false, sawFailing: true });
    // …through a read that found it failing again, and then fixed: passed.
    const still = await run(broken.autoCheck, '');
    expect(still.autoCheck.sawFailing).toBe(true);
    expect((await run(still.autoCheck, ORG)).autoCheck).toMatchObject({ passed: true });
  });

  it('checks structured data by the checks its page failed, and a crawler fix only from the audit', async () => {
    db.actions = { targets: [{ id: PAGE, checks: ['faq-schema'] }] };
    const fix = task({ task_key: 'fix_structured_data' });
    const result = await runTaskCheck(fix, action, { fetch: fetchOf({ [PAGE]: html('x') }), now });
    expect(result.autoCheck.missing).toEqual(['no_faq_schema']);
    expect(reads.find((r) => r.table === 'actions').filters).toContainEqual(['id', 'a1']);
    // The target's address written another way is the same page.
    db.actions = {
      targets: [
        { id: 'http://www.acme.example/pricing/', checks: ['json-ld-presence'] },
        { id: 'https://acme.example/other', checks: ['faq-schema'] },
      ],
    };
    const other = await runTaskCheck(fix, action, { fetch: fetchOf({ [PAGE]: html('x') }), now });
    expect(other.autoCheck.missing).toEqual(['no_structured_data']);
    // No target for the page: every target's checks, the stricter side.
    db.actions = {
      targets: [
        { id: 'https://acme.example/a', checks: ['json-ld-presence'] },
        { id: 'https://acme.example/b', checks: ['faq-schema'] },
      ],
    };
    const none = await runTaskCheck(fix, action, { fetch: fetchOf({ [PAGE]: html('x') }), now });
    expect(none.autoCheck.missing).toEqual(['no_structured_data', 'no_faq_schema']);
    // From the bot logs (a cited page crawlers never read): not checked here, its try kept.
    db.actions = { targets: [{ id: PAGE, checks: [] }] };
    const crawl = task({ task_key: 'fix_crawler_access' });
    const fetch = fetchOf({ [PAGE]: html('x') });
    ops = [];
    expect(await runTaskCheck(crawl, action, { fetch, now })).toEqual({
      reason: 'from_bot_logs',
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(lastWrite().payload.details.autoCheck).toEqual({
      triedAt: at,
    });
    db.actions = { targets: [{ id: PAGE, checks: ['ai-bot-access'] }] };
    expect(
      (
        await runTaskCheck(crawl, action, {
          fetch: fetchOf({ [PAGE]: html('x'), [ROBOTS]: 404 }),
          now,
        })
      ).autoCheck.passed,
    ).toBe(true);
  });

  it('keeps what is missing on a task that fails, and its first look through a 404', async () => {
    const changed = task({
      task_key: 'optimize_content',
      details: {
        check: 'auto',
        url: '/pricing',
        autoCheck: {
          at: 'x',
          url: PAGE,
          sketch: { hashes: ['aa'], runs: 1 },
          passed: false,
          missing: [],
        },
      },
    });
    const result = await runTaskCheck(changed, action, { fetch: fetchOf({ [PAGE]: 404 }), now });
    expect(result.autoCheck).toMatchObject({
      passed: false,
      missing: ['page_error'],
      sketch: { hashes: ['aa'], runs: 1 },
    });
    const update = lastWrite();
    expect(update.payload).not.toHaveProperty('status');
    expect(ops.some((op) => op.table === 'action_events')).toBe(false);
    // Another page's first look isn't kept for this one.
    ops = [];
    const moved = await runTaskCheck(
      task({
        task_key: 'optimize_content',
        details: { ...changed.details, url: '/plans' },
      }),
      action,
      { fetch: fetchOf({ 'https://acme.example/plans': 404 }), now },
    );
    expect(moved.autoCheck).not.toHaveProperty('sketch');
  });

  it('keeps only the try when the page can’t be read', async () => {
    const tried = task({
      details: {
        check: 'auto',
        url: '/pricing',
        autoCheck: { at: 'x', passed: false, missing: ['page_error'] },
      },
    });
    expect(await runTaskCheck(tried, action, { fetch: fetchOf({}), now })).toEqual({
      reason: 'no_answer',
    });
    expect(lastWrite().payload.details.autoCheck).toEqual({
      at: 'x',
      passed: false,
      missing: ['page_error'],
      triedAt: at,
    });
  });

  it('says why nothing was checked: no check here, done, or changed meanwhile', async () => {
    const fetch = fetchOf({ [PAGE]: html('x') });
    expect(
      await runTaskCheck(task({ task_key: 'fix_technical_issue' }), action, { fetch }),
    ).toEqual({ reason: 'not_checkable' });
    // A written task with no new text, and a task with no page, each by its own reason (#1565 C8).
    expect(
      await runTaskCheck(
        task({ task_key: null, details: { check: 'auto', url: '/pricing' } }),
        action,
        {
          fetch,
        },
      ),
    ).toEqual({ reason: 'no_change_text' });
    expect(
      await runTaskCheck(task({ details: { check: 'auto', url: '' } }), action, { fetch }),
    ).toEqual({ reason: 'no_address' });
    expect(await runTaskCheck(task({ status: 'completed' }), action, { fetch })).toEqual({
      reason: 'not_open',
    });
    db.moved = true;
    expect(await runTaskCheck(task(), action, { fetch })).toEqual({ reason: 'changed' });
    expect(ops.some((op) => op.table === 'action_events')).toBe(false);
  });
});

describe('runTaskCheck on a shopping links task', () => {
  const action = { brand_id: 'b1' };
  const LIVE = 'https://acme.example/blog/boots';
  const task = (over = {}) => ({
    id: 't1',
    action_id: 'a1',
    task_key: null,
    title: 'Swap the product that no longer sells',
    status: 'todo',
    updated_at: '2026-10-26T10:00:00Z',
    details: { check: 'auto', url: LIVE, source: 'shopping_check', draftId: 'd1' },
    ...over,
  });
  const now = new Date('2026-10-27T03:00:00Z');
  const at = now.toISOString();
  const fetch = vi.fn();

  beforeEach(() => {
    checkShoppingDraft.mockReset();
  });

  it('checks its draft as the catalog sync does; passed, that check completed it', async () => {
    checkShoppingDraft.mockResolvedValue({
      readFrom: 'page',
      pageUrl: LIVE,
      bad: [],
      action: 'closed',
    });
    expect(await runTaskCheck(task(), action, { fetch, now })).toEqual({
      autoCheck: { at, triedAt: at, url: LIVE, passed: true, missing: [] },
    });
    expect(checkShoppingDraft).toHaveBeenCalledWith('b1', 'd1', { readPage: fetch, now });
    // The task, its History and the action are the shopping check's to write.
    expect(ops).toEqual([]);
    expect(reads.some((r) => r.table === 'brand_domains')).toBe(false);
  });

  it('keeps what is missing on a page that still links a product that no longer sells', async () => {
    checkShoppingDraft.mockResolvedValue({
      readFrom: 'page',
      pageUrl: LIVE,
      bad: [{ id: 'p2', title: 'Boot', state: 'sold_out' }],
      action: 'kept',
    });
    const result = await runTaskCheck(task(), action, { fetch, now });
    expect(result).toEqual({
      autoCheck: { at, triedAt: at, url: LIVE, passed: false, missing: ['links_not_for_sale'] },
    });
    const update = ops.find((op) => op.table === 'action_tasks');
    expect(update.payload).toMatchObject({
      details: { source: 'shopping_check', draftId: 'd1', autoCheck: { passed: false } },
    });
    expect(update.payload.status).toBeUndefined();
    expect(update.filters).toContainEqual(['updated_at', '2026-10-26T10:00:00Z']);
    expect(ops.some((op) => op.table === 'action_events')).toBe(false);
  });

  it("says the page couldn't be read when only its draft was, and keeps the try", async () => {
    checkShoppingDraft.mockResolvedValue({
      readFrom: 'draft',
      pageUrl: null,
      bad: [{ id: 'p2', title: 'Boot', state: 'sold_out' }],
      action: null,
    });
    expect(await runTaskCheck(task(), action, { fetch, now })).toEqual({ reason: 'no_answer' });
    expect(ops.find((op) => op.table === 'action_tasks').payload).toMatchObject({
      details: { autoCheck: { triedAt: at } },
    });
  });

  it('says why nothing was checked: no path left, no draft named, or changed meanwhile', async () => {
    checkShoppingDraft.mockResolvedValue(null);
    expect(await runTaskCheck(task(), action, { fetch, now })).toEqual({
      reason: 'no_shopping_path',
    });
    expect(
      await runTaskCheck(
        task({ details: { check: 'auto', url: LIVE, source: 'shopping_check' } }),
        action,
        { fetch, now },
      ),
    ).toEqual({ reason: 'not_checkable' });
    checkShoppingDraft.mockResolvedValue({
      readFrom: 'page',
      pageUrl: LIVE,
      bad: [],
      action: 'none',
    });
    expect(await runTaskCheck(task(), action, { fetch, now })).toEqual({ reason: 'changed' });
    expect(checkShoppingDraft).toHaveBeenCalledTimes(2);
  });
});

describe('sweepTaskChecks', () => {
  const now = new Date('2026-10-27T03:00:00Z');
  const row = (id, over = {}) => ({
    id,
    action_id: 'a1',
    task_key: 'fix_broken_target',
    title: null,
    status: 'todo',
    updated_at: 'u',
    details: { check: 'auto', url: PAGE },
    actions: { brand_id: 'b1', status: 'new', deleted_at: null },
    ...over,
  });

  it('reads only tasks it can check, the least recently tried first', async () => {
    await sweepTaskChecks({ fetch: fetchOf({}), now });
    const filters = reads.find((r) => r.table === 'action_tasks').filters;
    expect(filters).toContainEqual(['not', 'details->>url', 'is', null]);
    expect(filters).toContainEqual([
      'or',
      expect.stringContaining('task_key.in.(publish_content,fix_broken_target'),
    ]);
    expect(filters).toContainEqual([
      'order',
      'details->autoCheck->>triedAt',
      { ascending: true, nullsFirst: true },
    ]);
    // A held task (reopened after it passed) is left to the person.
    expect(filters).toContainEqual(['is', 'details->autoCheck->>held', null]);
    // Never a demo brand's (00380): its tasks are sample data.
    expect(filters).toContainEqual(['actions.brands.is_demo', false]);
  });

  it('checks at most SWEEP_PER_BRAND of one brand’s tasks a night, the others’ too', async () => {
    const other = { brand_id: 'b2', status: 'new', deleted_at: null };
    db.action_tasks = [
      ...Array.from({ length: 25 }, (_, i) => row(`a${i}`)),
      ...Array.from({ length: 3 }, (_, i) => row(`b${i}`, { actions: other })),
    ];
    const fetch = fetchOf({ [PAGE]: html('x') });
    expect(await sweepTaskChecks({ fetch, now })).toEqual({ checked: 23, passed: 23 });
    expect(SWEEP_PER_BRAND).toBe(20);
    // Read a page at a time, in a steady order.
    const filters = reads.find((r) => r.table === 'action_tasks').filters;
    expect(filters).toContainEqual(['range', 0, 999]);
    expect(filters).toContainEqual(['order', 'id']);
  });

  it('checks the open tasks not tried in the last day, one at a time', async () => {
    db.action_tasks = [
      row('t1'),
      // Tried an hour ago: not again tonight.
      row('t2', {
        details: { check: 'auto', url: PAGE, autoCheck: { triedAt: '2026-10-27T02:00:00Z' } },
      }),
    ];
    const fetch = fetchOf({ [PAGE]: html('x') });
    expect(await sweepTaskChecks({ fetch, now })).toEqual({ checked: 1, passed: 1 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('leaves a shopping links task to the catalog sync', async () => {
    db.action_tasks = [
      row('t1', {
        task_key: null,
        details: { check: 'auto', url: PAGE, source: 'shopping_check', draftId: 'd1' },
      }),
    ];
    checkShoppingDraft.mockReset();
    expect(await sweepTaskChecks({ fetch: fetchOf({}), now })).toEqual({ checked: 0, passed: 0 });
    expect(checkShoppingDraft).not.toHaveBeenCalled();
  });
});
