import { createHash } from 'node:crypto';
import { z } from 'zod';
import { HEADING_LIMITS } from './contentAgent.js';
import {
  briefGuard,
  briefRulesOn,
  briefSchema,
  briefSystemPrompt,
  buildBriefPrompt,
} from './contentBrief.js';
import { NAME_PLACEHOLDER, QUOTE_PLACEHOLDER } from './contentPeople.js';
import { qualityPhase } from './contentQuality.js';
import { NUMBER_PLACEHOLDER } from './contentSources.js';

/**
 * The brief eval (CE-EVAL-001): how good the Content Editor's briefs are,
 * read against the brief rules for AI search (Google's May 2026 guide,
 * Bing's February 2026 guidelines, the GEO paper). Our own briefs only:
 * no competitor's.
 *
 * Each brief is read two ways:
 *   * checks anyone can repeat (briefChecks): its shape, the fan-outs it
 *     answers, and, as a gate, no figure, name, quote or address it wasn't
 *     given left in it after the guard;
 *   * a judge model's scores on the nine criteria (BRIEF_CRITERIA), 0 to 2,
 *     each with the brief's own words that earn it (readJudged drops a
 *     score whose words aren't in the brief).
 *
 * `node src/scripts/evalBrief.js` records both for the cases in
 * __fixtures__/brief-eval/cases.js (recorded.json), with a provider key: the
 * maintainer's run, never CI's. contentBriefEval.test.js reads the record
 * for free on every run, and skips it once the brief's prompt has changed
 * (promptVersion) until it is recorded again.
 */

/** The judge: another model family than the brief's, so it doesn't grade its own. */
export function briefEvalJudgeModelId() {
  return process.env.BRIEF_EVAL_JUDGE_MODEL || 'anthropic/claude-haiku-4-5';
}

/** The nine criteria, as the brief rules (2026) name them: 0 missing, 1 partly, 2 fully. */
export const BRIEF_CRITERIA = [
  {
    key: 'answerFirst',
    ask: 'Does each H2 say what its direct answer must state, so the section can open with a 40–75-word answer?',
  },
  {
    key: 'uniqueAngle',
    ask: "Does it name a unique angle or first-hand proof to gather (the brand's own data, cases, tests, experience), rather than commodity content?",
  },
  {
    key: 'sourcedFacts',
    ask: 'Does it name the facts to state, each with the kind of source it needs (a statistic, a study, a quote), about one per section, without a figure of its own?',
  },
  {
    key: 'entities',
    ask: 'Does it name the brand, its products and the competitors given consistently, exactly as given?',
  },
  {
    key: 'topEssentials',
    ask: 'Does it put the essentials at the top (a TL;DR or key takeaways) and keep the page to one topic?',
  },
  {
    key: 'freshness',
    ask: 'Does it plan freshness where the topic needs it: a dated data point, an updated date, the year?',
  },
  {
    key: 'format',
    ask: 'Does it say how each part is best shown (a table for a comparison, steps for a how-to, a question FAQ at the end), with short H2 headings (about 8–15 words)?',
  },
  {
    key: 'naturalLanguage',
    ask: 'Is it free of keyword stuffing and of wording engineered to trigger citations?',
  },
  {
    key: 'links',
    ask: "Does it plan internal links and outbound sources, to the brand's own pages or the sources given only?",
  },
];

/** Sections a brief should plan, as its prompt asks: 3 to 10. */
const SECTIONS = { min: 3, max: 10 };
/** Keywords it should list, as its prompt asks: up to 10. */
const MAX_KEYWORDS = 10;

// An address: with its scheme, or a host starting "www.".
const URL_RE = /(?:https?:\/\/|\bwww\.)[^\s"'<>)\]]+/gi;

/** An address as compared: its host without "www." and in small letters, its path without the last "/". */
function urlKey(url) {
  try {
    const read = new URL(/^www\./i.test(url) ? `https://${url}` : url);
    return `${read.hostname.toLowerCase().replace(/^www\./, '')}${read.pathname.replace(/\/+$/, '')}`;
  } catch {
    return url.toLowerCase();
  }
}

/**
 * A brief's fields as the judge sees them and as a quote is read in: the
 * goal, the audience, version 2's essentials, angle and proof to gather,
 * each heading and key point, a section's answer, format and facts (with the
 * kind of source each needs and the source to check it against), the
 * keywords as one line, the fan-outs left out, the freshness, the names as
 * written and the links planned; each with whether it's a heading.
 */
function briefFields(brief) {
  const fresh = brief.freshness;
  return [
    { label: 'Goal: ', text: brief.goal, heading: false },
    { label: 'Audience: ', text: brief.audience, heading: false },
    { label: 'TL;DR: ', text: brief.tldr, heading: false },
    { label: 'Angle: ', text: brief.angle, heading: false },
    ...(brief.proof ?? []).map((p) => ({
      label: `Proof to gather (${p.kind}): `,
      text: p.what,
      heading: false,
    })),
    ...brief.outline.flatMap((s) => [
      { label: 'H2: ', text: s.heading, heading: true },
      ...s.keyPoints.map((point) => ({ label: '- ', text: point, heading: false })),
      { label: 'Answer: ', text: s.answer, heading: false },
      { label: 'Format: ', text: s.format, heading: false },
      ...(s.facts ?? []).map((f) => ({
        label: `Fact (${f.sourceType}${f.source ? `, check against ${f.source.label}` : ''}): `,
        text: f.claim,
        heading: false,
      })),
    ]),
    { label: 'Keywords: ', text: brief.keywords.join(', '), heading: false },
    {
      label: 'Left out, for another page: ',
      text: (brief.leftOut ?? []).join(', '),
      heading: false,
    },
    {
      label: 'Freshness: ',
      text: [
        fresh?.datedPoint && `date ${fresh.datedPoint}`,
        fresh?.updatedLine && 'an "Updated" line',
        fresh?.yearInTitle && 'the year in the title',
      ]
        .filter(Boolean)
        .join('; '),
      heading: false,
    },
    {
      label: 'Names as written: ',
      text: [
        brief.entities?.brand,
        ...(brief.entities?.products ?? []),
        ...(brief.entities?.competitors ?? []),
      ]
        .filter(Boolean)
        .join(', '),
      heading: false,
    },
    ...['internal', 'outbound'].flatMap((kind) =>
      (brief.links?.[kind] ?? []).map((link) => ({
        label: `Link (${kind}${link.section ? `, in "${link.section}"` : ''}): `,
        text: `${link.anchor} → ${link.url}`,
        heading: false,
      })),
    ),
  ].filter((f) => f.text);
}

/** A brief's words, every field, as one text. */
export function briefText(brief) {
  return briefFields(brief)
    .map((f) => f.text)
    .join('\n');
}

const PLACEHOLDERS = [NUMBER_PLACEHOLDER, NAME_PLACEHOLDER, QUOTE_PLACEHOLDER];

/**
 * The checks anyone can repeat, for one case's brief (after shapeBrief):
 *   * sections, those without a key point, headings past the editor's limit,
 *     and keywords past the ten the prompt asks for;
 *   * fanoutCoverage: the share of the case's fan-outs an H2 answers, of
 *     those the brief keeps (version 2 leaves some to another page, as
 *     leftOut counts);
 *   * placeholders: the names and quotes the guard put as placeholders (a
 *     figure goes with its sentence: none is left as one);
 *   * invented (the gate, all 0): figures and names or quotes the guard let
 *     through that the case didn't give, and addresses it didn't list.
 */
export function briefChecks(brief, c) {
  const text = briefText(brief);
  const guard = briefGuard(c);
  // Each field read as the guard reads it: a heading as one, a question in quotes kept.
  const found = briefFields(brief).map((f) => guard.found(f.text, f.heading));
  // The addresses it was given: the cited pages, the live page, the pages it may link to.
  const given = new Set(
    [
      ...c.sources.pages.map((p) => p.url),
      c.draft.source_url,
      ...(c.targets?.own ?? []).map((p) => p.url),
      ...(c.targets?.sources ?? []).map((p) => p.url),
    ]
      .filter(Boolean)
      .map(urlKey),
  );
  const answered = new Set(brief.outline.map((s) => s.fanout).filter(Boolean));
  const leftOut = new Set(brief.leftOut ?? []);
  const kept = c.sources.fanouts.filter((f) => !leftOut.has(f.query));
  return {
    sections: brief.outline.length,
    sectionsInRange: brief.outline.length >= SECTIONS.min && brief.outline.length <= SECTIONS.max,
    emptySections: brief.outline.filter((s) => s.keyPoints.length === 0).length,
    longHeadings: brief.outline.filter((s) => s.heading.length > HEADING_LIMITS.other).length,
    extraKeywords: Math.max(0, brief.keywords.length - MAX_KEYWORDS),
    fanoutCoverage: kept.length
      ? kept.filter((f) => answered.has(f.query)).length / kept.length
      : null,
    leftOut: c.sources.fanouts.length - kept.length,
    placeholders: PLACEHOLDERS.reduce((n, p) => n + text.split(p).length - 1, 0),
    invented: {
      figures: found.flatMap((f) => f.figures),
      people: found.flatMap((f) => f.people),
      urls: [...text.matchAll(URL_RE)]
        .map((m) => m[0].replace(/[.,;:!?]+$/, ''))
        .filter((url) => !given.has(urlKey(url))),
    },
  };
}

/** Whether a brief passes the gate: nothing it wasn't given left in it. */
export function passesGate(checks) {
  const { figures, people, urls } = checks.invented;
  return figures.length === 0 && people.length === 0 && urls.length === 0;
}

/** What the judge answers: per criterion, its score, the brief's words for it, and why. */
export const judgeSchema = z.object({
  scores: z.array(
    z.object({
      key: z.enum(BRIEF_CRITERIA.map((k) => k.key)),
      score: z.number(),
      quote: z.string(),
      why: z.string(),
    }),
  ),
});

export const JUDGE_SYSTEM_PROMPT = `You grade one content brief: the plan a writer follows to write a web page that AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) cite.

Rules:
- Score each criterion listed 0 (missing), 1 (partly) or 2 (fully), from what the brief says only. Don't reward length or fill in what it leaves out.
- For a score above 0, put in "quote" the brief's own words that earn it, copied exactly from one of its lines, at least 3 words and at most 30. For 0, leave "quote" empty.
- A fact named in words without its figure, e.g. "how far forecasts drift, from a study", is one the writer looks up as it writes: that is correct, not a missing fact. A placeholder in square brackets, e.g. [name of a real person], marks what only the brand can give.
- In "why", one short sentence.
- Score every criterion listed, once each, by its key.`;

/** What the judge is told: the case the brief was built for, the brief, the criteria. */
export function buildJudgePrompt(c, brief) {
  const list = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none');
  return `The page: ${c.draft.title} (${c.draft.page_type}, ${c.draft.method === 'optimize' ? 'an existing page' : 'a new page'}), for ${c.brand.name}: ${c.brand.description}
Written in: ${c.language}

Prompts it must answer:
${list(c.prompts)}

AI searches (fan-outs) it was given:
${list(c.sources.fanouts.map((f) => f.query))}
${c.competitors?.length ? `\nCompetitors it was given: ${c.competitors.join(', ')}\n` : ''}${c.targets?.own?.length ? `\nThe brand's pages it may link to:\n${list(c.targets.own.map((p) => `${p.title} — ${p.url}`))}\n` : ''}
The brief:
${briefFields(brief)
  .map((f) => `${f.label}${f.text}`)
  .join('\n')}

Criteria:
${BRIEF_CRITERIA.map((k) => `- ${k.key}: ${k.ask}`).join('\n')}`;
}

/** Text as a quote is compared: one form of each character, straight quotes, small letters, single spaces. */
const norm = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .replace(/[‘’]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
const EDGES = /^["'\s.,;:!?-]+|["'\s.,;:!?-]+$/g;
/** A quote's parts: without the marks around it, split where it was shortened ("…"). */
const quoteParts = (quote) =>
  norm(quote)
    .split(/\s*(?:…|\.\.\.)\s*/)
    .map((part) => part.replace(EDGES, ''))
    .filter(Boolean);

/**
 * The judge's answer as kept: one score per criterion, a whole number 0 to
 * 2 (a criterion it left out is 0); a score above 0 whose quote isn't the
 * brief's own words is 0, marked `unquoted`, so a judge can't vouch for what
 * the brief doesn't say.
 */
export function readJudged(answer, brief) {
  const fields = briefFields(brief).map((f) => norm(f.text));
  const byKey = new Map((answer?.scores ?? []).map((s) => [s.key, s]));
  return Object.fromEntries(
    BRIEF_CRITERIA.map(({ key }) => {
      const s = byKey.get(key);
      const score = Math.max(0, Math.min(2, Math.round(Number(s?.score) || 0)));
      const parts = quoteParts(s?.quote);
      // Three words at least, each part within one line of the brief.
      const quoted =
        parts.join(' ').split(' ').length >= 3 &&
        parts.every((part) => fields.some((field) => field.includes(part)));
      const unquoted = score > 0 && !quoted;
      return [
        key,
        {
          score: unquoted ? 0 : score,
          quote: s?.quote ?? '',
          why: s?.why ?? '',
          ...(unquoted ? { unquoted: true } : {}),
        },
      ];
    }),
  );
}

/**
 * The brief's prompt as recorded: a hash of its rules, its schema and the
 * prompt each case gets, under Quality's phase (the site type line shows from
 * phase 2) and with the brief rules (2026) on or off (CONTENT_BRIEF_RULES:
 * version 2's rules, schema and numbered data). A record made under another
 * one is stale.
 */
export function promptVersion(cases, { phase = qualityPhase(), rules = briefRulesOn() } = {}) {
  const before = {
    phase: process.env.CONTENT_QUALITY_PHASE,
    rules: process.env.CONTENT_BRIEF_RULES,
  };
  process.env.CONTENT_QUALITY_PHASE = String(phase);
  process.env.CONTENT_BRIEF_RULES = rules ? 'true' : 'false';
  try {
    const hash = createHash('sha256')
      .update(briefSystemPrompt())
      .update(JSON.stringify(z.toJSONSchema(briefSchema())));
    for (const c of cases) hash.update(buildBriefPrompt(c));
    return hash.digest('hex').slice(0, 12);
  } finally {
    for (const [key, name] of [
      ['phase', 'CONTENT_QUALITY_PHASE'],
      ['rules', 'CONTENT_BRIEF_RULES'],
    ]) {
      if (before[key] === undefined) delete process.env[name];
      else process.env[name] = before[key];
    }
  }
}

/** A record's sums: per criterion its mean score, the gate, the checks, the tokens. */
export function summarize(cases) {
  const results = Object.values(cases);
  const mean = (values) =>
    values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100 : 0;
  const coverage = results.map((r) => r.checks.fanoutCoverage).filter((v) => v !== null);
  return {
    cases: results.length,
    criteria: Object.fromEntries(
      BRIEF_CRITERIA.map(({ key }) => [key, mean(results.map((r) => r.judged[key].score))]),
    ),
    total: mean(
      results.map((r) => BRIEF_CRITERIA.reduce((n, { key }) => n + r.judged[key].score, 0)),
    ),
    gateFailures: results.filter((r) => !passesGate(r.checks)).length,
    sectionsInRange: results.filter((r) => r.checks.sectionsInRange).length,
    fanoutCoverage: mean(coverage),
    placeholders: results.reduce((n, r) => n + r.checks.placeholders, 0),
    unquoted: results.reduce(
      (n, r) => n + Object.values(r.judged).filter((j) => j.unquoted).length,
      0,
    ),
    tokens: results.reduce(
      (n, r) => ({
        input: n.input + (r.usage?.inputTokens ?? 0),
        output: n.output + (r.usage?.outputTokens ?? 0),
      }),
      { input: 0, output: 0 },
    ),
  };
}
