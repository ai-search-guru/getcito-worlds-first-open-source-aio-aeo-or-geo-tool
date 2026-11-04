import { describe, expect, it } from 'vitest';
import {
  aiChecksOnPage,
  pageImages,
  proofsOnPage,
  type PageChecks,
  type ProofAsk,
} from './pageRead';
import { trustBlocks } from './qualityChecks';

/** The page read's proof asks on the page as it is now (Quality spec §4b, CE-049). */

describe('proofsOnPage', () => {
  const html =
    '<p>Ledgerly is award-winning. Teams love it.</p>' +
    '<p>Every plan is SOC 2 certified (<a href="https://ledgerly.example/trust">trust</a>).</p>' +
    '<ul><li>Rated 4.8 by 2,000 teams.</li></ul>' +
    '<p>Ledgerly is award-winning. Teams love it.</p>';
  const blocks = trustBlocks(html);
  const ask = (claim: string, block: string, kind: ProofAsk['kind'] = 'award'): ProofAsk => ({
    claim,
    block,
    kind,
  });

  it("gives each ask in the page's order, with its sentence and whether its block links out", () => {
    const proofs = [
      ask('Rated 4.8', 'Rated 4.8 by 2,000 teams.', 'rating'),
      ask('award-winning', 'Ledgerly is award-winning. Teams love it.'),
      ask('SOC 2 certified', 'Every plan is SOC 2 certified ( trust).', 'certification'),
    ];
    expect(proofsOnPage(blocks, proofs)).toEqual([
      {
        ...proofs[1],
        sentence: 'Ledgerly is award-winning.',
        linked: false,
      },
      {
        ...proofs[2],
        sentence: 'Every plan is SOC 2 certified ( trust).',
        linked: true,
      },
      { ...proofs[0], sentence: 'Rated 4.8 by 2,000 teams.', linked: false },
    ]);
  });

  it('leaves out an ask whose block changed, and a block the page has twice gives its claims once', () => {
    expect(
      proofsOnPage(blocks, [
        ask('award-winning', 'Ledgerly is award-winning.'),
        ask('the best', 'Ledgerly is award-winning. Teams love it.', 'ranking'),
        ask('award-winning', 'Ledgerly is award-winning. Teams love it.'),
      ]).map((p) => p.claim),
    ).toEqual(['award-winning']);
  });

  it('finds a claim once a link on it adds a space at its edge, and keeps its block as read', () => {
    const read = 'We are ISO 27001-certified and the best-rated tool in Europe.';
    const linked = trustBlocks(
      '<p>We are <a href="https://ledgerly.example/trust">ISO 27001</a>-certified and the best-rated tool in Europe.</p>',
    );
    expect(linked[0].text).toBe('We are ISO 27001 -certified and the best-rated tool in Europe.');
    const proofs = proofsOnPage(linked, [
      ask('the best-rated tool in Europe', read, 'ranking'),
      ask('ISO 27001-certified', read, 'certification'),
    ]);
    // In the block's order, each with the block as read.
    expect(proofs.map((p) => [p.claim, p.block, p.linked])).toEqual([
      ['ISO 27001-certified', read, true],
      ['the best-rated tool in Europe', read, true],
    ]);
    expect(proofs[0].sentence).toBe(
      'We are ISO 27001 -certified and the best-rated tool in Europe.',
    );
  });

  it("counts only an http(s) link as the block's proof", () => {
    const linkless = trustBlocks(
      '<p>We are ISO 27001 certified (<a href="mailto:trust@ledgerly.example">ask</a>).</p>',
    );
    expect(
      proofsOnPage(linkless, [ask('ISO 27001 certified', linkless[0].text, 'certification')])[0]
        .linked,
    ).toBe(false);
  });
});

describe('pageImages', () => {
  it("lists the page's images by their address, once each, in its order", () => {
    expect(
      pageImages(
        '<p>Intro</p><img src="https://cdn.example/a.png" alt="A run"><p><img src="data:image/png;base64,xx"></p>' +
          '<img src="https://cdn.example/b.jpg"><img src="https://cdn.example/a.png" alt="again">' +
          // As the database takes an own image's address: lower-case http(s), 2048 at most.
          `<img src="HTTP://cdn.example/c.png"><img src="https://cdn.example/${'x'.repeat(2048)}.png">`,
      ),
    ).toEqual([
      { src: 'https://cdn.example/a.png', alt: 'A run' },
      { src: 'https://cdn.example/b.jpg', alt: '' },
    ]);
  });
});

describe('aiChecksOnPage (CE-050)', () => {
  const PICK = 'Our top pick is the Trailmade Ridge 28, ahead of the Osprey Talon.';
  const HOW = 'We hiked 120 km in the rain with each pack.';
  const FIRST = 'The best daypack for wet hikes is the Trailmade Ridge 28.';
  const blocks = trustBlocks(`<h1>Best daypacks</h1><p>${FIRST}</p><p>${PICK}</p><p>${HOW}</p>`);
  const checks = (over: Partial<PageChecks> = {}): PageChecks => ({
    answerFirst: { answers: true, block: FIRST },
    recommends: { quote: 'Our top pick is the Trailmade Ridge 28', block: PICK },
    disclosure: null,
    balance: null,
    how: { quote: 'We hiked 120 km', block: HOW },
    cut: false,
    pageType: 'best_of',
    ...over,
  });

  it('asks a page that puts the brand forward for its disclosure and its balance, Show on the pick', () => {
    expect(aiChecksOnPage(blocks, checks(), 'best_of')).toEqual({
      how: { found: true, show: 'We hiked 120 km' },
      balanced: { found: false, show: 'Our top pick is the Trailmade Ridge 28' },
      disclosure: { found: false, show: 'Our top pick is the Trailmade Ridge 28' },
      answerFirst: { answers: true, block: FIRST },
    });
  });

  it('counts each check only where it applies', () => {
    // A feature page puts nothing forward and says nothing of how it was made.
    expect(aiChecksOnPage(blocks, checks({ recommends: null }), 'feature_page')).toMatchObject({
      how: null,
      balanced: null,
      disclosure: null,
    });
    // A comparison weighs options: its balance counts without the brand put forward.
    expect(aiChecksOnPage(blocks, checks({ recommends: null }), 'comparison')).toMatchObject({
      balanced: { found: false, show: null },
      disclosure: null,
    });
  });

  it('counts a find whose block is gone as not found, and leaves one out on a page read in part', () => {
    const edited = trustBlocks(`<h1>Best daypacks</h1><p>${PICK}</p><p>We tested them.</p>`);
    expect(aiChecksOnPage(edited, checks(), 'best_of')).toMatchObject({
      how: { found: false },
      answerFirst: null,
    });
    // Cut: one not found may be in the rest; one found still counts.
    expect(aiChecksOnPage(edited, checks({ cut: true }), 'best_of')).toMatchObject({
      how: null,
      disclosure: null,
    });
    expect(aiChecksOnPage(blocks, checks({ cut: true }), 'best_of').how).toEqual({
      found: true,
      show: 'We hiked 120 km',
    });
    // While the page as it is now is read, a find whose block was edited still counts.
    expect(aiChecksOnPage(edited, checks(), 'best_of', true).how).toEqual({
      found: true,
      show: null,
    });
  });

  it('holds the pick and Answer first’s verdict while the edited page is read again (review, #1479)', () => {
    const typo = trustBlocks(
      `<h1>Best daypacks</h1><p>The best daypack for wet hikes is the Trailmade Ridge 28!</p><p>Our top pick is the Trailmade Ridge 28, ahead of the Osprey Talon!</p><p>${HOW}</p>`,
    );
    // Read again: the pick still applies (no Show: its words moved), the verdict is held.
    expect(aiChecksOnPage(typo, checks(), 'feature_page', true)).toEqual({
      how: null,
      balanced: { found: false, show: null },
      disclosure: { found: false, show: null },
      answerFirst: { answers: true, block: FIRST, held: true },
    });
    // Once read and still edited: the pick doesn't apply, and the verdict goes.
    expect(aiChecksOnPage(typo, checks(), 'feature_page')).toEqual({
      how: null,
      balanced: null,
      disclosure: null,
      answerFirst: null,
    });
  });
});
