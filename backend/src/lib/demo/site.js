/**
 * The demo brand's Site Audit (demo-site): its audits, its page inventory,
 * its site trust and its brand facts.
 *
 * The audits are the audit engine's own: each of Brewline's pages
 * (siteHtml.js) is parsed by auditContextOf and scored by runSignals and
 * scoreAudit, as a fetched page is. Only what a model or an outside lookup
 * would say (the LLM-judged signals, Wikidata's brand entity and the fix
 * recommendations) is written here, in the shapes those steps store. The
 * page inventory goes through sitePages.js's selectPages and parseHead,
 * site trust through siteTrust.js's checks, and the brand facts through
 * brandFacts.js's factText and keptFacts, as if a model had quoted them.
 *
 * Three audit rounds: six key pages audited by a person three weeks ago and
 * again by the weekly auto-audit, then every page by the latest one. Fixes
 * land on the pages between rounds, so their scores climb.
 */

import supabaseAdmin from '../../config/supabase.js';
import { auditContextOf } from '../audit/context.js';
import { runSignals } from '../audit/engine.js';
import { DEFAULT_MODEL as AUDIT_MODEL, LLM_SIGNAL_KEYS } from '../audit/llmSignals.js';
import { opportunityKey } from '../audit/opportunities.js';
import { RECOMMENDABLE_SIGNALS } from '../audit/recommendations.js';
import { RUBRIC_VERSION, TOTAL_SIGNALS, signalsByKey } from '../audit/rubric.js';
import { scoreAudit } from '../audit/scorer.js';
import { factText, factTextHash, keptFacts } from '../brandFacts.js';
import { sourceClassModelId } from '../contentSourceClass.js';
import { parseHead, selectPages } from '../sitePages.js';
import { SITE_TRUST_CHECKS, authorPage, findPage, hasOrganization } from '../siteTrust.js';
import { BRAND } from './brewline.js';
import { demoId } from './random.js';
import { brandCitations } from './siteCommon.js';
import { allSettledOrThrow, demoWriter } from './write.js';
import { LLMS_TXT, ROBOTS_TXT, pageHtml, productDescription } from './siteHtml.js';
import {
  AUDITED_PAGES,
  AUTHORS,
  CATALOG,
  COLLECTIONS,
  OTHER_PAGES,
  SITE_URL,
  pageUrl,
} from './siteWorld.js';
import { gaSessionsByPath } from './traffic.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The audit rounds, oldest first: when, and who started them. */
export const AUDIT_ROUNDS = [
  { daysAgo: 24, source: 'user' },
  { daysAgo: 12, source: 'auto' },
  { daysAgo: 2, source: 'auto' },
];

/** Seconds between two audits of a round, and how long one takes. */
const AUDIT_GAP_MS = 40_000;
const AUDIT_TAKES_MS = 25_000;

/** When the page inventory and the brand facts were last read. */
const PAGES_READ_DAYS_AGO = 6;
const FACTS_READ_DAYS_AGO = 1;

const has = (page, fix, round) => round >= (page.since?.[fix] ?? 0);
const productOf = (id) => CATALOG.find((p) => p.id === id);

/** What a page is about, in a few words, for the verdicts' reasons. */
function topicOf(page) {
  if (page.kind === 'product') return productOf(page.product).title;
  return page.h1.replace(/\?$/, '').toLowerCase();
}

/**
 * The LLM-judged verdicts of one page in one round, in llmSignals.js's
 * stored shape: [status, reason] by signal; 'na' carries no score.
 */
function llmVerdicts(page, round) {
  const topic = topicOf(page);
  const product = page.kind === 'product' ? productOf(page.product) : null;
  const pass = (reason) => ['pass', reason];
  const warn = (reason) => ['warn', reason];
  const fail = (reason) => ['fail', reason];
  const na = (reason) => ['na', reason];
  const noPress = fail('No reference to press or independent reviews of the brand on this page.');

  if (page.kind === 'article') {
    const byline = !page.noByline;
    return {
      'direct-answer': pass(`The first sentence answers ${topic} directly.`),
      'bluf-answer': page.noByline
        ? warn('The opening describes the problem but states no clear recommendation.')
        : pass("The opening paragraph states the page's main claim before any detail."),
      'query-coverage': pass(`The body uses the terms a reader searching for ${topic} would use.`),
      'sub-query-coverage': warn(
        'Covers the main follow-up questions, but not cost per cup or how to brew decaf.',
      ),
      'entity-coverage': pass(
        'Names origins, roast levels and brew methods relevant to the topic.',
      ),
      'info-density': page.noByline
        ? warn('Short paragraphs with general advice and few specifics.')
        : pass('Most paragraphs carry a specific number, method or recommendation.'),
      'mega-page-coverage': warn(
        'Related sub-topics are touched on briefly rather than covered in their own sections.',
      ),
      definitions: page.path.includes('fresh')
        ? pass('Defines degassing and the roast date where they first appear.')
        : warn('Uses terms such as extraction and body without defining them.'),
      'technical-terms': pass('Uses roasting and brewing terms correctly and in context.'),
      'case-study-evidence': warn(
        "Describes the team's own tests but names no customer outcome or before-and-after result.",
      ),
      'author-credentials': byline
        ? pass("The byline gives the author's role, and the bio their years of experience.")
        : fail('No author is named, so no credentials are visible.'),
      'byline-depth': byline
        ? pass('The byline links to an author page with a short bio.')
        : fail('There is no byline to link to an author page.'),
      'press-mentions': noPress,
    };
  }

  if (page.kind === 'product') {
    const opening = has(page, 'descriptionOpening', round);
    return {
      'direct-answer': opening
        ? pass(`The opening names ${topic}, its roast and its tasting notes.`)
        : warn('The description opens with a slogan; the product facts come after it.'),
      'bluf-answer': opening
        ? pass('The first sentence says what the product is and who it suits.')
        : fail('The first paragraph makes no clear claim about the product.'),
      'query-coverage': pass(`The page uses the words a buyer of ${topic} would search for.`),
      'sub-query-coverage': warn(
        'Brewing and freshness are covered; caffeine, origin story and grind options are not.',
      ),
      'entity-coverage': warn(
        product?.process
          ? 'Names the origin and process but not the farm or cooperative.'
          : 'Names the coffees in it but not where they come from.',
      ),
      'info-density': pass('Short, specific copy: prices, sizes, notes and a brew recipe.'),
      'mega-page-coverage': na('A single product page; broad sub-topic coverage does not apply.'),
      definitions: product?.process
        ? warn(`Uses "${product.process}" without saying what the process means.`)
        : na('No specialist terms that need a definition.'),
      'technical-terms': pass('Uses roast level, process and brew ratios correctly.'),
      'case-study-evidence': na('Not expected on a product page.'),
      'author-credentials': na('A product page has no author.'),
      'byline-depth': na('A product page has no byline.'),
      'press-mentions': fail('No reviews or press quotes are shown for this coffee.'),
    };
  }

  // Home, pricing, collections and the company pages.
  const thin = ['contact', 'collection'].includes(page.kind) && (page.sections ?? []).length < 2;
  return {
    'direct-answer':
      round === 0
        ? warn('The opening sells the brand before it says what the page offers.')
        : thin
          ? warn('The page says what it offers only in a short line.')
          : pass('The opening sentence says what the page offers and for whom.'),
    'bluf-answer': thin
      ? warn('The page has no opening paragraph that states a clear claim.')
      : pass("The first paragraph states the page's main promise."),
    'query-coverage': pass(`The page covers the terms a visitor looking for ${topic} would use.`),
    'sub-query-coverage':
      page.kind === 'faq' || page.kind === 'pricing'
        ? pass('Answers the follow-up questions about shipping, pausing and changing plans.')
        : warn('Leaves common follow-up questions about shipping and grind options unanswered.'),
    'entity-coverage': pass('Names the coffees, origins and plans the page is about.'),
    'info-density': thin
      ? warn('Very little content beyond navigation and a short introduction.')
      : pass('The copy is specific: prices, delivery options and product names.'),
    'mega-page-coverage':
      page.kind === 'home'
        ? pass('Covers shopping, subscriptions and freshness in sections of their own.')
        : na('A focused page; broad sub-topic coverage does not apply.'),
    definitions: na('No specialist terms that need a definition.'),
    'technical-terms':
      page.kind === 'contact'
        ? na('No subject matter where technical terms apply.')
        : pass('Uses roast and brewing terms where they fit.'),
    'case-study-evidence':
      page.kind === 'home' || page.kind === 'pricing'
        ? fail('No customer stories or results are shown.')
        : na('Not expected on this kind of page.'),
    'author-credentials':
      page.kind === 'about'
        ? pass("Names the head roaster and the team's experience.")
        : na('No authored content on this page.'),
    'byline-depth': na('No byline on this kind of page.'),
    'press-mentions': noPress,
  };
}

/** Wikidata knows no entity for a brand that doesn't exist (externalSignals.js's no-match). */
const BRAND_ENTITY = { key: 'brand-entity', status: 'fail', score: 0, evidence: { matches: 0 } };

/**
 * A recommendation for a failing or warning signal, in recommendations.js's
 * stored shape (after its guard): page-specific, nothing invented, nothing
 * left to research, and only a fact the brand alone knows as a
 * [placeholder] for the person. Null for a signal with none here.
 */
/** Signals a model leaves out for a page of this kind: nothing specific to say. */
const NOT_FOR = {
  'author-byline': ['product', 'collection', 'home', 'pricing', 'contact', 'faq', 'about'],
  'author-credentials': ['product', 'collection', 'home', 'pricing', 'contact', 'faq'],
  'byline-depth': ['product', 'collection', 'home', 'pricing', 'contact', 'faq'],
  'first-person': ['product', 'collection', 'contact', 'faq'],
  'citation-density': ['product', 'collection', 'home', 'pricing', 'contact', 'faq'],
  'outbound-authority-links': ['product', 'collection', 'home', 'pricing', 'contact', 'faq'],
  quotations: ['product', 'collection', 'pricing', 'contact', 'faq'],
  'statistic-density': ['contact', 'faq'],
  'case-study-evidence': ['product', 'collection', 'contact', 'faq'],
  'faq-schema': ['contact'],
};

function recommendationFor(key, page, result) {
  if (NOT_FOR[key]?.includes(page.kind)) return null;
  const product = page.kind === 'product' ? productOf(page.product) : null;
  const topic = topicOf(page);
  const write = (recommendation, draft = null, code = null) => ({ recommendation, draft, code });
  switch (key) {
    case 'faq-schema':
      return page.faq
        ? write(
            'Mark up the questions this page already answers as FAQPage JSON-LD.',
            page.faq.map(([q, a]) => `Q: ${q}\nA: ${a}`).join('\n\n'),
            JSON.stringify(
              {
                '@context': 'https://schema.org',
                '@type': 'FAQPage',
                mainEntity: page.faq.map(([q, a]) => ({
                  '@type': 'Question',
                  name: q,
                  acceptedAnswer: { '@type': 'Answer', text: a },
                })),
              },
              null,
              2,
            ),
          )
        : write(
            `Add three short questions buyers ask about ${topic}, with answers and FAQPage markup.`,
          );
    case 'meta-description':
      return write(
        'Write a meta description that says what the page offers in one sentence.',
        product
          ? `${product.title}: ${product.notes}, roasted to order and shipped within 24 hours of roasting.`
          : (page.description ?? `${page.h1} from ${BRAND.name}, roasted to order.`),
      );
    case 'h1-quality':
      return write(
        'Make the H1 a full name of 20 to 70 characters that says what the page sells.',
        product ? `${product.title} Whole Bean Coffee` : null,
      );
    case 'h2-coverage':
      return write(
        'Split the page into at least three sections with H2 headings buyers scan for.',
        product
          ? 'Tasting notes\nHow to brew it\nShipping and freshness'
          : 'What you get\nHow it works\nQuestions',
      );
    case 'json-ld-relevance':
      return product
        ? write(
            'Add Product markup with the name, brand and offers so engines read the price.',
            null,
            JSON.stringify(
              {
                '@context': 'https://schema.org',
                '@type': 'Product',
                name: product.title,
                brand: { '@type': 'Brand', name: BRAND.name },
                offers: { '@type': 'Offer', price: '[your price]', priceCurrency: 'USD' },
              },
              null,
              2,
            ),
          )
        : write('Describe the page with a schema.org type that fits it, such as CollectionPage.');
    case 'open-graph':
      return write('Add og:description and og:image so shared links show a preview.');
    case 'outbound-authority-links':
      return write(
        'Cite an independent source, such as a coffee association’s brewing guide, for the brewing and storage advice.',
      );
    case 'citation-density':
      return write('Link the sources behind the main claims, about two per 1,000 words.');
    case 'statistic-density':
      return write(
        'Back the main claims with numbers, such as roast-to-ship time or grind settings.',
      );
    case 'quotations':
      return write(
        `Add a short attributed quote from your roaster about ${topic}.`,
        `"[your quote from the roaster]" (${AUTHORS[0].name}, ${AUTHORS[0].role})`,
      );
    case 'author-byline':
      return write('Name the author of this guide in a byline under the title.');
    case 'direct-answer':
    case 'bluf-answer':
      return write(
        "Open with one sentence that answers the page's main question.",
        product ? productDescription(product).split('. ')[0].replace(/\.?$/, '.') : null,
      );
    case 'product-description-opening':
      return write(
        'Start the description with the product type and two attributes, not a slogan.',
        product ? productDescription(product).split('. ')[0].replace(/\.?$/, '.') : null,
      );
    case 'readability': {
      const { formula, readingScore } = result?.evidence ?? {};
      return formula === 'flesch' && typeof readingScore === 'number' && readingScore > 70
        ? write('Add the detail readers expect: fuller sentences on taste, origin and brewing.')
        : write('Shorten the longest sentences; aim for a Flesch score between 50 and 70.');
    }
    case 'length':
      return write(
        product
          ? 'Add a section on how this coffee tastes on different brewers.'
          : 'Expand the thinnest sections with specifics buyers ask about.',
      );
    case 'first-person':
      return write(
        'Say how your team tested or brews this, in your own words.',
        'When we tested [your brew method], our team found [your result].',
      );
    case 'case-study-evidence':
      return write(
        'Add one customer example with a real outcome.',
        '[your customer name] switched to [your plan] and [your result].',
      );
    case 'press-mentions':
      return write(
        'Link press or review coverage of Brewline, if there is any.',
        '[your publication]: [your article link]',
      );
    case 'definitions':
      return write(
        product?.process
          ? `Define "${product.process}" in one sentence where it first appears.`
          : 'Define the coffee terms the page uses where they first appear.',
      );
    case 'sub-query-coverage':
      return write(
        'Answer the follow-up questions buyers ask, such as which grind to pick and how long a bag keeps.',
      );
    case 'mega-page-coverage':
    case 'entity-coverage':
      return write('Cover the related questions in sections of their own, each with a heading.');
    case 'author-credentials':
    case 'byline-depth':
      return write("Link the byline to an author page with the writer's experience.");
    default:
      return null;
  }
}

const TIER_RANK = { high: 0, medium: 1, standard: 2 };
/** Recommendations kept per audit, and how many of its failures lead as high priority. */
const MAX_RECOMMENDATIONS = 5;
const HIGH_PRIORITY = 2;

/**
 * The audit's recommendations, most important first: failures before
 * warnings, by the signal's impact; the leading failures (and any of high
 * impact) are high priority, other failures medium, warnings low.
 */
function recommendationsOf(page, results) {
  return results
    .filter((r) => RECOMMENDABLE_SIGNALS.has(r.key) && (r.status === 'fail' || r.status === 'warn'))
    .map((r) => ({ r, rec: recommendationFor(r.key, page, r) }))
    .filter(({ rec }) => rec)
    .map(({ r, rec }) => ({ r, rec, tier: TIER_RANK[signalsByKey[r.key]?.impactTier] ?? 2 }))
    .sort(
      (a, b) =>
        (a.r.status === 'fail' ? 0 : 1) - (b.r.status === 'fail' ? 0 : 1) || a.tier - b.tier,
    )
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ r, rec, tier }, i) => ({
      signalKey: r.key,
      label: signalsByKey[r.key]?.label ?? r.key,
      category: signalsByKey[r.key]?.category ?? null,
      priority: r.status === 'warn' ? 'low' : tier === 0 || i < HIGH_PRIORITY ? 'high' : 'medium',
      ...rec,
    }));
}

/** One page audited in one round: the audit row and its signal rows, as runAuditJob writes them. */
async function auditPage(page, round, { brandId, id, at }) {
  const url = pageUrl(page.path);
  const ctx = auditContextOf({
    url,
    statusCode: 200,
    html: pageHtml(page, { round, now: at }),
    robotsTxt: ROBOTS_TXT,
    llmsTxt: LLMS_TXT,
    now: at,
  });
  const deterministic = await runSignals(ctx);
  const verdicts = llmVerdicts(page, round);
  const llm = LLM_SIGNAL_KEYS.map((key) => {
    const [status, reason] = verdicts[key];
    const score = status === 'na' ? null : status === 'pass' ? 1 : status === 'warn' ? 0.5 : 0;
    return { key, status, score, evidence: { reason, model: AUDIT_MODEL } };
  });
  const results = [...deterministic, ...llm, BRAND_ENTITY];
  const { totalScore, categoryScores } = scoreAudit(results);

  const auditId = id(`audit:${round}:${page.path}`);
  const createdAt = new Date(at).toISOString();
  return {
    audit: {
      id: auditId,
      brand_id: brandId,
      url,
      final_url: ctx.url,
      status: 'completed',
      total_score: totalScore,
      category_scores: categoryScores,
      signals_evaluated: results.filter((r) => r.status !== 'na').length,
      signals_total: TOTAL_SIGNALS,
      rubric_version: RUBRIC_VERSION,
      error: null,
      recommendations: recommendationsOf(page, results),
      source: AUDIT_ROUNDS[round].source,
      created_at: createdAt,
      completed_at: new Date(at + AUDIT_TAKES_MS).toISOString(),
    },
    signals: results.map((r) => ({
      audit_id: auditId,
      signal_key: r.key,
      category: signalsByKey[r.key]?.category ?? null,
      status: r.status,
      score: r.score,
      evidence: r.evidence ?? {},
      created_at: new Date(at + AUDIT_TAKES_MS).toISOString(),
    })),
  };
}

/** The pages of the site the sitemap lists, with when each last changed. */
function sitemapPages(now) {
  const paths = [
    ...AUDITED_PAGES.map((p) => p.path),
    ...COLLECTIONS.map((c) => c.path),
    ...CATALOG.map((p) => p.path),
    ...OTHER_PAGES.map((p) => p.path),
  ];
  return [...new Set(paths)].map((path, i) => ({
    loc: pageUrl(path),
    lastmod: new Date(now - (3 + ((i * 7) % 60)) * DAY_MS).toISOString().slice(0, 10),
  }));
}

/** A page's head as the page inventory reads it (title, description, h1). */
function headOf(path, now) {
  const audited = AUDITED_PAGES.find((p) => p.path === path);
  if (audited) return parseHead(pageHtml(audited, { round: 2, now }));
  const collection = COLLECTIONS.find((c) => c.path === path);
  if (collection) return collection;
  const product = CATALOG.find((p) => p.path === path);
  if (product) {
    return {
      title: `${product.title} | ${BRAND.name}`,
      description: productDescription(product).slice(0, 300),
      h1: product.title,
    };
  }
  return OTHER_PAGES.find((p) => p.path === path) ?? { title: null, description: null, h1: null };
}

/**
 * The page inventory (site_pages), as refreshSitePages keeps it: pages AI
 * answers cite and GA reports traffic for first, then the sitemap's.
 */
function sitePageRows({ brandId, now, citations }) {
  const cutoff = now - 30 * DAY_MS;
  const counts = new Map();
  for (const c of citations) {
    if (Date.parse(c.created_at) < cutoff) continue;
    counts.set(c.url, (counts.get(c.url) ?? 0) + 1);
  }
  const selected = selectPages(
    {
      sitemap: sitemapPages(now),
      ga: [...gaSessionsByPath(now)],
      citations: [...counts].map(([url, n]) => ({ url, cur_citations: n })),
    },
    BRAND.domain,
  );
  const readAt = new Date(now - PAGES_READ_DAYS_AGO * DAY_MS).toISOString();
  return selected.map((page) => {
    const { title, description, h1 } = headOf(new URL(page.url).pathname || '/', now);
    return {
      brand_id: brandId,
      ...page,
      title: title ?? null,
      description: description ?? null,
      h1: h1 ?? null,
      fetch_status: 200,
      fetched_via: 'direct',
      fetched_at: readAt,
      updated_at: readAt,
    };
  });
}

/** The five site trust checks (siteTrust.js), read from the page list and the home page. */
function siteTrustRow({ brandId, pages, now }) {
  const home = AUDITED_PAGES.find((p) => p.path === '/');
  const onSite = (link) => new URL(link).hostname === BRAND.domain;
  const about = findPage(pages, 'about');
  const contact = findPage(pages, 'contact');
  const editorial = findPage(pages, 'editorial');
  const authors = AUTHORS.map((a) => ({ name: a.name, url: authorPage(pages, a, onSite) }));
  const checks = {
    about: { ok: !!about, url: about },
    contact: { ok: !!contact, url: contact },
    editorial: { ok: !!editorial, url: editorial },
    organizationSchema: {
      ok: hasOrganization(pageHtml(home, { round: 2, now })),
      url: `${SITE_URL}/`,
    },
    authorPages: { ok: authors.every((a) => a.url), authors },
  };
  return {
    brand_id: brandId,
    checks,
    score: SITE_TRUST_CHECKS.filter((k) => checks[k].ok).length,
    complete: true,
    checked_at: new Date(now).toISOString(),
    scraped_at: null,
  };
}

/**
 * What a model reading the pricing, About and product pages would quote
 * (brandFacts.js keeps a fact only when its words are on the page), and
 * which a person has approved.
 */
const FACT_READS = [
  {
    kind: 'pricing',
    path: '/subscriptions',
    facts: [
      { kind: 'price', quote: '$18 per bag', plan: 'House Blend Subscription', approved: true },
      { kind: 'price', quote: '$22 per bag', plan: 'Single Origin Club', approved: true },
      { kind: 'price', quote: '$20 per bag', plan: 'Espresso Club', approved: true },
      {
        kind: 'claim',
        quote: 'Shipping is free on every subscription order in the US',
        approved: true,
      },
      { kind: 'claim', quote: 'Pause, skip or cancel anytime from your account' },
    ],
  },
  {
    kind: 'about',
    path: '/about',
    facts: [
      { kind: 'founded', quote: 'founded in 2016', approved: true },
      { kind: 'claim', quote: 'Every bag ships within 24 hours of roasting.', approved: true },
      { kind: 'claim', quote: 'We roast in small batches of 12 kg' },
    ],
  },
  {
    kind: 'product',
    path: '/coffee/espresso-roast',
    facts: [
      { kind: 'price', quote: '$16.50', plan: '12 oz', approved: true },
      { kind: 'price', quote: '$38.00', plan: '2 lb', approved: true },
    ],
  },
];

function brandFactRows({ brandId, now, id }) {
  const checkedAt = new Date(now - FACTS_READ_DAYS_AGO * DAY_MS).toISOString();
  const firstSeen = new Date(now - 27 * DAY_MS).toISOString();
  const reviewedAt = new Date(now - 25 * DAY_MS).toISOString();
  const model = sourceClassModelId().slice(0, 100);
  const pages = [];
  const facts = [];
  for (const read of FACT_READS) {
    const page = AUDITED_PAGES.find((p) => p.path === read.path);
    const text = factText(pageHtml(page, { round: 2, now }));
    const url = pageUrl(read.path);
    pages.push({
      brand_id: brandId,
      kind: read.kind,
      url,
      status: 'ok',
      text_hash: factTextHash(text),
      model,
      checked_at: checkedAt,
      extracted_at: checkedAt,
    });
    const kept = keptFacts(text, { facts: read.facts }, { now });
    for (const fact of kept) {
      const asked = read.facts.find(
        (f) => f.kind === fact.kind && fact.quote.toLowerCase().includes(f.quote.toLowerCase()),
      );
      facts.push({
        id: id(`brand-fact:${fact.slot}:${fact.value_key}`),
        brand_id: brandId,
        ...fact,
        source_url: url,
        source_kind: read.kind,
        status: asked?.approved ? 'approved' : 'pending',
        reviewed_by: null,
        reviewed_at: asked?.approved ? reviewedAt : null,
        first_seen_at: asked?.approved ? firstSeen : checkedAt,
        last_seen_at: checkedAt,
        gone_at: null,
      });
    }
  }
  return { pages, facts };
}

/**
 * Every Site Audit row of the demo brand, built in memory: the same every
 * time but for the dates, which count back from `now`.
 *
 * @param {{ brandId: string, now: Date }} args
 */
export async function siteRows({ brandId, now }) {
  const id = (key) => demoId(brandId, key);
  const nowMs = now.getTime();
  const audits = [];
  const signals = [];
  for (const [round, { daysAgo }] of AUDIT_ROUNDS.entries()) {
    const day = new Date(nowMs - daysAgo * DAY_MS);
    day.setUTCHours(7, 0, 0, 0);
    let at = day.getTime();
    for (const page of AUDITED_PAGES.filter((p) => p.rounds.includes(round))) {
      at += AUDIT_GAP_MS;
      const audited = await auditPage(page, round, { brandId, id, at });
      audits.push(audited.audit);
      signals.push(...audited.signals);
    }
  }

  const sitePages = sitePageRows({ brandId, now: nowMs, citations: brandCitations(brandId, now) });
  const since = new Date(nowMs - 32 * DAY_MS).toISOString();
  const updatedAt = new Date(nowMs - 20 * DAY_MS).toISOString();
  const { pages: factPages, facts } = brandFactRows({ brandId, now: nowMs, id });

  return {
    audits,
    signals,
    sitePages: sitePages.map((p) => ({ ...p, created_at: since })),
    siteTrust: siteTrustRow({ brandId, pages: sitePages, now: nowMs }),
    // The brand's gear pages aren't worth auditing for AI answers.
    settings: {
      brand_id: brandId,
      exclude_patterns: ['/brewing/*'],
      updated_by: null,
      updated_at: updatedAt,
    },
    prefs: [
      ['/coffee/espresso-roast', 'pinned'],
      ['/subscriptions/espresso-club', 'pinned'],
      ['/shipping', 'excluded'],
    ].map(([path, state]) => ({
      id: id(`audit-pref:${path}`),
      brand_id: brandId,
      page_key: opportunityKey(pageUrl(path)),
      url: pageUrl(path),
      state,
      created_by: null,
      created_at: updatedAt,
      updated_at: updatedAt,
    })),
    factPages,
    facts,
  };
}

/** Signal rows written per statement: an audit's 48 a few times over. */
const SIGNAL_CHUNK = 480;

/** Its tables' key columns where a row has no `id` of its own. */
const KEYS = {
  site_pages: 'brand_id,url',
  audit_signal_results: 'audit_id,signal_key',
  site_trust: 'brand_id',
  site_audit_brand_settings: 'brand_id',
  brand_fact_pages: 'brand_id,kind',
};
/** The audits' signals have no brand_id: found through their audit. */
const SCOPES = { audit_signal_results: ['audit_id', 'site_audits'] };

/**
 * The Site Audit module: its brand-scoped tables and its build.
 */
export const site = {
  name: 'site',
  // Rebuilt in place (write.js): written over, what isn't written again deleted after.
  inPlace: true,
  keys: KEYS,
  scopes: SCOPES,
  tables: [
    'site_pages',
    // And, through it (on delete cascade), audit_signal_results.
    'site_audits',
    'site_trust',
    'site_audit_brand_settings',
    'site_audit_page_prefs',
    'brand_fact_pages',
    'brand_facts',
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
    write = demoWriter({ db, brandId, rebuild, keys: KEYS, scopes: SCOPES }).write,
  }) {
    const rows = await siteRows({ brandId, now });
    await allSettledOrThrow([
      write('site_pages', rows.sitePages),
      write('site_audits', rows.audits),
      write('site_trust', [rows.siteTrust]),
      write('site_audit_brand_settings', [rows.settings]),
      write('site_audit_page_prefs', rows.prefs),
      write('brand_fact_pages', rows.factPages),
      write('brand_facts', rows.facts),
    ]);
    // The signals point at their audit.
    await write('audit_signal_results', rows.signals, { chunk: SIGNAL_CHUNK });
    return {
      audits: rows.audits.length,
      signals: rows.signals.length,
      pages: rows.sitePages.length,
      facts: rows.facts.length,
    };
  },
};
