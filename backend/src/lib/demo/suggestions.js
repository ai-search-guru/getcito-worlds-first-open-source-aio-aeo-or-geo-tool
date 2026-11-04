/**
 * The demo brand's suggestions (demo-workflows): prompts and topics to track
 * next, and the Improve tab's suggestions on two of its weakest prompts.
 *
 * Prompt and topic suggestions are stored as the suggestion routes store a
 * model's picks. The Improve sets are built as POST /prompts/:id/improve
 * builds them: each engine's state from the demo's answers (classifyPlatform),
 * its evidence (collectEvidence), and suggestions kept only where they cite
 * that evidence (sanitizeSuggestions). The suggestion wording, the model's
 * part, is written from the evidence here.
 */

import supabaseAdmin from '../../config/supabase.js';
import {
  ACTIONABLE_STATES,
  classifyPlatform,
  collectEvidence,
  IMPROVE_PLATFORM_LABELS,
  improveRangeKey,
  sanitizeSuggestions,
} from '../promptImprove.js';
import { BRAND, TOPICS } from './brewline.js';
import { demoId } from './random.js';
import { allSettledOrThrow, demoWriter } from './write.js';
import * as S from './stats.js';

/**
 * How long the suggestions stay new. The routes give them 48 hours; the
 * demo's outlive its own rebuild (DEMO_MAX_AGE_MS, three days), so the
 * list never asks to be generated again, which a demo brand can't do.
 */
const FRESH_MS = 4 * S.DAY_MS;

/** Prompts the demo suggests tracking next, by topic. */
export const PROMPT_SUGGESTIONS = [
  {
    topic: 'subscriptions',
    text: 'Which coffee subscription ships the freshest beans?',
    reason:
      'Freshness is the reason answers give most often for recommending a subscription, and Brewline roasts to order.',
    volume: 880,
    relevance: 0.93,
  },
  {
    topic: 'subscriptions',
    text: 'How much does a coffee subscription cost per month?',
    reason: 'Price comparisons decide many subscription choices, and answers quote rivals’ prices.',
    volume: 1600,
    relevance: 0.86,
  },
  {
    topic: 'subscriptions',
    text: 'Can I change the grind size on my coffee subscription?',
    reason:
      'A question asked before signing up, close to the flexible-plan prompts already tracked.',
    volume: 140,
    relevance: 0.72,
  },
  {
    topic: 'beans',
    text: 'What are the best coffee beans for a French press?',
    reason: 'A brewing method with steady demand that the tracked espresso prompt doesn’t cover.',
    volume: 3600,
    relevance: 0.81,
  },
  {
    topic: 'beans',
    text: 'Which medium roast coffee beans taste the smoothest?',
    reason: 'Answers about smooth medium roasts name Morning Ritual Co. and rarely Brewline.',
    volume: 1300,
    relevance: 0.78,
  },
  {
    topic: 'buying',
    text: 'What does the roast date on a bag of coffee mean?',
    reason:
      'Engines cite Brewline’s freshness guide for related questions; this one has demand of its own.',
    volume: 1000,
    relevance: 0.88,
  },
  {
    topic: 'buying',
    text: 'How long does freshly roasted coffee take to ship?',
    reason: 'Shipping speed comes up in answers comparing online roasters.',
    volume: 390,
    relevance: 0.83,
  },
  {
    topic: 'buying',
    text: 'Is direct trade coffee worth paying more for?',
    reason:
      'Follows the fair trade prompt, where publishers’ roundups decide which roasters appear.',
    volume: 720,
    relevance: 0.69,
  },
];

/** Topics the demo suggests adding. */
export const TOPIC_SUGGESTIONS = [
  {
    name: 'Cold brew coffee',
    reason:
      'People ask which beans and grinds suit cold brew, and answers name subscription roasters.',
  },
  {
    name: 'Home brewing equipment',
    reason: 'Questions about grinders and brewers often end with which beans to buy.',
  },
  {
    name: 'Office coffee delivery',
    reason: 'Teams compare coffee subscriptions for the office, a need none of the topics covers.',
  },
];

/** The prompts whose Improve tab is filled, and the ranges it is filled for. */
export const IMPROVE_PROMPTS = ['pause-skip', 'buy-online'];
export const IMPROVE_PRESETS = { '30d': 30, '7d': 7 };
/** What the Improve route builds with unless configured otherwise. */
const IMPROVE_MODEL = 'google/gemini-3-flash-preview';

const host = (url) => new URL(url).hostname;

/**
 * One engine's suggestions, worded from its evidence the way the model is
 * asked to: an imperative title, what to do and why, and the evidence it
 * rests on. Only what the evidence holds survives sanitizeSuggestions.
 */
function suggestionsFor(platform, competitors) {
  const { id, label, state, evidence } = platform;
  const rivalDomains = new Set(competitors.map((c) => c.domain));
  const fanout = evidence.fanouts[0]?.query;
  // A publisher, forum or review site: not the brand's, not a rival's.
  const domain = evidence.citedDomains.find((d) => !d.own && !rivalDomains.has(d.domain))?.domain;
  // The rival ranked above, with its own page the engine cites when it has one.
  const rivalUrl = evidence.competitorUrls.find((u) =>
    evidence.competitors.some(
      (c) => competitors.find((x) => x.name === c.name)?.domain === host(u.url),
    ),
  )?.url;
  const rival = rivalUrl
    ? competitors.find((c) => c.domain === host(rivalUrl)).name
    : evidence.competitors[0]?.name;
  const ownPage = evidence.brandPages[0]?.url;
  const out = [];
  if (state === 'not_mentioned') {
    if (fanout) {
      out.push({
        platform: id,
        title: `Answer “${fanout}” on a Brewline page`,
        body: `${label} searched “${fanout}” for this prompt and built its answer from other sites. A page that answers that search directly gives it a Brewline source to use.`,
        sources: [{ type: 'fanout', ref: fanout }],
        confidence: 'high',
      });
    }
    if (domain) {
      out.push({
        platform: id,
        title: `Get listed on ${domain}`,
        body: `${domain} is the site ${label} cites most for this prompt, and its page doesn’t mention Brewline. A product listing or a contributed tip there puts Brewline in the source it trusts.`,
        sources: [{ type: 'domain', ref: domain }],
        confidence: 'medium',
      });
    }
  }
  if (state === 'mentioned_late' && rival) {
    out.push({
      platform: id,
      title: `Lead with what puts ${rival} first`,
      body: `${label} names ${rival} before Brewline here${rivalUrl ? `, citing ${host(rivalUrl)}` : ''}. Say early on the page it cites that every bag ships within a day of roasting and plans can be paused anytime.`,
      sources: rivalUrl
        ? [{ type: 'competitor_url', ref: rivalUrl }]
        : domain
          ? [{ type: 'domain', ref: domain }]
          : [],
      confidence: 'medium',
    });
  }
  if ((state === 'not_cited' || state === 'mentioned_late') && ownPage) {
    out.push({
      platform: id,
      title: 'Make this Brewline page the one it cites',
      body: `${label} names Brewline but rarely cites ${ownPage.replace(/^https?:\/\//, '')}. A short answer to the prompt at the top of that page, with a FAQ below, makes it the source to quote.`,
      sources: [{ type: 'brand_page', ref: ownPage }],
      confidence: 'medium',
    });
  }
  return out;
}

/** One prompt's Improve set over a range, as the route stores it. */
function improveSet(ctx, key, preset, days, generatedAt) {
  const promptId = ctx.promptId(key);
  const from = new Date(ctx.now.getTime() - days * S.DAY_MS).toISOString();
  const rows = ctx.rows.results
    .filter((r) => r.prompt_id === promptId && r.created_at >= from)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const byPlatform = S.groupBy(rows, 'platform');
  const prompt = ctx.rows.prompts.find((p) => p.id === promptId);
  const brandDomains = [BRAND.domain];
  const competitors = ctx.rows.competitors.map((c) => ({ name: c.name, domain: c.domain }));

  const states = Object.keys(IMPROVE_PLATFORM_LABELS)
    .filter((id) => byPlatform.has(id) || prompt.platforms.includes(id))
    .map((id) => ({
      id,
      label: IMPROVE_PLATFORM_LABELS[id],
      ...classifyPlatform(byPlatform.get(id) ?? [], brandDomains),
    }));
  const withEvidence = states
    .filter((p) => ACTIONABLE_STATES.includes(p.state))
    .map((p) => ({
      ...p,
      evidence: collectEvidence(byPlatform.get(p.id) ?? [], {
        brandName: BRAND.name,
        brandDomains,
        competitors,
        latestResponse: byPlatform.get(p.id)[0].response,
      }),
    }));
  const suggestions = sanitizeSuggestions(
    withEvidence.flatMap((p) => suggestionsFor(p, competitors)),
    withEvidence,
  );
  const evidenceById = new Map(withEvidence.map((p) => [p.id, p.evidence]));

  return {
    id: demoId(ctx.brandId, `improve:${key}:${preset}`),
    prompt_id: promptId,
    brand_id: ctx.brandId,
    range_key: improveRangeKey({ preset }),
    region: '',
    platform_states: states.map((p) => {
      const ev = evidenceById.get(p.id);
      return {
        ...p,
        inputs: ev
          ? {
              fanouts: ev.fanouts.length,
              citedDomains: ev.citedDomains.length,
              competitorUrls: ev.competitorUrls.length,
              answer: !!ev.excerpt,
            }
          : null,
      };
    }),
    suggestions,
    sent_actions: [],
    latest_result_at: rows[0]?.created_at ?? null,
    model: withEvidence.length > 0 ? IMPROVE_MODEL : null,
    generated_at: generatedAt.toISOString(),
  };
}

/**
 * Every suggestion row of the demo brand, built in memory.
 *
 * @param {{ brandId: string, now: Date }} args
 */
export function suggestionRows({ brandId, now }) {
  const ctx = S.demoContext(brandId, now);
  const latest = ctx.starts.length - 1;
  // Generated the morning of the latest run, once its answers were in.
  const generatedAt = S.afterRun(ctx.starts, latest, 1);
  const topicId = (key) => demoId(brandId, `topic:${key}`);
  const topicName = (key) => TOPICS.find((t) => t.key === key).name;

  const prompts = PROMPT_SUGGESTIONS.map((s, i) => ({
    id: demoId(brandId, `prompt-suggestion:${i}`),
    brand_id: brandId,
    suggested_text: s.text,
    topic_name: topicName(s.topic),
    topic_id: topicId(s.topic),
    reason: s.reason,
    est_volume: s.volume,
    relevance: s.relevance,
    source: 'llm',
    source_data: null,
    status: 'new',
    generated_at: generatedAt.toISOString(),
    expires_at: new Date(generatedAt.getTime() + FRESH_MS).toISOString(),
    created_at: generatedAt.toISOString(),
    updated_at: generatedAt.toISOString(),
  }));

  const topics = TOPIC_SUGGESTIONS.map((s, i) => ({
    id: demoId(brandId, `topic-suggestion:${i}`),
    brand_id: brandId,
    name: s.name,
    reason: s.reason,
    source: 'llm',
    status: 'new',
    generated_at: generatedAt.toISOString(),
    created_at: generatedAt.toISOString(),
    updated_at: generatedAt.toISOString(),
  }));

  const improve = IMPROVE_PROMPTS.flatMap((key) =>
    Object.entries(IMPROVE_PRESETS).map(([preset, days]) =>
      improveSet(ctx, key, preset, days, generatedAt),
    ),
  );

  return { prompts, topics, improve };
}

/** The suggestions module. */
export const suggestions = {
  name: 'suggestions',
  // Rebuilt in place (write.js): written over, what isn't written again deleted after.
  inPlace: true,
  tables: ['prompt_suggestions', 'topic_suggestions', 'prompt_improve_suggestions'],

  /**
   * Its three tables side by side, through the build's writer (a writer over
   * `db` for a first build without one).
   *
   * @param {{ brandId: string, now: Date, db?: object, rebuild?: boolean, write?: Function }} ctx
   */
  async build({
    brandId,
    now,
    db = supabaseAdmin,
    rebuild = false,
    write = demoWriter({ db, brandId, rebuild }).write,
  }) {
    const rows = suggestionRows({ brandId, now });
    await allSettledOrThrow([
      write('prompt_suggestions', rows.prompts),
      write('topic_suggestions', rows.topics),
      write('prompt_improve_suggestions', rows.improve),
    ]);
    return {
      promptSuggestions: rows.prompts.length,
      topicSuggestions: rows.topics.length,
      improveSuggestions: rows.improve.reduce((n, s) => n + s.suggestions.length, 0),
    };
  },
};
