/**
 * Brewline Coffee: the demo brand's facts and its sample world.
 *
 * Everything here is made up. The brand, its competitors and every
 * publisher, forum and shop it is cited on live on `.example` domains, which
 * can never belong to anyone (RFC 2606), so the demo never names a real
 * company or points at a real site (privacy first). All of it is English,
 * like the rest of the demo.
 */

export const BRAND = {
  name: 'Brewline Coffee',
  slug: 'demo-brewline-coffee',
  domain: 'brewline.example',
  industry: 'Food & Beverage',
  description:
    'Specialty coffee roaster selling freshly roasted whole beans by the bag and by subscription, shipped within a day of roasting.',
  region: 'US',
  language: 'en',
  siteType: 'ecommerce',
};

/** The tracked competitors, strongest first; `presence` is how often an answer names one. */
export const COMPETITORS = [
  {
    key: 'northbound',
    name: 'Northbound Roasters',
    domain: 'northboundroasters.example',
    presence: 0.62,
    traits: [
      'is a frequent pick for small-batch single origins',
      'gets praise for detailed tasting notes on every bag',
      'is known for a wide range of light roasts',
    ],
  },
  {
    key: 'kettle',
    name: 'Kettle & Crate',
    domain: 'kettleandcrate.example',
    presence: 0.46,
    traits: [
      'offers affordable bundles and frequent discounts',
      'is popular for its large variety boxes',
      'ships quickly, though roast dates can vary',
    ],
  },
  {
    key: 'ritual',
    name: 'Morning Ritual Co.',
    domain: 'morningritual.example',
    presence: 0.36,
    traits: [
      'is a favorite for gift boxes and brewing kits',
      'pairs its beans with simple brew guides for beginners',
      'focuses on smooth, medium roasts',
    ],
  },
  {
    key: 'daybreak',
    name: 'Daybreak Beans',
    domain: 'daybreakbeans.example',
    presence: 0.27,
    traits: [
      'is a budget-friendly option for everyday drinkers',
      'sells large bags at a low price per cup',
      'is often mentioned for dark, bold roasts',
    ],
  },
];

/** What an answer says about Brewline, by the sentiment it carries. */
export const BRAND_TRAITS = {
  positive: [
    'stands out for beans roasted to order and a subscription you can pause or skip anytime',
    'is praised for fresh, consistent roasts and clear roast dates on every bag',
    'earns strong reviews for flexible plans and friendly customer support',
    'is a reliable choice for fresh whole beans shipped within a day of roasting',
  ],
  neutral: [
    'offers whole-bean and ground subscriptions in several roast levels',
    'sells single origins and house blends by the bag or on a schedule',
    'has a subscription with weekly, biweekly and monthly deliveries',
  ],
  negative: [
    'has a solid range, though some reviewers mention slower shipping in busy weeks',
    'is well liked, but its prices sit above most supermarket brands',
  ],
};

/** The platforms the demo tracks, with how often each names Brewline at the start and end of the month. */
export const PLATFORMS = [
  { id: 'chatgpt-web', mention: [0.42, 0.6], citations: [3, 5] },
  { id: 'perplexity-web', mention: [0.52, 0.7], citations: [4, 6], fanout: 'perplexity' },
  { id: 'gemini-web', mention: [0.34, 0.5], citations: [2, 4] },
  { id: 'copilot-web', mention: [0.4, 0.56], citations: [3, 5], fanout: 'copilot' },
  { id: 'google-aimode', mention: [0.38, 0.54], citations: [3, 5] },
  { id: 'google-aio', mention: [0.3, 0.46], citations: [2, 3] },
];

export const TOPICS = [
  { key: 'subscriptions', name: 'Coffee subscriptions' },
  { key: 'beans', name: 'Whole bean coffee' },
  { key: 'buying', name: 'Buying better coffee' },
];

/**
 * The tracked prompts. `keywords` are the search volumes the Prompts page
 * shows ({ keyword: [monthly volume, competition index] }); `shopping` marks
 * the prompts whose answers carry product cards; `searches` are the searches
 * the engines that share them ran for it.
 */
export const PROMPTS = [
  {
    key: 'best-subscriptions',
    topic: 'subscriptions',
    text: 'What are the best coffee subscriptions in 2026?',
    lead: 'A few coffee subscriptions stand out this year for freshness and flexibility.',
    intent: 'best-top',
    shopping: true,
    keywords: {
      'best coffee subscription': [8100, 42],
      'coffee subscription': [22200, 55],
      'coffee subscription box': [2900, 61],
      'best coffee subscription 2026': [1300, 38],
    },
    searches: [
      'best coffee subscription 2026',
      'coffee subscription reviews',
      'fresh roasted coffee subscription',
    ],
  },
  {
    key: 'pause-skip',
    topic: 'subscriptions',
    text: 'Which coffee subscription lets you pause or skip a delivery?',
    lead: 'Most specialty roasters now let subscribers change their schedule online.',
    intent: 'recommendation',
    keywords: {
      'flexible coffee subscription': [480, 33],
      'pause coffee subscription': [210, 20],
      'coffee subscription skip delivery': [170, 18],
    },
    searches: ['coffee subscription pause anytime', 'flexible coffee delivery plan'],
  },
  {
    key: 'gift',
    topic: 'subscriptions',
    text: 'What is a good coffee subscription gift for a coffee lover?',
    lead: 'A prepaid subscription makes an easy gift that keeps arriving for months.',
    intent: 'recommendation',
    shopping: true,
    keywords: {
      'coffee subscription gift': [6600, 58],
      'coffee gift subscription': [2400, 52],
      'gift for coffee lovers': [14800, 70],
    },
    searches: ['coffee subscription gift ideas', 'prepaid coffee subscription gift'],
  },
  {
    key: 'worth-it',
    topic: 'subscriptions',
    text: 'Is a coffee bean subscription worth it?',
    lead: 'For people who brew at home every day, a subscription usually pays off in freshness.',
    intent: 'what-is',
    keywords: {
      'coffee bean subscription': [3600, 47],
      'is a coffee subscription worth it': [590, 22],
      'coffee subscription vs buying beans': [90, 15],
    },
    searches: ['is a coffee subscription worth it', 'coffee subscription cost per cup'],
  },
  {
    key: 'espresso',
    topic: 'beans',
    text: 'What are the best whole bean coffees for espresso at home?',
    lead: 'Espresso rewards fresh beans with a medium or darker roast.',
    intent: 'best-top',
    shopping: true,
    keywords: {
      'best espresso beans': [9900, 64],
      'best coffee beans for espresso': [5400, 60],
      'whole bean espresso': [1600, 49],
    },
    searches: ['best espresso beans for home', 'whole bean espresso roast'],
  },
  {
    key: 'buy-online',
    topic: 'beans',
    text: 'Where can I buy freshly roasted coffee beans online?',
    lead: 'Buying straight from a roaster is the surest way to get a recent roast date.',
    intent: 'recommendation',
    shopping: true,
    keywords: {
      'buy coffee beans online': [2900, 66],
      'fresh roasted coffee beans online': [1300, 51],
      'freshly roasted coffee delivery': [720, 44],
    },
    searches: ['buy fresh roasted coffee beans online', 'coffee roaster ships same day'],
  },
  {
    key: 'low-acid',
    topic: 'beans',
    text: 'Which coffee beans are best for a sensitive stomach?',
    lead: 'Low-acid beans and darker roasts tend to be gentler on the stomach.',
    intent: 'best-top',
    keywords: {
      'low acid coffee': [27100, 57],
      'low acid coffee beans': [4400, 49],
      'best coffee for sensitive stomach': [1900, 41],
    },
    searches: ['low acid coffee beans', 'coffee for sensitive stomach'],
  },
  {
    key: 'single-origin',
    topic: 'beans',
    text: 'Single-origin or blend: which coffee beans should I buy?',
    lead: 'Single origins show off one farm or region, while blends aim for balance.',
    intent: 'comparison',
    keywords: {
      'single origin coffee': [12100, 46],
      'single origin vs blend coffee': [480, 25],
      'coffee blend vs single origin': [260, 21],
    },
    searches: ['single origin vs blend coffee', 'best single origin coffee beans'],
  },
  {
    key: 'fair-trade',
    topic: 'buying',
    text: 'Which coffee roasters sell organic, fair trade beans?',
    lead: 'Several online roasters publish where their beans come from and what farmers are paid.',
    intent: 'recommendation',
    keywords: {
      'fair trade coffee beans': [2900, 50],
      'organic fair trade coffee': [2400, 47],
      'organic coffee roasters': [880, 39],
    },
    searches: ['organic fair trade coffee roasters', 'direct trade coffee beans'],
  },
  {
    key: 'decaf',
    topic: 'buying',
    text: 'What is the best decaf coffee that still tastes good?',
    lead: 'Decaf has improved a lot, especially beans decaffeinated with water instead of solvents.',
    intent: 'best-top',
    shopping: true,
    keywords: {
      'best decaf coffee': [12100, 53],
      'swiss water decaf': [3600, 35],
      'best decaf coffee beans': [2900, 48],
    },
    searches: ['best tasting decaf coffee beans', 'water process decaf coffee'],
  },
  {
    key: 'freshness',
    topic: 'buying',
    text: 'How fresh should coffee beans be when they arrive?',
    lead: 'Beans taste best within a few weeks of their roast date.',
    intent: 'what-is',
    keywords: {
      'fresh coffee beans': [5400, 43],
      'how long do coffee beans stay fresh': [4400, 18],
      'coffee roast date': [1000, 16],
    },
    searches: ['how long do coffee beans stay fresh', 'coffee roast date explained'],
  },
  {
    key: 'versus',
    topic: 'buying',
    text: 'Brewline Coffee vs Northbound Roasters: which subscription is better?',
    lead: 'Both are well-reviewed online roasters with flexible subscriptions.',
    intent: 'vs-review',
    // A prompt that names the brand: the answer always discusses it.
    namesBrand: true,
    keywords: {
      'northbound roasters review': [170, 12],
      'brewline coffee review': [110, 10],
      'brewline coffee vs northbound roasters': [40, 8],
    },
    searches: ['brewline coffee vs northbound roasters', 'northbound roasters subscription review'],
  },
];

/** Closing lines, one per answer. */
export const CLOSINGS = [
  'Check the roast date before you buy, and pick a grind that matches your brewer.',
  'Most of these offer a first-order discount, so it is easy to try a few.',
  'If you drink a lot of coffee, a subscription usually costs less per cup.',
  'Whichever you choose, store the beans airtight and away from light.',
];

/**
 * The pages answers cite, by owner. `brand` pages are Brewline's own; the
 * rest are competitors' and fictional publishers', review sites' and forums'.
 */
export const SOURCES = {
  brand: [
    { path: '/subscriptions', label: 'Coffee Subscriptions | Brewline Coffee' },
    {
      path: '/blog/how-fresh-should-coffee-beans-be',
      label: 'How Fresh Should Coffee Beans Be? | Brewline',
    },
    { path: '/coffee/espresso-roast', label: 'Espresso Roast Whole Beans | Brewline Coffee' },
    { path: '/coffee/decaf', label: 'Water Process Decaf | Brewline Coffee' },
    { path: '/gifts', label: 'Coffee Gift Subscriptions | Brewline Coffee' },
  ],
  competitor: {
    northbound: [
      { path: '/subscribe', label: 'Subscribe | Northbound Roasters' },
      { path: '/single-origins', label: 'Single Origins | Northbound Roasters' },
    ],
    kettle: [{ path: '/bundles', label: 'Coffee Bundles | Kettle & Crate' }],
    ritual: [{ path: '/gift-boxes', label: 'Gift Boxes | Morning Ritual Co.' }],
    daybreak: [{ path: '/bulk-coffee', label: 'Bulk Coffee Bags | Daybreak Beans' }],
  },
  publishers: [
    {
      domain: 'beanbulletin.example',
      pages: [
        {
          path: '/best-coffee-subscriptions-2026',
          label: 'The Best Coffee Subscriptions of 2026 | Bean Bulletin',
        },
        { path: '/best-decaf-coffee', label: 'Decaf That Tastes Like Coffee | Bean Bulletin' },
      ],
    },
    {
      domain: 'roastnotes.example',
      pages: [
        { path: '/guides/espresso-beans', label: 'Choosing Beans for Home Espresso | Roast Notes' },
        { path: '/guides/single-origin-vs-blend', label: 'Single Origin vs Blend | Roast Notes' },
      ],
    },
    {
      domain: 'cupcompare.example',
      pages: [
        {
          path: '/coffee-subscriptions-compared',
          label: 'Coffee Subscriptions Compared | Cup Compare',
        },
        { path: '/low-acid-coffee', label: 'Low-Acid Coffee Picks | Cup Compare' },
      ],
    },
    {
      domain: 'brewersforum.example',
      pages: [
        {
          path: '/t/which-subscription-do-you-use',
          label: 'Which subscription do you use? | Brewers Forum',
        },
        {
          path: '/t/fresh-beans-online',
          label: 'Where do you buy fresh beans online? | Brewers Forum',
        },
      ],
    },
    {
      domain: 'dailybrewnews.example',
      pages: [
        { path: '/fair-trade-roasters', label: 'Roasters Paying Farmers Fairly | Daily Brew News' },
        { path: '/coffee-gifts', label: 'Coffee Gifts Worth Giving | Daily Brew News' },
      ],
    },
  ],
};

/**
 * The product cards answers show for the shopping prompts. Prices in USD;
 * no images, so the demo loads nothing from outside.
 */
export const PRODUCTS = [
  {
    owner: 'brand',
    title: 'Brewline House Blend Subscription',
    path: '/subscriptions/house-blend',
    price: 18.0,
    rating: 4.8,
    reviews: 412,
  },
  {
    owner: 'brand',
    title: 'Brewline Espresso Roast, Whole Bean 12 oz',
    path: '/coffee/espresso-roast',
    price: 16.5,
    rating: 4.7,
    reviews: 238,
  },
  {
    owner: 'brand',
    title: 'Brewline Water Process Decaf',
    path: '/coffee/decaf',
    price: 17.0,
    rating: 4.6,
    reviews: 96,
  },
  {
    owner: 'northbound',
    title: 'Northbound Single Origin Subscription',
    path: '/subscribe',
    price: 21.0,
    rating: 4.7,
    reviews: 530,
  },
  {
    owner: 'kettle',
    title: 'Kettle & Crate Variety Box',
    path: '/bundles/variety',
    price: 14.0,
    rating: 4.3,
    reviews: 865,
  },
  {
    owner: 'ritual',
    title: 'Morning Ritual Gift Box',
    path: '/gift-boxes/classic',
    price: 32.0,
    rating: 4.5,
    reviews: 188,
  },
  {
    owner: 'daybreak',
    title: 'Daybreak Dark Roast 2 lb Bag',
    path: '/bulk-coffee/dark',
    price: 19.0,
    rating: 4.1,
    reviews: 1204,
  },
];
