import { NoObjectGeneratedError, generateObject } from 'ai';
import { z } from 'zod';
import supabaseAdmin from '../config/supabase.js';
import { resolveModel } from './aiProvider.js';
import {
  PAGE_TYPE_FRESHNESS,
  PAGE_TYPE_SECTION_FORMATS,
  pageTypeFormat,
  siteTypeLine,
} from './contentPageTypes.js';
import { inputSources, readDraftInputs } from './contentInputs.js';
import { NO_LINK_TARGETS, linkKey, readLinkTargets } from './contentLinks.js';
import { logger } from './logger.js';
import { getLanguageName } from './languages.js';
import {
  RunStoppedError,
  advanceRun,
  finishRun,
  isStop,
  runCall,
  startRun,
  stopIfStopped,
} from './contentRuns.js';
import { citedPagesLength } from './contentCitedLength.js';
import { guardPeople, knownPeople, peopleEdits } from './contentPeople.js';
import { sentenceSpans } from './contentResearch.js';
import {
  NUMBER_PLACEHOLDER,
  addedNumbers,
  knownNumbers,
  numberSources,
  placeholderNumbers,
  sourceWords,
  stripSourceIds,
  todayText,
} from './contentSources.js';
import { reserveAiBudget } from './planGuard.js';
import { objectOptions } from './structuredOutput.js';

/**
 * The Content Editor's brief (CE-007, spec §10): Rebuild outline writes a
 * draft's goal, audience and outline from the sources the person kept in the
 * Sources tab (CE-008), each H2 answering one of the searches AI engines ran
 * (a fan-out) on a platform. It is metered from the organization's AI usage,
 * the monthly budget the Improve tab and the task writer draw from — not the
 * content brief quota, which stays with Opportunities' Generate Brief
 * (spec §3).
 */

/**
 * The Improve tab's model, which the Content Editor ran on before it had
 * its own (contentReadModelId, contentWriteModelId), and still runs on
 * without an Anthropic key.
 */
export function contentBriefModelId() {
  return (
    process.env.IMPROVE_SUGGESTION_MODEL ||
    process.env.DEFAULT_SUGGESTION_MODEL ||
    'google/gemini-3-flash-preview'
  );
}

/** The Content Editor's models with ANTHROPIC_API_KEY set: Haiku reads, Sonnet writes. */
export const CONTENT_READ_CLAUDE = 'anthropic/claude-haiku-5-5';
export const CONTENT_WRITE_CLAUDE = 'anthropic/claude-sonnet-5-5';

/**
 * The model the Content Editor reads and judges with: the brief (Rebuild
 * outline) and Quality's reads (contentSourceClass.js). CONTENT_READ_MODEL,
 * else Claude Haiku with an Anthropic key, else `fallback`, the model it ran
 * on before: a server without the key runs as it did.
 */
export function contentReadModelId(fallback = contentBriefModelId) {
  return (
    process.env.CONTENT_READ_MODEL ||
    (process.env.ANTHROPIC_API_KEY ? CONTENT_READ_CLAUDE : fallback())
  );
}

/**
 * The model the Content Agent writes with: whatever goes into the page (a
 * page written or rewritten whole, the cut pass, its suggestions).
 * CONTENT_WRITE_MODEL, else Claude Sonnet with an Anthropic key, else the
 * model it ran on before.
 */
export function contentWriteModelId() {
  return (
    process.env.CONTENT_WRITE_MODEL ||
    (process.env.ANTHROPIC_API_KEY ? CONTENT_WRITE_CLAUDE : contentBriefModelId())
  );
}

/**
 * The most a read's and a write's answer may take, sent to Claude only
 * (structuredOutput.js): its thinking counts toward it. A whole page of
 * BRIEF_LENGTH_MAX characters is about 17k tokens as HTML in JSON.
 */
export const CONTENT_READ_MAX_TOKENS = 16_000;
export const CONTENT_WRITE_MAX_TOKENS = 32_000;

/** How long the model may take: the dashboard waits for it. */
const CALL_TIMEOUT_MS = 60_000;

/** A string cut to `max` characters after trimming: a long one is shortened, not refused. */
const cut = (max) =>
  z
    .string()
    .max(10_000)
    .transform((s) => s.trim().slice(0, max));

/** A list of strings, each cut to `max`; the ones left empty are dropped. */
const cutList = (max, count) =>
  z
    .array(cut(max))
    .max(count)
    .transform((items) => items.filter(Boolean));

/** The length a rebuild asks for, in characters. */
export const BRIEF_LENGTH_MIN = 100;
export const BRIEF_LENGTH_MAX = 50_000;

/**
 * What the Sources tab keeps, as the web sends it. Text is cut to fit, and
 * the length is brought into range, rather than refusing the whole rebuild
 * over one long heading or a Length rule out of range.
 */
export const rebuildSources = z.object({
  promptIds: z.array(z.guid()).max(100),
  fanouts: z
    .array(z.object({ query: cut(300), platforms: cutList(60, 12) }))
    .max(40)
    .transform((items) => items.filter((f) => f.query)),
  pages: z.array(z.object({ url: cut(2048), kind: cut(30) })).max(30),
  queries: cutList(300, 20),
  /** The page's headings as written now, for a draft optimizing a page. */
  headings: cutList(300, 30),
  /** The length the page type's rules ask for, in characters. */
  length: z
    .number()
    .int()
    .transform((n) => Math.min(BRIEF_LENGTH_MAX, Math.max(BRIEF_LENGTH_MIN, n))),
});

/**
 * The rules in effect, as Fix sends them to the agent (contentWriter.js
 * writeDraftInput), beside the sources: with the brief rules (2026) on, the
 * brief plans to them. Cut to fit, as the sources are.
 */
export const briefRules = z
  .array(z.object({ key: cut(60), name: cut(200), detail: cut(500).default('') }))
  .max(60);

/**
 * The limits the web reads a brief with (frontend/src/lib/content/brief.ts
 * draftBriefSchema): the model's output is cut to them, so a brief saved and
 * charged for is one the editor can show.
 */
export const BRIEF_LIMITS = {
  goal: 500,
  audience: 500,
  sections: 12,
  heading: 300,
  keyPoints: 8,
  keyPoint: 500,
  keywords: 15,
  keyword: 80,
};

/**
 * The brief rules (2026) on (CONTENT_BRIEF_RULES=true): the brief plans each
 * section's answer, format and facts, as version 2 (web brief.ts). Off until
 * the brief eval (contentBriefEval.js) passes them: then the brief is
 * version 1, as before.
 */
export function briefRulesOn() {
  return process.env.CONTENT_BRIEF_RULES === 'true';
}

/**
 * Version 2's limits, as the web reads them (frontend/src/lib/content/brief.ts
 * BRIEF_V2_LIMITS, which contentBrief.test.js reads to compare).
 */
export const BRIEF_V2_LIMITS = {
  answer: 600,
  facts: 4,
  claim: 300,
  url: 2048,
  tldr: 500,
  angle: 500,
  proof: 6,
  proofWhat: 300,
  leftOut: 20,
  leftOutQuery: 300,
  datedPoint: 300,
  entity: 120,
  entities: 10,
  internalLinks: 8,
  outboundLinks: 5,
  anchor: 120,
  linkSection: 300,
};
/**
 * The pages a brief may plan links to, as many as its prompt lists: the
 * brand's own (the most cited and visited first) and the sources kept.
 */
export const BRIEF_LINK_PAGES = { own: 12, sources: 8 };
/** The competitors a brief's prompt lists, and how long a page's title is there. */
const COMPETITORS_LISTED = 20;
const TITLE_CHARS = 150;
/** The link rules readLinkTargets reads both lists for. */
const LINK_RULES = new Set(['internalLinks', 'outboundLinks']);
/**
 * How a section is best shown; the kind of source a fact needs; the brand's
 * own proof to gather, as Brief › Your input takes it (web brief.ts).
 */
export const BRIEF_FORMATS = ['paragraphs', 'list', 'steps', 'table', 'faq'];
export const FACT_SOURCES = ['statistic', 'study', 'quote', 'example', 'official'];
export const PROOF_KINDS = ['experience', 'data', 'case', 'test', 'quote'];

// No counts or lengths enforced on the model: a miss would fail the whole
// call (charged all the same). They are asked for here and cut afterwards.
export const outlineSchema = z.object({
  goal: z.string().describe('What the page must achieve for the brand, in one sentence.'),
  audience: z.string().describe('Who the page is for, in one sentence.'),
  outline: z
    .array(
      z.object({
        heading: z.string().describe('The H2, worded as the answer a reader looks for.'),
        keyPoints: z.array(z.string()).describe('What the section must cover: up to 5 points.'),
        fanout: z
          .string()
          .nullable()
          .describe('The AI search this H2 answers, copied exactly from the list, or null.'),
        platform: z
          .string()
          .nullable()
          .describe('The platform key that ran that search, from its list, or null.'),
      }),
    )
    .describe('3 to 10 sections.'),
  keywords: z.array(z.string()).describe('Up to 10 keywords.'),
});

/** A link a brief plans: a page listed, the words to link, the H2 it goes in. */
const LINK_ITEM = z.object({
  url: z.string().describe('The address, copied exactly from the list.'),
  anchor: z.string().describe('The words to link: a few words the section says.'),
  section: z.string().nullable().describe('The H2 it goes in, as written, or null for anywhere.'),
});

/**
 * Version 2's: each section with its answer, format and facts; the page's
 * essentials, angle, proof to gather, fan-outs left out and point to date.
 */
export const outlineSchemaV2 = outlineSchema.extend({
  tldr: z
    .string()
    .nullable()
    .describe("What the page's essentials at its top must state: a note to the writer."),
  angle: z
    .string()
    .nullable()
    .describe("What this page can show that commodity pages can't: a note to the writer."),
  proof: z
    .array(
      z.object({
        kind: z.string().meta({ enum: PROOF_KINDS }).describe('Its kind.'),
        what: z.string().describe('What to gather, as a note: never a figure.'),
      }),
    )
    .describe("Up to 4 pieces of the brand's own proof to gather."),
  leftOut: z
    .array(z.string())
    .describe('Fan-outs from the list that belong on another page, copied exactly.'),
  datedPoint: z
    .string()
    .nullable()
    .describe('What the page should date, as a note, or null when nothing in it dates.'),
  products: z
    .array(z.string())
    .describe("The brand's products the page names, written exactly as the data writes them."),
  competitors: z
    .array(z.string())
    .describe('The competitors listed that the page names, written as listed.'),
  links: z.object({
    internal: z.array(LINK_ITEM).describe("Up to 5 of the brand's pages listed to link to."),
    outbound: z.array(LINK_ITEM).describe('Up to 3 of the sources listed to link to.'),
  }),
  outline: z
    .array(
      outlineSchema.shape.outline.element.extend({
        answer: z
          .string()
          .nullable()
          .describe(
            "What the section's first sentences must answer directly, in one line: a note to the writer, not the answer.",
          ),
        // Keys from the list, in the JSON schema the model is held to: a
        // brief in Turkish or German would translate a free word ("tablo").
        // Read as any text, so a model that writes "Table" doesn't fail the
        // whole call (charged all the same): sectionPlan reads the key.
        format: z
          .string()
          .meta({ enum: BRIEF_FORMATS })
          .nullable()
          .describe('How the section is best shown.'),
        facts: z
          .array(
            z.object({
              claim: z
                .string()
                .describe('A fact the section should state, as what to find out: never a figure.'),
              sourceType: z
                .string()
                .meta({ enum: FACT_SOURCES })
                .describe('The kind of source it needs.'),
              source: z
                .string()
                .nullable()
                .describe(
                  'The number (S1…) of the cited page to check it against, or null to find one.',
                ),
            }),
          )
          .describe('Up to 2 facts.'),
      }),
    )
    .describe('3 to 10 sections.'),
});

export const SYSTEM_PROMPT = `You are a senior content strategist for Answer Engine Optimization (AEO). You plan one web page so AI assistants (ChatGPT, Perplexity, Gemini, Copilot, Google's AI Overviews) cite it.

Rules:
- Plan an outline of H2 sections. Each H2 should answer one of the AI searches (fan-outs) listed, the most searched first, and name it exactly in "fanout" with one of its platform keys in "platform". An H2 that answers none has null for both.
- Cover the prompts listed: they are the questions the page must answer.
- Use only the facts given. Never invent numbers, prices, dates, names or claims; a key point that needs a fact says what to find out.
- When the page exists, keep its useful headings and improve them rather than starting over.
- Cited pages show what AI quotes today; plan to answer better than them, never to copy them.
- Write every field in the language asked for.`;

/** Version 2's rules (the brief rules, 2026), after version 1's. */
export const SYSTEM_PROMPT_V2 = `${SYSTEM_PROMPT}
- Answer first: in "answer", say what each section's first sentences must answer directly, as a note to the writer, with no word count: the rules give the length.
- In "facts", name about one fact per section the page should state, with the kind of source it needs. In "source", give the number (S1…) of the person's input that gives it, or of a cited page only when it is the one to check that fact against (you see only its address, never its words); when unsure, null. Never write a figure of your own.
- The numbers (S1…) go in "source" only, never in another field.
- In "format", say how each section is best shown: a table for a comparison, numbered steps for a how-to, a list for picks or criteria, paragraphs for an explanation, faq for questions (its key points are the questions).
- Top first: in "tldr", say what the page's essentials at its top must state, as a note to the writer.
- In "angle", say what this page can show that commodity pages can't: the brand's own data, cases, tests or first-hand experience. In "proof", list up to 4 of them to gather, each with its kind; one the person's input already gives, by its name.
- One topic: in "leftOut", copy exactly the fan-outs listed that belong on another page; none when they all fit.
- In "datedPoint", say what the page should date (a price, a figure with its month), or null when nothing in it dates.
- The person's input, when listed, is their own: plan with it as given. Never invent a customer, a test, a quote or a figure beyond it.
- Names as written: in "products", the brand's products the page names, written exactly as the data writes them; in "competitors", the competitors listed that it names, as listed. Never another spelling.
- In "links", pick up to 5 of the brand's pages and up to 3 of the sources listed to link to, each by its address copied exactly, with the words to link and the H2 it goes in. None when none is listed.
- "format", "sourceType" and a proof's "kind" are keys: write them as listed, in English, whatever the brief's language.
- Headings: each H2 about 8 to 15 words, under 90 characters.
- No keyword stuffing, and no wording made to trigger a citation: write for the reader.
- Follow the rules the page is written to, when listed.`;

/** The brief's rules and schema: version 2's with the brief rules on, else version 1's. */
export function briefSystemPrompt() {
  return briefRulesOn() ? SYSTEM_PROMPT_V2 : SYSTEM_PROMPT;
}
export function briefSchema() {
  return briefRulesOn() ? outlineSchemaV2 : outlineSchema;
}

/**
 * The brief rules' guardrail (Bing's February 2026 guidelines), for the
 * Content Agent's prompts that write a page's words (contentWriter.js:
 * write, suggest, rewrite), with the brief rules on.
 */
export const WRITING_GUARDRAIL =
  '- No keyword stuffing, and no wording made to trigger a citation: write for the reader.';

/**
 * How the writer can show a section: no page it writes has a table yet, so a
 * table is a comparison set out point by point.
 */
const FORMAT_FOR_WRITER = {
  paragraphs: 'paragraphs',
  list: 'a bulleted list',
  steps: 'numbered steps, in order',
  table: 'a comparison, the same points for each option in turn',
  faq: 'questions, each answered directly',
};

/**
 * A version 2 brief's plan as the Content Agent reads it (brief rules, 2026),
 * after the brief's goal, outline and keywords: the essentials at the top,
 * the angle, each section's answer, format and facts (one from Your input
 * by its name; any other looked up, contentResearch.js, a cited page
 * named when the brief has one, as the writer doesn't see its words), the
 * proof to gather (from Your input only, else asked of the person), the
 * searches left to another page, freshness, the names as
 * written and, unless `links` is false (a new page's writer has no links
 * rule), the links planned: never an allow list, the links rule decides.
 * '' with the brief rules off, or for an older brief.
 */
export function briefForWriter(brief, { links: withLinks = true } = {}) {
  if (!briefRulesOn() || brief?.version !== 2) return '';
  const lines = [];
  if (brief.tldr) lines.push(`TL;DR (what the page's top must say): ${brief.tldr}`);
  if (brief.angle) lines.push(`Angle (what only this page shows): ${brief.angle}`);
  const plans = (brief.outline ?? [])
    .map((section) => {
      const parts = [];
      if (section.answer) parts.push(`answer first: ${section.answer}`);
      if (FORMAT_FOR_WRITER[section.format])
        parts.push(`show as ${FORMAT_FOR_WRITER[section.format]}`);
      for (const fact of section.facts ?? []) {
        const source =
          fact.source?.kind === 'input'
            ? `from Your input "${fact.source.label}"`
            : fact.source
              ? `look it up with {{find: …}}: ${fact.source.label} may have it, but you don't see its words`
              : 'look it up with {{find: …}}';
        parts.push(`give a fact on: ${fact.claim} (${fact.sourceType}, ${source})`);
      }
      return parts.length ? `${section.heading} — ${parts.join('; ')}` : null;
    })
    .filter(Boolean);
  if (plans.length) lines.push(`Section plans:\n${plans.map((plan) => `- ${plan}`).join('\n')}`);
  if (brief.proof?.length) {
    lines.push(
      `Proof to gather (write it only from Your input; else {{ask: …}}): ${brief.proof.map((p) => `${p.kind}: ${p.what}`).join('; ')}`,
    );
  }
  if (brief.leftOut?.length) {
    lines.push(
      `Keep to one topic; these searches are for another page: ${brief.leftOut.join('; ')}`,
    );
  }
  const fresh = brief.freshness;
  const dates = [
    fresh?.datedPoint && `date ${fresh.datedPoint}`,
    fresh?.updatedLine && 'show an "Updated" date line',
    fresh?.yearInTitle && 'the year in the title, when you write it',
  ].filter(Boolean);
  if (dates.length) lines.push(`Freshness: ${dates.join('; ')}`);
  const names = [
    brief.entities?.brand,
    ...(brief.entities?.products ?? []),
    ...(brief.entities?.competitors ?? []),
  ].filter(Boolean);
  if (names.length) lines.push(`Names, written exactly so: ${names.join(', ')}`);
  const links = withLinks
    ? [...(brief.links?.internal ?? []), ...(brief.links?.outbound ?? [])]
    : [];
  if (links.length) {
    lines.push(
      `Links planned (only as the links rule allows): ${links.map((l) => `"${l.anchor}" → ${l.url}${l.section ? ` in "${l.section}"` : ''}`).join('; ')}`,
    );
  }
  return lines.join('\n');
}

const norm = (text) => text.trim().replace(/\s+/g, ' ').toLowerCase();
/** A fan-out as matched: without the quotes the prompt lists it in, as the model may copy them. */
const fanoutKey = (text) => norm(text.trim().replace(/^["“„«]\s*|\s*["”“»]$/g, ''));

/**
 * Text cut to `max` characters, never inside a placeholder: one the cut would
 * split ("[figure, so") goes whole.
 */
const clip = (text, max) => {
  const cut = text.trim().slice(0, max);
  const open = cut.lastIndexOf('[');
  return open > cut.lastIndexOf(']') ? cut.slice(0, open).trimEnd() : cut;
};

/** A question in quotes ("Which machine should I buy?"): one to answer, not a person's words. */
const QUOTED_QUESTION = /["“„«»]([^"“”„«»\n]{1,300}\?)["”“»«]/gu;

/**
 * Builds the brief: reads the draft and its brand, keeps the prompts that are
 * the brand's, charges the AI usage budget, asks the model, and saves the
 * brief on the draft. Throws with `.status` 404 for a draft outside the
 * brand, 422 with no sources to build from, PlanLimitError once the budget
 * is spent. `claimedAt` is the claim Write this holds on the draft while it
 * builds the brief before the page (contentWriter.js): a Stop lets go of it.
 */
export async function rebuildDraftBrief({
  draftId,
  brandId,
  sources,
  rules = [],
  claimedAt = null,
}) {
  const { data: draft, error: draftError } = await supabaseAdmin
    .from('content_drafts')
    .select('id, brand_id, title, page_type, method, source_url')
    .eq('id', draftId)
    .maybeSingle();
  if (draftError) throw draftError;
  if (!draft || draft.brand_id !== brandId) {
    throw Object.assign(new Error('Draft not found'), { status: 404 });
  }

  const [brandRes, promptsRes, inputRow, competitorsRes, linkTargets] = await Promise.all([
    supabaseAdmin
      .from('brands')
      .select(
        'name, industry, description, organization_id, language, site_type, shopping_mode_enabled',
      )
      .eq('id', brandId)
      .single(),
    sources.promptIds.length
      ? supabaseAdmin
          .from('prompts')
          .select('id, text, prompt_sets!inner(brand_id)')
          .in('id', sources.promptIds)
          .eq('prompt_sets.brand_id', brandId)
      : Promise.resolve({ data: [], error: null }),
    // Brief › Your input (CE-048, Quality's second phase), with the brief rules on.
    briefRulesOn() ? readDraftInputs(draftId) : Promise.resolve(null),
    // The competitors' names as written, and the pages it may link to (a failed read: none).
    briefRulesOn()
      ? supabaseAdmin.from('competitors').select('name').eq('brand_id', brandId)
      : Promise.resolve({ data: [], error: null }),
    briefRulesOn()
      ? readLinkTargets({ brandId, draftId, sourceUrl: draft.source_url, ruleKeys: LINK_RULES })
      : Promise.resolve(NO_LINK_TARGETS),
  ]);
  if (brandRes.error) throw brandRes.error;
  if (promptsRes.error) throw promptsRes.error;
  // A failed read of the competitors leaves none, as a failed read of the link targets does.
  if (competitorsRes.error) {
    logger.warn({ err: competitorsRes.error, draftId }, '[content-brief] competitors not read');
  }
  const competitors = [
    ...new Set(
      (competitorsRes.error ? [] : (competitorsRes.data ?? []))
        .map((c) => String(c.name ?? '').trim())
        .filter(Boolean),
    ),
  ].slice(0, COMPETITORS_LISTED);
  // An address the web keeps (BRIEF_V2_LIMITS.url), and a title the prompt can hold.
  const linkable = (pages, max) =>
    pages
      .filter((page) => page.url.length <= BRIEF_V2_LIMITS.url)
      .slice(0, max)
      .map((page) => ({ ...page, title: String(page.title ?? '').slice(0, TITLE_CHARS) }));
  const targets = {
    own: linkable(linkTargets.own, BRIEF_LINK_PAGES.own),
    sources: linkable(linkTargets.sources, BRIEF_LINK_PAGES.sources),
  };
  const brand = brandRes.data;
  const prompts = (promptsRes.data ?? []).map((p) => p.text);
  // The rules only with the brief rules on: the brief plans to them then, and may say their numbers.
  const planTo = briefRulesOn() ? rules : [];
  const inputs = inputSources(inputRow, brand.name);

  if (!prompts.length && !sources.fanouts.length && !sources.queries.length) {
    throw Object.assign(new Error('No prompts, fan-outs or queries to build from'), {
      status: 422,
      code: 'no_sources',
    });
  }

  // Its steps, named by the data it reads (CE-027/035); Stop aborts the call.
  const run = await startRun({
    draftId,
    kind: 'brief',
    claimedAt,
    counts: {
      sources:
        prompts.length + sources.fanouts.length + sources.pages.length + sources.queries.length,
    },
  });
  try {
    const brief = await briefWithRun({
      draft,
      draftId,
      brand,
      prompts,
      sources,
      rules: planTo,
      inputs,
      competitors,
      targets,
      run,
    });
    await finishRun(run, 'done');
    return brief;
  } catch (err) {
    if (isStop(err, run)) {
      await finishRun(run, 'stopped');
      throw new RunStoppedError();
    }
    await finishRun(run, 'failed');
    throw err;
  }
}

/**
 * The cited pages' read as the brief keeps it: their length (CE-030), and
 * what Site Audit's checks find on them (learning C2), when read.
 */
function citedOf(cited) {
  if (!cited) return { citedLength: null };
  return {
    citedLength: { characters: cited.characters, pages: cited.pages },
    ...(cited.features ? { citedFeatures: cited.features } : {}),
  };
}

/** The rebuild itself, step by step: nothing is saved once it is stopped. */
async function briefWithRun({
  draft,
  draftId,
  brand,
  prompts,
  sources,
  rules,
  inputs,
  competitors,
  targets,
  run,
}) {
  const modelId = contentReadModelId();
  // Held on the budget before the call, so calls at once can't pass it.
  const budget = await reserveAiBudget(brand.organization_id, {
    feature: 'content',
    modelId,
    draftId,
  });
  // The cited pages' length, read beside the model call (CE-030); never fails it.
  const citedLength = citedPagesLength({
    brandId: draft.brand_id,
    pages: sources.pages,
    ownUrl: draft.source_url,
    signal: run.signal,
  });

  let generated;
  try {
    await advanceRun(run, 1);
    generated = await runCall(run, budget, CALL_TIMEOUT_MS, (abortSignal) =>
      generateObject({
        model: resolveModel(modelId),
        ...objectOptions(modelId, briefSchema(), { maxOutputTokens: CONTENT_READ_MAX_TOKENS }),
        system: briefSystemPrompt(),
        prompt: buildBriefPrompt({
          brand,
          draft,
          prompts,
          sources,
          rules,
          inputs,
          competitors,
          targets,
        }),
        abortSignal,
      }),
    );
    await budget.charge(generated.usage);
  } catch (err) {
    // An answer that didn't fit the schema was still paid for: charged as
    // Improve charges it, so retries don't run free.
    if (NoObjectGeneratedError.isInstance(err) && err.usage) await budget.charge(err.usage);
    throw err;
  } finally {
    // Nothing charged (a timeout, a refusal): the hold goes.
    await budget.release();
  }
  const { object } = generated;
  // Each H2 matched to the fan-out it answers (mapOutline).
  await advanceRun(run, 2);

  const brief = {
    ...shapeBrief(object, { brand, draft, prompts, sources, rules, inputs, competitors, targets }),
    origin: 'rebuild',
    builtAt: new Date().toISOString(),
    builtFrom: {
      prompts: prompts.length,
      fanouts: sources.fanouts.length,
      pages: sources.pages.length,
      queries: sources.queries.length,
    },
    ...citedOf(await citedLength),
  };
  // Stopped meanwhile: the brief stays as it was.
  await stopIfStopped(run);
  const { error: saveError } = await supabaseAdmin
    .from('content_drafts')
    .update({ brief })
    .eq('id', draftId);
  if (saveError) throw saveError;
  return brief;
}

/**
 * The brief as saved, from the model's answer: what it adds beyond what it
 * was built from as a placeholder (briefGuard), before the cut; each H2
 * matched to the fan-out it answers (mapOutline); the keywords kept once.
 * The brief eval (contentBriefEval.js) reads the model's answers through
 * it too.
 */
export function shapeBrief(object, args) {
  return fitBrief(shapeWhole(object, args));
}

/**
 * Under content_drafts.brief's 64 KB (00212), with room for jsonb's spaces:
 * past it, the links go, then the fan-outs left out, then the facts' sources
 * (a whole address, 2 KB at most), then the facts, so a brief charged for is
 * one that saves.
 */
const BRIEF_BYTES = 60_000;
const withFacts = (brief, strip) => ({
  ...brief,
  outline: brief.outline.map((section) => ({ ...section, facts: strip(section.facts ?? []) })),
});
const FIT_STEPS = [
  (brief) => ({ ...brief, links: null }),
  (brief) => ({ ...brief, leftOut: [] }),
  (brief) => withFacts(brief, (list) => list.map((f) => ({ ...f, source: null }))),
  (brief) => withFacts(brief, () => []),
];
function fitBrief(brief) {
  const size = (b) => Buffer.byteLength(JSON.stringify(b));
  if (brief.version !== 2) return brief;
  let fitted = brief;
  for (const step of FIT_STEPS) {
    if (size(fitted) <= BRIEF_BYTES) break;
    fitted = step(fitted);
  }
  return fitted;
}

function shapeWhole(
  object,
  {
    brand,
    draft,
    prompts,
    sources,
    rules,
    inputs = [],
    competitors = [],
    targets = NO_LINK_TARGETS,
  },
) {
  const guard = briefGuard({ brand, draft, prompts, sources, rules, inputs, competitors });
  // Version 2's (a model answer with them): each section's plan, the page's.
  const v2 =
    'tldr' in object ||
    'proof' in object ||
    object.outline.some((section) => 'answer' in section || 'facts' in section);
  const byId = v2 ? new Map(briefNumbered(sources, inputs).map((n) => [n.id, n])) : null;
  // Version 2's numbers (S1…) belong in a fact's source only: taken out of the words.
  const words = v2 ? (text) => stripSourceIds(text, byId.size) : (text) => text;
  const outline = mapOutline(
    object.outline.map((section) => ({
      ...section,
      heading: guard.heading(words(section.heading)),
      keyPoints: (section.keyPoints ?? []).map((point) => guard.text(words(point))),
      ...(v2 ? sectionPlan(section, guard, byId, words) : {}),
    })),
    sources.fanouts,
  );
  return {
    goal: clip(guard.text(words(object.goal)), BRIEF_LIMITS.goal),
    audience: clip(guard.text(words(object.audience)), BRIEF_LIMITS.audience),
    outline,
    keywords: [
      ...new Set(
        object.keywords
          .map((keyword) => words(keyword))
          .filter(guard.keeps)
          .map((k) => k.trim().slice(0, BRIEF_LIMITS.keyword))
          .filter(Boolean),
      ),
    ].slice(0, BRIEF_LIMITS.keywords),
    ...(v2
      ? {
          version: 2,
          ...pagePlan(object, { guard, words, outline, sources, draft }),
          ...namesAndLinks(object, {
            guard,
            words,
            outline,
            brand,
            competitors,
            targets,
            // The brand's own words: a product is one it writes (never a
            // prompt's, a search's or a rule's name: "ChatGPT", "FAQ").
            own: [
              brand?.name,
              brand?.industry,
              brand?.description,
              draft.title,
              ...sources.headings,
              ...inputs.map(sourceWords),
              ...targets.own.map((page) => page.title),
            ],
          }),
        }
      : {}),
  };
}

/**
 * The page's plan of version 2, cut to the web's limits and guarded as the
 * rest: its essentials (tldr) and angle; the brand's own proof to gather, of
 * a kind the web knows; the fan-outs left out for another page, each one the
 * person kept that no H2 answers, as listed; its freshness, the point to
 * date as the model names it, the "Updated" line and the year in the title
 * by page type (PAGE_TYPE_FRESHNESS).
 */
function pagePlan(object, { guard, words, outline, sources, draft }) {
  const L = BRIEF_V2_LIMITS;
  const note = (text, max) => clip(guard.text(words(text ?? '')), max) || null;
  const proof = (object.proof ?? [])
    .map((p) => {
      const kind = keyOf(p?.kind);
      const what = clip(guard.text(words(p?.what ?? '')), L.proofWhat);
      return PROOF_KINDS.includes(kind) && what ? { kind, what } : null;
    })
    .filter(Boolean)
    .slice(0, L.proof);
  const kept = fanoutMatcher(sources.fanouts);
  const answered = new Set(outline.map((section) => section.fanout).filter(Boolean));
  const leftOut = [
    ...new Set(
      (object.leftOut ?? [])
        .map((query) => kept(String(query ?? ''))?.query)
        .filter((query) => query && !answered.has(query)),
    ),
  ]
    .map((query) => query.slice(0, L.leftOutQuery))
    .slice(0, L.leftOut);
  const dates = Object.hasOwn(PAGE_TYPE_FRESHNESS, draft.page_type ?? '')
    ? PAGE_TYPE_FRESHNESS[draft.page_type]
    : null;
  const datedPoint = note(object.datedPoint, L.datedPoint);
  return {
    tldr: note(object.tldr, L.tldr),
    angle: note(object.angle, L.angle),
    proof,
    leftOut,
    freshness:
      datedPoint || dates
        ? {
            datedPoint,
            updatedLine: dates?.updatedLine ?? false,
            yearInTitle: dates?.yearInTitle ?? false,
          }
        : null,
  };
}

/** Text as a name is compared: one form of each character, in small letters. */
const nameKey = (text) =>
  String(text ?? '')
    .normalize('NFKC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();

/**
 * The names and links of version 2, the brief rules' entities and links:
 * - the brand's name as kept;
 * - competitors the model names, each one listed, as listed;
 * - products the model names, each where the brand's own words write it
 *   (`own`: its name, description, the page's title and headings, Your
 *   input, its pages' titles), as written there (never the brand's or a
 *   competitor's name), so none is made up or respelled;
 * - links to the pages listed only (`targets`, by their address as links
 *   compare it), each with its words guarded and cut (one whose words came
 *   back with a placeholder goes), and the H2 it goes in when the outline
 *   has it (else anywhere).
 */
function namesAndLinks(object, { guard, words, outline, brand, competitors, targets, own }) {
  const L = BRIEF_V2_LIMITS;
  const listed = new Map(competitors.map((name) => [nameKey(name), name]));
  const competitorsNamed = [
    ...new Set((object.competitors ?? []).map((name) => listed.get(nameKey(name))).filter(Boolean)),
  ]
    .map((name) => name.slice(0, L.entity))
    .slice(0, L.entities);
  // Straight and curly apostrophes alike: a match's place is the same in both.
  const straight = (text) => text.replace(/[‘’]/g, "'");
  const data = own.filter(Boolean).join('\n');
  const plain = straight(data);
  const taken = new Set([nameKey(brand?.name), ...listed.keys()]);
  const products = [];
  for (const name of object.products ?? []) {
    const wanted = String(name ?? '').trim();
    if (!wanted || wanted.length > L.entity || taken.has(nameKey(wanted))) continue;
    const escaped = straight(wanted).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = plain.match(new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'iu'));
    const asWritten = at ? data.slice(at.index, at.index + at[0].length) : null;
    if (!asWritten || taken.has(nameKey(asWritten))) continue;
    taken.add(nameKey(asWritten));
    products.push(asWritten);
    if (products.length >= L.entities) break;
  }
  const headings = new Map(outline.map((section) => [nameKey(section.heading), section.heading]));
  const linksTo = (items, pages, max) => {
    const allowed = new Map(pages.map((page) => [linkKey(page.url), page.url]));
    const seen = new Set();
    const kept = [];
    for (const item of items ?? []) {
      const key = linkKey(item?.url);
      const url = key && allowed.get(key);
      const anchor = clip(guard.text(words(item?.anchor ?? '')), L.anchor);
      // Words that came back with a placeholder aren't ones to link.
      if (!url || !anchor || /\[[^\]]*\]/.test(anchor) || seen.has(key)) continue;
      seen.add(key);
      const section = headings.get(nameKey(item?.section)) ?? null;
      kept.push({ url, anchor, section: section ? section.slice(0, L.linkSection) : null });
      if (kept.length >= max) break;
    }
    return kept;
  };
  const internal = linksTo(object.links?.internal, targets.own, L.internalLinks);
  const outbound = linksTo(object.links?.outbound, targets.sources, L.outboundLinks);
  return {
    entities: {
      brand: String(brand?.name ?? '')
        .trim()
        .slice(0, L.entity),
      products,
      competitors: competitorsNamed,
    },
    links: internal.length || outbound.length ? { internal, outbound } : null,
  };
}

/** A key the model was asked for, as the web lists it: trimmed, in small letters. */
const keyOf = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

/**
 * A section's plan of version 2, cut to the web's limits (BRIEF_V2_LIMITS)
 * and guarded as the rest: its answer, its format if one the web knows, its
 * facts (a kind of source the web knows; the cited page to check it against
 * by kind and ref, as a suggestion keeps its source, never its number in
 * this run: S1 is another page once the Sources tab changes).
 */
function sectionPlan(section, guard, byId, words) {
  const answer = clip(guard.text(words(section.answer ?? '')), BRIEF_V2_LIMITS.answer);
  const format = BRIEF_FORMATS.includes(keyOf(section.format)) ? keyOf(section.format) : null;
  const facts = (section.facts ?? [])
    .map((fact) => {
      const claim = clip(guard.text(words(fact?.claim ?? '')), BRIEF_V2_LIMITS.claim);
      const sourceType = keyOf(fact?.sourceType);
      if (!claim || !FACT_SOURCES.includes(sourceType)) return null;
      const given = byId.get(
        String(fact?.source ?? '')
          .trim()
          .toUpperCase(),
      );
      const label = given ? given.label.trim().slice(0, BRIEF_V2_LIMITS.claim) : '';
      return {
        claim,
        sourceType,
        source: label
          ? { kind: given.kind, ref: given.ref.slice(0, BRIEF_V2_LIMITS.url), label }
          : null,
      };
    })
    .filter(Boolean)
    .slice(0, BRIEF_V2_LIMITS.facts);
  return { answer: answer || null, format, facts };
}

/**
 * The cited pages, then Brief › Your input, numbered as the writer numbers
 * its data (S1…, numberSources): version 2's facts name their source by it.
 * Only those: a prompt, a fan-out or a query is a question, not a source.
 */
export function briefNumbered(sources, inputs = []) {
  return numberSources({ pages: sources.pages, inputs });
}

/**
 * A brief's words with no figure left for anyone to find (2026-10-30): the
 * number guard's placeholder goes, in a heading on its own ("The best
 * machines under $500"), else with its sentence. A fact the page needs is
 * named in words ("how far forecasts drift, from a study"), and the
 * Content Agent looks it up as it writes (contentResearch.js).
 */
export function withoutFigures(text, heading = false) {
  const s = String(text ?? '');
  if (!s.includes(NUMBER_PLACEHOLDER)) return s;
  if (heading) {
    return s
      .split(NUMBER_PLACEHOLDER)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s+([,.;:!?])/g, '$1')
      .trim();
  }
  return sentenceSpans(s)
    .map(({ start, end }) => s.slice(start, end))
    .filter((sentence) => !sentence.includes(NUMBER_PLACEHOLDER))
    .join(' ');
}

/**
 * What a brief may say without a placeholder: the numbers (CE-033), names
 * and quotes (CE-044) of what it was built from — the brand, the page, the
 * prompts, searches, queries and headings kept, the length asked for — and
 * today's year. The writer reads a brief as something it was given, so a
 * figure or a person made up in one would pass the writer's own guard.
 * `text` and `heading` take each figure added out (withoutFigures: nobody
 * is left a figure to find, the writer looks up what the brief names in
 * words) and put each person or quote added as a placeholder, as a written
 * page's are, a question in quotes aside; `keeps` drops a keyword that adds
 * one, as a placeholder can't be searched for; `found` lists what a text
 * adds, read the same way (the brief eval's gate).
 */
export function briefGuard({ brand, draft, prompts, sources, rules, inputs, competitors }) {
  const { given, known, people } = briefKnown({
    brand,
    draft,
    prompts,
    sources,
    rules,
    inputs,
    competitors,
  });
  // The names and quotes a text may have: a question in quotes in it too.
  const askedIn = (words) => {
    const questions = [...words.matchAll(QUOTED_QUESTION)].map((m) => m[1]);
    return questions.length ? knownPeople(...given, ...questions) : people;
  };
  const text = (words, heading = false) => {
    const numbered = placeholderNumbers(words ?? '', known);
    return withoutFigures(guardPeople(numbered, askedIn(numbered), { heading }).text, heading);
  };
  return {
    text,
    heading: (words) => text(words, true),
    keeps: (keyword) => text(keyword) === String(keyword ?? ''),
    /** What a text says that it wasn't given, as the guard reads it: what it would take out. */
    found: (words, heading = false) => {
      const read = String(words ?? '');
      return {
        figures: addedNumbers(read, known).map((n) => read.slice(n.start, n.end)),
        people: peopleEdits(read, askedIn(read), { heading }).map((e) =>
          read.slice(e.start, e.end),
        ),
      };
    },
  };
}

/**
 * What a brief is built from (`given`), and the numbers (`known`) and the
 * names and quotes (`people`) it may say: briefGuard's, and the brief eval's.
 * The rules it plans to are among them ("aim: 60 words"), and the person's
 * own input, word for word.
 */
export function briefKnown({
  brand,
  draft,
  prompts,
  sources,
  rules = [],
  inputs = [],
  competitors = [],
}) {
  const given = [
    brand?.name,
    brand?.industry,
    brand?.description,
    draft.title,
    ...prompts,
    ...sources.fanouts.map((f) => f.query),
    ...sources.queries,
    ...sources.headings,
    String(sources.length),
    ...rules.flatMap((rule) => [rule.name, rule.detail]),
    ...inputs.map(sourceWords),
    ...competitors,
  ];
  return { given, known: knownNumbers(...given, todayText()), people: knownPeople(...given) };
}

/**
 * Keeps an H2's fan-out only when it is one the person kept, written as
 * listed, and its platform only when that search ran there. Cut to the
 * limits the web reads a brief with (BRIEF_LIMITS): a heading or key point
 * left empty goes, long text is shortened, and the lists are capped.
 */
export function mapOutline(outline, fanouts) {
  const kept = fanoutMatcher(fanouts);
  return outline
    .map((section) => {
      const fanout = section.fanout ? kept(section.fanout) : undefined;
      const platform =
        fanout && fanout.platforms.includes(section.platform)
          ? section.platform
          : (fanout?.platforms[0] ?? null);
      return {
        heading: clip(section.heading ?? '', BRIEF_LIMITS.heading),
        keyPoints: (section.keyPoints ?? [])
          .map((p) => clip(p, BRIEF_LIMITS.keyPoint))
          .filter(Boolean)
          .slice(0, BRIEF_LIMITS.keyPoints),
        fanout: fanout?.query ?? null,
        platform: fanout ? platform : null,
        // Version 2's plan (shapeBrief), as shaped.
        ...('answer' in section
          ? { answer: section.answer, format: section.format, facts: section.facts }
          : {}),
      };
    })
    .filter((section) => section.heading)
    .slice(0, BRIEF_LIMITS.sections);
}

/**
 * The kept fan-out a text names, or undefined: as listed first, then without
 * its quotes, as the model may copy it.
 */
function fanoutMatcher(fanouts) {
  const asListed = new Map(fanouts.map((f) => [norm(f.query), f]));
  const unquoted = new Map(fanouts.map((f) => [fanoutKey(f.query), f]));
  return (text) => asListed.get(norm(text)) ?? unquoted.get(fanoutKey(text));
}

/** What the model is told: the brand, the page, and the sources kept. */
export function buildBriefPrompt({
  brand,
  draft,
  prompts,
  sources,
  rules = [],
  inputs = [],
  competitors = [],
  targets = NO_LINK_TARGETS,
}) {
  const list = (items) => (items.length ? items.map((item) => `- ${item}`).join('\n') : '- none');
  const v2 = briefRulesOn();
  // With the brief rules on, each cited page and each piece of the person's
  // input by its number (S1…), for the facts' sources.
  const numbered = v2 ? briefNumbered(sources, inputs) : [];
  const pages = v2
    ? numbered
        .filter((n) => n.kind === 'cited_page')
        .map((n) => `${n.id}: ${n.label} (${n.detail})`)
    : sources.pages.map((p) => `${p.url} (${p.kind})`);
  // Without a note (a quote's address, a day): a fact cites the input by its number.
  const pageLines = (pages) => pages.map((p) => `${p.title || p.url} — ${p.url}`);
  const linkable = v2
    ? [
        competitors.length ? `\nCompetitors (names as written): ${competitors.join(', ')}\n` : '',
        targets.own.length
          ? `\nThe brand's pages to link to:\n${list(pageLines(targets.own))}\n`
          : '',
        targets.sources.length
          ? `\nSources to link to and cite:\n${list(pageLines(targets.sources))}\n`
          : '',
      ].join('')
    : '';
  const given = numbered
    .filter((n) => n.kind === 'input')
    .map((n) => `${n.id} "${n.label}": ${n.detail}`);
  const leans =
    v2 && Object.hasOwn(PAGE_TYPE_SECTION_FORMATS, draft.page_type ?? '')
      ? PAGE_TYPE_SECTION_FORMATS[draft.page_type]
      : null;
  const listed = v2 ? rules.filter((r) => r.name) : [];
  return `Brand: ${brand?.name || 'Unknown'}
Industry: ${brand?.industry || 'Not specified'}
${siteTypeLine(brand)}Description: ${brand?.description || 'N/A'}

Page: ${draft.title || 'Untitled'}
Page type: ${pageTypeFormat(draft.page_type)}
${leans ? `Its sections lean to: ${leans}.\n` : ''}${draft.method === 'optimize' && draft.source_url ? `Existing page to improve: ${draft.source_url}` : 'A new page.'}
Length: about ${sources.length} characters.
${listed.length ? `\nRules the page is written to:\n${list(listed.map((r) => (r.detail ? `${r.name}: ${r.detail}` : r.name)))}\n` : ''}
Prompts the page must answer:
${list(prompts)}

AI searches (fan-outs) run while answering them, with the platform keys that ran each and the most searched first:
${list(sources.fanouts.map((f) => `"${f.query}" (${f.platforms.join(', ') || 'unknown'})`))}

Google searches people use (Search Console):
${list(sources.queries)}

Pages AI cites for these prompts today:
${list(pages)}
${given.length ? `\nThe person's own input for this page (Brief › Your input):\n${list(given)}\n` : ''}${linkable}
${sources.headings.length ? `The page's headings now:\n${list(sources.headings)}\n\n` : ''}Write the brief in ${getLanguageName(brand?.language)}.`;
}
