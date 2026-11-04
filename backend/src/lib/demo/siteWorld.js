/**
 * Brewline Coffee's own website, for the demo brand's site pages (demo-site):
 * its pages and what they say, its catalog, its authors and the searches it
 * shows up for. Site Audit audits these pages, AI Referral Traffic counts
 * visits to them and Product Visibility reads the catalog.
 *
 * Everything here is made up, on `brewline.example` like the rest of the
 * demo (brewline.js): no real company, site or product. The pages link only
 * to Brewline's own pages and the demo's fictional publishers, and name no
 * image the demo would load.
 */

import { BRAND, SOURCES } from './brewline.js';

export const SITE_URL = `https://${BRAND.domain}`;

/** The page's full address: the home page without a trailing slash, as site_pages keeps it. */
export const pageUrl = (path) => (path === '/' ? SITE_URL : `${SITE_URL}${path}`);

/** The authors whose names the blog posts carry. */
export const AUTHORS = [
  {
    key: 'maya',
    name: 'Maya Okafor',
    path: '/authors/maya-okafor',
    role: 'Head Roaster',
    bio: 'Maya has roasted specialty coffee for 12 years and writes every Brewline roast profile. She cups each batch before it ships.',
  },
  {
    key: 'daniel',
    name: 'Daniel Reyes',
    path: '/authors/daniel-reyes',
    role: 'Coffee Editor',
    bio: 'Daniel writes the Brewline brewing guides and tests every recipe at home with a hand grinder and a basic kettle.',
  },
];

/**
 * The catalog: one entry per product, its variants by bag size (or bag
 * count, for a subscription). `card` marks the products the demo's AI
 * answers show as product cards (brewline.js PRODUCTS): same page, same
 * price, so the two sides match.
 */
export const CATALOG = [
  // Single origins
  {
    id: 'BL-ETH',
    path: '/coffee/ethiopia-yirgacheffe',
    title: 'Ethiopia Yirgacheffe',
    type: 'Coffee > Whole Bean > Single Origin',
    notes: 'jasmine, bergamot and lemon',
    roast: 'light',
    process: 'washed',
    sizes: [
      ['12 oz', 19.5],
      ['2 lb', 46],
    ],
  },
  {
    id: 'BL-COL',
    path: '/coffee/colombia-huila',
    title: 'Colombia Huila',
    type: 'Coffee > Whole Bean > Single Origin',
    notes: 'red apple, caramel and cocoa',
    roast: 'medium',
    process: 'washed',
    sizes: [
      ['12 oz', 17.5],
      ['2 lb', 41],
    ],
  },
  {
    id: 'BL-GUA',
    path: '/coffee/guatemala-antigua',
    title: 'Guatemala Antigua',
    type: 'Coffee > Whole Bean > Single Origin',
    notes: 'milk chocolate, toffee and orange',
    roast: 'medium',
    process: 'washed',
    sizes: [
      ['12 oz', 18],
      ['2 lb', 42],
    ],
  },
  {
    id: 'BL-KEN',
    path: '/coffee/kenya-nyeri',
    title: 'Kenya Nyeri',
    type: 'Coffee > Whole Bean > Single Origin',
    notes: 'blackcurrant, grapefruit and brown sugar',
    roast: 'light',
    process: 'washed',
    sizes: [
      ['12 oz', 21],
      ['2 lb', 49, 'out of stock'],
    ],
  },
  {
    id: 'BL-SUM',
    path: '/coffee/sumatra-mandheling',
    title: 'Sumatra Mandheling',
    type: 'Coffee > Whole Bean > Single Origin',
    notes: 'cedar, dark chocolate and molasses',
    roast: 'dark',
    process: 'wet-hulled',
    sizes: [
      ['12 oz', 17.5],
      ['2 lb', 41],
    ],
  },
  {
    id: 'BL-BRA',
    path: '/coffee/brazil-cerrado',
    title: 'Brazil Cerrado',
    type: 'Coffee > Whole Bean > Single Origin',
    notes: 'peanut, milk chocolate and low acidity',
    roast: 'medium',
    process: 'natural',
    sizes: [
      ['12 oz', 15.5],
      ['2 lb', 36],
    ],
  },
  {
    id: 'BL-CRC',
    path: '/coffee/costa-rica-tarrazu',
    title: 'Costa Rica Tarrazu',
    type: 'Coffee > Whole Bean > Single Origin',
    notes: 'honey, peach and almond',
    roast: 'light',
    process: 'honey',
    sizes: [
      ['12 oz', 19],
      ['2 lb', 44],
    ],
  },
  // Blends
  {
    id: 'BL-HOU',
    path: '/coffee/house-blend',
    title: 'House Blend',
    type: 'Coffee > Whole Bean > Blends',
    notes: 'chocolate, hazelnut and a round finish',
    roast: 'medium',
    sizes: [
      ['12 oz', 15],
      ['2 lb', 35],
    ],
  },
  {
    id: 'BL-BRK',
    path: '/coffee/breakfast-blend',
    title: 'Breakfast Blend',
    type: 'Coffee > Whole Bean > Blends',
    notes: 'brown sugar, citrus and a bright finish',
    roast: 'light',
    sizes: [
      ['12 oz', 15, null, 13.5],
      ['2 lb', 35],
    ],
  },
  {
    id: 'BL-MID',
    path: '/coffee/midnight-dark-roast',
    title: 'Midnight Dark Roast',
    type: 'Coffee > Whole Bean > Blends',
    notes: 'smoke, cocoa and toasted walnut',
    roast: 'dark',
    sizes: [
      ['12 oz', 16],
      ['2 lb', 37],
    ],
  },
  // Espresso
  {
    id: 'BL-ESP',
    path: '/coffee/espresso-roast',
    title: 'Espresso Roast',
    type: 'Coffee > Whole Bean > Espresso',
    notes: 'dark chocolate, cherry and a thick crema',
    roast: 'medium-dark',
    card: true,
    sizes: [
      ['12 oz', 16.5],
      ['2 lb', 38],
    ],
  },
  {
    id: 'BL-CRM',
    path: '/coffee/crema-espresso-blend',
    title: 'Crema Espresso Blend',
    type: 'Coffee > Whole Bean > Espresso',
    notes: 'caramel, almond and a syrupy body',
    roast: 'medium',
    sizes: [
      ['12 oz', 17.5],
      ['2 lb', 40],
    ],
  },
  // Decaf
  {
    id: 'BL-DEC',
    path: '/coffee/decaf',
    title: 'Water Process Decaf',
    type: 'Coffee > Whole Bean > Decaf',
    notes: 'milk chocolate, plum and brown sugar',
    roast: 'medium',
    process: 'water process decaf',
    card: true,
    sizes: [
      ['12 oz', 17],
      ['2 lb', 39],
    ],
  },
  {
    id: 'BL-DES',
    path: '/coffee/decaf-espresso',
    title: 'Decaf Espresso',
    type: 'Coffee > Whole Bean > Decaf',
    notes: 'cocoa, dates and a heavy body',
    roast: 'medium-dark',
    process: 'water process decaf',
    sizes: [
      ['12 oz', 17.5],
      ['2 lb', 40],
    ],
  },
  // Subscriptions: a variant per bags a delivery.
  {
    id: 'BL-SUB-HOU',
    path: '/subscriptions/house-blend',
    title: 'House Blend Subscription',
    type: 'Subscriptions',
    notes: 'our House Blend, roasted to order',
    card: true,
    bags: [
      ['1 bag', 18],
      ['2 bags', 34],
    ],
  },
  {
    id: 'BL-SUB-SOC',
    path: '/subscriptions/single-origin-club',
    title: 'Single Origin Club',
    type: 'Subscriptions',
    notes: 'a different single origin every delivery',
    bags: [
      ['1 bag', 22],
      ['2 bags', 42],
    ],
  },
  {
    id: 'BL-SUB-ESP',
    path: '/subscriptions/espresso-club',
    title: 'Espresso Club',
    type: 'Subscriptions',
    notes: 'our espresso roasts in rotation',
    bags: [
      ['1 bag', 20],
      ['2 bags', 38],
    ],
  },
  // Gifts and brewing gear: one variant each.
  {
    id: 'BL-GFT-3M',
    path: '/gifts/3-month-gift-subscription',
    title: '3-Month Gift Subscription',
    type: 'Gifts',
    notes: 'three monthly deliveries of a single origin, prepaid',
    price: 54,
  },
  {
    id: 'BL-GFT-TST',
    path: '/gifts/single-origin-tasting-set',
    title: 'Single Origin Tasting Set',
    type: 'Gifts',
    notes: 'four 4 oz bags of our current single origins',
    price: 29,
  },
  {
    id: 'BL-EQ-GRN',
    path: '/brewing/burr-grinder',
    title: 'Brewline Burr Grinder',
    type: 'Brewing Equipment',
    notes: 'a conical burr grinder with 30 grind settings',
    price: 89,
  },
  {
    id: 'BL-EQ-POK',
    path: '/brewing/pour-over-starter-kit',
    title: 'Pour-Over Starter Kit',
    type: 'Brewing Equipment',
    notes: 'a ceramic dripper, 100 filters and a glass server',
    price: 45,
  },
  {
    id: 'BL-EQ-CBB',
    path: '/brewing/cold-brew-filter-bags',
    title: 'Cold Brew Filter Bags',
    type: 'Brewing Equipment',
    notes: 'a pack of 50 bags for one-quart batches',
    price: 9,
  },
];

/** A product taken off the store: still in the catalog, marked removed. */
export const REMOVED_PRODUCT = {
  id: 'BL-HOL',
  path: '/coffee/holiday-blend',
  title: 'Holiday Blend',
  type: 'Coffee > Whole Bean > Blends',
  notes: 'spice, dried cherry and dark chocolate',
  roast: 'medium-dark',
  sizes: [['12 oz', 17]],
  removedDaysAgo: 41,
};

/** The collection pages (Shopify style), one per catalog category that has one. */
export const COLLECTIONS = [
  {
    path: '/collections/single-origin',
    type: 'Coffee > Whole Bean > Single Origin',
    title: 'Single Origin Coffee | Brewline Coffee',
    h1: 'Single Origin Coffee Beans',
    description:
      'Single origin whole bean coffee from Ethiopia, Colombia, Kenya and more, roasted to order and shipped within a day of roasting.',
  },
  {
    path: '/collections/blends',
    type: 'Coffee > Whole Bean > Blends',
    title: 'Coffee Blends | Brewline Coffee',
    h1: 'Coffee Blends',
    description:
      'Balanced everyday coffee blends, from a bright breakfast roast to a smoky dark roast, roasted fresh every weekday.',
  },
  {
    path: '/collections/espresso',
    type: 'Coffee > Whole Bean > Espresso',
    title: 'Espresso Beans | Brewline Coffee',
    h1: 'Espresso Beans for Home Espresso',
    description:
      'Whole bean espresso roasts developed for home machines: thick crema, chocolate sweetness and a forgiving extraction window.',
  },
  {
    path: '/collections/decaf',
    type: 'Coffee > Whole Bean > Decaf',
    title: 'Decaf Coffee | Brewline Coffee',
    h1: 'Water Process Decaf Coffee',
    description:
      'Decaf coffee decaffeinated with water only, no solvents, roasted to taste like the real thing.',
  },
];

/** A collection page's title, h1 and description, for its audited page. */
const collection = (path) => {
  const { type: _type, ...page } = COLLECTIONS.find((c) => c.path === path);
  return page;
};

/**
 * The categories a person set a page for by hand (catalog_category_pages):
 * a themed collection the matcher leaves alone, and the subscriptions page.
 */
export const CATEGORY_DECISIONS = [
  { category: 'Gifts', path: '/gifts' },
  { category: 'Subscriptions', path: '/subscriptions' },
];

/** A page cited in the demo's answers keeps the title the answers show for it. */
const citedTitle = (path) => SOURCES.brand.find((p) => p.path === path)?.label;

const FOOTER_LINKS = [
  ['/about', 'About us'],
  ['/contact', 'Contact'],
  ['/faq', 'FAQ'],
  ['/shipping', 'Shipping'],
  ['/privacy-policy', 'Privacy policy'],
  ['/terms', 'Terms of service'],
];
export { FOOTER_LINKS };

/**
 * The pages Site Audit audits, with what they say. `since` names the audit
 * round (0, 1, 2: oldest first) from which a fix is on the page; a page
 * without it had it all along. `rounds` are the rounds the page was audited
 * in (every page is in the latest).
 */
export const AUDITED_PAGES = [
  {
    path: '/',
    kind: 'home',
    title: 'Brewline Coffee | Fresh Roasted Coffee Beans & Subscriptions',
    description:
      'Specialty coffee roasted to order and shipped within a day of roasting. Whole beans by the bag or on a flexible subscription you can pause anytime.',
    h1: 'Fresh Roasted Coffee, Shipped the Day After Roasting',
    rounds: [0, 1, 2],
    since: { metaDescription: 1, faqSchema: 2, twitterCard: 1 },
    intro:
      'Brewline roasts specialty coffee to order in small batches and ships every bag within 24 hours of roasting. Pick a single origin, a house blend or a subscription you can pause, skip or cancel anytime.',
    sections: [
      {
        h2: 'Why fresh roasted coffee tastes better',
        p: [
          'Coffee is at its best between 4 and 21 days after roasting. Supermarket bags often sit on shelves for months, so the aromatics that make a cup interesting are long gone by the time you brew.',
          'We print the roast date on every bag and roast only what has been ordered, so the beans you open are always inside that window.',
        ],
      },
      {
        h2: 'Shop by how you brew',
        list: [
          'Espresso at home: our Espresso Roast and Crema Espresso Blend',
          'Pour-over and drip: single origins from Ethiopia, Colombia and Kenya',
          'French press and cold brew: Sumatra Mandheling and Midnight Dark Roast',
          'Evenings: Water Process Decaf, with no solvents',
        ],
      },
      {
        h2: 'Subscriptions that fit your week',
        p: [
          'Choose weekly, every two weeks or monthly deliveries. Change the coffee, the grind or the date from your account, and pause whenever you travel.',
        ],
      },
    ],
    faq: [
      [
        'How soon after roasting do you ship?',
        'Every order ships within 24 hours of roasting, Monday to Friday.',
      ],
      [
        'Can I pause my subscription?',
        'Yes. You can pause, skip a delivery or cancel anytime from your account.',
      ],
      [
        'Do you sell ground coffee?',
        'Yes. Every coffee comes as whole beans or ground for espresso, drip or French press.',
      ],
    ],
  },
  {
    path: '/subscriptions',
    kind: 'pricing',
    title: citedTitle('/subscriptions'),
    description:
      'Coffee subscriptions from $18 a bag: House Blend, Single Origin Club and Espresso Club, delivered weekly, every two weeks or monthly. Pause anytime.',
    h1: 'Coffee Subscriptions, Roasted to Order',
    rounds: [0, 1, 2],
    since: { faqSchema: 1, twitterCard: 2 },
    intro:
      'A Brewline subscription sends freshly roasted coffee on your schedule. Every plan ships within a day of roasting, and you can pause, skip or cancel anytime.',
    sections: [
      {
        h2: 'Our plans',
        p: [
          'House Blend Subscription: $18 per bag. Our chocolatey everyday blend, the same every delivery.',
          'Single Origin Club: $22 per bag. A different single origin each delivery, with tasting notes from our roasters.',
          'Espresso Club: $20 per bag. Our espresso roasts in rotation, developed for home machines.',
        ],
      },
      {
        h2: 'Compare plans',
        table: {
          head: ['Plan', 'Price per bag', 'Coffee', 'Best for'],
          rows: [
            ['House Blend Subscription', '$18', 'House Blend', 'Daily drip or French press'],
            ['Single Origin Club', '$22', 'Rotating single origins', 'Pour-over and exploring'],
            ['Espresso Club', '$20', 'Espresso roasts', 'Home espresso machines'],
          ],
        },
      },
      {
        h2: 'How deliveries work',
        list: [
          'Choose weekly, every two weeks or monthly deliveries',
          'Pick whole beans or a grind for your brewer',
          'Shipping is free on every subscription order in the US',
          'Pause, skip or cancel anytime from your account',
        ],
      },
    ],
    faq: [
      ['Is shipping included?', 'Yes, shipping is free on every subscription order in the US.'],
      [
        'Can I change my coffee?',
        'Yes. Switch plans or coffees before your next roast date and the change applies to that delivery.',
      ],
      [
        'What if I am away?',
        'Pause your subscription or skip a delivery from your account. There is no fee.',
      ],
    ],
  },
  {
    path: '/subscriptions/house-blend',
    kind: 'product',
    product: 'BL-SUB-HOU',
    title: 'House Blend Coffee Subscription | Brewline Coffee',
    description:
      'Our House Blend on a subscription: chocolate and hazelnut notes, roasted to order and delivered on your schedule from $18 a bag.',
    h1: 'House Blend Coffee Subscription',
    rounds: [0, 1, 2],
    since: { productJsonLd: 1, descriptionOpening: 2 },
  },
  {
    path: '/gifts',
    kind: 'collection',
    title: citedTitle('/gifts'),
    description:
      'Coffee gifts that keep arriving: prepaid gift subscriptions and tasting sets, with a personal note and a delivery date you choose.',
    h1: 'Coffee Gift Subscriptions and Gift Sets',
    rounds: [2],
    intro:
      'Give freshly roasted coffee: a prepaid subscription delivered for three, six or twelve months, or a tasting set of our current single origins.',
    sections: [
      {
        h2: 'Gift subscriptions',
        p: [
          'Prepaid gift subscriptions send a fresh bag every month. Add a personal note and choose the date the first bag arrives.',
        ],
      },
      {
        h2: 'Tasting sets',
        p: [
          'The Single Origin Tasting Set has four 4 oz bags of our current single origins, with tasting cards for each.',
        ],
      },
    ],
    products: ['BL-GFT-3M', 'BL-GFT-TST', 'BL-SUB-SOC'],
  },
  {
    ...collection('/collections/single-origin'),
    kind: 'collection',
    rounds: [2],
    intro:
      'Our single origins come from one farm or one region, so each bag tastes of where it was grown. We roast them light to medium to keep that character.',
    sections: [
      {
        h2: 'Finding your single origin',
        p: [
          'East African coffees like Ethiopia Yirgacheffe and Kenya Nyeri are floral and bright. Central and South American coffees are rounder, with caramel and chocolate.',
        ],
      },
    ],
    products: ['BL-ETH', 'BL-COL', 'BL-GUA', 'BL-KEN', 'BL-SUM', 'BL-BRA', 'BL-CRC'],
  },
  {
    ...collection('/collections/espresso'),
    kind: 'collection',
    rounds: [2],
    since: { metaDescription: 3 },
    intro: 'Espresso roasts for home machines.',
    sections: [],
    products: ['BL-ESP', 'BL-CRM', 'BL-DES'],
  },
  {
    path: '/coffee/espresso-roast',
    kind: 'product',
    product: 'BL-ESP',
    title: citedTitle('/coffee/espresso-roast'),
    description:
      'Espresso Roast whole bean coffee with dark chocolate and cherry notes and a thick crema. Roasted to order for home espresso machines.',
    h1: 'Espresso Roast Whole Bean Coffee',
    rounds: [0, 1, 2],
    since: { faqSchema: 2, descriptionOpening: 1 },
    faq: [
      [
        'What grind should I use?',
        'Start fine, at about 18 grams in and 36 grams out in 28 seconds, then adjust.',
      ],
      [
        'How long does a bag stay fresh?',
        'Use it within a month of the roast date, and rest it 5 to 7 days before pulling shots.',
      ],
    ],
  },
  {
    path: '/coffee/decaf',
    kind: 'product',
    product: 'BL-DEC',
    title: citedTitle('/coffee/decaf'),
    description:
      'Water Process Decaf whole bean coffee: decaffeinated with water only, no solvents, with milk chocolate and plum notes.',
    h1: 'Water Process Decaf Coffee',
    rounds: [0, 1, 2],
    since: { faqSchema: 1, descriptionOpening: 2 },
    faq: [
      [
        'How much caffeine is left?',
        'The water process removes 99.9% of the caffeine, so a cup has about 2 mg.',
      ],
      [
        'Does decaf taste different?',
        'Ours keeps its sweetness because no solvents touch the beans.',
      ],
    ],
  },
  {
    path: '/coffee/ethiopia-yirgacheffe',
    kind: 'product',
    product: 'BL-ETH',
    title: 'Ethiopia Yirgacheffe Coffee Beans | Brewline Coffee',
    description:
      'Ethiopia Yirgacheffe single origin coffee with jasmine, bergamot and lemon notes, light roasted to order.',
    h1: 'Ethiopia Yirgacheffe Single Origin',
    rounds: [2],
    since: { descriptionOpening: 0 },
  },
  {
    path: '/coffee/colombia-huila',
    kind: 'product',
    product: 'BL-COL',
    title: 'Colombia Huila Coffee Beans | Brewline Coffee',
    description: 'Colombia Huila coffee beans.',
    h1: 'Colombia Huila',
    rounds: [2],
    since: { descriptionOpening: 3, productJsonLd: 3 },
  },
  {
    path: '/coffee/sumatra-mandheling',
    kind: 'product',
    product: 'BL-SUM',
    title: 'Sumatra Mandheling Low Acid Coffee | Brewline Coffee',
    description:
      'Sumatra Mandheling dark roast whole bean coffee: low acidity, with cedar, dark chocolate and molasses notes.',
    h1: 'Sumatra Mandheling Dark Roast',
    rounds: [2],
  },
  {
    path: '/blog/how-fresh-should-coffee-beans-be',
    kind: 'article',
    author: 'maya',
    published: 160,
    modified: 19,
    title: citedTitle('/blog/how-fresh-should-coffee-beans-be'),
    description:
      'Coffee beans taste best 4 to 21 days after roasting. Here is how to read a roast date, store beans and tell when coffee has gone stale.',
    h1: 'How Fresh Should Coffee Beans Be When They Arrive?',
    rounds: [0, 1, 2],
    since: { faqSchema: 1, quote: 2 },
    intro:
      'Coffee beans taste best between 4 and 21 days after their roast date. Before day 4 they are still releasing carbon dioxide, and after about three weeks the aromatics fade. When we tested the same Colombia Huila every few days for six weeks, our team found the sweetest cups between day 7 and day 14.',
    sections: [
      {
        h2: 'What a roast date tells you',
        p: [
          'A roast date is the day the beans left the roaster. A best-by date is usually set 12 to 18 months later and says nothing about flavor. Look for the roast date first; if a bag only shows a best-by date, assume it was roasted long ago.',
          'Degassing is the release of carbon dioxide trapped during roasting. It is why fresh beans bloom when water hits them, and why espresso needs a few more days of rest than filter coffee.',
        ],
      },
      {
        h2: 'The freshness window by brew method',
        table: {
          head: ['Brew method', 'Rest after roasting', 'Best within'],
          rows: [
            ['Pour-over and drip', '3 to 5 days', '21 days'],
            ['Espresso', '5 to 7 days', '28 days'],
            ['French press', '2 to 4 days', '21 days'],
            ['Cold brew', '2 days', '30 days'],
          ],
        },
        p: [
          'These are starting points, not rules. Darker roasts degas faster and fade sooner; light roasts often need a week before they open up.',
        ],
      },
      {
        h2: 'How to store coffee beans',
        list: [
          'Keep beans in an airtight, opaque container',
          'Store them at room temperature, away from the stove and sunlight',
          'Grind right before brewing: ground coffee goes stale within an hour',
          'Freeze only what you will not use within a month, in small sealed portions',
        ],
        p: [
          'In our experience, a one-way valve bag kept closed with a clip works as well as most canisters for the first two weeks.',
        ],
      },
      {
        h2: 'Signs your coffee has gone stale',
        p: [
          'Stale beans smell flat or papery, barely bloom when you pour water over them, and brew a cup that tastes hollow and bitter. If a fresh grind smells of little at all, the beans are past their best.',
          'For a side by side test, brew one cup from a bag roasted last week and one from a supermarket bag. The difference in aroma and sweetness is the clearest lesson in freshness there is.',
        ],
      },
      {
        h2: 'Why we roast to order',
        p: [
          'Every Brewline bag is roasted after it is ordered and ships within 24 hours, so it arrives on day 2 or 3 and is ready to brew by the time you finish the bag before it. Independent guides such as the Roast Notes freshness guide reach the same window.',
        ],
      },
    ],
    links: [
      ['https://roastnotes.example/guides/espresso-beans', 'Roast Notes guide to espresso beans'],
      [
        'https://beanbulletin.example/best-coffee-subscriptions-2026',
        'Bean Bulletin subscription review',
      ],
    ],
    quote: [
      'Most home brewers open a bag too early for espresso and too late for pour-over.',
      'Maya Okafor, Head Roaster',
    ],
    faq: [
      [
        'Is coffee bad after the best-by date?',
        'It is safe, but it will taste flat. Use the roast date to judge freshness.',
      ],
      [
        'Should I freeze coffee beans?',
        'Only beans you will not use within a month, sealed in small portions.',
      ],
      [
        'How long does ground coffee stay fresh?',
        'Less than an hour at its best, so grind right before you brew.',
      ],
    ],
  },
  {
    path: '/blog/single-origin-vs-blend',
    kind: 'article',
    author: 'daniel',
    published: 95,
    modified: 33,
    title: 'Single Origin vs Blend: Which Coffee Should You Buy? | Brewline',
    description:
      'Single origin coffee shows off one place; a blend aims for balance. How they differ in taste, price and brewing, and which to buy for your brewer.',
    h1: 'Single Origin vs Blend: Which Coffee Should You Buy?',
    rounds: [2],
    intro:
      'Buy a single origin when you want to taste one place, and a blend when you want the same balanced cup every morning. Neither is better; they answer different questions.',
    sections: [
      {
        h2: 'What single origin means',
        p: [
          'A single origin coffee comes from one country, region or farm. Its flavor depends on the variety, the altitude and the process, so an Ethiopia Yirgacheffe and a Brazil Cerrado can taste nothing alike.',
        ],
      },
      {
        h2: 'What a blend is for',
        p: [
          'A blend combines two or more coffees to balance sweetness, body and acidity, and to stay consistent as harvests change. Our House Blend pairs a Brazil for body with a Colombia for sweetness.',
        ],
      },
      {
        h2: 'How they compare',
        table: {
          head: ['', 'Single origin', 'Blend'],
          rows: [
            ['Flavor', 'Distinct, changes by harvest', 'Balanced, consistent'],
            ['Best brewers', 'Pour-over, drip', 'Espresso, French press, drip'],
            ['Price per bag', '$17.50 to $21', '$15 to $16'],
          ],
        },
      },
      {
        h2: 'Which to choose',
        list: [
          'Pick a single origin to explore flavors on pour-over',
          'Pick a blend for milk drinks and a reliable daily cup',
          'Try the Single Origin Club to taste a new origin each month',
        ],
      },
    ],
    links: [['https://roastnotes.example/guides/single-origin-vs-blend', 'Roast Notes comparison']],
  },
  {
    path: '/blog/low-acid-coffee-guide',
    kind: 'article',
    author: 'daniel',
    published: 70,
    modified: 70,
    title: 'Low Acid Coffee: A Guide for Sensitive Stomachs | Brewline',
    description: 'Low acid coffee beans and brewing tips.',
    h1: 'Low Acid Coffee Guide',
    rounds: [2],
    noByline: true,
    intro:
      'Some people find coffee hard on the stomach. Darker roasts, beans from low-altitude farms and cold brew all tend to taste less acidic.',
    sections: [
      {
        h2: 'Which beans are lower in acid',
        p: [
          'Sumatra Mandheling and Brazil Cerrado are naturally low in perceived acidity. A darker roast lowers it further.',
        ],
      },
      {
        h2: 'Brewing for less acidity',
        p: [
          'Cold brew extracts fewer acids than hot water. A coarser grind and a shorter brew help too.',
        ],
      },
    ],
  },
  {
    path: '/blog/espresso-at-home',
    kind: 'article',
    author: 'maya',
    published: 45,
    modified: 12,
    title: 'Espresso at Home: A Beginner Recipe That Works | Brewline',
    description:
      'A simple espresso recipe for home machines: 18 grams in, 36 grams out in 28 seconds, plus how to fix sour or bitter shots.',
    h1: 'Espresso at Home: A Beginner Recipe That Works',
    rounds: [2],
    intro:
      'Start every espresso at 18 grams of coffee in, 36 grams out, in about 28 seconds. That 1:2 ratio is the baseline most cafes begin from, and it is the easiest place to learn what to change.',
    sections: [
      {
        h2: 'The base recipe',
        list: [
          'Dose: 18 grams of freshly ground coffee',
          'Yield: 36 grams of espresso in the cup',
          'Time: 25 to 30 seconds from the pump starting',
          'Water: 93 degrees Celsius if your machine lets you set it',
        ],
      },
      {
        h2: 'Fixing sour or bitter shots',
        p: [
          'A sour, thin shot ran too fast: grind finer. A bitter, harsh shot ran too slow: grind coarser. Change one thing at a time and taste after each change.',
          'We tested this recipe on four entry-level machines; in our testing the grind setting mattered more than the machine.',
        ],
      },
      {
        h2: 'Choosing beans for espresso',
        p: [
          'Medium to medium-dark roasts are the most forgiving. Our Espresso Roast was developed for home machines and pulls well from day 5 to day 28 after roasting.',
        ],
      },
    ],
    links: [['https://roastnotes.example/guides/espresso-beans', 'Roast Notes espresso guide']],
  },
  {
    path: '/about',
    kind: 'about',
    title: 'About Us | Brewline Coffee',
    description:
      'Brewline Coffee is a small-batch roaster founded in 2016. We roast every order fresh and ship it within a day of roasting.',
    h1: 'About Brewline Coffee',
    rounds: [2],
    intro:
      'Brewline Coffee was founded in 2016 by two home baristas who were tired of stale supermarket beans. Today our team of 14 roasts every order in small batches of 12 kg.',
    sections: [
      {
        h2: 'How we roast',
        p: [
          'Every bag ships within 24 hours of roasting. We roast in small batches of 12 kg and cup every batch before it is packed.',
        ],
      },
      {
        h2: 'Who we buy from',
        p: [
          'We buy green coffee from importers who publish what farmers are paid, and we list the farm or cooperative on every single origin bag.',
        ],
      },
      {
        h2: 'Our team',
        list: [
          'Maya Okafor, Head Roaster',
          'Daniel Reyes, Coffee Editor',
          'A customer care team that answers every email within one business day',
        ],
      },
    ],
  },
  {
    path: '/contact',
    kind: 'contact',
    title: 'Contact Us | Brewline Coffee',
    description:
      'Questions about an order or a subscription? Email hello@brewline.example and we answer within one business day.',
    h1: 'Contact Brewline Coffee',
    rounds: [2],
    intro:
      'Email hello@brewline.example about an order, a subscription or a wholesale account. We answer within one business day, Monday to Friday.',
    sections: [],
  },
  {
    path: '/faq',
    kind: 'faq',
    title: 'Frequently Asked Questions | Brewline Coffee',
    description:
      'Answers about roast dates, shipping, subscriptions, grinding and returns for Brewline Coffee orders.',
    h1: 'Frequently Asked Questions',
    rounds: [2],
    intro: 'Answers to the questions we hear most about orders, subscriptions and our coffee.',
    sections: [],
    faq: [
      [
        'When will my order ship?',
        'Within 24 hours of roasting, Monday to Friday. You get a tracking link by email.',
      ],
      [
        'How do I pause a subscription?',
        'Open your account, choose the subscription and select Pause or Skip.',
      ],
      ['Do you ship outside the US?', 'Not yet. We ship to all 50 US states.'],
      [
        'What if I do not like a coffee?',
        'Tell us within 30 days and we will send a different coffee or a refund.',
      ],
    ],
  },
];

/**
 * Pages of the site that aren't audited: they only list in Site Audit's page
 * inventory (and its templates) with their title.
 */
export const OTHER_PAGES = [
  {
    path: '/shipping',
    title: 'Shipping | Brewline Coffee',
    h1: 'Shipping',
    description: 'Free shipping on subscriptions; orders ship within 24 hours of roasting.',
  },
  {
    path: '/blog',
    title: 'Coffee Guides | Brewline Coffee',
    h1: 'Coffee Guides',
    description: 'Brewing guides, buying advice and roast notes from the Brewline team.',
  },
  ...AUTHORS.map((a) => ({
    path: a.path,
    title: `${a.name} | Brewline Coffee`,
    h1: a.name,
    description: `${a.name}, ${a.role} at Brewline Coffee. ${a.bio}`.slice(0, 160),
  })),
];

/**
 * A page that no longer exists: AI answers still link to it, so the
 * snippet sees visits land on a 404 (Broken AI links).
 */
export const BROKEN_PAGE = '/blog/cold-brew-ratio-guide';

/**
 * The searches Brewline shows up for on Google (Search Console): query,
 * daily impressions at the start and end of the window, average position.
 */
export const SEARCH_QUERIES = [
  ['brewline coffee', 140, 190, 1.2],
  ['brewline coffee subscription', 55, 80, 1.4],
  ['brewline espresso roast', 20, 34, 1.6],
  ['coffee subscription', 420, 520, 18.5],
  ['fresh roasted coffee beans', 260, 330, 9.8],
  ['how long do coffee beans stay fresh', 380, 470, 6.2],
  ['coffee roast date', 90, 120, 4.1],
  ['water process decaf', 150, 210, 7.4],
  ['best decaf coffee beans', 130, 170, 12.6],
  ['single origin vs blend coffee', 70, 95, 5.3],
  ['low acid coffee beans', 210, 240, 21.4],
  ['espresso beans for home', 160, 230, 11.1],
  ['colombia huila coffee', 45, 60, 8.9],
  ['coffee gift subscription', 180, 260, 15.7],
];
