import { describe, expect, it } from 'vitest';
import {
  OPENING,
  attributesIn,
  checkDescriptionOpening,
  openingCut,
  productTypeWords,
} from './productDescription.js';

/**
 * #1279: a product description's first 40 words or 250 characters name the
 * product type and at least two key attributes.
 */

const BRAND_STORY =
  'Since 1987, our family has crafted every pair by hand in a small workshop at the foot of the Alps. ' +
  'We believe the mountains belong to everyone, and every step you take carries a little of our story. ' +
  'This men’s trail running shoe weighs 268 g and has a 6 mm drop.';

/** Real-looking descriptions: [what, input, passes]. */
const FIXTURES = [
  [
    'type first, two measures',
    {
      description:
        'Men’s trail running shoe, 268 g, 6 mm drop, with a grippy outsole for wet rock and mud.',
      productName: 'Acme Ridge Men’s Trail Running Shoe',
      brand: 'Acme',
    },
    true,
  ],
  [
    'brand story first',
    { description: BRAND_STORY, productName: 'Acme Men’s Trail Running Shoe', brand: 'Acme' },
    false,
  ],
  [
    'type and material and fit',
    {
      description:
        'Slim fit organic cotton crew neck t-shirt in a midweight jersey that keeps its shape wash after wash.',
      productName: 'Northwind Crew Neck T-Shirt',
      brand: 'Northwind',
    },
    true,
  ],
  [
    'type named, one attribute',
    {
      description:
        'A backpack you will love on every adventure, made by people who care about the details.',
      productName: 'Summit Daypack Backpack',
      brand: 'Summit',
    },
    false,
  ],
  [
    'type with a plural and a use',
    {
      description:
        'Waterproof hiking boots with a 30 L gaiter loop and full-grain leather uppers for long days on the trail.',
      productName: 'Granite Hiking Boot',
      brand: 'Granite',
    },
    true,
  ],
  [
    'attributes, but another product type',
    {
      description:
        'Lightweight, breathable and waterproof: our best-selling jacket for rainy commutes.',
      productName: 'Acme Trail Running Shoe',
      brand: 'Acme',
    },
    false,
  ],
  [
    'the model named, with two measures and a use',
    {
      description:
        'The Speedgoat 5 weighs 292 g, has a 4 mm drop and a cushioned midsole for long runs.',
      productName: 'Hoka Speedgoat 5',
      brand: 'Hoka',
    },
    true,
  ],
  [
    'a kitchen product with a capacity and a material',
    {
      description:
        'Stainless steel French press coffee maker, 1 L, double-walled to keep coffee hot for an hour.',
      productName: 'Barista French Press Coffee Maker',
      brand: 'Barista',
    },
    true,
  ],
];

describe('checkDescriptionOpening', () => {
  it.each(FIXTURES)('%s', (_, input, passes) => {
    expect(checkDescriptionOpening(input).passes).toBe(passes);
  });

  it('passes "Men’s trail running shoe, 268 g, 6 mm drop…" on its type and two measures', () => {
    const result = checkDescriptionOpening(FIXTURES[0][1]);
    expect(result.namesType).toBe(true);
    expect(result.attributes).toEqual(expect.arrayContaining(['268 g', '6 mm']));
  });

  it('flags a brand-story opening: no product type before the cut', () => {
    const result = checkDescriptionOpening(FIXTURES[1][1]);
    expect(result.namesType).toBe(false);
    expect(result.opening).not.toContain('trail running shoe');
    expect(BRAND_STORY.indexOf('trail running shoe')).toBeGreaterThan(result.cut);
  });

  it('has no type to judge when the name is only the brand and a model number', () => {
    const result = checkDescriptionOpening({
      description: 'Weighs 292 g, with a 4 mm drop and a cushioned midsole for long runs.',
      productName: 'Hoka X-200',
      brand: 'Hoka',
    });
    expect(result.namesType).toBeNull();
    expect(result.passes).toBe(true);
  });
});

describe('openingCut', () => {
  it('stops at 40 words when they end before 250 characters', () => {
    const text = Array.from({ length: 60 }, (_, i) => `w${i}`).join(' ');
    const cut = openingCut(text);
    expect(text.slice(0, cut).split(' ')).toHaveLength(OPENING.words);
    expect(cut).toBeLessThan(OPENING.chars);
  });

  it('stops at 250 characters when they come before the 40th word', () => {
    const text = Array.from({ length: 60 }, () => 'characterful').join(' ');
    expect(openingCut(text)).toBe(OPENING.chars);
  });

  it('keeps a short description whole', () => {
    expect(openingCut('Merino wool beanie, one size.')).toBe(29);
  });
});

describe('productTypeWords', () => {
  it('takes the name without the brand, models and filler', () => {
    expect(productTypeWords('Acme Ridge 2 Men’s Trail Running Shoes', 'Acme')).toEqual([
      'ridge',
      'men',
      'trail',
      'running',
      'shoe',
    ]);
    expect(productTypeWords('Hoka Speedgoat 5', 'Hoka')).toEqual(['speedgoat']);
  });
});

describe('attributesIn', () => {
  it('counts a measure, a material, a fit and a use, each once', () => {
    expect(attributesIn('Slim fit organic cotton running tee, 180 g', ['tee']).sort()).toEqual(
      ['180 g', 'organic cotton', 'running', 'slim fit'].sort(),
    );
  });

  it('counts no attribute in the product type, a bare "in" or an everyday "wide"', () => {
    expect(attributesIn('Trail running shoe', ['trail', 'running', 'shoe'])).toEqual([]);
    expect(attributesIn('3 in stock, in a wide range of colors')).toEqual([]);
  });
});
