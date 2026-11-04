import { describe, expect, it } from 'vitest';
import { confirmedFacts, introConfirmKeys, introFacts } from './introFacts';

/** A category page's intro facts (Quality spec §11, CE-054). */

const page = (intro: string, rest = '<h2>All daypacks</h2><p>Over 200 daypacks in stock.</p>') =>
  `<h1>Daypacks</h1>${intro}${rest}`;
const facts = (intro: string, language = 'en') =>
  introFacts(page(`<p>${intro}</p>`), language).flatMap((fact) => fact.facts);

describe('introFacts', () => {
  it('reads the intro’s counts and prices, each sentence once, each fact as itself', () => {
    expect(
      introFacts(
        page(
          '<p>Choose from 120+ daypacks for every trail. They are made to last.</p>' +
            '<p>Prices run $49–$199, and most are under $100.</p>',
        ),
      ),
    ).toEqual([
      { sentence: 'Choose from 120+ daypacks for every trail.', facts: ['120+'] },
      { sentence: 'Prices run $49–$199, and most are under $100.', facts: ['USD49-199', 'USD100'] },
    ]);
    for (const [intro, fact] of [
      ['Over 50 styles in stock.', '50+'],
      ['More than 40 models to pick from.', '40+'],
      ['Shop 24 colours.', '24+'],
      ['Choose from 1,200 designs.', '1200+'],
      ['12 models for city and trail.', '12'],
      ["50'den fazla model.", '50+'],
      ['Über 30 Modelle im Shop.', '30+'],
      ['Plus de 20 modèles.', '20+'],
      ['Más de 30 modelos.', '30+'],
      ['From €49.', 'EUR49'],
    ]) {
      expect(facts(intro), intro).toEqual([fact]);
    }
  });

  it('reads no fact in what isn’t one (#CE-054 review)', () => {
    for (const intro of [
      // Time, distance, an age, a sun factor, ways and trails.
      'Over 10 years of experience.',
      'Über 20 Jahre Erfahrung.',
      'Get 4+ hours of battery.',
      'Over 50 km of trails.',
      'Toys for ages 3+.',
      'SPF 50+ sunscreens.',
      'Shop 3 ways.',
      'Explore 5 trails.',
      // A year, a size, steps.
      'Shop 2026 styles.',
      'Since 2009, packs from 20 to 40 litres, in 3 easy steps.',
      // A shipping threshold is no price of the category's.
      'Free shipping over $50.',
      '500 TL üzeri kargo bedava.',
      // No number at all.
      'Packs for wet hikes and long days.',
    ]) {
      expect(facts(intro), intro).toEqual([]);
    }
  });

  it('reads only the intro, a line break and a nested list apart, in the page’s language', () => {
    // After the first H2 isn't the intro.
    expect(introFacts(page('<p>Packs for wet hikes.</p>'))).toEqual([]);
    expect(introFacts('<p>120+ daypacks.</p>')).toHaveLength(1);
    expect(
      introFacts(page('<p>Over 50 styles.<br>Under $100 each.</p>')).map((f) => f.sentence),
    ).toEqual(['Over 50 styles.', 'Under $100 each.']);
    expect(
      introFacts(page('<ul><li>Over 50 styles<ul><li>Under $100</li></ul></li></ul>')).map(
        (f) => f.sentence,
      ),
    ).toEqual(['Over 50 styles', 'Under $100']);
  });
});

describe('introConfirmKeys and confirmedFacts', () => {
  it('keeps a confirm by its facts: rewording keeps it, a changed number asks again', () => {
    const keys = introConfirmKeys(['USD49-199', '120+', '120+']);
    expect(keys).toEqual(['intro:120+,USD49-199']);
    const confirmed = confirmedFacts([...keys, 'case:acmecutcosts']);
    expect([...confirmed].sort()).toEqual(['120+', 'USD49-199']);
    // The same facts in other words are confirmed; a new count isn't.
    const reworded = facts('Pick from 120+ daypacks, each made to last.');
    expect(reworded.every((fact) => confirmed.has(fact))).toBe(true);
    expect(facts('Choose from 140+ daypacks.').some((fact) => confirmed.has(fact))).toBe(false);
  });

  it('splits facts over keys of 400 characters at most', () => {
    const many = Array.from({ length: 80 }, (_, i) => `USD${1000 + i}`);
    const keys = introConfirmKeys(many);
    expect(keys.length).toBeGreaterThan(1);
    expect(keys.every((key) => key.length <= 400 && key.startsWith('intro:'))).toBe(true);
    expect(confirmedFacts(keys).size).toBe(80);
  });
});
