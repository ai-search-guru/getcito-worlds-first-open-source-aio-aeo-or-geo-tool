import { describe, expect, it } from 'vitest';
import type { ContentAuthor } from './authors';
import type { PageProof } from './pageRead';
import { eeat, trust, trustBlocks } from './qualityChecks';
import { PROFILE_WEIGHTS, checksOff, weighed, weighedTrust } from './qualityProfiles';
import { caseConfirmed, caseKey, proofKey, qualityTodos } from './qualityTodos';

/** Your to-dos (Quality spec §4, CE-040): only what the person can do, read from the checks. */

const author = (over: Partial<ContentAuthor> = {}): ContentAuthor => ({
  id: 'a1',
  name: 'Ada Lovelace',
  title: null,
  bio: 'Writes about forecasting.',
  photoUrl: null,
  sameAs: ['https://www.linkedin.com/in/ada'],
  userId: null,
  createdBy: null,
  defaultFor: [],
  pages: null,
  ...over,
});
const todos = (a: ContentAuthor | null, hasAuthors = true, canEdit = true) =>
  qualityTodos({ eeat: eeat({ author: a }), author: a, hasAuthors, canEdit });

describe('qualityTodos', () => {
  it("asks to pick the page's author, with the byline's gain, and lists the profile after it", () => {
    expect(todos(null)).toEqual([
      { id: 'byline', done: false, gain: 60, score: 'eeat', action: 'pickAuthor' },
      { id: 'authorProfile', done: false, gain: 40, score: 'eeat', action: null },
    ]);
  });

  it('asks for no author on a page type that goes out under the brand (CE-052)', () => {
    const product = qualityTodos({
      eeat: weighed(
        eeat({ author: null, used: { experience: false, data: false } }),
        PROFILE_WEIGHTS.product.eeat,
      ),
      author: null,
      hasAuthors: true,
      used: { experience: false, data: false, quote: false },
      off: checksOff('product'),
    });
    // Experience and data are half its live E-E-A-T each.
    expect(product.map((t) => [t.id, t.gain])).toEqual([
      ['experience', 50],
      ['originalData', 50],
    ]);
  });

  it('asks a product page to say how shipping and returns work: only the person knows (CE-052)', () => {
    const base = {
      eeat: weighed(
        eeat({ author: null, used: { experience: true, data: true } }),
        PROFILE_WEIGHTS.product.eeat,
      ),
      author: null,
      hasAuthors: true,
    };
    const ships = (shipping: boolean, returns: boolean) =>
      qualityTodos({ ...base, shipping: { shipping, returns }, off: checksOff('product') }).find(
        (t) => t.id === 'shippingReturns',
      );
    expect(ships(true, false)).toMatchObject({ done: false, score: 'trust', action: null });
    expect(ships(true, true)).toMatchObject({ done: true, gain: 0 });
    // With Trust scored, its gain is the check's share.
    const scored = weighedTrust(
      trust({
        blocks: trustBlocks('<p>Win rates rose 42% last year.</p>'),
        links: new Map(),
        brandDomains: ['acme.com'],
        shipping: { shipping: true, returns: false },
        now: Date.parse('2026-10-25'),
      }),
      PROFILE_WEIGHTS.product.trust,
    );
    expect(
      qualityTodos({
        ...base,
        trust: scored,
        shipping: { shipping: true, returns: false },
        off: checksOff('product'),
      }).find((t) => t.id === 'shippingReturns')!.gain,
    ).toBeGreaterThan(0);
    // Before E-E-A-T is read, the type's checks are left out all the same.
    expect(
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        shipping: { shipping: false, returns: false },
        off: checksOff('feature'),
      }),
    ).toEqual([]);
    // Another type doesn't ask.
    expect(
      qualityTodos({
        ...base,
        shipping: { shipping: false, returns: false },
        off: checksOff('feature'),
      }).some((t) => t.id === 'shippingReturns'),
    ).toBe(false);
  });

  it('asks a comparison to show when it was last checked, with Add line where it has one (CE-052)', () => {
    const run = (checkDate: {
      found: boolean;
      old?: 'line' | 'text' | null;
      line: string | null;
    }) =>
      qualityTodos({
        eeat: weighed(
          eeat({ author: author(), checkDate: checkDate.found }),
          PROFILE_WEIGHTS.comparison.eeat,
        ),
        author: author(),
        hasAuthors: true,
        checkDate,
        off: checksOff('comparison'),
      }).find((t) => t.id === 'checkDate');
    expect(run({ found: false, line: 'Last checked: October 2026.' })).toMatchObject({
      done: false,
      action: 'addCheckDate',
      score: 'eeat',
    });
    expect(run({ found: false, line: 'x' })!.gain).toBeGreaterThan(0);
    // A language without a line: the person writes it.
    expect(run({ found: false, line: null })!.action).toBeNull();
    expect(run({ found: true, line: 'x' })).toMatchObject({ done: true, action: null, gain: 0 });
    // An old date: Add line's own line (it replaces it) or the person's words (#1495 review).
    expect(run({ found: false, old: 'line', line: 'x' })).toMatchObject({ old: 'line' });
    expect(run({ found: false, old: 'text', line: 'x' })).toMatchObject({ old: 'text' });
    expect(run({ found: true, old: null, line: 'x' })).not.toHaveProperty('old');
  });

  it('asks to confirm a customer case may be published, not to link it, in Phase 3 (CE-052)', () => {
    const ask = (linked: boolean, kind: 'customer_case' | 'award' = 'customer_case') => ({
      claim: 'Acme cut close time 40%',
      block: 'Acme cut close time 40% with Ledgerly.',
      kind,
      sentence: 'Acme cut close time 40% with Ledgerly.',
      linked,
    });
    const run = (
      a: ReturnType<typeof ask>,
      cases: ReadonlySet<string> | null,
      had: string[] = [],
    ) =>
      qualityTodos({
        eeat: weighed(
          eeat({
            author: null,
            cases: { total: 1, confirmed: cases?.has(caseKey(a)) ? 1 : 0 },
          }),
          PROFILE_WEIGHTS.feature.eeat,
        ),
        author: null,
        hasAuthors: true,
        proofs: { asks: [a], had: new Set(had) },
        cases,
        off: checksOff('feature'),
      }).find((t) => t.id === 'proof');
    // Linked isn't enough: only the person knows they may name the customer.
    expect(run(ask(true), new Set())).toMatchObject({
      done: false,
      action: 'confirmCase',
      score: 'eeat',
      key: caseKey(ask(true)),
    });
    expect(run(ask(true), new Set())!.gain).toBeGreaterThan(0);
    expect(run(ask(false), new Set([caseKey(ask(false))]), [caseKey(ask(false))])).toMatchObject({
      done: true,
      gain: 0,
    });
    // Keyed by the claim alone: a typo fixed in its paragraph keeps the confirm.
    expect(caseKey({ claim: 'Acme cut close time 40%' })).toBe(
      caseKey({ claim: 'Acme  cut close time 40% ' }),
    );
    // Before Phase 3 (or before they're read): the link, on Trust, as before.
    expect(run(ask(false), null)).toMatchObject({ action: 'addProof', score: 'trust' });
    // Another kind of proof stays a link in Phase 3.
    expect(run(ask(false, 'award'), new Set())).toMatchObject({
      action: 'addProof',
      score: 'trust',
    });
  });

  it('keeps a case confirmed when the next read picks other words of its sentence (#1496 review)', () => {
    const sentence = 'Acme cut its close time by 40% with Ledgerly in one quarter.';
    const shorter = { claim: 'Acme cut its close time', sentence };
    const longer = { claim: 'Acme cut its close time by 40%', sentence };
    // Confirmed on one slice, read again as the other: still confirmed, no second row.
    expect(caseConfirmed(new Set([caseKey(shorter)]), longer)).toBe(true);
    expect(caseConfirmed(new Set([caseKey(longer)]), shorter)).toBe(true);
    // Another case, or a name alone, isn't this one.
    const other = {
      claim: 'Brightline doubled its pipeline',
      sentence: 'Brightline doubled its pipeline.',
    };
    expect(caseConfirmed(new Set([caseKey(shorter)]), other)).toBe(false);
    expect(caseConfirmed(new Set(['case:acme']), longer)).toBe(false);
    // A confirm of another kind doesn't count.
    expect(caseConfirmed(new Set([`intro:${caseKey(longer).slice(5)}`]), longer)).toBe(false);
  });

  it('says linking a confirmed case still raises Trust (#1496 review)', () => {
    const sentence = 'Acme cut its close time by 40% with Ledgerly.';
    const read = trust({
      blocks: trustBlocks(`<p>${sentence}</p>`),
      links: new Map(),
      brandDomains: ['ledgerly.com'],
      now: Date.parse('2026-10-25'),
    });
    const ask = {
      claim: 'Acme cut its close time by 40%',
      block: sentence,
      kind: 'customer_case' as const,
      sentence,
      linked: false,
    };
    const row = qualityTodos({
      eeat: null,
      trust: read,
      author: null,
      hasAuthors: true,
      proofs: { asks: [ask], had: new Set([caseKey(ask)]) },
      cases: new Set([caseKey(ask)]),
      off: checksOff('feature'),
    }).find((t) => t.id === 'proof')!;
    expect(row).toMatchObject({ done: true, action: 'confirmCase' });
    expect(row.trustGain).toBeGreaterThan(0);
  });

  it('asks to confirm a category intro’s counts and prices, all at once (CE-054)', () => {
    const facts = [
      { sentence: 'Choose from 120+ daypacks.', facts: ['120+'] },
      { sentence: 'Prices run $49–$199.', facts: ['USD49-199'] },
    ];
    const read = trust({
      blocks: trustBlocks('<p>Choose from 120+ daypacks.</p><p>Prices run $49–$199.</p>'),
      links: new Map(),
      brandDomains: ['acme.com'],
      intro: { total: 2, confirmed: 1 },
      now: Date.parse('2026-10-25'),
    });
    const run = (confirmed: string[]) =>
      qualityTodos({
        eeat: null,
        trust: weighedTrust(read, PROFILE_WEIGHTS.category.trust),
        author: null,
        hasAuthors: true,
        intro: { facts, confirmed: new Set(confirmed) },
        off: checksOff('category'),
      }).find((t) => t.id === 'introFacts');
    expect(run(['120+'])).toMatchObject({
      done: false,
      action: 'confirmIntro',
      score: 'trust',
      count: 1,
      facts: ['Prices run $49–$199.'],
    });
    expect(run(['120+'])!.gain).toBeGreaterThan(0);
    expect(run(['120+', 'USD49-199'])).toMatchObject({
      done: true,
      action: null,
      gain: 0,
      count: 0,
    });
    // No facts in the intro: no to-do.
    expect(
      qualityTodos({
        eeat: null,
        trust: null,
        author: null,
        hasAuthors: true,
        intro: { facts: [], confirmed: new Set() },
      }).some((t) => t.id === 'introFacts'),
    ).toBe(false);
  });

  it('asks to add an author when the workspace has none', () => {
    expect(todos(null, false)[0]).toEqual({
      id: 'byline',
      done: false,
      gain: 60,
      score: 'eeat',
      action: 'addAuthor',
    });
  });

  it("keeps the byline done, then asks to complete the author's profile", () => {
    expect(todos(author({ bio: null, sameAs: [] }))).toEqual([
      { id: 'byline', done: true, gain: 0, score: 'eeat', action: 'pickAuthor' },
      { id: 'authorProfile', done: false, gain: 40, score: 'eeat', action: 'editAuthor' },
    ]);
    expect(todos(author({ sameAs: [] }))[1]).toEqual({
      id: 'authorProfile',
      done: false,
      gain: 20,
      score: 'eeat',
      action: 'editAuthor',
    });
  });

  it('checks both off for an author with a bio and profile links', () => {
    expect(todos(author()).map((t) => [t.id, t.done, t.gain])).toEqual([
      ['byline', true, 0],
      ['authorProfile', true, 0],
    ]);
  });

  it('offers Edit author only to who can edit the author', () => {
    expect(todos(author({ bio: null }), true, false)[1]).toMatchObject({
      id: 'authorProfile',
      action: null,
    });
  });

  it('has none before E-E-A-T is read', () => {
    expect(qualityTodos({ eeat: null, author: null, hasAuthors: true })).toEqual([]);
  });

  it('asks to fill the placeholders first, and keeps it checked once filled (CE-044)', () => {
    const fill = (count: number) => ({
      id: 'placeholders',
      done: count === 0,
      gain: 0,
      score: 'eeat',
      action: 'showPlaceholder',
      count,
    });
    expect(
      qualityTodos({
        eeat: eeat({ author: null }),
        author: null,
        hasAuthors: true,
        placeholders: { count: 2, had: true },
      }),
    ).toEqual([
      fill(2),
      expect.objectContaining({ id: 'byline' }),
      expect.objectContaining({ id: 'authorProfile' }),
    ]);
    // Before the authors are read, the placeholders still are.
    expect(
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        placeholders: { count: 2, had: true },
      }),
    ).toEqual([fill(2)]);
    expect(
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        placeholders: { count: 0, had: true },
      }),
    ).toEqual([fill(0)]);
    // A page that never had any: no row.
    expect(
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        placeholders: { count: 0, had: false },
      }),
    ).toEqual([]);
  });

  it('asks for what only the person can give, once Your input is read (CE-048)', () => {
    const none = { experience: false, data: false, quote: false };
    const quoted = trust({
      blocks: [{ tag: 'p', text: 'Sales grew 40% in 2025.', links: [] }],
      links: new Map(),
      brandDomains: [],
      quote: false,
      now: Date.parse('2026-10-24'),
    });
    const read = (
      used: typeof none,
      given: typeof none | null = null,
      trustScore: typeof quoted | null = quoted,
    ) =>
      qualityTodos({
        eeat: eeat({ author: author(), used }),
        author: author(),
        hasAuthors: true,
        used,
        given,
        trust: trustScore,
      }).slice(2);
    expect(read(none)).toEqual([
      { id: 'experience', done: false, given: false, gain: 33, score: 'eeat', action: 'addInput' },
      {
        id: 'originalData',
        done: false,
        given: false,
        gain: 25,
        score: 'eeat',
        action: 'addInput',
      },
      {
        id: 'expertQuote',
        done: false,
        given: false,
        gain: 21,
        score: 'trust',
        action: 'addInput',
      },
    ]);
    // Given in Your input, the page not using it yet: still to do, said so.
    expect(read(none, { experience: true, data: false, quote: true }).map((t) => t.given)).toEqual([
      true,
      false,
      true,
    ]);
    // Used: checked off, with no gain left.
    expect(
      read(
        { experience: true, data: true, quote: true },
        { experience: true, data: true, quote: true },
      ),
    ).toEqual([
      expect.objectContaining({ id: 'experience', done: true, given: false, gain: 0 }),
      expect.objectContaining({ id: 'originalData', done: true, given: false, gain: 0 }),
      expect.objectContaining({ id: 'expertQuote', done: true, given: false, gain: 0 }),
    ]);
    // Trust not scored yet: a quote's gain isn't made up.
    expect(read(none, null, null)[2]).toMatchObject({ id: 'expertQuote', gain: 0 });
  });

  it('has no input to-dos before Your input is read', () => {
    expect(todos(author()).map((t) => t.id)).toEqual(['byline', 'authorProfile']);
  });

  it('asks to approve the brand facts read from its site, and keeps it checked once done (CE-047)', () => {
    const facts = (pending: number, had: boolean) =>
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        brandFacts: { pending, had },
      });
    expect(facts(3, true)).toEqual([
      {
        id: 'brandFacts',
        done: false,
        gain: 0,
        score: 'trust',
        action: 'reviewBrandFacts',
        count: 3,
      },
    ]);
    expect(facts(0, true)).toEqual([expect.objectContaining({ id: 'brandFacts', done: true })]);
    expect(facts(0, false)).toEqual([]);
    expect(qualityTodos({ eeat: null, author: null, hasAuthors: true })).toEqual([]);
  });

  it("asks for the proof of the page's own claims, at most five open, and keeps one checked once linked (CE-049)", () => {
    const NOW = Date.parse('2026-10-24');
    const proof = (claim: string, linked = false): PageProof => ({
      claim,
      block: `Ledgerly is ${claim}.`,
      kind: 'award',
      sentence: `Ledgerly is ${claim}.`,
      linked,
    });
    const trustScore = trust({
      blocks: trustBlocks('<p>Ledgerly is 40% faster.</p><p>Sales grew 3x in 2025.</p>'),
      links: new Map(),
      brandDomains: [],
      now: NOW,
    });
    const read = (asks: PageProof[], had: string[] = []) =>
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        trust: trustScore,
        proofs: { asks, had: new Set(had) },
        brandFacts: { pending: 1, had: true },
      });
    const [first] = read([proof('40% faster')]);
    expect(first).toEqual({
      id: 'proof',
      key: proofKey(proof('40% faster')),
      done: false,
      // Its sentence is one of Trust's two unsourced figures.
      gain: expect.any(Number),
      score: 'trust',
      action: 'addProof',
      proof: {
        claim: '40% faster',
        block: 'Ledgerly is 40% faster.',
        kind: 'award',
        sentence: 'Ledgerly is 40% faster.',
      },
    });
    expect(first.gain).toBeGreaterThan(0);
    // A claim Trust doesn't count: no gain made up. The brand facts stay last.
    expect(read([proof('award-winning')]).map((t) => [t.id, t.gain])).toEqual([
      ['proof', 0],
      ['brandFacts', 0],
    ]);
    // Linked before it was asked for: no to-do. Linked after: checked.
    expect(read([proof('award-winning', true)]).map((t) => t.id)).toEqual(['brandFacts']);
    expect(
      read([proof('award-winning', true)], [proofKey(proof('award-winning'))])[0],
    ).toMatchObject({ id: 'proof', done: true, gain: 0 });
    // Five open at once, in the page's order; a checked one doesn't count.
    const many = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => proof(`claim ${c}`));
    const open = read([proof('done', true), ...many], [proofKey(proof('done'))]);
    expect(open.filter((t) => t.id === 'proof').map((t) => t.proof!.claim)).toEqual([
      'done',
      'claim a',
      'claim b',
      'claim c',
      'claim d',
      'claim e',
    ]);
  });

  it("lists the proof to-dos after the person's input and before the brand facts", () => {
    const none = { experience: false, data: false, quote: false };
    const ids = qualityTodos({
      eeat: eeat({ author: author(), used: none }),
      author: author(),
      hasAuthors: true,
      used: none,
      given: null,
      proofs: {
        asks: [
          {
            claim: 'award-winning',
            block: 'We are award-winning.',
            kind: 'award',
            sentence: 'We are award-winning.',
            linked: false,
          },
        ],
        had: new Set(),
      },
      brandFacts: { pending: 2, had: true },
    }).map((t) => t.id);
    expect(ids).toEqual([
      'byline',
      'authorProfile',
      'experience',
      'originalData',
      'expertQuote',
      'proof',
      'brandFacts',
    ]);
  });

  it("asks to confirm the page's own image, or to add one where a spot is open (CE-049)", () => {
    const none = { experience: false, data: false, quote: false };
    const visualTodo = (images: number, own: number, openSpots: number) =>
      qualityTodos({
        eeat: eeat({ author: author(), used: none, visual: { images, own, openSpots } }),
        author: author(),
        hasAuthors: true,
        used: none,
        visual: { images, own, openSpots },
      }).find((t) => t.id === 'visualProof');
    expect(visualTodo(2, 0, 0)).toMatchObject({
      done: false,
      action: 'confirmImage',
      count: 2,
      score: 'eeat',
    });
    expect(visualTodo(2, 0, 0)!.gain).toBeGreaterThan(0);
    expect(visualTodo(0, 0, 1)).toMatchObject({ done: false, action: 'addImage' });
    expect(visualTodo(2, 1, 0)).toMatchObject({ done: true, action: null, gain: 0 });
    expect(visualTodo(0, 0, 0)).toBeUndefined();
    // Your input not read: visual proof still counts, so its to-do is still listed.
    const unread = qualityTodos({
      eeat: eeat({ author: author(), visual: { images: 2, own: 0, openSpots: 0 } }),
      author: author(),
      hasAuthors: true,
      used: null,
      visual: { images: 2, own: 0, openSpots: 0 },
    });
    expect(unread.find((t) => t.id === 'visualProof')).toMatchObject({
      done: false,
      action: 'confirmImage',
    });
  });

  it('asks a page that advises on health, money or the law for a qualified reviewer (CE-049)', () => {
    const review = (picked: boolean, hasAuthors = true) =>
      qualityTodos({
        eeat: eeat({ author: author() }),
        author: author(),
        hasAuthors,
        reviewer: { topic: 'health', picked },
        brandFacts: { pending: 1, had: true },
      }).map(({ id, done, action, topic }) => ({ id, done, action, topic }));
    expect(review(false).slice(-2)).toEqual([
      { id: 'reviewer', done: false, action: 'pickReviewer', topic: 'health' },
      { id: 'brandFacts', done: false, action: 'reviewBrandFacts', topic: undefined },
    ]);
    expect(review(false, false).at(-2)).toMatchObject({ id: 'reviewer', action: 'addAuthor' });
    expect(review(true).at(-2)).toMatchObject({ id: 'reviewer', done: true, action: null });
    // Not regulated: none.
    expect(
      qualityTodos({ eeat: eeat({ author: author() }), author: author(), hasAuthors: true }).map(
        (t) => t.id,
      ),
    ).not.toContain('reviewer');
  });

  it("keeps a linked proof checked when the next read carries its block with the link's space (review, #1468)", () => {
    const read = 'We are ISO 27001-certified for every plan.';
    const linked = 'We are ISO 27001 -certified for every plan.';
    // The API cuts the claim from the block as it has it: the space too.
    const ask = (block: string, isLinked: boolean): PageProof => ({
      claim: isLinked ? 'ISO 27001 -certified' : 'ISO 27001-certified',
      block,
      kind: 'certification',
      sentence: block,
      linked: isLinked,
    });
    expect(proofKey(ask(linked, true))).toBe(proofKey(ask(read, false)));
    // Asked while open on the first read; linked, the API's next answer
    // names the block as the page has it now.
    const had = new Set([proofKey(ask(read, false))]);
    expect(
      qualityTodos({
        eeat: null,
        author: null,
        hasAuthors: true,
        proofs: { asks: [ask(linked, true)], had },
      }),
    ).toMatchObject([{ id: 'proof', done: true }]);
  });

  it('asks how the page was made where the page read counts it (CE-050)', () => {
    const how = (found: boolean | null) =>
      qualityTodos({
        eeat: eeat({ author: author(), how: found === null ? null : { found } }),
        author: author(),
        hasAuthors: true,
        used: { experience: false, data: false, quote: false },
      }).find((t) => t.id === 'whoHowWhy');
    expect(how(false)).toMatchObject({ done: false, action: 'addInput', score: 'eeat' });
    expect(how(false)!.gain).toBeGreaterThan(0);
    expect(how(true)).toMatchObject({ done: true, gain: 0 });
    expect(how(null)).toBeUndefined();
  });

  it('offers to confirm the author the site names instead of picking one, the profile once they are', () => {
    const read = (real: boolean, profile: boolean) =>
      qualityTodos({
        eeat: eeat({ author: null, confirmed: { real, profile } }),
        author: null,
        hasAuthors: true,
        confirmed: { real, profile },
      }).map(({ id, done, confirm }) => ({ id, done, confirm }));
    expect(read(false, false)).toEqual([
      { id: 'byline', done: false, confirm: { what: 'real', on: false } },
      { id: 'authorProfile', done: false, confirm: undefined },
    ]);
    expect(read(true, false)).toEqual([
      { id: 'byline', done: true, confirm: { what: 'real', on: true } },
      { id: 'authorProfile', done: false, confirm: { what: 'profile', on: false } },
    ]);
    expect(read(true, true)[1]).toEqual({
      id: 'authorProfile',
      done: true,
      confirm: { what: 'profile', on: true },
    });
    // A picked author: nothing to confirm.
    expect(
      qualityTodos({
        eeat: eeat({ author: author() }),
        author: author(),
        hasAuthors: true,
        confirmed: { real: false, profile: false },
      }).map((t) => t.confirm),
    ).toEqual([undefined, undefined]);
  });
});
