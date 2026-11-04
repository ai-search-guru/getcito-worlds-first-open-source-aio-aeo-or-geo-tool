/**
 * The demo brand's Content (demo-workflows): its prompt clusters, the
 * content opportunities written for them, its Content Editor drafts and its
 * Plan marks.
 *
 * Clusters are stored as replace_prompt_clusters stores them, with the
 * fan-out searches the demo's own answers ran (clusterQueries) and the scope
 * fingerprint the clusterer checks (scopeFingerprint), so nothing reads them
 * as stale. Each opportunity carries what opportunityGenerator.js writes:
 * its cluster's metrics (clusterMetrics over the demo's month), its score
 * (scoreComponents, opportunityScore) and its assets (buildAssets). Only
 * the titles and descriptions, the model's part, are written here.
 */

import supabaseAdmin from '../../config/supabase.js';
import { OPPORTUNITY_ACTION_KIND, WHOLE } from '../action-center/fromOpportunity.js';
import { assetTypes, buildAssets } from '../pageMatching.js';
import {
  clusterMetrics,
  OPPORTUNITY_WINDOW_DAYS,
  opportunityScore,
  scoreComponents,
} from '../opportunityLimits.js';
import { clusterQueries, MAX_QUERIES_PER_CLUSTER, scopeFingerprint } from '../promptClusters.js';
import { BRAND, SOURCES, TOPICS } from './brewline.js';
import { DRAFTS } from './contentPages.js';
import { demoId } from './random.js';
import { allSettledOrThrow, demoWriter } from './write.js';
import * as S from './stats.js';

/** The fan-out queries a cluster keeps: run in two answers at least (FANOUT_MIN_ANSWERS). */
const MIN_QUERY_ANSWERS = 2;
/** Included queries an opportunity keeps, most searched first (opportunityGenerator.js). */
const QUERIES_KEPT = 15;

const brandUrl = (path) => `https://${BRAND.domain}${path}`;

/** The demo's prompt clusters: what one piece of content can answer. */
export const CLUSTERS = [
  {
    key: 'choosing-subscription',
    topic: 'subscriptions',
    prompts: ['best-subscriptions', 'worth-it'],
    label: 'Choosing a coffee subscription',
    intent: 'Compare coffee subscriptions and decide whether one is worth it',
    secondary: ['Compare subscription prices', 'Cost per cup of a subscription'],
  },
  {
    key: 'flexible-plans',
    topic: 'subscriptions',
    prompts: ['pause-skip'],
    label: 'Flexible subscription plans',
    intent: 'Find a coffee subscription that can be paused or skipped',
    secondary: [],
  },
  {
    key: 'subscription-gifts',
    topic: 'subscriptions',
    prompts: ['gift'],
    label: 'Coffee subscription gifts',
    intent: 'Pick a coffee subscription to give as a gift',
    secondary: ['Prepaid gift plans'],
  },
  {
    key: 'espresso-beans',
    topic: 'beans',
    prompts: ['espresso'],
    label: 'Espresso beans for home',
    intent: 'Choose whole beans for espresso at home',
    secondary: [],
  },
  {
    key: 'buying-online',
    topic: 'beans',
    prompts: ['buy-online'],
    label: 'Buying fresh beans online',
    intent: 'Find a roaster that ships freshly roasted beans',
    secondary: [],
  },
  {
    key: 'sensitive-stomach',
    topic: 'beans',
    prompts: ['low-acid'],
    label: 'Coffee for sensitive stomachs',
    intent: 'Find low-acid coffee that is gentle on the stomach',
    secondary: [],
  },
  {
    key: 'origin-vs-blend',
    topic: 'beans',
    prompts: ['single-origin'],
    label: 'Single origin vs blends',
    intent: 'Decide between single-origin coffee and a blend',
    secondary: [],
  },
  {
    key: 'ethical-sourcing',
    topic: 'buying',
    prompts: ['fair-trade'],
    label: 'Ethically sourced coffee',
    intent: 'Find roasters selling organic, fair trade beans',
    secondary: [],
  },
  {
    key: 'decaf',
    topic: 'buying',
    prompts: ['decaf'],
    label: 'Decaf that tastes good',
    intent: 'Find a decaf coffee that still tastes good',
    secondary: [],
  },
  {
    key: 'freshness',
    topic: 'buying',
    prompts: ['freshness'],
    label: 'Coffee bean freshness',
    intent: 'Understand how fresh coffee beans should be',
    secondary: [],
  },
  {
    key: 'brand-comparison',
    topic: 'buying',
    prompts: ['versus'],
    label: 'Brewline vs Northbound Roasters',
    intent: 'Compare Brewline Coffee and Northbound Roasters subscriptions',
    secondary: [],
  },
];

const pct = (n) => `${Math.round(n)}%`;
const searches = (n) => n.toLocaleString('en-US');

/**
 * The opportunities, one per cluster that has one, oldest first. `asset`
 * is the model's pick (type, decision, pages by path); `created` is
 * [run, hours] for when the nightly run wrote it.
 */
export const OPPORTUNITIES = [
  {
    cluster: 'choosing-subscription',
    created: [2, 2],
    status: 'new',
    impact: 'high',
    type: 'owned',
    asset: { type: 'buying_guide', decision: 'optimize', pages: ['/subscriptions'] },
    supporting: [
      {
        type: 'comparison',
        channel: 'owned',
        decision: 'create',
        pages: [],
        title: 'Coffee subscriptions compared side by side',
      },
    ],
    title: 'Turn the subscriptions page into a guide to choosing a coffee subscription',
    description: (m) =>
      `Answers comparing coffee subscriptions name Brewline in ${pct(m.visibility)} of cases, while ${m.competitorsCited[0]} reaches ${pct(m.topCompetitorVisibility)}. About ${searches(m.demand)} AI searches a month ask which subscription to pick and whether it is worth it.`,
    priority: true,
  },
  {
    cluster: 'subscription-gifts',
    created: [2, 2],
    status: 'reviewed',
    impact: 'medium',
    type: 'owned',
    asset: { type: 'collection_page', decision: 'expand', pages: ['/gifts'] },
    supporting: [],
    title: 'Expand the gifts page with prepaid subscription plans and gift notes',
    description: (m) =>
      `Gift answers lean on ${m.competitorsCited[0]}, visible in ${pct(m.topCompetitorVisibility)} of them against Brewline’s ${pct(m.visibility)}. The gifts page lists bags but not how a prepaid subscription works as a present.`,
  },
  {
    cluster: 'espresso-beans',
    created: [2, 2],
    status: 'new',
    impact: 'high',
    type: 'owned',
    asset: { type: 'product_page', decision: 'optimize', pages: ['/coffee/espresso-roast'] },
    supporting: [],
    title: 'Add brewing specs and a dose guide to the Espresso Roast page',
    description: (m) =>
      `With ${searches(m.demand)} AI searches a month, espresso beans is one of the busiest needs. Brewline is named in ${pct(m.visibility)} of answers; adding grind, dose and roast-date details gives engines a reason to cite the product page.`,
    priority: true,
  },
  {
    cluster: 'sensitive-stomach',
    created: [5, 2],
    status: 'in_progress',
    impact: 'high',
    type: 'owned',
    asset: { type: 'buying_guide', decision: 'create', pages: [] },
    supporting: [],
    title: 'Write a buying guide to low-acid coffee for sensitive stomachs',
    description: (m) =>
      `People asking for coffee that is gentle on the stomach rarely see Brewline (${pct(m.visibility)} of answers), and no Brewline page covers low-acid beans. ${m.competitorsCited[0]} is named in ${pct(m.topCompetitorVisibility)} of them.`,
  },
  {
    cluster: 'origin-vs-blend',
    created: [5, 2],
    status: 'new',
    impact: 'medium',
    type: 'owned',
    asset: { type: 'comparison', decision: 'create', pages: [] },
    supporting: [],
    title: 'Explain single origin vs blends with a side-by-side tasting chart',
    description: (m) =>
      `${m.competitorsCited[0]} owns this comparison at ${pct(m.topCompetitorVisibility)} visibility; Brewline is at ${pct(m.visibility)} and has no page comparing the two.`,
  },
  {
    cluster: 'ethical-sourcing',
    created: [5, 2],
    status: 'new',
    impact: 'medium',
    type: 'earned',
    asset: { type: 'third_party_article', decision: 'create', pages: [] },
    supporting: [],
    title: 'Get Brewline into the roundups of fair trade and organic roasters',
    description: (m) =>
      `Answers about ethically sourced coffee cite publishers’ roundups, and Brewline appears in ${pct(m.visibility)} of them. A sourcing story placed with those publishers can put it on their lists.`,
  },
  {
    cluster: 'decaf',
    created: [8, 2],
    status: 'new',
    impact: 'medium',
    type: 'owned',
    asset: { type: 'product_page', decision: 'optimize', pages: ['/coffee/decaf'] },
    supporting: [
      {
        type: 'help_faq',
        channel: 'owned',
        decision: 'create',
        pages: [],
        title: 'How water-process decaf is made',
      },
    ],
    title: 'Add tasting notes and process details to the Water Process Decaf page',
    description: (m) =>
      `The decaf page is already cited, yet Brewline is named in ${pct(m.visibility)} of decaf answers against ${pct(m.topCompetitorVisibility)} for ${m.competitorsCited[0]}. Detail on how the beans are decaffeinated and how they taste gives engines more to quote.`,
  },
  {
    cluster: 'freshness',
    created: [5, 2],
    status: 'in_progress',
    impact: 'medium',
    type: 'owned',
    asset: {
      type: 'guide',
      decision: 'refresh',
      pages: ['/blog/how-fresh-should-coffee-beans-be'],
    },
    supporting: [],
    title: 'Refresh the coffee freshness guide with a roast-date timeline',
    description: (m) =>
      `The freshness guide is Brewline’s most cited page for this need, with Brewline visible in ${pct(m.visibility)} of answers. A clear day-by-day timeline answers the question engines are asked directly.`,
  },
  {
    cluster: 'flexible-plans',
    created: [2, 2],
    status: 'done',
    impact: 'medium',
    type: 'owned',
    asset: { type: 'help_faq', decision: 'create', pages: [] },
    supporting: [],
    title: 'Publish a help page on pausing and skipping deliveries',
    description: (m) =>
      `People ask which subscriptions can be paused or skipped. Brewline offers both, yet it is named in only ${pct(m.visibility)} of these answers and no page explains how.`,
  },
  {
    cluster: 'buying-online',
    created: [8, 2],
    status: 'dismissed',
    impact: 'low',
    type: 'earned',
    asset: { type: 'backlink', decision: 'create', pages: [] },
    supporting: [],
    title: 'Earn a link from forum threads about buying fresh beans online',
    description: (m) =>
      `Forum threads are cited in answers about buying beans online, where Brewline appears in ${pct(m.visibility)} of cases.`,
    dismissReason: 'not_relevant',
  },
];

/** What brand_prompt_opportunity_metrics reads for one prompt over the window. */
function promptMetrics(results) {
  const brand = S.brandStats(results);
  const rivals = [...S.competitorStats(results).values()]
    .filter((c) => c.mentionAnswers > 0)
    .sort((a, b) => b.mentionAnswers - a.mentionAnswers);
  const rate = (n) => (results.length ? Math.round((n / results.length) * 1000) / 10 : 0);
  return {
    cells: results.length,
    visibility: rate(brand.visibleAnswers),
    top_competitor_visibility: rate(rivals[0]?.mentionAnswers ?? 0),
    competitors: rivals.map((c) => c.name),
  };
}

/** The brand's pages an opportunity can work on, as site_pages would list them. */
function candidatePages(ctx, windowResults) {
  const cited = new Map();
  for (const r of windowResults) {
    for (const c of r.citations ?? []) {
      if (c.url.startsWith(brandUrl(''))) cited.set(c.url, (cited.get(c.url) ?? 0) + 1);
    }
  }
  return SOURCES.brand.map((p) => ({
    url: brandUrl(p.path),
    title: p.label,
    h1: null,
    ai_citations: cited.get(brandUrl(p.path)) ?? 0,
    ga_sessions: null,
    lastmod: null,
  }));
}

/**
 * Every Content row of the demo brand, built in memory: clusters with their
 * members and searches, opportunities, drafts and Plan marks.
 *
 * @param {{ brandId: string, now: Date }} args
 * @param {{ actionFor?: (opportunityKey: string) => string|null }} [links]
 *   The action each opportunity was sent to the Action Center as, if any.
 */
export function contentRows({ brandId, now }, { actionFor = () => null } = {}) {
  const ctx = S.demoContext(brandId, now);
  const id = (key) => demoId(brandId, key);
  const at = ([run, hours]) => S.afterRun(ctx.starts, run, hours);
  const latest = ctx.starts.length - 1;
  const since = ctx.rows.brand.created_at;
  const windowFrom = S.utcDay(new Date(now.getTime() - OPPORTUNITY_WINDOW_DAYS * S.DAY_MS));
  const month = S.between(ctx.rows.results, windowFrom, S.utcDay(now));

  // Clusters, as replace_prompt_clusters writes them.
  const clusterId = (key) => id(`cluster:${key}`);
  const clusteredAt = S.afterRun(ctx.starts, 0, 1).toISOString();
  const clusters = CLUSTERS.map((c) => ({
    id: clusterId(c.key),
    brand_id: brandId,
    topic_id: id(`topic:${c.topic}`),
    label: c.label,
    primary_intent: c.intent,
    secondary_intents: c.secondary,
    created_at: clusteredAt,
    updated_at: clusteredAt,
  }));
  const members = CLUSTERS.flatMap((c) =>
    c.prompts.map((key) => ({ prompt_id: ctx.promptId(key), cluster_id: clusterId(c.key) })),
  );
  const scopes = TOPICS.map((t) => ({
    brand_id: brandId,
    topic_id: id(`topic:${t.key}`),
    fingerprint: scopeFingerprint(
      ctx.rows.prompts
        .filter((p) => p.topic_id === id(`topic:${t.key}`))
        .map((p) => ({ id: p.id, text: p.text })),
    ),
    clustered_at: clusteredAt,
  }));

  // The searches engines ran for each cluster's prompts this month (refreshBaskets).
  const searched = new Map();
  for (const r of month) {
    for (const q of r.search_queries ?? []) {
      const key = `${r.prompt_id}\n${q.query}`;
      searched.set(key, (searched.get(key) ?? 0) + 1);
    }
  }
  const clusterOf = new Map(members.map((m) => [m.prompt_id, m.cluster_id]));
  const byCluster = clusterQueries(
    [...searched]
      .filter(([, times]) => times >= MIN_QUERY_ANSWERS)
      .map(([key, times]) => [...key.split('\n'), times]),
    clusterOf,
  );
  const judgedAt = S.afterRun(ctx.starts, latest, 1).toISOString();
  const queries = [...byCluster].flatMap(([cluster, list]) =>
    list.slice(0, MAX_QUERIES_PER_CLUSTER).map(({ query, times }) => ({
      cluster_id: cluster,
      query,
      times_searched: times,
      included: true,
      reason: '',
      judged_at: judgedAt,
      last_seen_at: judgedAt,
    })),
  );

  // The opportunities, measured as the generator measures them.
  const byPrompt = new Map(
    ctx.rows.prompts.map((p) => {
      const v = ctx.volume(p.id);
      return [
        p.id,
        {
          text: p.text,
          volume: v && { est_ai_volume: v.est_ai_volume, intent: v.intent, keywords: v.keywords },
          metrics: promptMetrics(month.filter((r) => r.prompt_id === p.id)),
        },
      ];
    }),
  );
  const pages = candidatePages(ctx, month);
  const types = assetTypes('ecommerce');
  const topicName = (key) => TOPICS.find((t) => t.key === key).name;

  const opportunities = OPPORTUNITIES.map((o) => {
    const cluster = CLUSTERS.find((c) => c.key === o.cluster);
    const promptIds = cluster.prompts.map((key) => ctx.promptId(key));
    const metrics = clusterMetrics(promptIds, byPrompt);
    const components = scoreComponents(metrics);
    const pageIndex = (path) => pages.findIndex((p) => p.url === brandUrl(path));
    const assets = buildAssets(
      {
        type: o.asset.type,
        channel: o.type,
        decision: o.asset.decision,
        pageIndexes: o.asset.pages.map(pageIndex),
        title: o.title,
      },
      o.supporting.map((a) => ({ ...a, pageIndexes: a.pages.map(pageIndex) })),
      pages,
      types,
    );
    const list = byCluster.get(clusterId(cluster.key)) ?? [];
    const createdAt = at(o.created).toISOString();
    const actionId = actionFor(o.cluster);
    return {
      id: id(`opportunity:${o.cluster}`),
      brand_id: brandId,
      cluster_id: clusterId(cluster.key),
      related_cluster_ids: [],
      prompt_id: metrics.representative?.id ?? null,
      title: o.title,
      description: o.description(metrics),
      type: o.type,
      impact: o.impact,
      opportunity_score: opportunityScore(components),
      status: o.status,
      source: 'system',
      decision: assets[0].decision,
      source_data: {
        promptText: metrics.representative?.text,
        clusterLabel: cluster.label,
        topicName: topicName(cluster.topic),
        relatedTopics: [],
        prompts: promptIds.map((pid) => byPrompt.get(pid).text),
        estAiVolume: metrics.demand,
        questionVolume: metrics.representative?.volume ?? 0,
        visibilityScore: metrics.visibility,
        topCompetitorVisibility: metrics.topCompetitorVisibility,
        competitorGap: metrics.competitorGap,
        intent: metrics.intent,
        keywords: metrics.keywords,
        competitorsCited: metrics.competitorsCited,
        queries: {
          included: list.length,
          excluded: 0,
          top: list.slice(0, QUERIES_KEPT).map((q) => ({ query: q.query, timesSearched: q.times })),
        },
        scoreComponents: components,
        windowDays: OPPORTUNITY_WINDOW_DAYS,
        targetPages: assets[0].pages,
        assets,
        ...(o.dismissReason ? { dismissReason: o.dismissReason } : {}),
        ...(actionId ? { actions: { [WHOLE]: actionId } } : {}),
      },
      created_at: createdAt,
      updated_at: createdAt,
    };
  });

  // The drafts the Library lists and the Editor opens.
  const opportunityId = (key) => id(`opportunity:${key}`);
  const drafts = DRAFTS.map((d) => ({
    id: id(`draft:${d.key}`),
    brand_id: brandId,
    title: d.title,
    page_type: d.pageType,
    page_type_source: 'detected',
    method: d.method,
    status: d.status,
    body_html: d.bodyHtml,
    author: d.author,
    created_by: null,
    opportunity_id: opportunityId(d.opportunity),
    prompt_ids: d.prompts.map((key) => ctx.promptId(key)),
    source_url: d.sourcePath ? brandUrl(d.sourcePath) : null,
    action_id: actionFor(d.opportunity),
    slug: d.slug ?? null,
    meta_title: d.metaTitle ?? null,
    meta_description: d.metaDescription ?? null,
    published_url: d.publishedPath ? brandUrl(d.publishedPath) : null,
    published_at: d.published ? at(d.published).toISOString() : null,
    created_at: at(d.created).toISOString(),
    updated_at: at(d.updated).toISOString(),
  }));

  // Plan's priority marks (CE: "Send to Plan").
  const marks = OPPORTUNITIES.filter((o) => o.priority).map((o) => ({
    brand_id: brandId,
    row_key: `opportunity:${opportunityId(o.cluster)}`,
    priority: true,
    hidden_at: null,
    updated_by: null,
    updated_at: since,
  }));

  return { clusters, members, scopes, queries, opportunities, drafts, marks };
}

/** The opportunity sent to the Action Center (fromOpportunity.js), for the action built from it. */
export const SENT_OPPORTUNITY = 'sensitive-stomach';
export { OPPORTUNITY_ACTION_KIND };

/** Its tables' key columns where a row has no `id` of its own. */
const KEYS = {
  prompt_cluster_members: 'prompt_id',
  prompt_cluster_queries: 'cluster_id,query',
  prompt_cluster_scopes: 'brand_id,topic_id',
  content_plan_marks: 'brand_id,row_key',
};
/** Its tables without a brand_id, found through their cluster. */
const SCOPES = {
  prompt_cluster_members: ['cluster_id', 'prompt_clusters'],
  prompt_cluster_queries: ['cluster_id', 'prompt_clusters'],
};

/**
 * The Content module. Cluster members and searches hang off the clusters
 * (no brand_id of their own) and go with them.
 */
export const content = {
  name: 'content',
  // A draft points at the action its opportunity was sent as.
  after: 'actionCenter',
  // Rebuilt in place (write.js): written over, what isn't written again deleted after.
  inPlace: true,
  keys: KEYS,
  scopes: SCOPES,
  tables: [
    'prompt_cluster_scopes',
    'prompt_clusters',
    'content_opportunities',
    'content_drafts',
    'content_plan_marks',
  ],

  /**
   * Each step's independent tables side by side, through the build's
   * writer (a writer over `db` for a first build without one).
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
    const sent = demoId(brandId, `action:opportunity:${SENT_OPPORTUNITY}`);
    const rows = contentRows(
      { brandId, now },
      { actionFor: (key) => (key === SENT_OPPORTUNITY ? sent : null) },
    );
    await allSettledOrThrow([
      write('prompt_clusters', rows.clusters),
      write('prompt_cluster_scopes', rows.scopes),
      write('content_plan_marks', rows.marks),
    ]);
    // Members, searches and opportunities point at their cluster; the drafts
    // at their opportunity.
    await allSettledOrThrow([
      write('prompt_cluster_members', rows.members),
      write('prompt_cluster_queries', rows.queries),
      write('content_opportunities', rows.opportunities),
    ]);
    await write('content_drafts', rows.drafts);
    return {
      clusters: rows.clusters.length,
      opportunities: rows.opportunities.length,
      drafts: rows.drafts.length,
    };
  },
};
