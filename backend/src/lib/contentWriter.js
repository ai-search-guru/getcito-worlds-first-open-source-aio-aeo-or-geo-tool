import { randomUUID } from 'crypto';
import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { brandRulesSection } from './brandRules.js';
import { readBrandRules } from './brandRulesRead.js';
import { resolveModel } from './aiProvider.js';
import {
  ATTRIBUTION_RULE,
  attributableSources,
  bannedWordsOf,
  placeholderAttributionsInHtml,
  FANOUT_RULE,
  HEADING_LIMITS,
  HEADING_RULE,
  LINK_RULE,
  MAX_AGENT_SUGGESTIONS,
  draftPassages,
  hasOpenSuggestions,
  keepSuggestions,
  passageKey,
  promptPassages,
  readPrompts,
  suggestionsSchema,
  WRITING_STALE_MS,
} from './contentAgent.js';
import {
  CONTENT_WRITE_MAX_TOKENS,
  WRITING_GUARDRAIL,
  briefForWriter,
  briefRulesOn,
  contentReadModelId,
  contentWriteModelId,
  rebuildDraftBrief,
  rebuildSources,
} from './contentBrief.js';
import {
  HEALTH_RULE,
  healthGuard,
  healthHtml,
  healthPage,
  withoutHealthFinds,
} from './contentHealth.js';
import { inputSources, readDraftInputs } from './contentInputs.js';
import {
  RESEARCH_RULE,
  applyEdits,
  editHtml,
  linkFacts,
  lookUpFacts,
  lookUpSuggestionFacts,
  pageOwn,
  settler,
  sweepHtml,
  sweeper,
  withFactLinks,
} from './contentResearch.js';
import { draftLanguage } from './contentLanguage.js';
import { linkAllowList, linkTargetsPrompt, readLinkTargets } from './contentLinks.js';
import { insertProductGrid } from './shoppingBlocks.js';
import {
  linkShoppingPath,
  shoppingGiven,
  shoppingPathFor,
  shoppingPrompt,
  withShopping,
} from './shoppingLinks.js';
import { siteTypeLine, pageTypeFormat } from './contentPageTypes.js';
import { authorWords, guardPeople, guardPeopleInHtml, knownPeople } from './contentPeople.js';
import {
  INPUT_RULE,
  SOURCES_RULE,
  htmlText,
  knownNumbers,
  numberSources,
  placeholderNumbers,
  placeholderNumbersInHtml,
  sourceSuggestion,
  sourceWords,
  stripSourceIds,
  todayText,
  withNamedNumbers,
} from './contentSources.js';
import {
  MAX_PAGE_HTML,
  MAX_REWRITE_CHARS,
  REWRITE_SYSTEM_PROMPT,
  cleanPageHtml,
  isPageHtml,
  keepBlocks,
  ownText,
  restoreKept,
  rewriteLinks,
  rewriteSchema,
  textLength,
} from './contentRewrite.js';
import {
  RunStoppedError,
  advanceRun,
  finishRun,
  fixUnderWay,
  isStop,
  runCall,
  startRun,
  stopIfStopped,
} from './contentRuns.js';
import { getLanguageName } from './languages.js';
import { logger } from './logger.js';
import { reserveAiBudget } from './planGuard.js';
import { objectOptions } from './structuredOutput.js';

/**
 * "Agent" in the Content Editor's Start (CE-015, spec §5): the Content Agent
 * does the page, and a person reviews it in Library › In review. A new page
 * is written whole, from its brief, prompts, the AI searches behind them and
 * its rules. An existing page is the person's live text: the agent leaves
 * suggestions on it (content_draft_suggestions, 00217), as Fix open rules
 * does, and never changes a passage AI answers quote today.
 *
 * Start doesn't wait for it. The draft says where the agent is
 * (content_drafts.agent_state, 00219): 'writing' while it runs here in the
 * background, then In review, or 'failed'. It is metered from the
 * organization's AI usage, as the brief and the agent's fixes are, and one
 * draft of an organization is written at a time: the budget is checked
 * before a run, so runs started together could all pass it.
 */

/** How long the model may take: nobody waits on the request. */
const CALL_TIMEOUT_MS = 180_000;
/** How far a Length's band reaches either side of it (the editor's LENGTH_TOLERANCE). */
const LENGTH_TOLERANCE = 0.2;

// A 'writing' older than WRITING_STALE_MS (contentAgent.js, which Fix open
// rules checks too) was left by a server that stopped: it can start again.
export { WRITING_STALE_MS };

/**
 * The drafts the agent writes in: still being worked on, a draft or one in
 * review (Rewrite from brief, after its first run), never one marked ready
 * or published.
 */
const OPEN_STATUSES = ['draft', 'in_review'];

/** What the person's dashboard sends: the sources kept, the page's rules, its locked passages. */
export const writeDraftInput = z.object({
  sources: rebuildSources,
  rules: z
    .array(
      z.object({
        key: z.string().trim().min(1).max(60),
        name: z.string().trim().min(1).max(200),
        /** What the rule asks: "aim 3,000 characters". */
        detail: z.string().trim().max(500).default(''),
      }),
    )
    .max(60)
    .default([]),
  textRules: z.array(z.string().trim().min(1).max(300)).max(50).default([]),
  /** The passages AI answers quote today, by passageKey (an existing page's). */
  locked: z.array(z.string().max(5000)).max(500).default([]),
  /**
   * How many rules the editor counts (its "met of total": those it checks on
   * the page), for the run's "Reading N rules" step; the rules sent also
   * hold those only AI can read (tone, language).
   */
  counted: z.number().int().min(0).max(60).optional(),
  /**
   * Write this (customer priorities item 9): the brief is built from these
   * sources first, in the same run, and the page written from it. A draft
   * with a brief of its own keeps it.
   */
  buildBrief: z.boolean().optional(),
});

export const pageSchema = z.object({
  title: z.string().describe('The page title, its H1.'),
  intro: z
    .array(z.string())
    .min(1)
    .max(3)
    .describe('The opening paragraphs, the direct answer first.'),
  sections: z
    .array(
      z.object({
        heading: z.string().describe('The H2.'),
        paragraphs: z.array(z.string()).max(6),
        bullets: z.array(z.string()).max(10).describe('A list after the paragraphs, or none.'),
      }),
    )
    .min(2)
    .max(12),
  faqHeading: z.string().describe('The FAQ section heading, in the page language, or "".'),
  faq: z.array(z.object({ question: z.string(), answer: z.string() })).max(8),
});

export const WRITE_SYSTEM_PROMPT = `You are the Content Agent for Answer Engine Optimization (AEO). You write one web page so AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) understand it, trust it and cite it. A person reviews it before it is published.

How to write:
- Answer first: the opening paragraphs answer the page's main question directly.
- Follow the outline when there is one; each H2 answers one of the questions or AI searches given.
- Short paragraphs and plain sentences. Lists where a reader compares or follows steps.
- Follow the brand's rules first, then every rule listed and the writer's own rules; when they disagree, the brand's rule wins.
- For each fan-out a rule names, use its words, not questions of your own: a section heading for fanoutH2, an FAQ question ending in "?" for fanoutFaq.
- Use only facts from the brand, the brief and your data, and the ones you ask to have looked up. Never invent numbers, prices, dates, names, customers, sources or quotes.
${RESEARCH_RULE}
${HEALTH_RULE}
- Plain text in every field: no HTML, no Markdown.
- Write in the language asked for.`;

/**
 * With the brief rules (2026) on: the brief's section plans followed, headings
 * kept short (the editor's limits), and the guardrail.
 */
const WRITE_RULES_2026 = `- Follow the brief's section plans when it has them: each section's answer first, its format, the facts it names (from your data, else looked up with {{find: …}}), the names as written.
- Headings are one short line: the title up to ${HEADING_LIMITS.h1} characters, each section heading about 8 to 15 words (a fan-out's own words, when shorter) and under ${HEADING_LIMITS.other} characters. Never put a sentence or an answer in a heading.
${WRITING_GUARDRAIL}`;

/** The prompts as the run uses them: version 1's, or with the brief rules (2026) on, theirs too. */
export function writeSystemPrompt() {
  return briefRulesOn() ? `${WRITE_SYSTEM_PROMPT}\n${WRITE_RULES_2026}` : WRITE_SYSTEM_PROMPT;
}
export function suggestSystemPrompt() {
  return briefRulesOn() ? `${SUGGEST_SYSTEM_PROMPT}\n${WRITING_GUARDRAIL}` : SUGGEST_SYSTEM_PROMPT;
}
export function rewriteSystemPrompt() {
  return briefRulesOn() ? `${REWRITE_SYSTEM_PROMPT}\n${WRITING_GUARDRAIL}` : REWRITE_SYSTEM_PROMPT;
}

const SUGGEST_SYSTEM_PROMPT = `You are the Content Agent for Answer Engine Optimization (AEO). You improve one existing web page so AI assistants cite it, by suggesting changes that a person reviews.

Rules for your suggestions:
- Make the page answer the questions and AI searches listed, follow the brief when there is one, and meet the rules listed.
- A replace changes words inside one passage: copy "before" exactly as that passage has it (a phrase or a sentence), and write "after" as plain text that fits in its place, with links only as the links rule below says.
- An insert adds new blocks after a passage, as simple HTML (h2, h3, p, ul, ol, li, strong, em, and a for links): a missing section, a direct answer, an FAQ.
${HEADING_RULE}
${LINK_RULE}
${FANOUT_RULE}
- Never change a passage marked LOCKED: AI assistants quote its wording today. You may insert after it.
- Put the keys of the rules a change meets in "rules" (none when it meets none).
- Use only facts from the page, the brand and your data, and the ones you ask to have looked up. Never invent numbers, prices, dates, names, sources or quotes.
${RESEARCH_RULE}
${HEALTH_RULE}
${SOURCES_RULE}
${ATTRIBUTION_RULE}
- Keep the page's voice. The most useful changes first, at most ${MAX_AGENT_SUGGESTIONS}.
- "reason" says in a few words what the change does, e.g. "answer the search 'x' (fan-out)".
- Write in the language asked for.`;

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeText = (value) => String(value).replace(/[&<>"']/g, (c) => ENTITIES[c]);
const clean = (value) => String(value ?? '').trim();

/**
 * A heading as a reader sees one: its first letter a capital when its first
 * word is all lowercase, as a fan-out's words come ("latest news ChatGPT"),
 * in the page's language (Turkish "i" → "İ"). A name written lowercase on
 * purpose ("iPhone", "eBay") stays as it is.
 */
export function headingCase(text, language) {
  const value = clean(text);
  const [first = ''] = value.split(/\s+/u);
  if (!first || first !== first.toLowerCase() || first === first.toUpperCase()) return value;
  const chars = Array.from(value);
  let capital;
  try {
    capital = chars[0].toLocaleUpperCase(language || undefined);
  } catch {
    capital = chars[0].toUpperCase();
  }
  return capital + chars.slice(1).join('');
}

/**
 * The written page as the editor's HTML: an H1, the opening paragraphs, an
 * H2 per section with its paragraphs and list, and the FAQ as H3 questions,
 * each heading starting with a capital (headingCase). Every text is escaped:
 * the model writes text, never markup.
 */
export function renderPage(page, { language = null } = {}) {
  const p = (text) => (clean(text) ? `<p>${escapeText(clean(text))}</p>` : '');
  const h = (level, text) => `<h${level}>${escapeText(headingCase(text, language))}</h${level}>`;
  const parts = [h(1, page.title), ...page.intro.map(p)];
  for (const section of page.sections) {
    if (!clean(section.heading)) continue;
    parts.push(h(2, section.heading), ...section.paragraphs.map(p));
    const bullets = section.bullets.filter((b) => clean(b));
    if (bullets.length) {
      parts.push(`<ul>${bullets.map((b) => `<li>${p(b)}</li>`).join('')}</ul>`);
    }
  }
  const faq = page.faq.filter((item) => clean(item.question) && clean(item.answer));
  if (faq.length && clean(page.faqHeading)) {
    parts.push(h(2, page.faqHeading));
    for (const item of faq) {
      parts.push(h(3, item.question), p(item.answer));
    }
  }
  return parts.filter(Boolean).join('');
}

const list = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none');

/**
 * A written page with each number its sources don't have (CE-033), and each
 * person's name or quote what it was given doesn't have (CE-044), put as a
 * placeholder.
 */
export function sourcedPage(page, known, people = knownPeople()) {
  const fix = (text, heading = false) =>
    guardPeople(placeholderNumbers(stripSourceIds(text), known), people, { heading }).text;
  const heading = (text) => fix(text, true);
  return {
    ...page,
    title: heading(page.title),
    intro: page.intro.map((text) => fix(text)),
    sections: page.sections.map((section) => ({
      ...section,
      heading: heading(section.heading),
      paragraphs: section.paragraphs.map((text) => fix(text)),
      bullets: section.bullets.map((text) => fix(text)),
    })),
    faqHeading: heading(page.faqHeading),
    faq: page.faq.map((item) => ({ question: heading(item.question), answer: fix(item.answer) })),
  };
}

/**
 * A written page with `editsFor(text, heading)`'s edits ({ start, end,
 * text }) made in each of its texts, in order: the title, the intro, each
 * section's heading, paragraphs and list, the FAQ's heading, questions and
 * answers (contentResearch.js lookUpFacts, settler).
 */
export function editPage(page, editsFor) {
  const fix = (text, heading = false) => applyEdits(text, editsFor(String(text ?? ''), heading));
  const heading = (text) => fix(text, true);
  return {
    ...page,
    title: heading(page.title),
    intro: page.intro.map((text) => fix(text)),
    sections: page.sections.map((section) => ({
      ...section,
      heading: heading(section.heading),
      paragraphs: section.paragraphs.map((text) => fix(text)),
      bullets: section.bullets.map((text) => fix(text)),
    })),
    faqHeading: heading(page.faqHeading),
    faq: page.faq.map((item) => ({ question: heading(item.question), answer: fix(item.answer) })),
  };
}

/**
 * The cited pages' checks the writer can give a page in its body HTML. Not
 * its schema (FAQ schema, JSON-LD), date markup or freshness, which the
 * site's template or CMS sets, nor its byline, which would name a person the
 * writer doesn't know. The Brief tab still shows them all.
 */
export const WRITER_CHECKS = Object.freeze([
  'length',
  'structural-depth',
  'h2-coverage',
  'lists',
  'tables',
  'statistic-density',
  'quotations',
  'citation-density',
  'outbound-authority-links',
  'readability',
]);

/**
 * What the pages AI cites for the draft's prompts have (learning C2), as the
 * brief's rebuild read them through Site Audit's checks: seen, not guessed.
 * Only what the writer can give the page (WRITER_CHECKS).
 */
export function citedHave(features) {
  const checks = (features?.checks ?? []).filter(
    (c) => c?.label && c.pages > 0 && WRITER_CHECKS.includes(c.key),
  );
  if (!checks.length) return '';
  return `\nWhat the pages AI cites for these prompts have (Site Audit's checks, ${features.pages} pages read): ${checks
    .map((c) => `${c.label} on ${c.pages}`)
    .join('; ')}. Give the page these where they serve its readers.`;
}

/** The brief as the model reads it: the draft's own, else its opportunity's. */
export function briefText(draftBrief, opportunityBrief, { links = true } = {}) {
  if (draftBrief?.outline?.length || draftBrief?.goal) {
    const sections = draftBrief.outline.map(
      (s) =>
        `${s.heading}${s.keyPoints?.length ? `: ${s.keyPoints.join('; ')}` : ''}${s.fanout ? ` (answers the AI search "${s.fanout}")` : ''}`,
    );
    // Version 2's plan after it, with the brief rules on (briefForWriter).
    const plan = briefForWriter(draftBrief, { links });
    return `Goal: ${draftBrief.goal || '—'}
Audience: ${draftBrief.audience || '—'}
Outline:
${list(sections)}
Keywords: ${(draftBrief.keywords ?? []).join(', ') || '—'}${citedHave(draftBrief.citedFeatures)}${plan ? `\n${plan}` : ''}`;
  }
  if (opportunityBrief?.outline?.length) {
    const sections = opportunityBrief.outline.map(
      (s) => `${s.heading}${s.keyPoints?.length ? `: ${s.keyPoints.join('; ')}` : ''}`,
    );
    return `Suggested title: ${opportunityBrief.suggestedTitle || '—'}
Outline:
${list(sections)}
Keywords: ${(opportunityBrief.targetKeywords ?? []).join(', ') || '—'}
Call to action: ${opportunityBrief.callToAction || '—'}`;
  }
  return 'No brief: plan the sections from the questions and AI searches below.';
}

/**
 * An existing page's length now against its Length, and what its
 * suggestions should do about it: a page told only the Length doesn't know
 * it's already twice as long (editor test 2026-10-26).
 */
export function lengthNow(now, target) {
  const top = Math.round(target * (1 + LENGTH_TOLERANCE));
  const bottom = Math.round(target * (1 - LENGTH_TOLERANCE));
  if (now > top) {
    return `The page is about ${now} characters now, over its Length: suggest cuts (repetition, filler, the least useful detail) before anything new, and keep each addition short.`;
  }
  if (now < bottom) {
    return `The page is about ${now} characters now, under its Length: add what the questions and rules ask for.`;
  }
  return `The page is about ${now} characters now: keep it about this long.`;
}

/**
 * What the model is told, for a new page, an existing one (passage by
 * passage, with its length now: lengthNow) or one it rewrites whole
 * (`current`: keepBlocks' page).
 */
export function buildWritePrompt({
  brand,
  draft,
  numbered = [],
  brief,
  input,
  passages,
  more = false,
  lockedKeys,
  linkTargets = '',
  current = null,
}) {
  const { sources } = input;
  // An existing page's length now, when its Length is among the rules (as
  // overLengthLine): Length off keeps the page's length. A rewrite's page
  // says it in its own lines.
  const now =
    passages && !current && input.rules.some((r) => r.key === 'length')
      ? textLength(draft.body_html ?? '')
      : null;
  // The data, numbered (S1, S2…) as the agent cites it (CE-033).
  const of = (kind) => numbered.filter((s) => s.kind === kind);
  const rules = input.rules.map((r) => `${r.key}: ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
  const own = input.textRules.map((text) => `- ${text}`);
  // The brand's rules (Settings › Content, 00450): before the writer's own, which they outrank.
  const brandRules = brandRulesSection(brand.rules, "The brand's rules, which come first:");
  // Brief › Your input, the person's own (CE-048): with what to do with it.
  const given = of('input').map(
    (s) => `${s.id} "${s.label}" (${s.detail})${s.note ? ` — ${s.note}` : ''}`,
  );
  const page = current
    ? rewritePagePrompt(current)
    : passages
      ? `The page, passage by passage:\n${passages
          .map((p, i) => {
            const locked = lockedKeys.has(passageKey(p.text)) ? ', LOCKED' : '';
            return `[${i + 1}] (${p.tag}${locked}) ${p.text}`;
          })
          .join(
            '\n',
          )}${more ? '\n(The page goes on; suggest changes only to the passages above.)' : ''}`
      : `Write a new page titled about: ${draft.title || 'the questions below'}.`;
  return `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
${siteTypeLine(brand)}Description: ${brand?.description || 'N/A'}

Page type: ${pageTypeFormat(draft.page_type)}
Length: about ${sources.length} characters.${now === null ? '' : ` ${lengthNow(now, sources.length)}`}

Brief:
${brief}

Your data is numbered below (S1, S2…), by its words only. Name the ones you use where asked; never write these numbers in the page's words.

Questions the page must answer (tracked prompts):
${list(of('prompt').map((s) => `${s.id} ${s.label}`))}

AI searches (fan-outs) run while answering them, the most searched first:
${list(of('fanout').map((s) => `${s.id} "${s.label}"`))}

Google searches people use (Search Console):
${list(of('gsc_query').map((s) => `${s.id} "${s.label}"`))}

Pages AI cites for these questions today (answer better than them, never copy them):
${list(of('cited_page').map((s) => `${s.id} ${s.label}`))}
${given.length ? `\nYour input, the person's own for this page:\n${given.join('\n')}\n${INPUT_RULE}\n` : ''}
Rules (key: rule — what it asks):
${list(rules)}
${brandRules ? `\n${brandRules}\n` : ''}${own.length ? `\nThe writer's own rules:\n${own.join('\n')}\n` : ''}${linkTargets ? `\n${linkTargets}\n` : ''}
${page}

Write in ${current ? "the page's own language" : getLanguageName(brand?.language)}.`;
}

/** The page a rewrite starts from: its HTML with kept lines, and what each holds. */
function rewritePagePrompt(current) {
  const total = ownText(current) + current.keptChars;
  const legend = [...current.legend].map(([n, what]) => `- [[${current.word} ${n}]]: ${what}`);
  const h1 =
    current.h1Token !== null
      ? `The page's H1 is [[${current.word} ${current.h1Token}]]: keep it first, and write no other H1.\n`
      : '';
  return `The page now, as HTML: about ${total} characters of text, ${current.keptChars} of them in its kept blocks, which count toward Length.
${current.html}
${legend.length ? `\nWhat each kept line holds (kept as it is):\n${legend.join('\n')}\n` : ''}${h1}`;
}

/**
 * Whether the agent is writing another of the organization's drafts now (a
 * 'writing' left by a stopped server doesn't count).
 */
async function organizationWriting(organizationId, draftId, staleBefore) {
  const { data, error } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brands!inner(organization_id)')
    .eq('brands.organization_id', organizationId)
    .eq('agent_state', 'writing')
    .gt('agent_state_at', staleBefore)
    .neq('id', draftId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Starts the agent on a draft: checks it is the brand's and still open to it,
 * that the agent isn't already on it or on another of the organization's
 * drafts, the AI usage budget and the model; marks it 'writing' and runs the
 * model in the background. Throws with `.status` 404 for a draft outside the
 * brand, 409 (code 'not_draft', 'writing', 'open_suggestions', 'running'
 * or 'org_writing'), PlanLimitError
 * once the budget is spent, and the provider's error when the model isn't
 * set up — all before anything runs.
 */
export async function startDraftWriting({ draftId, brandId, input, rewrite = false }) {
  const { data: draft, error: draftError } = await supabaseAdmin
    .from('content_drafts')
    .select(
      'id, brand_id, title, page_type, rules, method, source_url, body_html, status, agent_state, agent_state_at, opportunity_id, brief, action_id, shopping_path',
    )
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }
  if (!OPEN_STATUSES.includes(draft.status)) {
    throw Object.assign(new Error('Only a draft or one in review can be written'), {
      status: 409,
      code: 'not_draft',
    });
  }
  const staleBefore = new Date(Date.now() - WRITING_STALE_MS).toISOString();
  if (
    draft.agent_state === 'writing' &&
    new Date(draft.agent_state_at).getTime() > Date.now() - WRITING_STALE_MS
  ) {
    throw Object.assign(new Error('The agent is already writing it'), {
      status: 409,
      code: 'writing',
    });
  }
  // An existing page's run, and a rewrite, leave a new batch, which would
  // hide the open one (the editor shows the latest), as Fix open rules and
  // the API refuse.
  if ((rewrite || draft.method === 'optimize') && (await hasOpenSuggestions(draftId))) {
    throw Object.assign(new Error('Decide the open suggestions first'), {
      status: 409,
      code: 'open_suggestions',
    });
  }
  // A Fix open rules (or Quality's hand-off) still under way on the draft,
  // maybe from another tab: a run beside it would make a model call of its
  // own, charged, and its batch would land on a page this one changes. One at
  // a time, as Fix open rules refuses beside a Start (contentAgent.js). A
  // live page's Start, which runs as a Fix too, is 'writing' above.
  if (await fixUnderWay(draftId)) {
    throw Object.assign(new Error('The agent is already fixing it'), {
      status: 409,
      code: 'running',
    });
  }
  if (rewrite) {
    // A page to rewrite, small enough to send whole.
    if (!draftPassages(draft.body_html).length) {
      throw Object.assign(new Error('The page has no text to rewrite'), {
        status: 422,
        code: 'empty',
      });
    }
    const page = keepBlocks(draft.body_html, new Set(input.locked.map(passageKey)));
    // Kept blocks aren't rewritten: a page that is only those has nothing to rewrite.
    if (!ownText(page)) {
      throw Object.assign(new Error('The page has no text to rewrite'), {
        status: 422,
        code: 'empty',
      });
    }
    if (ownText(page) > MAX_REWRITE_CHARS) {
      throw Object.assign(new Error('The page is too long to rewrite whole'), {
        status: 422,
        code: 'too_long',
      });
    }
  }

  const { data: brand, error: brandError } = await supabaseAdmin
    .from('brands')
    .select(
      'name, industry, description, organization_id, language, site_type, shopping_mode_enabled',
    )
    .eq('id', brandId)
    .single();
  if (brandError) throw brandError;
  // The brand's rules (00450), read here: the prompts put them first.
  brand.rules = await readBrandRules(brandId);
  const modelId = contentWriteModelId();
  // Held on the budget now, for the run below: starts at once can't pass it.
  const budget = await reserveAiBudget(brand.organization_id, {
    feature: 'content',
    modelId,
    draftId,
  });
  try {
    if (await organizationWriting(brand.organization_id, draftId, staleBefore)) {
      throw Object.assign(new Error('The agent is writing another draft'), {
        status: 409,
        code: 'org_writing',
      });
    }
    // A provider that isn't set up fails here, before anything is claimed.
    const model = resolveModel(modelId);

    // Claimed once: a second start meanwhile finds it writing. The claim's
    // time is the run's own: it ends only a claim it still holds (finish).
    const claimedAt = new Date().toISOString();
    const { data: claimed, error: claimError } = await supabaseAdmin
      .from('content_drafts')
      .update({
        agent_state: 'writing',
        agent_state_at: claimedAt,
        // Which run, for every device: a failed rewrite is tried again as one.
        agent_run: rewrite ? 'rewrite' : 'write',
      })
      .eq('id', draftId)
      .in('status', OPEN_STATUSES)
      .or(`agent_state.is.null,agent_state.eq.failed,agent_state_at.lt."${staleBefore}"`)
      .select('id')
      .maybeSingle();
    if (claimError) throw claimError;
    if (!claimed) {
      throw Object.assign(new Error('The agent is already writing it'), {
        status: 409,
        code: 'writing',
      });
    }

    const held = { ...draft, agent_state: 'writing', agent_state_at: claimedAt };
    if (input.buildBrief && !rewrite && !draft.brief) {
      // Write this: the brief's run first, holding the claim, then the page's.
      briefThenWrite({ draft: held, brand, model, modelId, input, budget }).catch((err) =>
        logger.error({ err, draftId }, '[content-writer] run failed'),
      );
    } else {
      // Written before the answer, so the editor reads its steps, and Stop finds
      // it, at once; with its claim, the one a Stop on it lets go of.
      const run = await startWritingRun(held, input, rewrite);
      runDraftWriting({ draft: held, brand, model, modelId, input, budget, rewrite, run }).catch(
        (err) => logger.error({ err, draftId }, '[content-writer] run failed'),
      );
    }
  } catch (err) {
    // Not started: the hold goes.
    await budget.release();
    throw err;
  }
  return { started: true };
}

/**
 * Write this (customer priorities item 9): the draft's brief built from the
 * sources the page is written from, as the editor's Build brief builds it
 * (its own run, shown step by step, holding the draft's claim so a Stop lets
 * go of it), then the page written from it. A brief that can't be built (no
 * sources, the AI budget, the model) leaves the page written from what there
 * is, as Start writes it; a Stop ends both, and the hold on the budget goes.
 */
async function briefThenWrite({ draft, brand, model, modelId, input, budget }) {
  let brief = null;
  try {
    brief = await rebuildDraftBrief({
      draftId: draft.id,
      brandId: draft.brand_id,
      sources: input.sources,
      // As the editor's rulesForBrief: a rebuild writes the keywords anew from the sources.
      rules: input.rules.filter((rule) => rule.key !== 'keywords'),
      claimedAt: draft.agent_state_at,
    });
  } catch (err) {
    if (err instanceof RunStoppedError) {
      await budget.release();
      // The Stop let go of the claim; this only ends one it couldn't.
      await finish(draft, { agent_state: null }).catch((finishErr) =>
        logger.error({ err: finishErr, draftId: draft.id }, '[content-writer] state not saved'),
      );
      return { stopped: true };
    }
    logger.warn({ err, draftId: draft.id }, '[content-writer] brief not built, writing without it');
  }
  return runDraftWriting({
    draft: brief ? { ...draft, brief } : draft,
    brand,
    model,
    modelId,
    input,
    budget,
  });
}

/**
 * The agent's state as it ends, only while it is still the run's to end: the
 * draft still held by this run's own claim (its agent_state_at), never a
 * newer run's after a Stop let the draft go. With `openOnly`, only while the
 * draft is still open to it (not marked ready meanwhile). Answers whether it
 * ended it.
 */
async function finish(draft, values, { openOnly = false } = {}) {
  let query = supabaseAdmin
    .from('content_drafts')
    .update({ ...values, agent_state_at: new Date().toISOString() })
    .eq('id', draft.id)
    .eq('agent_state', 'writing');
  if (draft.agent_state_at) query = query.eq('agent_state_at', draft.agent_state_at);
  if (openOnly) query = query.in('status', OPEN_STATUSES);
  const { data, error } = await query.select('id').maybeSingle();
  if (error) throw error;
  return !!data;
}

/** A draft marked ready or published during the run keeps its page; the agent lets go of it. */
async function letGo(draft) {
  await finish(draft, { agent_state: null });
  logger.info({ draftId: draft.id }, '[content-writer] the draft was closed during the run');
  return { skipped: true };
}

/**
 * A whole page rewritten to the rules, left as ONE suggestion (kind 'page',
 * 00247) beside the page as it was: the person compares them and accepts or
 * rejects it. What the page keeps word for word goes as [[KEEP n]] lines and
 * is put back as it was (contentRewrite.js); a rewrite that drops one, or
 * leaves no page, fails the run. The draft's status doesn't change.
 */
async function rewritePage({
  attributable,
  language,
  draft,
  shoppingPath,
  brand,
  model,
  modelId,
  input,
  budget,
  numbered,
  known,
  people,
  health,
  brief,
  run,
}) {
  const page = keepBlocks(draft.body_html, new Set(input.locked.map(passageKey)));
  const ruleKeys = new Set(input.rules.map((r) => r.key));
  // The Length rule's target; with Length off, the page keeps its length.
  const length = ruleKeys.has('length') ? input.sources.length : textLength(draft.body_html);
  // Where it may link: the brand's pages and the draft's sources (A).
  // …and its shopping path's shop pages (shopping path, part 4).
  const targets = withShopping(
    await readLinkTargets({
      brandId: draft.brand_id,
      draftId: draft.id,
      sourceUrl: draft.source_url,
      ruleKeys,
    }),
    shoppingPath,
  );
  await advanceRun(run, 2);
  const { object, usage } = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
    generateObject({
      model,
      ...objectOptions(modelId, rewriteSchema, { maxOutputTokens: CONTENT_WRITE_MAX_TOKENS }),
      system: rewriteSystemPrompt(),
      prompt: buildWritePrompt({
        brand,
        draft,
        numbered,
        brief,
        input: { ...input, sources: { ...input.sources, length } },
        linkTargets: linkTargetsPrompt(targets, ruleKeys),
        current: page,
      }),
      abortSignal,
    }),
  );
  await budget.charge(usage);
  if (!isPageHtml(object.html)) throw new Error('The agent answered with no page in HTML');
  // Well past its Length: one more pass that only cuts.
  const answer = ruleKeys.has('length')
    ? await cutToLength({ answer: object, page, length, brand, draft, model, modelId, run })
    : object;
  await advanceRun(run, 3);

  // No invented person or quote (CE-044): read in its words as written,
  // blockquotes too, before what it kept goes back, so the page's own
  // passages are never touched. No health claim the brand didn't make, nor
  // a {{find: …}} for one, before anything is looked up (contentHealth.js).
  const stats = { health: 0 };
  const cleaned = cleanPageHtml(
    // A claim given to a source it wasn't given: a placeholder, not the page dropped.
    placeholderAttributionsInHtml(
      guardPeopleInHtml(healthHtml(answer.html, health, stats), people).html,
      attributable,
    ),
    rewriteLinks(draft.body_html, linkAllowList(targets)),
    { h1Kept: page.h1Token !== null, originalH1: page.h1 },
  );
  // The facts it asked for, and the figures it wrote with no source, looked
  // up on the web and written in with their links, or left for the person
  // (contentResearch.js). Its kept lines are never read, nor its shopping
  // path's products' specs.
  const looked = await lookUpFacts({
    map: (editsFor) => editHtml(cleaned, editsFor),
    known,
    own: pageOwn(draft.body_html),
    products: shoppingGiven(shoppingPath).names,
    orgId: brand.organization_id,
    draftId: draft.id,
    modelId: contentReadModelId(),
    run,
    context: { brand: brand.name, title: draft.title, language: getLanguageName(language) },
  });
  // No number without a source (CE-033): one nobody found is the person's
  // to fill, as a fact only the brand has; a marker left broken goes with
  // its sentence, in code or an attribute on its own (sweeper, sweepHtml).
  const settled = editHtml(
    editHtml(placeholderNumbersInHtml(looked.page, known), settler(looked.own, looked.stats)),
    sweeper(looked.own, looked.stats),
  );
  // …and none the facts pass wrote in.
  const checked = healthHtml(settled, health, stats);
  logger.info(
    { draftId: draft.id, ...looked.stats, health: stats.health },
    '[content-writer] facts settled',
  );
  const linked = linkFacts(sweepHtml(checked, looked.own), looked.links);
  const { html, missing } = restoreKept(linked, page.kept, {
    word: page.word,
    h1Token: page.h1Token,
  });
  if (missing.length) {
    throw new Error(`The rewrite left out ${missing.length} kept block(s)`);
  }
  if (!textLength(html)) throw new Error('The agent left no page to review');
  if (html.length > MAX_PAGE_HTML) throw new Error('The rewritten page is too long to keep');
  // A batch that landed during the run stays the one to decide.
  if (await hasOpenSuggestions(draft.id)) {
    logger.info({ draftId: draft.id }, '[content-writer] open suggestions came in during the run');
    return await letGo(draft);
  }
  // Stopped meanwhile: nothing it wrote is kept.
  await stopIfStopped(run);
  // The data it says it wrote from (CE-033).
  const { sources } = sourceSuggestion({
    named: answer.sources,
    marks: [],
    pieces: [],
    numbered,
    known,
  });
  const batchId = randomUUID();
  const { error: insertError } = await supabaseAdmin.from('content_draft_suggestions').insert({
    draft_id: draft.id,
    batch_id: batchId,
    action_id: draft.action_id ?? null,
    position: 0,
    kind: 'page',
    // The passage it stands at: the page's first.
    block_text:
      clean(draftPassages(draft.body_html)[0]?.text).slice(0, 5000) || clean(draft.title) || 'Page',
    before_text: '',
    before_html: draft.body_html,
    after_text: html,
    reason: clean(stripSourceIds(answer.reason)).slice(0, 300) || 'Rewrote the page to the rules',
    rule_keys: [...ruleKeys],
    // What it was asked for and came to (00285): a Length it missed isn't
    // offered again. With Length off, it was asked for none.
    length_target: ruleKeys.has('length') ? length : null,
    kept_chars: page.keptChars,
    after_chars: textLength(html),
    ...(sources.length ? { sources } : {}),
  });
  if (insertError) throw insertError;
  if (!(await finish(draft, { agent_state: null }, { openOnly: true }))) {
    // Nobody reviews a rewrite of a page already marked ready.
    const { error: dropError } = await supabaseAdmin
      .from('content_draft_suggestions')
      .delete()
      .eq('batch_id', batchId);
    if (dropError) throw dropError;
    return await letGo(draft);
  }
  return { rewritten: true };
}

/**
 * One more pass when a rewrite came past the top of its Length's band
 * (editor test 2026-10-25, where rewrites for 4,000 came to 5,468, 6,843
 * and 7,335 characters): the model cuts its own page to the Length, keeping
 * every heading with its answer, each kept line, the links and the facts.
 * Any way past it, not only well past (editor test 2026-11-03: a rewrite
 * left a little long was taken as the most a rewrite reaches, so the
 * Length set was never met). On its own hold on the budget, so a budget
 * the first pass used up skips it. The cut is taken only when it is
 * shorter and keeps every kept line; else, or when it fails, the first
 * rewrite stands (logged). A stop goes through.
 */
async function cutToLength({ answer, page, length, brand, draft, model, modelId, run }) {
  const total = ownText({ ...page, html: answer.html }) + page.keptChars;
  const max = Math.round(length * (1 + LENGTH_TOLERANCE));
  if (total <= max) return answer;
  const budget = await reserveAiBudget(brand.organization_id, {
    feature: 'content',
    modelId,
    draftId: draft.id,
  }).catch((err) => {
    logger.info(
      { draftId: draft.id, code: err?.code },
      '[content-writer] no budget to cut further',
    );
    return null;
  });
  if (!budget) return answer;
  try {
    const { object, usage } = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
      generateObject({
        model,
        ...objectOptions(modelId, rewriteSchema, { maxOutputTokens: CONTENT_WRITE_MAX_TOKENS }),
        system: rewriteSystemPrompt(),
        prompt: cutPrompt({ html: answer.html, page, total, length, max }),
        abortSignal,
      }),
    );
    await budget.charge(usage);
    const cut = isPageHtml(object.html)
      ? ownText({ ...page, html: object.html }) + page.keptChars
      : Infinity;
    // Each kept line on its own, as restoreKept puts them back: one written
    // into a paragraph would fail the whole run.
    const keepsAll =
      cut < Infinity &&
      restoreKept(object.html, page.kept, { word: page.word, h1Token: page.h1Token }).missing
        .length === 0;
    if (cut >= total || !keepsAll) {
      logger.info(
        { draftId: draft.id, total, cut },
        '[content-writer] the cut pass kept nothing shorter',
      );
      return answer;
    }
    // The first pass's data and reason: the cut had no data to name, only the page.
    return { ...answer, html: object.html };
  } catch (err) {
    if (isStop(err, run)) throw err;
    if (NoObjectGeneratedError.isInstance(err) && err.usage) await budget.charge(err.usage);
    else await budget.release();
    logger.warn(
      { err: { name: err?.name, message: err?.message }, draftId: draft.id },
      '[content-writer] the cut pass failed; the first rewrite stands',
    );
    return answer;
  } finally {
    // A stop before the call went out leaves the hold unused: it goes (a no-op once charged or kept).
    await budget.release();
  }
}

/** What the cut pass is told: its own page, how long it is and the Length to cut it to. */
function cutPrompt({ html, page, total, length, max }) {
  return `Your rewrite below is about ${total} characters of text, ${page.keptChars} of them in kept blocks, which count toward Length. Its Length is ${length} characters, up to ${max}. Cut it to about ${length}.

Cut repetition, filler, long examples and the least useful detail first. Keep the H1 and every heading, a short answer under each heading, every [[${page.word} n]] line exactly as it is and on its own, the links on their words, the facts, each {{find: …}} and {{ask: …}} exactly as it is, and any placeholders in square brackets. Add nothing new. Return the whole page.

${html}

Write in the page's own language.`;
}

/**
 * The run itself: the page written, or the suggestions left, and the draft
 * In review; 'failed' when the model fails or leaves nothing to review. The
 * model's answer is charged to the hold Start took on the budget
 * (reserveAiBudget); a run that ends before one lets the hold go. `modelId`
 * is the `model`'s, for its call settings (structuredOutput.js) and the
 * cut pass's hold.
 */
export async function runDraftWriting({
  draft,
  brand,
  model,
  modelId = contentWriteModelId(),
  input,
  budget,
  rewrite = false,
  run: started = null,
}) {
  // Its steps, named by the data it reads (CE-027/035): Start writes the run
  // before it answers, so Stop finds it at once; Stop aborts the call.
  const run = started ?? (await startWritingRun(draft, input, rewrite));
  try {
    const result = await writeWithRun({
      draft,
      brand,
      model,
      modelId,
      input,
      budget,
      rewrite,
      run,
    });
    await finishRun(
      run,
      'done',
      Number.isInteger(result.suggestions) ? { 2: result.suggestions } : {},
    );
    return result;
  } catch (err) {
    // An answer the provider billed but that missed the schema is charged,
    // as Improve's is: else the costliest call, a whole page, would run free.
    if (NoObjectGeneratedError.isInstance(err) && err.usage) await budget.charge(err.usage);
    if (isStop(err, run)) {
      // Stopped: the page as it was, and the agent lets go of it.
      await finishRun(run, 'stopped');
      await finish(draft, { agent_state: null }).catch((finishErr) =>
        logger.error({ err: finishErr, draftId: draft.id }, '[content-writer] state not saved'),
      );
      return { stopped: true };
    }
    await finishRun(run, 'failed');
    logger.error({ err, draftId: draft.id }, '[content-writer] the agent could not finish');
    await finish(draft, { agent_state: 'failed' }).catch((finishErr) =>
      logger.error({ err: finishErr, draftId: draft.id }, '[content-writer] state not saved'),
    );
    return { failed: true };
  } finally {
    // Nothing charged (it failed before an answer): the hold goes.
    await budget.release();
  }
}

/**
 * A writing run's steps by what it does: a rewrite, a new page, or
 * suggestions on a live one, with the claim it holds on the draft: a Start
 * on a live page runs as 'fix', so its kind alone can't tell a Stop that it
 * holds one.
 */
function startWritingRun(draft, input, rewrite) {
  const { promptIds, fanouts, pages, queries } = input.sources;
  return startRun({
    draftId: draft.id,
    claimedAt: draft.agent_state === 'writing' ? (draft.agent_state_at ?? null) : null,
    kind: rewrite ? 'rewrite' : draft.method === 'create' ? 'write' : 'fix',
    counts: {
      // As the editor counts them, so the step and its rules chip agree (editor test 2026-10-25).
      rules: input.counted ?? input.rules.length,
      sources: promptIds.length + fanouts.length + pages.length + queries.length,
    },
  });
}

/** The run itself, step by step: nothing is kept once it is stopped. */
async function writeWithRun({ draft, brand, model, modelId, input, budget, rewrite, run }) {
  await advanceRun(run, 1);
  const [prompts, inputRow, opportunityRes, shoppingPath] = await Promise.all([
    readPrompts(draft.brand_id, input.sources.promptIds),
    readDraftInputs(draft.id),
    draft.opportunity_id && !draft.brief
      ? supabaseAdmin
          .from('content_opportunities')
          .select('brief')
          .eq('id', draft.opportunity_id)
          .eq('brand_id', draft.brand_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    // Its shopping path, checked: none when it isn't one (shopping path, part 4).
    shoppingPathFor(draft),
  ]);
  if (opportunityRes.error) throw opportunityRes.error;
  // A new page's writer has no links rule: the brief's planned links are left out for it.
  const brief = briefText(draft.brief, opportunityRes.data?.brief, {
    links: rewrite || draft.method !== 'create',
  });
  // What the brief gives the guards: never its addresses (a planned link's
  // "/top-37-tools", "/interview-with-john-smith"), as sourceWords keeps a
  // cited page's out.
  const briefGiven = brief.replace(/https?:\/\/\S+/g, ' ');
  // The shopping path's prices and names (shopping path, part 4): the catalog's, written unmarked.
  const shopping = shoppingGiven(shoppingPath);
  // The data it writes from, numbered (CE-033), Brief › Your input last
  // (CE-048); the numbers a suggestion may write unmarked (the page's, the
  // brand's, the brief's, the rules', today's), and those a page written
  // whole may (the sources' words too).
  const numbered = numberSources({
    prompts,
    fanouts: input.sources.fanouts,
    pages: input.sources.pages,
    queries: input.sources.queries,
    inputs: inputSources(inputRow, brand.name),
  });
  const known = withNamedNumbers(
    knownNumbers(
      htmlText(draft.body_html),
      draft.title,
      brand.name,
      brand.industry,
      brand.description,
      briefGiven,
      shopping.prices,
      ...input.rules.flatMap((r) => [r.name, r.detail]),
      ...input.textRules,
      ...(brand.rules ?? []),
      todayText(),
    ),
    shopping.names,
  );
  const knownInPage = withNamedNumbers(
    new Set([...known, ...knownNumbers(...numbered.map(sourceWords))]),
    shopping.names,
  );
  // The people and quotes it may name: the same words, its data's and the authors' (CE-044).
  const authors = await authorWords(supabaseAdmin, brand.organization_id);
  const people = knownPeople(
    htmlText(draft.body_html),
    draft.title,
    brand.name,
    brand.industry,
    brand.description,
    briefGiven,
    ...shopping.names,
    ...input.rules.flatMap((r) => [r.name, r.detail]),
    ...input.textRules,
    ...(brand.rules ?? []),
    ...numbered.map(sourceWords),
    ...authors,
  );
  // A health brand's guard: the claims it made in its own words (the page,
  // its description, Your input, its products' names and the rules people
  // wrote), never the brief's, a buyer's or a cited page's (contentHealth.js).
  const health = healthGuard(brand, {
    html: draft.body_html,
    texts: [
      draft.title,
      brand.name,
      brand.description,
      ...shopping.names,
      ...input.textRules,
      ...(brand.rules ?? []),
    ],
    numbered,
  });
  // The sources a claim may be given to: the ones the page gives claims to,
  // its Your input and authors (editor test 2026-10-25).
  const language = await draftLanguage(draft, brand);
  const attributable = attributableSources(draft.body_html, numbered, authors, language, [
    brand.name,
  ]);

  if (rewrite) {
    return await rewritePage({
      attributable,
      language,
      draft,
      shoppingPath,
      brand,
      model,
      modelId,
      input,
      budget,
      numbered,
      known: knownInPage,
      people,
      health,
      brief,
      run,
    });
  }

  if (draft.method === 'create') {
    await advanceRun(run, 2);
    const { object, usage } = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
      generateObject({
        model,
        ...objectOptions(modelId, pageSchema, { maxOutputTokens: CONTENT_WRITE_MAX_TOKENS }),
        system: writeSystemPrompt(),
        prompt: buildWritePrompt({
          brand,
          draft,
          numbered,
          brief,
          input,
          linkTargets: shoppingPrompt(shoppingPath),
        }),
        abortSignal,
      }),
    );
    await budget.charge(usage);
    await advanceRun(run, 3);
    // No health claim the brand didn't make, nor a {{find: …}} for one,
    // before anything is looked up (contentHealth.js).
    const stats = { health: 0 };
    const asked = healthPage(object, health, editPage, stats);
    // The facts it asked for, and the figures it wrote with no source,
    // looked up on the web and written in with their links, or left for the
    // person (contentResearch.js); never its shopping path's products' specs.
    const looked = await lookUpFacts({
      map: (editsFor) => editPage(asked, editsFor),
      known: knownInPage,
      own: pageOwn(draft.body_html),
      products: shopping.names,
      orgId: brand.organization_id,
      draftId: draft.id,
      modelId: contentReadModelId(),
      run,
      context: { brand: brand.name, title: draft.title, language: getLanguageName(language) },
    });
    // No number without a source (CE-033): one nobody found is the person's
    // to fill, as a fact only the brand has; a marker left broken goes; and
    // no health claim the facts pass wrote in.
    const written = healthPage(
      editPage(
        editPage(sourcedPage(looked.page, knownInPage, people), settler(looked.own, looked.stats)),
        sweeper(looked.own, looked.stats),
      ),
      health,
      editPage,
      stats,
    );
    logger.info(
      { draftId: draft.id, ...looked.stats, health: stats.health },
      '[content-writer] facts settled',
    );
    // The title column as the H1 reads it: a capital first (headingCase).
    const title = headingCase(clean(written.title).slice(0, 300), language) || draft.title;
    // Stopped meanwhile: the page stays as it was, and History with it.
    await stopIfStopped(run);
    // Try again over a page the person has written in: History keeps it
    // first. Their saves wait while the agent writes (saveContentDraft).
    if (draftPassages(draft.body_html).some((p) => p.tag !== 'h1')) {
      const { error: keepError } = await supabaseAdmin.rpc('content_draft_snapshot', {
        p_draft_id: draft.id,
        p_origin: 'agent_before',
      });
      if (keepError) throw keepError;
    }
    const saved = await finish(
      draft,
      {
        title,
        // The shopping path's names it wrote, linked (shoppingLinks.js), and
        // its products as a grid where the page names them most (shoppingBlocks.js).
        body_html: insertProductGrid(
          linkShoppingPath(
            linkFacts(renderPage({ ...written, title }, { language }), looked.links),
            shoppingPath,
          ).html,
          shoppingPath && { ...shoppingPath, pageType: draft.page_type },
        ),
        status: 'in_review',
        author: 'agent',
        agent_state: null,
      },
      { openOnly: true },
    );
    // Awaited here, so a failure to let go is caught below.
    return saved ? { written: true } : await letGo(draft);
  }

  const { passages, more } = promptPassages(draftPassages(draft.body_html));
  if (!passages.length) throw new Error('The page has no text to improve');
  const lockedKeys = new Set(input.locked.map(passageKey));
  const ruleKeys = new Set(input.rules.map((r) => r.key));
  // Where it may link: the brand's pages and the draft's sources (A).
  // …and its shopping path's shop pages (shopping path, part 4).
  const targets = withShopping(
    await readLinkTargets({
      brandId: draft.brand_id,
      draftId: draft.id,
      sourceUrl: draft.source_url,
      ruleKeys,
    }),
    shoppingPath,
  );
  await advanceRun(run, 2);
  const { object, usage } = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
    generateObject({
      model,
      ...objectOptions(modelId, suggestionsSchema, { maxOutputTokens: CONTENT_WRITE_MAX_TOKENS }),
      system: suggestSystemPrompt(),
      prompt: buildWritePrompt({
        brand,
        draft,
        numbered,
        brief,
        input,
        passages,
        more,
        lockedKeys,
        linkTargets: linkTargetsPrompt(targets, ruleKeys),
      }),
      abortSignal,
    }),
  );
  await budget.charge(usage);
  await advanceRun(run, 3);
  // The facts it asked for, and the figures it wrote with no source, looked
  // up (contentResearch.js); its data's own figures are its sources'. One
  // that asks for a health claim to be looked up goes first: none is
  // searched (contentHealth.js); keepSuggestions reads the claims.
  const looked = await lookUpSuggestionFacts({
    suggestions: withoutHealthFinds(object.suggestions, health),
    known: knownInPage,
    own: pageOwn(draft.body_html),
    products: shopping.names,
    orgId: brand.organization_id,
    draftId: draft.id,
    modelId: contentReadModelId(),
    run,
    context: { brand: brand.name, title: draft.title, language: getLanguageName(language) },
  });
  for (const value of looked.learned) known.add(value);
  const rows = keepSuggestions(
    looked.suggestions,
    passages,
    lockedKeys,
    ruleKeys,
    withFactLinks(linkAllowList(targets), looked.links),
    { numbered, known, people, attributable, banned: bannedWordsOf(input.rules), health },
  );
  // Stopped meanwhile: nothing it wrote is kept.
  await stopIfStopped(run);
  if (!rows.length) throw new Error('The agent left no suggestion it could place');
  // A batch that landed during the run (Fix open rules, the API) stays the
  // one to decide: this one isn't added over it.
  if (await hasOpenSuggestions(draft.id)) {
    logger.info({ draftId: draft.id }, '[content-writer] open suggestions came in during the run');
    return await letGo(draft);
  }
  const batchId = randomUUID();
  const { error: insertError } = await supabaseAdmin.from('content_draft_suggestions').insert(
    rows.map((row, position) => ({
      ...row,
      draft_id: draft.id,
      batch_id: batchId,
      action_id: draft.action_id ?? null,
      position,
    })),
  );
  if (insertError) throw insertError;
  if (!(await finish(draft, { status: 'in_review', agent_state: null }, { openOnly: true }))) {
    // Nobody reviews suggestions on a page already marked ready.
    const { error: dropError } = await supabaseAdmin
      .from('content_draft_suggestions')
      .delete()
      .eq('batch_id', batchId);
    if (dropError) throw dropError;
    return await letGo(draft);
  }
  return { suggestions: rows.length };
}
