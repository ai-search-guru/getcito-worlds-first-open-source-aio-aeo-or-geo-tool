import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A page's visual proof spots and proof asks (Quality CE-049): read by the
 * model from the whole page with its types, kept by rule (a spot names a
 * specific image for a passage of the page, a proof is the page's own
 * claim), kept by the page's hash, on the workspace's AI budget as
 * "quality".
 */

let kept;
let readsToday;
let upserts;
let reserves;
let reserveError;
const charge = vi.fn();
const release = vi.fn();
const keep = vi.fn();
const generateObject = vi.fn();

vi.mock('../config/supabase.js', () => ({
  default: {
    from: (table) => {
      let columns = null;
      const chain = {
        // Only the columns asked for, as the database answers.
        select: (list) => ((columns = list ?? null), chain),
        eq: () => chain,
        gte: () => chain,
        maybeSingle: async () => ({
          data:
            kept && columns
              ? Object.fromEntries(
                  columns
                    .split(',')
                    .map((c) => c.trim())
                    .filter((c) => c in kept)
                    .map((c) => [c, kept[c]]),
                )
              : kept,
          error: null,
        }),
        upsert: async (row, options) => (upserts.push({ row, options }), { error: null }),
        then: (resolve) => resolve({ count: readsToday, error: null, table }),
      };
      return chain;
    },
  },
}));
vi.mock('./planGuard.js', async (importOriginal) => {
  const { PlanLimitError } = await importOriginal();
  return {
    PlanLimitError,
    reserveAiBudget: async (orgId, options) => {
      reserves.push({ orgId, ...options });
      if (reserveError) throw reserveError;
      return { charge, release, keep };
    },
  };
});
vi.mock('./aiProvider.js', () => ({ resolveModel: (id) => ({ id }) }));
vi.mock('ai', async (importOriginal) => ({
  ...(await importOriginal()),
  generateObject: (...args) => generateObject(...args),
}));

const { NoObjectGeneratedError } = await import('ai');
const { PlanLimitError } = await import('./planGuard.js');
const { PAGE_READS_PER_DAY, QUALITY_CALLS_PER_DAY } = await import('./contentQualityCalls.js');
const { SOURCE_READS_PER_DAY } = await import('./contentSourceClass.js');
const { MAX_SPOTS, PAGE_HOLD_USD, buildPagePrompt, keptPageRead, pageHash, pageOutline, readPage } =
  await import('./contentQualityPage.js');

const NOW = Date.parse('2026-10-25T12:00:00Z');
const WEATHER = 'Made for day hikes in any weather, the Ridge 28 keeps your gear dry.';
const SEAMS = 'Every Ridge 28 is fully waterproof, with welded seams and a roll-top.';
const AWARD = 'The Ridge 28 won the 2025 Outdoor Gear Award for best daypack.';
const filler = (topic) =>
  `<p>${`We built the ${topic} for long days outside, with straps that stay comfortable and pockets you can reach on the move. `.repeat(3)}</p>`;
const HTML =
  `<h1>Ridge 28 daypack</h1><p>${WEATHER}</p>${filler('pack')}` +
  `<h2>Built for rain</h2><p>${SEAMS}</p><ul><li>Roll-top closure keeps rain out.</li></ul>${filler('shell')}` +
  `<h2>Awards</h2><p>${AWARD}</p><p>Read more on <a href="https://press.example/ridge">our press page</a>, says the team.</p>` +
  '<table><tr><td>Volume: 28 litres of space</td></tr></table>';

const answer = (over = {}) => ({
  object: {
    spots: [
      {
        n: 1,
        passage: 'Made for day hikes in any weather',
        image: 'A photo of this Ridge 28 backpack on a real hike in the rain',
        alt: 'A hiker with the Ridge 28 on a wet trail',
      },
      {
        n: 3,
        passage: 'fully waterproof, with welded seams',
        image: 'A close-up of the roll-top and welded seams',
        alt: 'Close-up of the Ridge 28 seams',
      },
    ],
    proofs: [
      { n: 3, claim: 'fully waterproof', kind: 'certification' },
      { n: 6, claim: 'won the 2025 Outdoor Gear Award', kind: 'award' },
    ],
    regulated: null,
    ...over,
  },
  usage: { inputTokens: 900, outputTokens: 80 },
});

beforeEach(() => {
  kept = null;
  readsToday = 0;
  upserts = [];
  reserves = [];
  reserveError = null;
  charge.mockReset();
  release.mockReset();
  keep.mockReset();
  generateObject.mockReset().mockResolvedValue(answer());
});
afterEach(() => vi.unstubAllEnvs());

const read = (over = {}) =>
  readPage({
    orgId: 'o1',
    draftId: 'd1',
    html: HTML,
    siteType: 'ecommerce',
    pageType: 'product_page',
    brandName: 'Trailmade',
    now: NOW,
    ...over,
  });

describe('pageOutline', () => {
  it('reads headings and blocks in order, each block with its H2 section and its heading', () => {
    const outline = pageOutline(HTML);
    expect(outline.slice(0, 4).map((i) => [i.type, i.level ?? i.tag, i.section ?? null])).toEqual([
      ['heading', 1, null],
      ['block', 'p', 0],
      ['block', 'p', 0],
      ['heading', 2, null],
    ]);
    const press = outline.find((i) => i.text?.startsWith('Read more on'));
    expect(press).toMatchObject({
      section: 2,
      h2: 'Awards',
      text: 'Read more on our press page, says the team.',
    });
    // An empty H2 opens a section with no heading: the next one's blocks keep theirs.
    const empty = pageOutline(`<h2></h2><p>${WEATHER}</p><h2>Rain</h2><p>${SEAMS}</p>`);
    expect(empty.filter((i) => i.type === 'block').map((b) => [b.section, b.h2])).toEqual([
      [1, ''],
      [2, 'Rain'],
    ]);
    expect(outline.find((i) => i.tag === 'td')).toMatchObject({
      text: 'Volume: 28 litres of space',
    });
  });
});

describe('pageHash and buildPagePrompt', () => {
  it('reads again when the types, the brand’s claims or the words change', () => {
    const outline = pageOutline(HTML);
    const base = pageHash({ outline, siteType: 'ecommerce', pageType: 'product_page' });
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(pageHash({ outline, siteType: 'b2c', pageType: 'product_page' })).not.toBe(base);
    expect(pageHash({ outline, siteType: 'ecommerce', pageType: 'guide' })).not.toBe(base);
    expect(
      pageHash({ outline, siteType: 'ecommerce', pageType: 'product_page', facts: ['x'] }),
    ).not.toBe(base);
    expect(
      pageHash({
        outline: pageOutline(`${HTML}<p>One more line of copy here.</p>`),
        siteType: 'ecommerce',
        pageType: 'product_page',
      }),
    ).not.toBe(base);
    // The brand's facts in any order, a change past what the model reads: the same read.
    expect(pageHash({ outline, siteType: 'ecommerce', pageType: 'p', facts: ['b', 'a'] })).toBe(
      pageHash({ outline, siteType: 'ecommerce', pageType: 'p', facts: ['a', 'b'] }),
    );
    const long = (tail) =>
      pageHash({
        outline: pageOutline(
          `${HTML}${Array.from({ length: 400 }, (_, i) => `<p>Strap note ${i}: the straps stay comfortable.</p>`).join('')}<p>${tail}</p>`,
        ),
        siteType: 'ecommerce',
        pageType: 'product_page',
      });
    expect(long('One ending of the page.')).toBe(long('Another ending of the page.'));
  });

  it('shows the model the business, the page type, the brand’s claims and the page, numbered', () => {
    const prompt = buildPagePrompt({
      outline: pageOutline(HTML),
      siteType: 'ecommerce',
      pageType: 'product_page',
      brandName: 'Trailmade',
      facts: ['Bluesign certified', 'See https://trailmade.example/awards'],
    });
    expect(prompt).not.toContain('https://');
    expect(prompt).toContain('Business: E-commerce (an online shop selling products)');
    expect(prompt).toContain('Page type: Product page');
    expect(prompt).toContain('Brand: Trailmade');
    expect(prompt).toContain('- Bluesign certified');
    expect(prompt).toContain(`# Ridge 28 daypack\n[1] ${WEATHER}`);
    expect(prompt).toContain('## Built for rain');
    // A heading past MAX_HEADING_CHARS is cut: the page's blocks still fit.
    const huge = buildPagePrompt({
      outline: pageOutline(`<h1>${'Ridge '.repeat(4000)}</h1>${HTML}`),
      siteType: 'ecommerce',
      pageType: 'product_page',
    });
    expect(huge).toContain(`[1] ${WEATHER}`);
  });
});

describe('keptPageRead', () => {
  const outline = pageOutline(HTML);
  const keptOf = (object, site = 'ecommerce') => keptPageRead(outline, object, site);

  it('keeps a spot naming a specific image for a passage of the page, one an H2 section, three at most', () => {
    const { spots } = keptOf(answer().object);
    expect(spots.map((s) => [s.passage, s.image])).toEqual([
      [
        'Made for day hikes in any weather',
        'A photo of this Ridge 28 backpack on a real hike in the rain',
      ],
      ['fully waterproof, with welded seams', 'A close-up of the roll-top and welded seams'],
    ]);
    // A second spot in a section, a spot on a cell, past three.
    const many = keptOf({
      spots: [
        ...answer().object.spots,
        {
          n: 4,
          passage: 'Roll-top closure keeps rain out',
          image: 'A photo of the roll-top closed in rain',
          alt: 'Roll-top closed',
        },
        {
          n: 8,
          passage: 'Volume: 28 litres',
          image: 'A photo of the Ridge 28 packed full',
          alt: 'The pack, full',
        },
        {
          n: 6,
          passage: 'won the 2025 Outdoor Gear Award',
          image: 'A photo of the 2025 Outdoor Gear Award trophy',
          alt: 'The award trophy',
        },
      ],
      proofs: [],
      regulated: null,
    });
    expect(many.spots).toHaveLength(MAX_SPOTS);
    expect(many.spots.map((s) => s.passage)).not.toContain('Roll-top closure keeps rain out');
    expect(many.spots.map((s) => s.passage)).not.toContain('Volume: 28 litres');
  });

  it('drops a generic image, one with an address, one naming nothing of the page, a passage not on it', () => {
    const spot = (image, passage = 'Made for day hikes in any weather') => ({
      spots: [{ n: 1, passage, image, alt: 'A hiker with the pack' }],
      proofs: [],
      regulated: null,
    });
    for (const image of [
      'A screenshot of your dashboard',
      'A relevant image of the product',
      'A stock photo of a hiker',
      'Panonuzun ekran görüntüsü',
      'Ein passendes Bild vom Produkt',
      'A photo of the pack at https://example.com/a.png',
      'A photo of a sunset over the city',
      'A screenshot of our dashboard',
      'A screenshot of the dashboard showing data',
      'A photo of your team at work',
      'An image of your product',
      'A picture of the product in use',
      'A photo of a happy customer using the product',
      'Ürününüzün bir fotoğrafı',
      'Ekibimizin bir fotoğrafı',
      'İnfografik: ürünümüzün özellikleri',
      'İlgili bir görsel',
      'Ein Screenshot des Dashboards',
      'Ein Foto Ihres Teams',
      'Ein Foto des Produkts',
      'An illustration of the process',
    ]) {
      expect(keptOf(spot(image)).spots, image).toEqual([]);
    }
    expect(
      keptOf(spot('A photo of this backpack on a hike', 'Made for winter climbs')).spots,
    ).toEqual([]);
    // Too short a passage to show.
    expect(keptOf(spot('A photo of this backpack on a hike', 'any weather')).spots).toEqual([]);
    // Specific images that name a logo or an illustration still count.
    const named = pageOutline(
      `<h1>Ridge 28</h1><p>Every Ridge 28 has our logo engraved on the bottle clip, a small detail.</p>`,
    );
    expect(
      keptPageRead(
        named,
        {
          spots: [
            {
              n: 1,
              passage: 'our logo engraved on the bottle clip',
              image: 'A photo of the logo engraved on the bottle clip',
              alt: 'The engraved logo on the Ridge 28 clip',
            },
          ],
          proofs: [],
          regulated: null,
        },
        'ecommerce',
      ).spots,
    ).toHaveLength(1);
  });

  it('keeps a proof in its block’s own words, once and not inside another, its kind known', () => {
    const { proofs } = keptOf({
      spots: [],
      proofs: [
        { n: 3, claim: 'fully waterproof', kind: 'Certification' },
        { n: 3, claim: 'fully waterproof', kind: 'certification' },
        { n: 3, claim: 'waterproof', kind: 'certification' },
        { n: 6, claim: 'won the 2025 Outdoor Gear Award', kind: 'trophy' },
        // A block that links out keeps its proofs: the editor checks them off while it does.
        { n: 7, claim: 'says the team', kind: 'unknown' },
        { n: 2, claim: 'the lightest pack ever made', kind: 'ranking' },
      ],
      regulated: 'health',
    });
    expect(proofs.map((p) => [p.claim, p.kind])).toEqual([
      ['fully waterproof', 'certification'],
      ['won the 2025 Outdoor Gear Award', 'unknown'],
      ['says the team', 'unknown'],
    ]);
  });

  it('asks a shop or consumer page for no customer case unless the claim names one; regulated only for B2C and mobile apps', () => {
    const cases = {
      spots: [],
      proofs: [
        { n: 2, claim: 'We built the pack for long days outside', kind: 'customer_case' },
        { n: 1, claim: 'Made for day hikes', kind: 'customer_case' },
      ],
      regulated: 'health',
    };
    expect(keptOf(cases).proofs).toEqual([]);
    expect(keptOf(cases).regulated).toBeNull();
    expect(keptOf(cases, 'b2b').proofs).toHaveLength(2);
    expect(keptOf({ ...cases, regulated: ' Health ' }, 'b2c').regulated).toBe('health');
    expect(keptOf({ ...cases, regulated: 'finance' }, 'app').regulated).toBe('finance');
    expect(keptOf(cases, 'app').proofs).toEqual([]);
    const trusted = pageOutline(
      `${HTML}<p>Trusted by 400 hiking clubs across Europe and the US.</p>` +
        '<p>Trusted by Alpine Club Zermatt and their guides since 2019.</p>' +
        '<p>Müşterilerimiz arasında Doğa Kulübü ve Kaçkar Rehberleri var.</p>',
    );
    const kinds = (claim, n) =>
      keptPageRead(
        trusted,
        { spots: [], proofs: [{ n, claim, kind: 'customer case' }] },
        'b2c',
      ).proofs.map((p) => p.kind);
    // A count asks for its source; a named customer is a case on any page.
    expect(kinds('Trusted by 400 hiking clubs', 9)).toEqual(['number']);
    expect(kinds('Trusted by Alpine Club Zermatt', 10)).toEqual(['customer_case']);
    expect(kinds('Müşterilerimiz arasında Doğa Kulübü', 11)).toEqual(['customer_case']);
  });
});

describe('readPage', () => {
  it('holds the call on the meter it is given, for an agent run (AUTONOMOUS-GO-LIVE §6.2)', async () => {
    const meter = { charge: vi.fn(), release: vi.fn(), keep: vi.fn() };
    const reserve = vi.fn(async () => meter);
    await read({ reserve });
    expect(reserve).toHaveBeenCalledWith({ modelId: expect.any(String), holdUsd: PAGE_HOLD_USD });
    expect(reserves).toEqual([]);
    expect(meter.charge).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 80 });
  });

  it('reads the page in one call on the budget as quality, keeps it by its hash, and maps it to the page', async () => {
    const result = await read();
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(generateObject.mock.calls[0][0].system).toContain('not instructions to you');
    expect(reserves).toEqual([
      expect.objectContaining({ feature: 'quality', draftId: 'd1', holdUsd: PAGE_HOLD_USD }),
    ]);
    expect(charge).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 80 });
    expect(release).toHaveBeenCalled();
    expect(upserts[0].options).toEqual({ onConflict: 'draft_id' });
    expect(upserts[0].row).toMatchObject({ draft_id: 'd1', site_type: 'ecommerce', missed: false });
    expect(result).toMatchObject({
      pending: false,
      limited: false,
      paused: false,
      regulated: null,
    });
    expect(result.spots[0]).toEqual({
      passage: 'Made for day hikes in any weather',
      block: WEATHER,
      image: 'A photo of this Ridge 28 backpack on a real hike in the rain',
      alt: 'A hiker with the Ridge 28 on a wet trail',
    });
    expect(result.proofs.map((p) => p.block)).toEqual([SEAMS, AWARD]);
  });

  it('reads with Claude Haiku with an Anthropic key, in a schema Claude takes, and keeps its id', async () => {
    vi.stubEnv('QUALITY_CHECK_MODEL', '');
    vi.stubEnv('CONTENT_READ_MODEL', '');
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-key');
    await read();
    const [call] = generateObject.mock.calls[0];
    expect(call.model).toEqual({ id: 'anthropic/claude-haiku-5-5' });
    expect(call.maxOutputTokens).toBe(16_000);
    expect(call.providerOptions).toEqual({ anthropic: { structuredOutputMode: 'outputFormat' } });
    for (const key of ['temperature', 'topP', 'topK']) expect(call).not.toHaveProperty(key);
    const schema = call.schema.jsonSchema;
    expect(JSON.stringify(schema)).not.toMatch(/"(\$schema|minimum|maximum|maxItems|oneOf)"/);
    // A check's quote or none: a closed object, or null.
    expect(schema.properties.balance.anyOf).toEqual([
      expect.objectContaining({ type: 'object', additionalProperties: false }),
      { type: 'null' },
    ]);
    expect(upserts[0].row.model).toBe('anthropic/claude-haiku-5-5');
  });

  it('reads nothing for a short page, an unchanged one, or within the minute', async () => {
    expect(
      await read({ html: '<h1>Short</h1><p>Only a few words on this page.</p>' }),
    ).toMatchObject({
      spots: [],
      proofs: [],
    });
    expect(generateObject).not.toHaveBeenCalled();
    await read();
    const row = upserts[0].row;
    generateObject.mockClear();
    kept = { ...row, read_at: new Date(NOW - 3_600_000).toISOString() };
    expect((await read()).spots).toHaveLength(2);
    expect(generateObject).not.toHaveBeenCalled();
    // Changed within the minute: the kept read, its changed paragraph's items gone.
    kept = { ...row, read_at: new Date(NOW - 30_000).toISOString() };
    const changed = await read({ html: HTML.replace(WEATHER, 'Made for long weekends.') });
    expect(generateObject).not.toHaveBeenCalled();
    expect(changed.pending).toBe(true);
    expect(changed.spots.map((s) => s.passage)).toEqual(['fully waterproof, with welded seams']);
  });

  it('reads no more once the day’s page reads are made, nor with the budget spent', async () => {
    readsToday = QUALITY_CALLS_PER_DAY - SOURCE_READS_PER_DAY;
    expect(await read()).toMatchObject({ limited: true });
    expect(generateObject).not.toHaveBeenCalled();
    readsToday = 0;
    reserveError = new PlanLimitError('used up', 429);
    expect(await read()).toMatchObject({ paused: true, spots: [] });
  });

  it('counts the day’s page reads on the row, PAGE_READS_PER_DAY at most', async () => {
    await read();
    expect(upserts[0].row).toMatchObject({
      day_reads: 1,
      day_started_at: new Date(NOW).toISOString(),
    });
    const old = { ...upserts[0].row, page_hash: '0000000000000000' };
    const dayStart = new Date(NOW - 3_600_000).toISOString();
    kept = {
      ...old,
      read_at: dayStart,
      day_reads: PAGE_READS_PER_DAY - 1,
      day_started_at: dayStart,
    };
    await read();
    expect(upserts[1].row).toMatchObject({
      day_reads: PAGE_READS_PER_DAY,
      day_started_at: dayStart,
    });
    kept = { ...kept, day_reads: PAGE_READS_PER_DAY };
    // The page as it was read: the kept items, limited.
    expect(await read()).toMatchObject({ limited: true, spots: expect.any(Array) });
    expect(generateObject).toHaveBeenCalledTimes(2);
    // A new day.
    kept = { ...kept, day_started_at: new Date(NOW - 25 * 3_600_000).toISOString() };
    await read();
    expect(upserts[2].row).toMatchObject({
      day_reads: 1,
      day_started_at: new Date(NOW).toISOString(),
    });
  });

  it('reads once for two asks at once, each mapped to its own page, the older one pending', async () => {
    let answerNow;
    generateObject.mockReturnValueOnce(new Promise((resolve) => (answerNow = resolve)));
    const first = read();
    const newer = read({ html: HTML.replace(WEATHER, 'Made for long weekends in the hills.') });
    await vi.waitFor(() => expect(answerNow).toBeDefined());
    answerNow(answer());
    const [a, b] = await Promise.all([first, newer]);
    expect(generateObject).toHaveBeenCalledTimes(1);
    expect(a).toMatchObject({ pending: false });
    expect(a.spots).toHaveLength(2);
    // The read was of the page before: its changed paragraph's spot gone, asked again.
    expect(b.pending).toBe(true);
    expect(b.spots.map((s) => s.passage)).toEqual(['fully waterproof, with welded seams']);
  });

  it('keeps a missed read for a day, and maps a kept read when the budget is spent', async () => {
    await read();
    const row = upserts[0].row;
    generateObject.mockClear();
    kept = {
      ...row,
      page_hash: row.page_hash,
      missed: true,
      read_at: new Date(NOW - 3_600_000).toISOString(),
    };
    await read();
    expect(generateObject).not.toHaveBeenCalled();
    kept = {
      ...row,
      page_hash: '0000000000000000',
      read_at: new Date(NOW - 3_600_000).toISOString(),
    };
    reserveError = new PlanLimitError('used up', 429);
    const paused = await read();
    expect(paused.paused).toBe(true);
    expect(paused.spots).toHaveLength(2);
    expect(paused.proofs.map((p) => p.kind)).toEqual(['certification', 'award']);
  });

  it('reads nothing new when a link put on a claim only adds a space at its edge', async () => {
    await read();
    const row = upserts[0].row;
    generateObject.mockClear();
    kept = { ...row, read_at: new Date(NOW - 30_000).toISOString() };
    const linked = HTML.replace(
      'and a roll-top.',
      'and a <a href="https://trailmade.example/tests">roll</a>-top.',
    );
    expect(pageOutline(linked).find((b) => b.text?.startsWith('Every Ridge'))?.text).toBe(
      'Every Ridge 28 is fully waterproof, with welded seams and a roll -top.',
    );
    const result = await read({ html: linked });
    expect(generateObject).not.toHaveBeenCalled();
    expect(result.pending).toBe(false);
    // The kept proof, on the block as the page has it now.
    expect(result.proofs[0]).toEqual({
      claim: 'fully waterproof',
      block: 'Every Ridge 28 is fully waterproof, with welded seams and a roll -top.',
      kind: 'certification',
    });
  });

  it('reads a kept read for the business as it is now', async () => {
    const block = pageOutline(HTML).find((i) => i.text === SEAMS);
    kept = {
      page_hash: '0000000000000000',
      spots: [],
      proofs: [
        { claim: 'fully waterproof', block_hash: block.hash, kind: 'customer_case' },
        { claim: 'Ridge 28', block_hash: block.hash, kind: 'award' },
      ],
      regulated: 'health',
      missed: false,
      read_at: new Date(NOW - 30_000).toISOString(),
    };
    // Read as B2B, the brand a shop now: no customer case, nothing regulated.
    const now = await read();
    expect(now.pending).toBe(true);
    expect(now.proofs).toEqual([{ claim: 'Ridge 28', block: SEAMS, kind: 'award' }]);
    expect(now.regulated).toBeNull();
    expect((await read({ siteType: 'b2c' })).regulated).toBe('health');
  });

  it('charges an answer that missed the schema and keeps it as missed, read again after a day; a timeout keeps its hold', async () => {
    generateObject.mockRejectedValueOnce(
      new NoObjectGeneratedError({
        message: 'no object',
        text: '{}',
        response: {},
        usage: { inputTokens: 900, outputTokens: 2 },
        finishReason: 'stop',
      }),
    );
    expect(await read()).toMatchObject({ spots: [], proofs: [] });
    expect(charge).toHaveBeenCalledWith({ inputTokens: 900, outputTokens: 2 });
    expect(upserts[0].row).toMatchObject({ missed: true, spots: [], proofs: [] });
    kept = { ...upserts[0].row, read_at: new Date(NOW - 2 * 86_400_000).toISOString() };
    await read();
    expect(generateObject).toHaveBeenCalledTimes(2);

    kept = null;
    generateObject.mockRejectedValueOnce(
      Object.assign(new Error('slow'), { name: 'TimeoutError' }),
    );
    await expect(read()).rejects.toThrow('slow');
    expect(keep).toHaveBeenCalled();
  });
});

describe('page checks (CE-050)', () => {
  const FIRST =
    'For wet hikes, the best daypack is the Trailmade Ridge 28, because its welded seams keep water out.';
  const PICK =
    'Our top pick is the Trailmade Ridge 28, ahead of the Osprey Talon and the Deuter Speed Lite.';
  const DISCLOSE = 'Disclosure: Trailmade makes the Ridge 28, so weigh our pick with that in mind.';
  const LIMIT =
    'The Ridge 28 has no hip-belt pockets, so the Osprey Talon is the better pick for long runs.';
  const HOW = 'We hiked 120 km in the rain with each pack and weighed every one on the same scale.';
  const PAGE =
    `<h1>The best daypacks for wet hikes</h1><p>${FIRST}</p><h2>Our pick</h2><p>${PICK}</p>` +
    `<p>${DISCLOSE}</p><p>${LIMIT}</p><h2>How we tested</h2><p>${HOW}</p>${filler('pack')}`;
  const checksAnswer = (over = {}) => ({
    spots: [],
    proofs: [],
    regulated: null,
    answer_first: 'yes',
    recommends: { n: 2, quote: 'Our top pick is the Trailmade Ridge 28' },
    disclosure: { n: 3, quote: 'Trailmade makes the Ridge 28' },
    balance: { n: 4, quote: 'the Osprey Talon is the better pick for long runs' },
    how: { n: 5, quote: 'We hiked 120 km in the rain with each pack' },
    ...over,
  });
  const outline = pageOutline(PAGE);
  const hashOf = (text) => outline.find((item) => item.text === text).hash;
  const keptChecks = (answerOver = {}, options = {}) =>
    keptPageRead(outline, checksAnswer(answerOver), 'ecommerce', {
      pageType: 'best_of',
      brandName: 'Trailmade',
      ...options,
    }).checks;

  it('keeps each check in its paragraph’s own words, by the paragraph’s hash', () => {
    expect(keptChecks()).toEqual({
      answerFirst: { block_hash: hashOf(FIRST), answers: true },
      recommends: { quote: 'Our top pick is the Trailmade Ridge 28', block_hash: hashOf(PICK) },
      disclosure: { quote: 'Trailmade makes the Ridge 28', block_hash: hashOf(DISCLOSE) },
      balance: {
        quote: 'the Osprey Talon is the better pick for long runs',
        block_hash: hashOf(LIMIT),
      },
      how: { quote: 'We hiked 120 km in the rain with each pack', block_hash: hashOf(HOW) },
      cut: false,
    });
    // The verdict is the answer's first word, however it's written.
    for (const said of ['No', 'No.', 'no, it opens with a story']) {
      expect(keptChecks({ answer_first: said }).answerFirst).toEqual({
        block_hash: hashOf(FIRST),
        answers: false,
      });
    }
    expect(keptChecks({ answer_first: 'Yes.' }).answerFirst).toMatchObject({ answers: true });
  });

  it('reads the brand by its whole name, in the quote or its sentence', () => {
    // A short name inside another word ("Ace" in "workspace") isn't the brand.
    const ace = pageOutline(
      `<h1>Best note apps</h1><p>${FIRST}</p><p>Our pick is Notion, the best workspace to replace your notes app.</p>${filler('app')}`,
    );
    const pick = { n: 2, quote: 'Our pick is Notion, the best workspace' };
    expect(
      keptPageRead(ace, checksAnswer({ recommends: pick }), 'b2b', {
        pageType: 'best_of',
        brandName: 'Ace',
      }).checks.recommends,
    ).toBeNull();
    // Another sentence of its block naming the brand doesn't make the pick the brand's.
    const other = pageOutline(
      `<h1>Best note apps</h1><p>${FIRST}</p><p>Trailmade makes packs. Our pick is Notion, the best workspace.</p>${filler('app')}`,
    );
    expect(
      keptPageRead(other, checksAnswer({ recommends: pick }), 'b2b', {
        pageType: 'best_of',
        brandName: 'Trailmade',
      }).checks.recommends,
    ).toBeNull();
  });

  it('reads past a byline or a date under the H1, and says when the page was cut', () => {
    const bylined = pageOutline(
      `<h1>The best daypacks for wet hikes</h1><p>By Jane Doe · October 2026</p><p>${FIRST}</p>${filler('pack')}`,
    );
    const firstHash = bylined.find((item) => item.text === FIRST).hash;
    expect(
      keptPageRead(bylined, checksAnswer({ recommends: null }), 'ecommerce', {
        pageType: 'best_of',
        brandName: 'Trailmade',
      }).checks,
    ).toMatchObject({ answerFirst: { block_hash: firstHash }, cut: false });
    expect(
      buildPagePrompt({
        outline: bylined,
        siteType: 'ecommerce',
        pageType: 'best_of',
        brandName: 'Trailmade',
      }),
    ).toContain('First paragraph after the H1: [2]');
    // A short answer is a sentence: it's the first paragraph.
    const short = pageOutline(
      `<h1>What is a daypack?</h1><p>A small pack for one day.</p>${filler('pack')}`,
    );
    expect(
      buildPagePrompt({
        outline: short,
        siteType: 'ecommerce',
        pageType: 'guide',
        brandName: 'Trailmade',
      }),
    ).toContain('First paragraph after the H1: [1]');
    const long = pageOutline(
      `${PAGE}${Array.from({ length: 60 }, (_, i) => filler(`shell ${i}`)).join('')}`,
    );
    expect(
      keptPageRead(long, checksAnswer(), 'ecommerce', {
        pageType: 'best_of',
        brandName: 'Trailmade',
      }).checks.cut,
    ).toBe(true);
  });

  it('reads the brand put forward only on a page that chooses, with the brand named; its disclosure only then', () => {
    // A product page describes the brand's own thing: nothing put forward, no disclosure asked.
    expect(keptChecks({}, { pageType: 'product_page' })).toMatchObject({
      recommends: null,
      disclosure: null,
      balance: null,
      how: { block_hash: hashOf(HOW) },
    });
    // Another brand's name: not the brand's own pick. Balance still counts on a best-of list.
    expect(keptChecks({}, { brandName: 'Northwind' })).toMatchObject({
      recommends: null,
      disclosure: null,
      balance: { block_hash: hashOf(LIMIT) },
    });
    // A page type not set is read.
    expect(keptChecks({}, { pageType: null }).recommends).toMatchObject({
      block_hash: hashOf(PICK),
    });
  });

  it('drops a quote not on the page, an unclear answer, and answer first under a list', () => {
    expect(
      keptChecks({
        answer_first: 'unclear',
        how: { n: 5, quote: 'We tested every pack for a year' },
        balance: { n: 9, quote: 'the Osprey Talon is the better pick for long runs' },
      }),
    ).toMatchObject({ answerFirst: null, how: null, balance: null });
    const listed = pageOutline(`<h1>Packs</h1><ul><li>${FIRST}</li></ul><p>${HOW}</p>`);
    expect(
      keptPageRead(listed, checksAnswer({ recommends: null }), 'ecommerce', {
        pageType: 'best_of',
        brandName: 'Trailmade',
      }).checks.answerFirst,
    ).toBeNull();
  });

  it('names the first paragraph after the H1 for the model, or none', () => {
    const prompt = buildPagePrompt({
      outline,
      siteType: 'ecommerce',
      pageType: 'best_of',
      brandName: 'Trailmade',
    });
    expect(prompt).toContain('First paragraph after the H1: [1]');
    expect(
      buildPagePrompt({
        outline: pageOutline(`<h1>Packs</h1><h2>Why</h2><p>${HOW}</p>`),
        siteType: 'ecommerce',
        pageType: 'best_of',
        brandName: 'Trailmade',
      }),
    ).toContain('First paragraph after the H1: none');
  });

  it('keeps the checks on the row, maps them to the page, and drops one whose paragraph changed', async () => {
    generateObject.mockResolvedValue({
      object: checksAnswer(),
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    const result = await read({ html: PAGE, pageType: 'best_of' });
    expect(upserts[0].row.checks).toEqual(keptChecks());
    expect(result.checks).toEqual({
      answerFirst: { answers: true, block: FIRST },
      recommends: { quote: 'Our top pick is the Trailmade Ridge 28', block: PICK },
      disclosure: { quote: 'Trailmade makes the Ridge 28', block: DISCLOSE },
      balance: { quote: 'the Osprey Talon is the better pick for long runs', block: LIMIT },
      how: { quote: 'We hiked 120 km in the rain with each pack', block: HOW },
      cut: false,
      pageType: 'best_of',
    });

    // Within the minute the kept read stands: a paragraph put before the first one,
    // and the limit reworded.
    kept = upserts[0].row;
    const changed = PAGE.replace(
      `<p>${FIRST}</p>`,
      `<p>Rain finds every seam, and every pack on the trail leaks in the end.</p><p>${FIRST}</p>`,
    ).replace(LIMIT, 'The Ridge 28 has no hip-belt pockets.');
    const again = await read({ html: changed, pageType: 'best_of', now: NOW + 1000 });
    expect(again.pending).toBe(true);
    expect(again.checks).toMatchObject({
      answerFirst: null,
      balance: null,
      recommends: { block: PICK },
    });
  });

  it('reads a kept read for the page type as it is now, and reads again for a new brand name', async () => {
    generateObject.mockResolvedValue({
      object: checksAnswer(),
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    await read({ html: PAGE, pageType: 'best_of' });
    kept = upserts[0].row;
    // A product page within the minute: nothing put forward, no disclosure asked.
    const asProduct = await read({ html: PAGE, pageType: 'product_page', now: NOW + 1000 });
    expect(asProduct.pending).toBe(true);
    expect(asProduct.checks).toMatchObject({
      recommends: null,
      disclosure: null,
      balance: null,
      // Read for a best-of list: the editor waits for a read as a product page.
      pageType: 'best_of',
    });
    expect(
      pageHash({ outline, siteType: 'ecommerce', pageType: 'best_of', brandName: 'Trailmade' }),
    ).not.toBe(
      pageHash({
        outline,
        siteType: 'ecommerce',
        pageType: 'best_of',
        brandName: 'Trailmade Gear',
      }),
    );
  });

  it('has no checks for a short page, a missed read, or a read from before them', async () => {
    expect(
      (await read({ html: '<h1>Short</h1><p>Only a few words on this page.</p>' })).checks,
    ).toBeNull();
    // The page as read, kept: an unchanged page isn't read again.
    const keptRow = {
      page_hash: pageHash({
        outline,
        siteType: 'ecommerce',
        pageType: 'best_of',
        brandName: 'Trailmade',
      }),
      spots: [],
      proofs: [],
      regulated: null,
      missed: false,
      read_at: new Date(NOW).toISOString(),
      day_reads: 1,
      day_started_at: new Date(NOW).toISOString(),
    };
    kept = { ...keptRow, checks: undefined };
    expect((await read({ html: PAGE, pageType: 'best_of', now: NOW + 1000 })).checks).toBeNull();
    kept = { ...keptRow, missed: true, checks: keptChecks() };
    expect((await read({ html: PAGE, pageType: 'best_of', now: NOW + 1000 })).checks).toBeNull();
  });
});
