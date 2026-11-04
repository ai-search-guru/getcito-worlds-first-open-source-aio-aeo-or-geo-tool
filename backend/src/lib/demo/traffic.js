/**
 * The demo brand's AI Referral Traffic (demo-site): its tracking snippet's
 * visits and journeys, its AI crawler hits, and what Google Analytics and
 * Search Console report for it, over 90 days.
 *
 * Each goes through the code that stores it live wherever that is pure:
 * Analytics' rows are GA4 reports in GA4's own shape, mapped by gaSync.js;
 * Search Console's are its API rows, mapped by gscSync.js; a journey event
 * is the snippet's body, made a row by trafficEvents.js's eventRow; a
 * visit's source and surface come from aiSources.js. The page
 * opportunities are pageOpportunities.js's own findings over these rows.
 *
 * The story it tells: AI visits grow over the quarter; Analytics has the
 * whole quarter, the snippet the last four weeks (a day with a snippet visit
 * is the snippet's, any other Analytics'); two of the shop's best-selling
 * pages get no AI visit at all; a guide AI answers still link to is gone.
 */

import { createHash } from 'node:crypto';
import supabaseAdmin from '../../config/supabase.js';
import { AI_SOURCES_VERSION, classifyAiSurface, landingMedium } from '../aiSources.js';
import {
  mapAiTrafficRows,
  mapChannelRows,
  mapItemRows,
  mapPageRows as mapGaPageRows,
} from '../gaSync.js';
import { mapAnalyticsRows, mapPageRows as mapGscPageRows } from '../gscSync.js';
import { detectPageOpportunities } from '../pageOpportunities.js';
import { eventRow } from '../trafficEvents.js';
import { BRAND } from './brewline.js';
import { demoId, seededRandom } from './random.js';
import { DAY_MS, brandCitations, dayBefore, dayStart } from './siteCommon.js';
import { allSettledOrThrow, demoWriter } from './write.js';
import { BROKEN_PAGE, CATALOG, SEARCH_QUERIES, SITE_URL } from './siteWorld.js';

/** Days of Google Analytics history, and of Search Console page history. */
export const GA_DAYS = 90;
/** The snippet went on the site this many days ago. */
export const SNIPPET_DAYS = 28;
/** Conversions (CE-017) were turned on this many days ago. */
export const CONVERSION_DAYS = 20;
/** Days of Search Console query history (its sync's window) and of AI crawler counts. */
export const QUERY_DAYS = 28;
export const BOT_DAYS = 30;
/** Raw AI crawler hits kept: the last few days of the daily counts. */
const BOT_EVENT_DAYS = 2;
/** Search Console reports a day this late. */
const GSC_DELAY_DAYS = 2;

/** The demo's GA4 property (the web's DEMO_ANALYTICS_PROPERTY_ID) and Search Console property. */
export const GA_PROPERTY_ID = '100000000';
export const GSC_PROPERTY = `sc-domain:${BRAND.domain}`;

/** The AI assistants visitors come from: their source key (ai-sources.json), share and referrer. */
const AI_PLATFORMS = [
  { key: 'chatgpt.com', share: 0.5, referrer: 'https://chatgpt.com/' },
  { key: 'perplexity.ai', share: 0.19, referrer: 'https://www.perplexity.ai/' },
  { key: 'gemini.google.com', share: 0.12, referrer: 'https://gemini.google.com/' },
  { key: 'copilot.microsoft.com', share: 0.11, referrer: 'https://copilot.microsoft.com/' },
  { key: 'claude.ai', share: 0.08, referrer: 'https://claude.ai/' },
];

/** Where AI visitors land, by weight: the pages the demo's answers cite and link. */
const AI_PAGES = [
  ['/coffee/espresso-roast', 16],
  ['/blog/how-fresh-should-coffee-beans-be', 15],
  ['/subscriptions', 14],
  ['/', 10],
  ['/subscriptions/house-blend', 9],
  ['/coffee/decaf', 8],
  ['/gifts', 6],
  ['/blog/single-origin-vs-blend', 6],
  ['/blog/espresso-at-home', 5],
  ['/coffee/ethiopia-yirgacheffe', 4],
  ['/blog/low-acid-coffee-guide', 3],
  ['/collections/single-origin', 2],
];

/**
 * Every landing page Analytics reports, with its daily sessions from all
 * channels and its revenue a day: Colombia Huila and the Espresso Club sell
 * well and get no AI visit (the page opportunities).
 */
const GA_PAGES = [
  ['/', 120, 60],
  ['/subscriptions', 62, 400],
  ['/coffee/colombia-huila', 34, 300],
  ['/subscriptions/espresso-club', 22, 280],
  ['/coffee/espresso-roast', 46, 250],
  ['/subscriptions/house-blend', 26, 150],
  ['/coffee/house-blend', 24, 120],
  ['/coffee/decaf', 21, 90],
  ['/gifts', 16, 80],
  ['/coffee/ethiopia-yirgacheffe', 14, 55],
  ['/collections/single-origin', 27, 40],
  ['/blog/how-fresh-should-coffee-beans-be', 41, 12],
  ['/blog/single-origin-vs-blend', 17, 6],
  ['/blog/espresso-at-home', 12, 5],
  ['/blog/low-acid-coffee-guide', 9, 2],
];

/** Sessions a day by Analytics' default channel group, AI Assistant aside (it is the AI sessions). */
const CHANNELS = [
  ['Organic Search', 0.46],
  ['Direct', 0.24],
  ['Email', 0.1],
  ['Paid Search', 0.1],
  ['Organic Social', 0.1],
];

/** The products Analytics reports item views and sales for: the best sellers' first variant. */
const GA_ITEMS = ['BL-ESP', 'BL-SUB-HOU', 'BL-COL', 'BL-SUB-ESP', 'BL-DEC', 'BL-ETH'];

/** Pages Search Console reports clicks for; the low-acid guide loses clicks while impressions rise. */
const GSC_PAGES = [
  ['/', 210, 260, 2.1],
  ['/subscriptions', 160, 230, 9.4],
  ['/blog/how-fresh-should-coffee-beans-be', 300, 420, 5.8],
  ['/coffee/espresso-roast', 120, 170, 10.2],
  ['/coffee/decaf', 110, 150, 7.9],
  ['/blog/single-origin-vs-blend', 70, 95, 5.6],
  ['/coffee/colombia-huila', 50, 65, 8.7],
  ['/blog/low-acid-coffee-guide', 150, 260, 6.1, 'losing'],
];

/** AI crawlers (ai-bots.json), how many hits a day each makes, and the pages they read. */
const BOTS = [
  ['gptbot', 'training', 9],
  ['oai-searchbot', 'search', 6],
  ['chatgpt-user', 'user', 7],
  ['claudebot', 'training', 5],
  ['perplexitybot', 'search', 4],
  ['perplexity-user', 'user', 3],
];
const BOT_PAGES = [
  ['/', 5],
  ['/subscriptions', 4],
  ['/coffee/espresso-roast', 4],
  ['/blog/how-fresh-should-coffee-beans-be', 4],
  ['/coffee/decaf', 2],
  ['/blog/single-origin-vs-blend', 2],
  ['/collections/single-origin', 2],
  ['/robots.txt', 2],
  ['/sitemap.xml', 1],
  [BROKEN_PAGE, 1],
];

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36',
];
const SCREENS = ['1440x900', '1920x1080', '390x844', '412x915'];
const COUNTRIES = [
  ['US', 0.78],
  ['CA', 0.09],
  ['GB', 0.08],
  ['AU', 0.05],
];

const SEED = 'brewline-traffic';

/** A page's address as a browser has it (the home page with its slash). */
const href = (path) => `${SITE_URL}${path}`;

/** One of a weighted list's items ([item, weight, ...]). */
function weighted(rng, list, weightAt = 1) {
  const total = list.reduce((sum, item) => sum + item[weightAt], 0);
  let roll = rng.next() * total;
  for (const item of list) {
    roll -= item[weightAt];
    if (roll < 0) return item;
  }
  return list.at(-1);
}

const platformOf = (rng) => {
  let roll = rng.next();
  for (const platform of AI_PLATFORMS) {
    roll -= platform.share;
    if (roll < 0) return platform;
  }
  return AI_PLATFORMS[0];
};

/** About `mean`, give or take `spread` of it. */
const around = (rng, mean, spread = 0.2) => Math.max(0, mean * (1 + (rng.next() * 2 - 1) * spread));

const isWeekend = (day) => [0, 6].includes(new Date(dayStart(day)).getUTCDay());

/** A page's share of its visitors that buy, and what an order is worth. */
function buyerRate(path) {
  if (path.startsWith('/subscriptions')) return 0.08;
  if (path.startsWith('/coffee/') || path === '/gifts') return 0.06;
  if (path.startsWith('/blog/')) return 0.012;
  return 0.03;
}

/**
 * Analytics' AI sessions, one at a time over the quarter: the day, the
 * assistant, the landing page, and what the visitor did. Shared by the GA
 * rows and the snippet, which counts a little more of the same visits.
 */
function aiDays(now) {
  const days = [];
  for (let back = GA_DAYS; back >= 1; back--) {
    const day = dayBefore(now, back);
    const rng = seededRandom(`${SEED}:ai:${back}`);
    const growth = (GA_DAYS - back) / (GA_DAYS - 1);
    const mean = (11 + 13 * growth) * (isWeekend(day) ? 0.75 : 1);
    days.push({ day, back, sessions: Math.round(around(rng, mean)) });
  }
  return days;
}

/** A GA4 report in the Data API's shape, from rows of { dimension: value, metric: value }. */
function gaReport(dimensions, metrics, rows) {
  return {
    dimensionHeaders: dimensions.map((name) => ({ name })),
    metricHeaders: metrics.map((name) => ({ name, type: 'TYPE_INTEGER' })),
    rows: rows.map((row) => ({
      dimensionValues: dimensions.map((name) => ({ value: String(row[name]) })),
      metricValues: metrics.map((name) => ({ value: String(row[name] ?? 0) })),
    })),
  };
}

const TRAFFIC_METRICS = [
  'sessions',
  'engagedSessions',
  'keyEvents',
  'sessionKeyEventRate',
  'totalUsers',
  'transactions',
  'purchaseRevenue',
  'userEngagementDuration',
];

/** A group of sessions' GA4 metrics: engagement, key events (orders and signups), revenue. */
function sessionMetrics(rng, path, sessions) {
  let orders = 0;
  let signups = 0;
  let revenue = 0;
  let engaged = 0;
  let seconds = 0;
  for (let i = 0; i < sessions; i++) {
    if (rng.chance(path.startsWith('/blog/') ? 0.74 : 0.64)) engaged++;
    seconds += Math.round(around(rng, path.startsWith('/blog/') ? 150 : 80, 0.5));
    if (rng.chance(buyerRate(path))) {
      orders++;
      revenue += rng.pick([16.5, 17.5, 18, 22, 34, 38, 54]);
    } else if (rng.chance(0.02)) signups++;
  }
  const keyEventSessions = orders + signups;
  return {
    sessions,
    engagedSessions: engaged,
    keyEvents: orders + signups,
    sessionKeyEventRate: sessions ? keyEventSessions / sessions : 0,
    totalUsers: Math.max(1, sessions - Math.floor(sessions / 9)),
    transactions: orders,
    purchaseRevenue: Math.round(revenue * 100) / 100,
    userEngagementDuration: seconds,
  };
}

/** The GA4 rows of the quarter: AI sessions by source and page, pages, channels and items. */
function analyticsRows(brandId, now) {
  const aiRows = [];
  const aiByDayPage = new Map();
  for (const { day, back, sessions } of aiDays(now)) {
    const rng = seededRandom(`${SEED}:ga-ai:${back}`);
    const groups = new Map();
    for (let i = 0; i < sessions; i++) {
      const platform = platformOf(rng);
      const [path] = weighted(rng, AI_PAGES);
      // ChatGPT Shopping: a product card's link carries utm_medium=feed (#1283).
      const shopping =
        platform.key === 'chatgpt.com' && path.startsWith('/coffee/') && rng.chance(0.3);
      const key = `${platform.key}|${path}|${shopping}`;
      groups.set(key, { platform, path, shopping, n: (groups.get(key)?.n ?? 0) + 1 });
    }
    for (const { platform, path, shopping, n } of groups.values()) {
      const query =
        platform.key === 'chatgpt.com'
          ? `${path}?utm_source=chatgpt.com${shopping ? '&utm_medium=feed' : ''}`
          : path;
      aiRows.push({
        date: day.replace(/-/g, ''),
        sessionSource: platform.key,
        sessionMedium: shopping ? 'feed' : 'referral',
        sessionDefaultChannelGroup: 'AI Assistant',
        landingPage: path,
        landingPagePlusQueryString: query,
        ...sessionMetrics(rng, path, n),
      });
      aiByDayPage.set(`${day}|${path}`, (aiByDayPage.get(`${day}|${path}`) ?? 0) + n);
    }
  }

  const pageRows = [];
  const channelRows = [];
  for (let back = GA_DAYS; back >= 1; back--) {
    const day = dayBefore(now, back);
    const rng = seededRandom(`${SEED}:ga-pages:${back}`);
    const weekend = isWeekend(day) ? 0.8 : 1;
    let other = 0;
    let ai = 0;
    for (const [path, daily, revenue] of GA_PAGES) {
      const aiSessions = aiByDayPage.get(`${day}|${path}`) ?? 0;
      const sessions = Math.round(around(rng, daily * weekend)) + aiSessions;
      const metrics = sessionMetrics(rng, path, sessions);
      // The page's own revenue level, so the best sellers rank as they should.
      metrics.purchaseRevenue = Math.round(around(rng, revenue * weekend, 0.3) * 100) / 100;
      metrics.transactions = Math.max(
        metrics.transactions,
        Math.round(metrics.purchaseRevenue / 24),
      );
      pageRows.push({ date: day.replace(/-/g, ''), landingPage: path, ...metrics });
      other += sessions - aiSessions;
      ai += aiSessions;
    }
    for (const [channel, share] of CHANNELS) {
      const sessions = Math.round(other * 1.3 * share);
      channelRows.push({
        date: day.replace(/-/g, ''),
        sessionDefaultChannelGroup: channel,
        ...sessionMetrics(rng, '/', sessions),
      });
    }
    channelRows.push({
      date: day.replace(/-/g, ''),
      sessionDefaultChannelGroup: 'AI Assistant',
      ...sessionMetrics(rng, '/coffee/', ai),
    });
  }

  const itemRows = [];
  for (let back = QUERY_DAYS; back >= 1; back--) {
    const rng = seededRandom(`${SEED}:ga-items:${back}`);
    for (const id of GA_ITEMS) {
      const product = CATALOG.find((p) => p.id === id);
      const [label, price] = (product.sizes ?? product.bags)[0];
      const viewed = Math.round(around(rng, 30));
      const added = Math.round(viewed * around(rng, 0.18, 0.3));
      const purchased = Math.round(added * around(rng, 0.45, 0.3));
      itemRows.push({
        date: dayBefore(now, back).replace(/-/g, ''),
        itemId: `${id}-${label.replace(/\s+/g, '').toUpperCase()}`,
        itemName: `${product.title} - ${label}`,
        itemCategory: product.type,
        itemsViewed: viewed,
        itemsAddedToCart: added,
        itemsPurchased: purchased,
        itemRevenue: Math.round(purchased * price * 100) / 100,
      });
    }
  }

  // Stored as each day's sync wrote it: the morning after.
  const synced = (row) => ({
    ...row,
    created_at: new Date(Math.min(dayStart(row.date) + DAY_MS * 1.27, now.getTime())).toISOString(),
  });
  return {
    ai: mapAiTrafficRows(
      brandId,
      gaReport(
        [
          'date',
          'sessionSource',
          'sessionMedium',
          'sessionDefaultChannelGroup',
          'landingPage',
          'landingPagePlusQueryString',
        ],
        TRAFFIC_METRICS,
        aiRows,
      ),
    ).map(synced),
    pages: mapGaPageRows(brandId, gaReport(['date', 'landingPage'], TRAFFIC_METRICS, pageRows)).map(
      synced,
    ),
    channels: mapChannelRows(
      brandId,
      gaReport(['date', 'sessionDefaultChannelGroup'], TRAFFIC_METRICS, channelRows),
    ).map(synced),
    items: mapItemRows(
      brandId,
      gaReport(
        ['date', 'itemId', 'itemName', 'itemCategory'],
        ['itemsViewed', 'itemsAddedToCart', 'itemsPurchased', 'itemRevenue'],
        itemRows,
      ),
    ).map(synced),
  };
}

/** Sessions per landing page over the last 30 days, as the page inventory reads Analytics. */
export function gaSessionsByPath(now) {
  const date = now instanceof Date ? now : new Date(now);
  const since = dayBefore(date, 30);
  const sessions = new Map();
  for (const row of analyticsRows('', date).pages) {
    if (row.date < since) continue;
    sessions.set(row.landing_page, (sessions.get(row.landing_page) ?? 0) + row.sessions);
  }
  return sessions;
}

/** Click-through rate at a Google position. */
const ctrAt = (position) => Math.min(0.32, 0.32 / position ** 1.15);

/** Search Console's query and page rows, as its API returns them ({ keys, clicks, … }). */
function searchRows(brandId, now) {
  const queries = [];
  for (let back = QUERY_DAYS + GSC_DELAY_DAYS - 1; back >= GSC_DELAY_DAYS; back--) {
    const rng = seededRandom(`${SEED}:gsc-q:${back}`);
    const progress = (QUERY_DAYS + GSC_DELAY_DAYS - 1 - back) / (QUERY_DAYS - 1);
    for (const [query, from, to, position] of SEARCH_QUERIES) {
      const impressions = Math.round(around(rng, from + (to - from) * progress, 0.15));
      const pos = Math.max(1, position + (rng.next() * 2 - 1) * 0.8);
      const clicks = Math.round(impressions * ctrAt(pos) * around(rng, 1, 0.2));
      queries.push({
        keys: [query, dayBefore(now, back)],
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : 0,
        position: Math.round(pos * 10) / 10,
      });
    }
  }
  const pages = [];
  for (let back = GA_DAYS + GSC_DELAY_DAYS - 1; back >= GSC_DELAY_DAYS; back--) {
    const rng = seededRandom(`${SEED}:gsc-p:${back}`);
    const progress = (GA_DAYS + GSC_DELAY_DAYS - 1 - back) / (GA_DAYS - 1);
    for (const [path, from, to, position, trend] of GSC_PAGES) {
      const impressions = Math.round(around(rng, from + (to - from) * progress, 0.15));
      const pos = Math.max(1, position + (rng.next() * 2 - 1) * 0.6);
      // An AI Overview answers it on the results page: fewer clicks as it shows more.
      const ctr = ctrAt(pos) * (trend === 'losing' ? 1 - 0.6 * progress : 1);
      const clicks = Math.round(impressions * ctr * around(rng, 1, 0.2));
      pages.push({
        keys: [href(path), dayBefore(now, back)],
        clicks,
        impressions,
        ctr: impressions ? clicks / impressions : 0,
        position: Math.round(pos * 10) / 10,
      });
    }
  }
  const synced = (row) => ({
    ...row,
    created_at: new Date(
      Math.min(dayStart(row.date) + DAY_MS * (GSC_DELAY_DAYS + 0.27), now.getTime()),
    ).toISOString(),
  });
  return {
    queries: mapAnalyticsRows(brandId, queries).map(synced),
    pages: mapGscPageRows(brandId, pages).map(synced),
  };
}

const hex = (text) => createHash('sha256').update(text).digest('hex');
/** The snippet's own visitor id (a random 22-character id, CE-017). */
const visitorIdOf = (n) =>
  createHash('sha256').update(`${SEED}:journey:${n}`).digest('base64url').slice(0, 22);

/**
 * The snippet's visits (ai_traffic_logs) over its four weeks, and the
 * journeys (ai_traffic_events) of the visitors since conversions went on.
 */
function snippetRows(brandId, now) {
  const nowMs = now.getTime();
  const days = new Map(aiDays(now).map((d) => [d.back, d.sessions]));
  const visits = [];
  const pageviews = [];
  const events = [];
  let journey = 0;
  for (let back = SNIPPET_DAYS; back >= 0; back--) {
    const rng = seededRandom(`${SEED}:snippet:${back}`);
    const day = dayBefore(now, back);
    // The snippet counts a little more than Analytics (blocked cookies, no consent).
    const gaSessions = days.get(back) ?? days.get(1);
    let count = Math.round(around(rng, gaSessions * 1.15, 0.1));
    if (back === 0) count = Math.floor((count * (nowMs - dayStart(day))) / DAY_MS);
    for (let i = 0; i < count; i++) {
      // US daytime, mostly (13:00 to 04:00 UTC); today's up to a few minutes ago.
      const at =
        back === 0
          ? dayStart(day) + Math.floor(rng.next() * (nowMs - 5 * 60 * 1000 - dayStart(day)))
          : dayStart(day) + Math.floor(((13 + rng.next() * 15) % 24) * 60 * 60 * 1000);
      const platform = platformOf(rng);
      const broken = rng.chance(0.025);
      const [path] = broken ? [BROKEN_PAGE] : weighted(rng, AI_PAGES);
      const shopping =
        platform.key === 'chatgpt.com' && path.startsWith('/coffee/') && rng.chance(0.3);
      const url =
        platform.key === 'chatgpt.com'
          ? `${href(path)}?utm_source=chatgpt.com${shopping ? '&utm_medium=feed' : ''}`
          : href(path);
      const visitor = {
        visitor_key: hex(`${SEED}:visitor:${back}:${i}`),
        user_agent: rng.pick(USER_AGENTS),
        country: weighted(rng, COUNTRIES)[0],
        language: rng.chance(0.9) ? 'en-US' : 'en-GB',
        screen: rng.pick(SCREENS),
      };
      const id = demoId(brandId, `visit:${back}:${i}`);
      const row = (pageId, pageUrlValue, when, status) => ({
        id: pageId,
        brand_id: brandId,
        url: pageUrlValue,
        referrer: platform.referrer,
        source_platform: platform.key,
        source_surface: classifyAiSurface(platform.key, landingMedium(pageUrlValue)),
        ...visitor,
        visit_of: pageId === id ? null : id,
        source_list_version: AI_SOURCES_VERSION,
        http_status: status,
        not_found_title: false,
        created_at: new Date(when).toISOString(),
      });
      visits.push(row(id, url, at, broken ? 404 : 200));
      // A reload or a second link from the same answer continues the visit (AT-003).
      const more = rng.chance(0.25) ? rng.int(1, 2) : 0;
      for (let j = 1; j <= more && at + j * 4 * 60_000 < nowMs; j++) {
        const [next] = weighted(rng, AI_PAGES);
        pageviews.push(
          row(demoId(brandId, `visit:${back}:${i}:${j}`), href(next), at + j * 4 * 60_000, 200),
        );
      }

      // Journeys: the visitor's next pages and what they bought or signed up for.
      if (back > CONVERSION_DAYS || broken || !rng.chance(0.18)) continue;
      journey += 1;
      const visitorId = visitorIdOf(journey);
      const first = { s: platform.key, u: url, at };
      const steps = [
        path,
        ...rng
          .shuffle(['/subscriptions', '/coffee/espresso-roast', '/cart', '/gifts'])
          .slice(0, rng.int(0, 2)),
      ];
      steps.forEach((step, k) => {
        const when = Math.min(at + k * 90_000, nowMs - 60_000);
        const event = eventRow(brandId, { k: 'pv', id: visitorId, u: href(step), f: first }, when);
        if (event) {
          events.push({
            id: demoId(brandId, `journey:${journey}:${k}`),
            ...event,
            occurred_at: new Date(when).toISOString(),
          });
        }
      });
      const buys = rng.chance(buyerRate(path) * 4);
      const signs = !buys && rng.chance(0.08);
      if (!buys && !signs) continue;
      const when = Math.min(at + steps.length * 90_000 + 60_000, nowMs - 30_000);
      const body = buys
        ? {
            k: 'cv',
            id: visitorId,
            u: `${SITE_URL}/checkout/thank-you`,
            f: first,
            g: 'order',
            o: 'call',
            val: rng.pick([16.5, 18, 22, 34, 38, 54]),
            cur: 'USD',
            q: rng.int(1, 2),
            ref: `BL-${10_200 + journey}`,
          }
        : {
            k: 'cv',
            id: visitorId,
            u: href(path),
            f: first,
            g: 'newsletter',
            o: 'form',
            n: 'newsletter-footer',
          };
      const conversion = eventRow(brandId, body, when);
      if (conversion) {
        events.push({
          id: demoId(brandId, `journey:${journey}:cv`),
          ...conversion,
          occurred_at: new Date(when).toISOString(),
        });
      }
    }
  }
  return { visits, pageviews, events };
}

/** The AI crawlers' daily counts, their last days' raw hits, and the Worker sending them. */
function botRows(brandId, now) {
  const nowMs = now.getTime();
  const daily = [];
  const events = [];
  let lastHit = 0;
  for (let back = BOT_DAYS - 1; back >= 0; back--) {
    const day = dayBefore(now, back);
    const rng = seededRandom(`${SEED}:bots:${back}`);
    const end = back === 0 ? nowMs - 10 * 60 * 1000 : dayStart(day) + DAY_MS - 1;
    for (const [bot, type, mean] of BOTS) {
      const hits = Math.round(around(rng, mean, 0.5) * ((end - dayStart(day)) / DAY_MS));
      const pages = new Map();
      const read = rng.shuffle(BOT_PAGES).slice(0, 3);
      for (let h = 0; h < hits; h++) {
        const [path] = weighted(rng, read);
        const at = dayStart(day) + Math.floor(rng.next() * (end - dayStart(day)));
        const page = path.toLowerCase();
        const seen = pages.get(page) ?? { hits: 0, last: 0 };
        pages.set(page, { hits: seen.hits + 1, last: Math.max(seen.last, at) });
        lastHit = Math.max(lastHit, at);
        if (back < BOT_EVENT_DAYS) {
          events.push({
            brand_id: brandId,
            bot,
            bot_type: type,
            page,
            status: path === BROKEN_PAGE ? 404 : 200,
            country: 'US',
            occurred_at: new Date(at).toISOString(),
            received_at: new Date(at + 20_000).toISOString(),
          });
        }
      }
      for (const [page, { hits: count, last }] of pages) {
        daily.push({
          brand_id: brandId,
          day,
          bot,
          bot_type: type,
          page,
          hits: count,
          last_seen: new Date(last).toISOString(),
        });
      }
    }
  }
  events.sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
  const connection = {
    id: demoId(brandId, 'bot-connection'),
    brand_id: brandId,
    kind: 'cloudflare_worker',
    // Not a hash of any secret (botIngest.js keeps sha256 hex): no sender
    // can ever send for the demo brand.
    secret_hash: `demo:${demoId(brandId, 'bot-connection')}`,
    created_by: null,
    created_at: new Date(nowMs - (BOT_DAYS + 1) * DAY_MS).toISOString(),
    last_event_at: lastHit ? new Date(lastHit + 20_000).toISOString() : null,
    revoked_at: null,
  };
  return { daily, events, connection };
}

/** Page opportunities (#719): the nightly findings over the last 28 days, by its own rules. */
function opportunityRows(brandId, now, { analytics, snippet, citations }) {
  const since = dayBefore(now, 28);
  const pages = new Map();
  const page = (path) => {
    if (!pages.has(path)) {
      pages.set(path, {
        landingPage: path,
        sessions: 0,
        engagedSessions: 0,
        keyEvents: 0,
        transactions: 0,
        revenue: 0,
        engagementSeconds: 0,
        aiSessions: 0,
        aiPlatforms: new Set(),
        citations: 0,
        citingPrompts: new Set(),
        targetingPrompts: 0,
        snippetVisits: 0,
      });
    }
    return pages.get(path);
  };
  for (const row of analytics.pages) {
    if (row.date < since) continue;
    const p = page(row.landing_page);
    p.sessions += row.sessions;
    p.engagedSessions += row.engaged_sessions;
    p.keyEvents += row.key_events;
    p.transactions += row.transactions;
    p.revenue += row.purchase_revenue;
    p.engagementSeconds += row.engagement_duration_seconds;
  }
  const known = (path) => pages.get(path);
  for (const row of analytics.ai) {
    if (row.date < since || !known(row.landing_page)) continue;
    known(row.landing_page).aiSessions += row.sessions;
    known(row.landing_page).aiPlatforms.add(row.platform);
  }
  for (const visit of snippet.visits) {
    if (visit.created_at.slice(0, 10) < since) continue;
    const path = new URL(visit.url).pathname;
    if (known(path)) known(path).snippetVisits += 1;
  }
  for (const c of citations) {
    if (c.created_at.slice(0, 10) < since) continue;
    const path = new URL(c.url).pathname || '/';
    if (!known(path)) continue;
    known(path).citations += 1;
    known(path).citingPrompts.add(c.prompt_id);
  }
  const findings = detectPageOpportunities({
    pages: [...pages.values()].map((p) => ({
      ...p,
      aiPlatforms: [...p.aiPlatforms],
      citingPrompts: p.citingPrompts.size,
    })),
  });
  const detected = new Date(now.getTime() - 9 * DAY_MS).toISOString();
  const latest = new Date(dayStart(dayBefore(now, 0)) + 5 * 60 * 60 * 1000);
  const last = (latest > now ? new Date(latest.getTime() - DAY_MS) : latest).toISOString();
  return findings.map((f) => ({
    id: demoId(brandId, `page-opportunity:${f.landing_page}`),
    brand_id: brandId,
    ...f,
    first_detected_at: detected,
    last_detected_at: last,
    resolved_at: null,
  }));
}

/**
 * Every AI Referral Traffic row of the demo brand, built in memory: the
 * same every time but for its dates, which count back from `now`.
 *
 * @param {{ brandId: string, now: Date }} args
 */
export function trafficRows({ brandId, now }) {
  const analytics = analyticsRows(brandId, now);
  const search = searchRows(brandId, now);
  const snippet = snippetRows(brandId, now);
  const bots = botRows(brandId, now);
  const opportunities = opportunityRows(brandId, now, {
    analytics,
    snippet,
    citations: brandCitations(brandId, now),
  });
  return {
    brand: {
      ga_property_id: GA_PROPERTY_ID,
      gsc_property: GSC_PROPERTY,
      conversions_enabled: true,
    },
    analytics,
    search,
    snippet,
    bots,
    opportunities,
  };
}

/** The AI Referral Traffic module: its brand-scoped tables, in the order written, and its build. */
/**
 * Its tables' key columns where a row has no `id` of its own: the Google
 * Analytics and Search Console rows by their day and what they count, as
 * their sync writes them. ai_bot_events has neither (an identity id): it is
 * replaced (write's `generated`).
 */
const KEYS = {
  ga_ai_traffic_stats: 'brand_id,date,landing_page_query,medium,source',
  ga_page_stats: 'brand_id,date,landing_page',
  ga_channel_stats: 'brand_id,channel,date',
  ga_item_stats: 'brand_id,date,item_id,item_name',
  gsc_query_stats: 'brand_id,date,query',
  gsc_page_stats: 'brand_id,date,page',
  ai_bot_daily: 'brand_id,day,bot,page',
};

export const traffic = {
  name: 'traffic',
  // Rebuilt in place (write.js): written over, what isn't written again deleted after.
  inPlace: true,
  keys: KEYS,
  tables: [
    'ga_ai_traffic_stats',
    'ga_page_stats',
    'ga_channel_stats',
    'ga_item_stats',
    'gsc_query_stats',
    'gsc_page_stats',
    'ai_traffic_logs',
    'ai_traffic_events',
    'ai_bot_connections',
    'ai_bot_daily',
    'ai_bot_events',
    'page_opportunities',
  ],

  /**
   * Its independent tables side by side, through the build's writer (a
   * writer over `db` for a first build without one).
   *
   * @param {{ brandId: string, now: Date, db?: object, rebuild?: boolean, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    rebuild = false,
    write = demoWriter({ db, brandId, rebuild, keys: KEYS }).write,
  }) {
    const rows = trafficRows({ brandId, now });
    const settings = async () => {
      const { error } = await db.from('brands').update(rows.brand).eq('id', brandId);
      if (error) throw new Error(`demo brand traffic settings: ${error.message}`);
    };
    await allSettledOrThrow([
      settings(),
      write('ga_ai_traffic_stats', rows.analytics.ai),
      write('ga_page_stats', rows.analytics.pages),
      write('ga_channel_stats', rows.analytics.channels),
      write('ga_item_stats', rows.analytics.items),
      write('gsc_query_stats', rows.search.queries),
      write('gsc_page_stats', rows.search.pages),
      (async () => {
        // A visit before the pageviews that continue it (visit_of).
        await write('ai_traffic_logs', rows.snippet.visits);
        await write('ai_traffic_logs', rows.snippet.pageviews);
      })(),
      write('ai_traffic_events', rows.snippet.events),
      write('ai_bot_connections', [rows.bots.connection]),
      write('ai_bot_daily', rows.bots.daily),
      write('ai_bot_events', rows.bots.events, { generated: true }),
      write('page_opportunities', rows.opportunities),
    ]);
    return {
      gaRows: rows.analytics.ai.length + rows.analytics.pages.length,
      visits: rows.snippet.visits.length,
      events: rows.snippet.events.length,
      bots: rows.bots.daily.length,
      opportunities: rows.opportunities.length,
    };
  },
};
