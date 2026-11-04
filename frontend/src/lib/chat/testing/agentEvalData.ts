/**
 * The workspace the agents' and skills' test set runs in (agentEval.ts):
 * Brewline Coffee, the demo brand's world (backend/src/lib/demo/brewline.js),
 * with a week of numbers as GetCito's reads answer them. Every read of a
 * run answers from here, by its tool's name; the numbers a run may state are
 * the ones its reads returned. Made up, on `.example` domains that can
 * never belong to anyone. Tests only.
 */

const id = (group: string, n: number) => `${group}-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const EVAL_IDS = {
  brand: id('b1e00000', 1),
  /** A second brand of the workspace, outside every agent's scope. */
  otherBrand: id('b1e00000', 2),
  prompts: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => id('a1e00000', n)),
  topics: [1, 2, 3].map((n) => id('a2e00000', n)),
  competitors: [1, 2, 3, 4].map((n) => id('a3e00000', n)),
  drafts: [1, 2, 3].map((n) => id('a4e00000', n)),
  actions: [1, 2, 3, 4].map((n) => id('a5e00000', n)),
  tasks: [1, 2, 3, 4, 5, 6].map((n) => id('a6e00000', n)),
  mentions: [1, 2, 3, 4, 5].map((n) => id('a7e00000', n)),
  signals: [1, 2, 3].map((n) => id('a8e00000', n)),
  suggestions: [1, 2, 3].map((n) => id('a9e00000', n)),
  opportunities: [1, 2].map((n) => id('aae00000', n)),
  audit: id('abe00000', 1),
};

export const EVAL_BRAND = {
  id: EVAL_IDS.brand,
  name: 'Brewline Coffee',
  domain: 'brewline.example',
  region: 'US',
  language: 'en',
  site_type: 'ecommerce',
  industry: 'Food & Beverage',
  description:
    'Specialty coffee roaster selling freshly roasted whole beans by the bag and by subscription, shipped within a day of roasting.',
};

export const EVAL_OTHER_BRAND = {
  id: EVAL_IDS.otherBrand,
  name: 'Lumen Tea Co.',
  domain: 'lumentea.example',
};

/** The week the reads describe, and the one before it. */
export const EVAL_WEEK = { from: '2026-10-27', to: '2026-11-02' };
export const EVAL_LAST_WEEK = { from: '2026-10-20', to: '2026-10-26' };
export const EVAL_AS_OF = '2026-11-02T06:00:00.000Z';

const window = {
  brand: EVAL_BRAND.name,
  period: EVAL_WEEK,
  previous_period: EVAL_LAST_WEEK,
  data_as_of: EVAL_AS_OF,
};

const COMPETITORS = [
  {
    id: EVAL_IDS.competitors[0],
    name: 'Northbound Roasters',
    domain: 'northboundroasters.example',
  },
  { id: EVAL_IDS.competitors[1], name: 'Kettle & Crate', domain: 'kettleandcrate.example' },
  { id: EVAL_IDS.competitors[2], name: 'Morning Ritual Co.', domain: 'morningritual.example' },
  { id: EVAL_IDS.competitors[3], name: 'Daybreak Beans', domain: 'daybreakbeans.example' },
];
export const EVAL_COMPETITORS = COMPETITORS;

const TOPICS = [
  { id: EVAL_IDS.topics[0], name: 'Coffee subscriptions', prompts: 3 },
  { id: EVAL_IDS.topics[1], name: 'Whole bean coffee', prompts: 3 },
  { id: EVAL_IDS.topics[2], name: 'Buying better coffee', prompts: 2 },
];

const PLATFORMS = [
  { platform: 'ChatGPT', visibility_pct: 58, previous_pct: 51, change_pts: 7 },
  { platform: 'Perplexity', visibility_pct: 64, previous_pct: 71, change_pts: -7 },
  { platform: 'Gemini', visibility_pct: 47, previous_pct: 45, change_pts: 2 },
  { platform: 'Copilot', visibility_pct: 53, previous_pct: 52, change_pts: 1 },
  { platform: 'Google AI Mode', visibility_pct: 50, previous_pct: 49, change_pts: 1 },
  { platform: 'Google AI Overviews', visibility_pct: 41, previous_pct: 44, change_pts: -3 },
];

/** The tracked prompts: this week's visibility, last week's, and the searches a month where known. */
const PROMPTS = [
  {
    id: EVAL_IDS.prompts[0],
    text: 'What are the best coffee subscriptions in 2026?',
    topic: 'Coffee subscriptions',
    visibility_pct: 62,
    previous_pct: 70,
    change_pts: -8,
    searches_a_month: 8100,
    location: 'United States',
    leader: 'Northbound Roasters',
  },
  {
    id: EVAL_IDS.prompts[1],
    text: 'Which coffee subscription lets you pause or skip a delivery?',
    topic: 'Coffee subscriptions',
    visibility_pct: 74,
    previous_pct: 72,
    change_pts: 2,
    searches_a_month: 480,
    location: 'United States',
    leader: 'Brewline Coffee',
  },
  {
    id: EVAL_IDS.prompts[2],
    text: 'Freshest whole bean coffee delivered',
    topic: 'Whole bean coffee',
    visibility_pct: 55,
    previous_pct: 49,
    change_pts: 6,
    searches_a_month: 1900,
    location: 'United States',
    leader: 'Brewline Coffee',
  },
  {
    id: EVAL_IDS.prompts[3],
    text: 'How long do whole coffee beans stay fresh?',
    topic: 'Whole bean coffee',
    visibility_pct: 38,
    previous_pct: 41,
    change_pts: -3,
    searches_a_month: 6600,
    location: 'United States',
    leader: null,
  },
  {
    id: EVAL_IDS.prompts[4],
    text: 'Best coffee gift box for a coffee lover',
    topic: 'Buying better coffee',
    visibility_pct: 29,
    previous_pct: 27,
    change_pts: 2,
    searches_a_month: 3600,
    location: 'United States',
    leader: 'Morning Ritual Co.',
  },
  {
    id: EVAL_IDS.prompts[5],
    text: 'Is a coffee subscription worth it?',
    topic: 'Buying better coffee',
    visibility_pct: 46,
    previous_pct: 44,
    change_pts: 2,
    searches_a_month: 2400,
    location: 'United States',
    leader: null,
  },
  {
    id: EVAL_IDS.prompts[6],
    text: 'Light roast vs dark roast for espresso',
    topic: 'Whole bean coffee',
    visibility_pct: 21,
    previous_pct: 25,
    change_pts: -4,
    searches_a_month: null,
    location: 'United Kingdom',
    leader: null,
  },
  {
    id: EVAL_IDS.prompts[7],
    text: 'Cheapest specialty coffee subscription',
    topic: 'Coffee subscriptions',
    visibility_pct: 33,
    previous_pct: 39,
    change_pts: -6,
    searches_a_month: 1300,
    location: 'United States',
    leader: 'Daybreak Beans',
  },
];
export const EVAL_PROMPTS = PROMPTS;

const BLOG = 'https://brewline.example/blog/best-coffee-subscriptions-2026';
const FRESH = 'https://brewline.example/guides/how-long-coffee-beans-stay-fresh';
const SUBS = 'https://brewline.example/subscriptions';
const SHIPPING = 'https://brewline.example/faq/shipping-returns';
const GIFTS = 'https://brewline.example/gift-boxes';
const NB_GUIDE = 'https://northboundroasters.example/journal/coffee-subscription-guide';

const OWNED_CITATIONS = [
  { url: BLOG, citations: 21, previous: 38, change: -17, top_platform_lost: 'Perplexity' },
  { url: SUBS, citations: 31, previous: 35, change: -4, top_platform_lost: 'Gemini' },
  { url: FRESH, citations: 26, previous: 24, change: 2, top_platform_lost: null },
  { url: SHIPPING, citations: 9, previous: 11, change: -2, top_platform_lost: 'ChatGPT' },
  { url: GIFTS, citations: 9, previous: 13, change: -4, top_platform_lost: 'Perplexity' },
];

const EXTERNAL_CITATIONS = [
  {
    url: 'https://beanbulletin.example/best-coffee-subscriptions',
    kind: 'review site',
    citations: 34,
    previous: 31,
  },
  {
    url: 'https://coffeegeekly.example/subscription-reviews',
    kind: 'publisher',
    citations: 22,
    previous: 24,
  },
  {
    url: 'https://brewforum.example/t/which-subscription',
    kind: 'forum',
    citations: 18,
    previous: 15,
  },
  {
    url: 'https://roasterdirectory.example/coffee-subscriptions',
    kind: 'directory',
    citations: 15,
    previous: 12,
  },
  { url: 'https://giftguide.example/coffee-gifts', kind: 'publisher', citations: 11, previous: 9 },
];

const COMPETITOR_CITATIONS = [
  { competitor: 'Northbound Roasters', url: NB_GUIDE, citations: 29, previous: 12, change: 17 },
  {
    competitor: 'Northbound Roasters',
    url: 'https://northboundroasters.example/subscriptions',
    citations: 18,
    previous: 17,
    change: 1,
  },
  {
    competitor: 'Kettle & Crate',
    url: 'https://kettleandcrate.example/bundles',
    citations: 29,
    previous: 31,
    change: -2,
  },
  {
    competitor: 'Morning Ritual Co.',
    url: 'https://morningritual.example/gift-boxes',
    citations: 21,
    previous: 16,
    change: 5,
  },
  {
    competitor: 'Daybreak Beans',
    url: 'https://daybreakbeans.example/value-subscription',
    citations: 12,
    previous: 13,
    change: -1,
  },
];

const SHARE_OF_VOICE = [
  { brand: 'Brewline Coffee', share_pct: 31, previous_pct: 30, change_pts: 1 },
  { brand: 'Northbound Roasters', share_pct: 27, previous_pct: 25, change_pts: 2 },
  { brand: 'Kettle & Crate', share_pct: 19, previous_pct: 21, change_pts: -2 },
  { brand: 'Morning Ritual Co.', share_pct: 14, previous_pct: 14, change_pts: 0 },
  { brand: 'Daybreak Beans', share_pct: 9, previous_pct: 10, change_pts: -1 },
];

const SUMMARY = {
  ...window,
  visibility_pct: 52,
  previous_visibility_pct: 51,
  visibility_change_pts: 1,
  answers_analyzed: 1184,
  mention_rate_pct: 57,
  previous_mention_rate_pct: 55,
  citations: 418,
  previous_citations: 452,
  citations_change: -34,
  citations_change_pct: -7.5,
  owned_citations: 96,
  previous_owned_citations: 121,
  share_of_voice_pct: 31,
  previous_share_of_voice_pct: 30,
  sentiment: {
    positive_pct: 71,
    previous_positive_pct: 76,
    neutral_pct: 22,
    negative_pct: 7,
  },
  platforms: PLATFORMS,
};

const TREND = {
  ...window,
  by: 'day',
  // Perplexity fell on Oct 25, the day after Northbound updated its subscription guide.
  series: [
    { date: '2026-10-20', visibility_pct: 50, perplexity_pct: 72 },
    { date: '2026-10-21', visibility_pct: 51, perplexity_pct: 71 },
    { date: '2026-10-22', visibility_pct: 51, perplexity_pct: 72 },
    { date: '2026-10-23', visibility_pct: 52, perplexity_pct: 71 },
    { date: '2026-10-24', visibility_pct: 51, perplexity_pct: 70 },
    { date: '2026-10-25', visibility_pct: 50, perplexity_pct: 66 },
    { date: '2026-10-26', visibility_pct: 51, perplexity_pct: 65 },
    { date: '2026-10-27', visibility_pct: 51, perplexity_pct: 64 },
    { date: '2026-10-28', visibility_pct: 52, perplexity_pct: 64 },
    { date: '2026-10-29', visibility_pct: 52, perplexity_pct: 65 },
    { date: '2026-10-30', visibility_pct: 53, perplexity_pct: 63 },
    { date: '2026-10-31', visibility_pct: 52, perplexity_pct: 64 },
    { date: '2026-11-01', visibility_pct: 53, perplexity_pct: 64 },
    { date: '2026-11-02', visibility_pct: 52, perplexity_pct: 63 },
  ],
};

const FANOUTS = {
  ...window,
  fanouts: [
    { query: 'best coffee subscription 2026', seen: 14, brand_answers_it: true },
    { query: 'coffee subscription reviews', seen: 11, brand_answers_it: false },
    { query: 'fresh roasted coffee subscription', seen: 9, brand_answers_it: true },
    { query: 'coffee subscription can i pause', seen: 7, brand_answers_it: true },
    { query: 'coffee subscription shipping cost', seen: 6, brand_answers_it: false },
    { query: 'how fresh is subscription coffee roast date', seen: 5, brand_answers_it: false },
    { query: 'coffee subscription cancel anytime', seen: 5, brand_answers_it: false },
    { query: 'how long do coffee beans last after roasting', seen: 12, brand_answers_it: true },
    { query: 'best way to store coffee beans', seen: 9, brand_answers_it: false },
    { query: 'should you freeze coffee beans', seen: 6, brand_answers_it: false },
    { query: 'coffee gift box with grinder', seen: 4, brand_answers_it: false },
    { query: 'can i manage my coffee subscription in an app', seen: 3, brand_answers_it: false },
  ],
};

const ANSWERS = {
  ...window,
  answers: [
    {
      platform: 'Perplexity',
      prompt: PROMPTS[0].text,
      recommends: ['Northbound Roasters', 'Kettle & Crate', 'Brewline Coffee'],
      text: 'Northbound Roasters tops many 2026 lists for its small-batch single origins and a guide that compares price per cup and roast dates. Kettle & Crate is a value pick with large variety boxes. Brewline Coffee roasts to order and lets you pause or skip anytime.',
      cites: [NB_GUIDE, 'https://beanbulletin.example/best-coffee-subscriptions', BLOG],
    },
    {
      platform: 'ChatGPT',
      prompt: PROMPTS[0].text,
      recommends: ['Brewline Coffee', 'Northbound Roasters'],
      text: 'Brewline Coffee is a reliable choice for fresh whole beans shipped within a day of roasting, with a subscription you can pause or skip. Northbound Roasters is a frequent pick for light roasts.',
      cites: [SUBS, NB_GUIDE],
    },
    {
      platform: 'Gemini',
      prompt: PROMPTS[5].text,
      recommends: ['Kettle & Crate', 'Brewline Coffee'],
      text: 'A subscription is worth it if you drink coffee daily. Kettle & Crate offers frequent discounts. Brewline Coffee charges a $15 fee to cancel a subscription, so check the terms first.',
      cites: ['https://coffeegeekly.example/subscription-reviews'],
    },
    {
      platform: 'Perplexity',
      prompt: PROMPTS[4].text,
      recommends: ['Morning Ritual Co.', 'Kettle & Crate'],
      text: 'Morning Ritual Co. is a favorite for gift boxes and brewing kits. Kettle & Crate is popular for variety boxes.',
      cites: ['https://morningritual.example/gift-boxes', 'https://giftguide.example/coffee-gifts'],
    },
    {
      platform: 'ChatGPT',
      prompt: PROMPTS[3].text,
      recommends: [],
      text: 'Whole beans taste best within 2 to 4 weeks of their roast date. Store them airtight, away from light and heat.',
      cites: [FRESH, 'https://brewforum.example/t/which-subscription'],
    },
    {
      platform: 'Copilot',
      prompt: PROMPTS[7].text,
      recommends: ['Daybreak Beans', 'Kettle & Crate'],
      text: 'Daybreak Beans sells large bags at a low price per cup. Kettle & Crate runs frequent discounts. Brewline Coffee does not offer decaf.',
      cites: [
        'https://daybreakbeans.example/value-subscription',
        'https://roasterdirectory.example/coffee-subscriptions',
      ],
    },
  ],
};

const MENTIONS = [
  {
    id: EVAL_IDS.mentions[0],
    platform: 'Gemini',
    prompt: PROMPTS[5].text,
    sentiment: 'negative',
    excerpt:
      'Brewline Coffee charges a $15 fee to cancel a subscription, so check the terms first.',
    date: '2026-10-30',
  },
  {
    id: EVAL_IDS.mentions[1],
    platform: 'Copilot',
    prompt: PROMPTS[7].text,
    sentiment: 'neutral',
    excerpt: 'Brewline Coffee does not offer decaf.',
    date: '2026-10-31',
  },
  {
    id: EVAL_IDS.mentions[2],
    platform: 'ChatGPT',
    prompt: PROMPTS[0].text,
    sentiment: 'positive',
    excerpt:
      'Brewline Coffee is a reliable choice for fresh whole beans shipped within a day of roasting.',
    date: '2026-11-01',
  },
  {
    id: EVAL_IDS.mentions[3],
    platform: 'Perplexity',
    prompt: PROMPTS[0].text,
    sentiment: 'neutral',
    excerpt: 'Brewline Coffee roasts to order and lets you pause or skip anytime.',
    date: '2026-11-01',
  },
  {
    id: EVAL_IDS.mentions[4],
    platform: 'Google AI Overviews',
    prompt: PROMPTS[2].text,
    sentiment: 'negative',
    excerpt:
      'Brewline Coffee is well liked, but some reviewers mention slower shipping in busy weeks.',
    date: '2026-10-29',
  },
];

const DRAFTS = [
  {
    id: EVAL_IDS.drafts[0],
    title: 'Coffee subscription FAQ',
    status: 'ready',
    page_type: 'docs_faq',
    updated_at: '2026-10-30T14:00:00.000Z',
    live_url: null,
    // Ready: nothing waits for review and nothing is left to fill.
    waiting_suggestions: 0,
    quality: { readability: 71, trust: 58, eeat: 49 },
    passages: [
      {
        heading: 'Can I pause or skip a delivery?',
        text: 'Yes. Pause, skip or cancel anytime online, with no fees.',
        locked: true,
      },
      {
        heading: 'How much does a subscription cost?',
        text: 'Plans start at $16 per 12 oz bag, and shipping is free on subscriptions.',
        locked: false,
      },
      {
        heading: 'When does my coffee ship?',
        text: 'Every bag is roasted to order and ships within 1 day of roasting.',
        locked: false,
      },
    ],
    sources: [SUBS, SHIPPING],
  },
  {
    id: EVAL_IDS.drafts[1],
    title: 'How long do whole coffee beans stay fresh?',
    status: 'draft',
    page_type: 'guide',
    updated_at: '2025-02-14T09:00:00.000Z',
    live_url: FRESH,
    waiting_suggestions: 0,
    quality: { readability: 64, trust: 52, eeat: 48 },
    passages: [
      {
        heading: 'How long do beans stay fresh?',
        text: 'Whole beans taste best within 2 to 4 weeks of their roast date.',
        locked: true,
      },
      {
        heading: 'What our customers do',
        text: 'In our 2024 survey of 1,200 subscribers, 68% grind their beans at home.',
        locked: false,
      },
      { heading: 'Updated', text: 'Last updated February 14, 2025.', locked: false },
    ],
    sources: ['https://brewforum.example/t/which-subscription'],
  },
  {
    id: EVAL_IDS.drafts[2],
    title: 'Brewline Coffee vs Northbound Roasters',
    status: 'draft',
    page_type: 'comparison',
    updated_at: '2026-10-12T11:00:00.000Z',
    live_url: null,
    waiting_suggestions: 0,
    quality: { readability: 69, trust: 44, eeat: 41 },
    passages: [
      {
        heading: 'Which one should you pick?',
        text: 'Pick Brewline Coffee for roast-to-order freshness and a flexible plan; pick Northbound Roasters for light single origins.',
        locked: false,
      },
    ],
    sources: [NB_GUIDE, SUBS],
  },
];
export const EVAL_DRAFTS = DRAFTS;

const ACTIONS = [
  {
    id: EVAL_IDS.actions[0],
    number: 'AC-41',
    category: 'recover',
    title: 'Win back citations on the 2026 subscriptions guide',
    priority_score: 86,
    status: 'new',
    due: '2026-11-06',
    why: 'The guide lost 17 citations this week, mostly on Perplexity, after Northbound Roasters updated its own guide on 2026-10-24.',
    pages: [BLOG],
    tasks: [
      {
        id: EVAL_IDS.tasks[0],
        title: 'Refresh the guide against the pages Perplexity cites now',
        where: BLOG,
        how: 'Add a dated comparison table and a direct answer under each H2.',
        done_when: 'The page is updated with a dated comparison table.',
        status: 'todo',
      },
      {
        id: EVAL_IDS.tasks[1],
        title: 'Add an FAQ block from the top fan-outs',
        where: BLOG,
        how: 'Five to eight questions from the fan-outs, with FAQPage schema.',
        done_when: 'The FAQ block and its schema are on the page.',
        status: 'todo',
      },
    ],
  },
  {
    id: EVAL_IDS.actions[1],
    number: 'AC-42',
    category: 'compete',
    title: 'Close the gift box gap with Morning Ritual Co.',
    priority_score: 71,
    status: 'new',
    due: '2026-11-12',
    why: 'Morning Ritual Co. gained 5 citations on its gift box page; Brewline is at 29% visibility on the gift box prompt.',
    pages: [GIFTS],
    tasks: [
      {
        id: EVAL_IDS.tasks[2],
        title: 'Add a gift box comparison table to the gift boxes page',
        where: GIFTS,
        how: 'A table of what each box includes, with an as-of date.',
        done_when: 'The table is on the page.',
        status: 'todo',
      },
    ],
  },
  {
    id: EVAL_IDS.actions[2],
    number: 'AC-43',
    category: 'protect',
    title: 'Correct the cancellation fee claim on Gemini',
    priority_score: 64,
    status: 'in_progress',
    due: '2026-11-09',
    why: 'Gemini says Brewline charges a $15 fee to cancel; the subscriptions page says there are no fees.',
    pages: [SUBS],
    tasks: [
      {
        id: EVAL_IDS.tasks[3],
        title: 'Add a dated “Cancel anytime, no fees” passage to the subscriptions page',
        where: SUBS,
        how: 'One short passage near the top, with the date.',
        done_when: 'The passage is live on the subscriptions page.',
        status: 'todo',
      },
    ],
  },
  {
    id: EVAL_IDS.actions[3],
    number: 'AC-44',
    category: 'fix',
    title: 'Add Product schema to the subscription pages',
    priority_score: 52,
    status: 'new',
    due: '2026-11-20',
    why: 'The site audit found 4 pages without Product schema.',
    pages: [SUBS, GIFTS],
    tasks: [
      {
        id: EVAL_IDS.tasks[4],
        title: 'Add Product schema to the subscriptions page',
        where: SUBS,
        how: 'Product JSON-LD with name, brand, offers.',
        done_when: 'The audit passes the Product schema check.',
        status: 'todo',
      },
      {
        id: EVAL_IDS.tasks[5],
        title: 'Add Product schema to the gift boxes page',
        where: GIFTS,
        how: 'Product JSON-LD for each box.',
        done_when: 'The audit passes the Product schema check.',
        status: 'todo',
      },
    ],
  },
];
export const EVAL_ACTIONS = ACTIONS;

const SIGNALS = [
  {
    id: EVAL_IDS.signals[0],
    kind: 'lost_citation',
    category: 'recover',
    title: 'The 2026 subscriptions guide lost 17 citations',
    page: BLOG,
    detected: '2026-11-02',
  },
  {
    id: EVAL_IDS.signals[1],
    kind: 'competitor_gain',
    category: 'compete',
    title: 'Morning Ritual Co. gained on the gift box prompt',
    competitor: 'Morning Ritual Co.',
    prompt: PROMPTS[4].text,
    detected: '2026-11-02',
  },
  {
    id: EVAL_IDS.signals[2],
    kind: 'decaying_page',
    category: 'protect',
    title: 'A cited guide was last updated on 2025-02-14',
    page: FRESH,
    detected: '2026-11-01',
  },
];

const AUDIT = {
  audit_id: EVAL_IDS.audit,
  brand: EVAL_BRAND.name,
  audited_at: '2026-10-30',
  pages_audited: 24,
  score: 72,
  previous_score: 68,
  scores: { ai_crawler_access: 80, structured_data: 55, direct_answers: 61, metadata: 78 },
};

const AUDIT_ISSUES = {
  audited_at: '2026-10-30',
  issues: [
    {
      finding: 'GPTBot is blocked by robots.txt on /blog/',
      severity: 'high',
      pages: 1,
      example: BLOG,
    },
    { finding: 'Missing Product schema', severity: 'high', pages: 4, example: SUBS },
    { finding: 'No direct answer under the H2s', severity: 'medium', pages: 3, example: BLOG },
    { finding: 'dateModified is older than a year', severity: 'medium', pages: 1, example: FRESH },
    { finding: 'Missing meta description', severity: 'low', pages: 2, example: GIFTS },
  ],
};

/** The pages fetch_page opens; any other address answers 404. */
export const EVAL_PAGES: Readonly<Record<string, { title: string; text: string }>> = {
  [SUBS]: {
    title: 'Coffee subscriptions · Brewline Coffee',
    text: 'Brewline subscriptions: whole bean or ground, delivered weekly, every 2 weeks or monthly. Pause, skip or cancel anytime online, with no fees. Plans start at $16 per 12 oz bag, and shipping is free on subscriptions. Every bag is roasted to order and ships within 1 day of roasting. Decaf: a Swiss Water Process Colombia.',
  },
  [SHIPPING]: {
    title: 'Shipping and returns · Brewline Coffee',
    text: 'Orders ship from Portland, Oregon within 1 business day. Standard shipping is $5.95, and free on orders over $45 and on every subscription. Not happy with a bag? We replace it or refund it within 30 days.',
  },
  ['https://brewline.example/about']: {
    title: 'About · Brewline Coffee',
    text: 'Brewline Coffee was founded in 2016 in Portland, Oregon. We roast in small batches of 12 kg and print the roast date on every bag.',
  },
  [BLOG]: {
    title: 'The best coffee subscriptions in 2026 · Brewline Coffee',
    text: 'The best coffee subscriptions in 2026. Updated January 2026. What to look for: freshness, flexibility and price per bag. Brewline roasts to order and ships within 1 day. Our plans start at $16 per 12 oz bag.',
  },
  [FRESH]: {
    title: 'How long do whole coffee beans stay fresh? · Brewline Coffee',
    text: 'Last updated February 14, 2025. Whole beans taste best within 2 to 4 weeks of their roast date. In our 2024 survey of 1,200 subscribers, 68% grind their beans at home. Store beans airtight, away from light and heat.',
  },
  [GIFTS]: {
    title: 'Coffee gift boxes · Brewline Coffee',
    text: 'Gift boxes with two or three 12 oz bags of whole bean coffee and a tasting card. Ships within 1 day of roasting.',
  },
  [NB_GUIDE]: {
    title: 'Coffee subscription guide · Northbound Roasters',
    text: 'Updated October 24, 2026. We compared 9 coffee subscriptions on price per cup, roast date and flexibility, in one table, with an FAQ under it.',
  },
  ['https://roasterdirectory.example/coffee-subscriptions']: {
    title: 'Coffee subscriptions directory',
    text: 'Coffee subscriptions we list: Northbound Roasters, Kettle & Crate, Morning Ritual Co. Roasters can apply to be listed.',
  },
  ['https://beanbulletin.example/best-coffee-subscriptions']: {
    title: 'The best coffee subscriptions · Bean Bulletin',
    text: 'Our picks: 1. Northbound Roasters. 2. Kettle & Crate. 3. Brewline Coffee, for roast-to-order freshness.',
  },
  ['https://giftguide.example/coffee-gifts']: {
    title: 'Coffee gifts · Gift Guide',
    text: 'Our favourite coffee gifts: Morning Ritual Co. brewing kits and Kettle & Crate variety boxes.',
  },
};

/**
 * What each read answers, by tool name. A read of the other brand answers
 * as that brand: a run that wanders shows it.
 */
export function evalReadResult(tool: string, input: Record<string, unknown>): unknown {
  const brandId = typeof input.brand_id === 'string' ? input.brand_id : null;
  if (brandId && brandId !== EVAL_IDS.brand) {
    return brandId === EVAL_IDS.otherBrand
      ? { brand: EVAL_OTHER_BRAND.name, visibility_pct: 23, citations: 61, data_as_of: EVAL_AS_OF }
      : { error: 'not_found' };
  }
  switch (tool) {
    case 'list_brands':
      return {
        brands: [
          { ...EVAL_BRAND, tracked_platforms: PLATFORMS.map((p) => p.platform) },
          { ...EVAL_OTHER_BRAND, region: 'GB' },
        ],
      };
    case 'get_profile':
      return { name: 'Sam Rivera', role: 'admin', timezone: 'America/New_York' };
    case 'get_usage':
      return { ai_usage_pct_of_month: 40, period_ends: '2026-11-30' };
    case 'list_members':
      return {
        members: [
          { name: 'Sam Rivera', role: 'admin' },
          { name: 'Alex Kim', role: 'manager' },
        ],
      };
    case 'get_chat_policy':
      return { full_auto_for_agents: true, dont_ask_again: true };
    case 'list_connections':
      return {
        connections: [
          { kind: 'cms', provider: 'Webflow', status: 'connected' },
          { kind: 'google_search_console', status: 'connected' },
          { kind: 'google_analytics', status: 'not_connected' },
          { kind: 'catalog', status: 'not_connected' },
        ],
      };
    case 'get_overview_summary':
    case 'get_visibility_summary':
      return SUMMARY;
    case 'get_visibility_trend':
      return TREND;
    case 'list_prompts':
    case 'get_prompt_performance':
      return { ...window, prompts: PROMPTS };
    case 'get_prompt_volumes':
      return {
        volumes: PROMPTS.map((p) => ({ prompt: p.text, searches_a_month: p.searches_a_month })),
        source: 'Google Ads keyword data, United States',
      };
    case 'list_prompt_suggestions':
      return {
        suggestions: [
          {
            id: EVAL_IDS.suggestions[0],
            text: 'best decaf coffee subscription',
            searches_a_month: 720,
          },
          {
            id: EVAL_IDS.suggestions[1],
            text: 'coffee subscription for the office',
            searches_a_month: 390,
          },
          {
            id: EVAL_IDS.suggestions[2],
            text: 'single origin coffee subscription',
            searches_a_month: 1000,
          },
        ],
      };
    case 'get_prompt_insights':
      return { ...window, prompts: PROMPTS.slice(0, 4), fanouts: FANOUTS.fanouts.slice(0, 6) };
    case 'list_topics':
      return { topics: TOPICS };
    case 'get_fanouts':
      return FANOUTS;
    case 'list_ai_answers':
      return ANSWERS;
    case 'get_mentions_summary':
      return {
        ...window,
        mention_rate_pct: 57,
        previous_mention_rate_pct: 55,
        mentions: 675,
        previous_mentions: 641,
        sentiment: SUMMARY.sentiment,
      };
    case 'list_mentions':
      return { ...window, mentions: MENTIONS };
    case 'get_mention': {
      const mention = MENTIONS.find((m) => m.id === input.mention_id || m.id === input.id);
      const answer = ANSWERS.answers.find((a) => a.platform === mention?.platform);
      return mention
        ? { ...mention, full_text: answer?.text ?? mention.excerpt, cites: answer?.cites ?? [] }
        : { error: 'not_found' };
    }
    case 'get_mention_competitors':
      return {
        ...window,
        named_beside_brand: [
          { competitor: 'Northbound Roasters', share_of_answers_pct: 38 },
          { competitor: 'Kettle & Crate', share_of_answers_pct: 27 },
          { competitor: 'Morning Ritual Co.', share_of_answers_pct: 19 },
          { competitor: 'Daybreak Beans', share_of_answers_pct: 12 },
        ],
      };
    case 'get_mentions_perception':
      return {
        ...window,
        associations: [
          { theme: 'fresh, roasted-to-order beans', share_pct: 41 },
          { theme: 'flexible subscription', share_pct: 33 },
          { theme: 'premium price', share_pct: 18 },
          { theme: 'slower shipping in busy weeks', share_pct: 9 },
        ],
      };
    case 'list_citations':
      return {
        ...window,
        owned: OWNED_CITATIONS,
        external: EXTERNAL_CITATIONS,
        competitors: COMPETITOR_CITATIONS,
      };
    case 'list_competitors':
      return { competitors: COMPETITORS };
    case 'get_competitor_comparison':
      return {
        ...window,
        share_of_voice: SHARE_OF_VOICE,
        by_platform: [
          { platform: 'Perplexity', leader: 'Northbound Roasters', leader_pct: 34, brand_pct: 28 },
          { platform: 'ChatGPT', leader: 'Brewline Coffee', leader_pct: 35, brand_pct: 35 },
          { platform: 'Gemini', leader: 'Kettle & Crate', leader_pct: 29, brand_pct: 26 },
          { platform: 'Copilot', leader: 'Brewline Coffee', leader_pct: 32, brand_pct: 32 },
        ],
      };
    case 'get_shopping_visibility':
      return {
        product: 'Brewline House Blend Whole Bean 12 oz',
        appearances: [
          { platform: 'ChatGPT Shopping', region: 'US', shown_in: 9, answers: 20 },
          { platform: 'Google Shopping', region: 'DE', shown_in: 2, answers: 20 },
        ],
        rating: 4.6,
        reviews: 212,
        merchants: ['brewline.example', 'shopmart.example'],
        identifiers: { gtin: null, brand: 'Brewline Coffee', model: null },
      };
    case 'get_ai_traffic_summary':
      return {
        ...window,
        ai_sessions: 612,
        previous_ai_sessions: 548,
        by_source: [
          { source: 'ChatGPT', sessions: 344 },
          { source: 'Perplexity', sessions: 171 },
          { source: 'Gemini', sessions: 58 },
          { source: 'Copilot', sessions: 39 },
        ],
      };
    case 'get_gsc_summary':
      return {
        ...window,
        clicks: 3420,
        previous_clicks: 3610,
        impressions: 128400,
        top_pages: [
          { url: BLOG, clicks: 610, previous_clicks: 790 },
          { url: FRESH, clicks: 540, previous_clicks: 520 },
        ],
      };
    case 'get_ga_summary':
      return { connected: false };
    case 'get_site_audit_summary':
      return AUDIT;
    case 'list_site_audit_issues':
      return AUDIT_ISSUES;
    case 'list_action_center_tasks':
      return {
        actions: ACTIONS.map(({ tasks, ...action }) => ({ ...action, tasks: tasks.length })),
      };
    case 'get_action': {
      const action = ACTIONS.find((a) => a.id === input.action_id || a.number === input.number);
      return action ?? { error: 'not_found' };
    }
    case 'list_signals':
      return { signals: SIGNALS };
    case 'get_action_history':
      return {
        closed_this_week: [
          { number: 'AC-37', title: 'Add the roast date to product pages', closed: '2026-10-29' },
        ],
      };
    case 'get_action_center_kpis':
      return { open_actions: 4, closed_this_month: 3, positive_sentiment_pct: 71 };
    case 'get_onboarding_progress':
      return {
        open_steps: [
          {
            step: 'Connect Google Analytics',
            stage: 'Measure',
            href: '/dashboard/settings/integrations',
          },
        ],
      };
    case 'list_content_opportunities':
      return {
        opportunities: [
          {
            id: EVAL_IDS.opportunities[0],
            title: 'Coffee storage guide refresh',
            searches_a_month: 6600,
          },
          {
            id: EVAL_IDS.opportunities[1],
            title: 'Decaf subscription page',
            searches_a_month: 720,
          },
        ],
      };
    case 'list_drafts':
      return {
        drafts: DRAFTS.map(({ passages, sources, ...draft }) => ({
          ...draft,
          passages: passages.length,
          sources: sources.length,
        })),
      };
    case 'get_draft': {
      const draft = DRAFTS.find((d) => d.id === input.draft_id || d.id === input.id);
      return draft ?? { error: 'not_found' };
    }
    case 'get_brand_facts':
      // The brand's approved facts (Brand facts tab), each in its page's own words.
      return {
        brand: EVAL_BRAND.name,
        facts: [
          {
            kind: 'policy',
            text: 'Pause, skip or cancel anytime online, with no fees.',
            approved_at: '2026-10-02',
            source_url: SUBS,
          },
          {
            kind: 'product',
            text: 'Decaf: a Swiss Water Process Colombia.',
            approved_at: '2026-10-02',
            source_url: SUBS,
          },
          {
            kind: 'price',
            text: 'Plans start at $16 per 12 oz bag, and shipping is free on subscriptions.',
            approved_at: '2026-10-02',
            source_url: SUBS,
          },
          {
            kind: 'company',
            text: 'Brewline Coffee was founded in 2016 in Portland, Oregon.',
            approved_at: '2026-10-02',
            source_url: 'https://brewline.example/about',
          },
        ],
        data_as_of: EVAL_AS_OF,
      };
    case 'get_reports':
      return {
        reports: [{ title: 'Weekly AI visibility', period: EVAL_LAST_WEEK, created: '2026-10-26' }],
      };
    case 'explain_change':
      return {
        found: true,
        metric: 'visibility',
        platform: 'Perplexity',
        from_pct: 71,
        to_pct: 64,
        change_pts: -7,
        normal_swing_pts: 3,
        beyond_normal: true,
        window: { from: EVAL_LAST_WEEK.from, to: EVAL_WEEK.to },
        causes: [
          {
            kind: 'lost_citations',
            page: BLOG,
            detail: 'Its citations on Perplexity fell from 38 to 21 from 2026-10-25.',
          },
          {
            kind: 'competitor_gain',
            competitor: 'Northbound Roasters',
            page: NB_GUIDE,
            detail: 'Updated on 2026-10-24; its citations rose from 12 to 29.',
          },
        ],
        confidence: 'medium',
      };
    default:
      return { ...window, note: 'No data for this read in the test workspace.' };
  }
}
