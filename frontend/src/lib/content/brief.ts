import { z } from 'zod';
import type { ContentBrief } from '@/types';
import {
  SUGGESTION_SOURCE_KINDS,
  buildSourceGroups,
  readDraftDoc,
  type DraftSourceChoice,
  type DraftSourcesData,
} from '@/lib/content/sources';
import type { SuggestionSource } from '@/lib/content/suggestions';

/**
 * The editor's Brief tab (Content Editor CE-007, spec §10): what the page
 * should do — its goal, audience and length, and an outline whose H2s each
 * answer a search AI engines ran (a fan-out) on a platform. Rebuild outline
 * writes it from the sources kept in the Sources tab (server
 * contentBrief.js); Edit brief changes it by hand. Stored in
 * content_drafts.brief (00212).
 */

export const BRIEF_ORIGINS = ['rebuild', 'edit', 'opportunity'] as const;
export type BriefOrigin = (typeof BRIEF_ORIGINS)[number];

// The brief rules (2026) a brief plans with, from its version 2 (server
// contentBrief.js, behind CONTENT_BRIEF_RULES): each optional, so a brief
// from before them reads as it was, and Edit brief keeps them. A value this
// editor doesn't know yet, from a newer server, reads as none rather than
// hiding the brief: a new one is added here, and shipped, before the server
// writes it.

/**
 * How a section is best shown: a table for a comparison, steps for a how-to.
 * A "faq" section's key points are its questions.
 */
export const BRIEF_FORMATS = ['paragraphs', 'list', 'steps', 'table', 'faq'] as const;
export type BriefFormat = (typeof BRIEF_FORMATS)[number];
/** The kind of source a fact to state needs. */
export const FACT_SOURCES = ['statistic', 'study', 'quote', 'example', 'official'] as const;
export type FactSource = (typeof FACT_SOURCES)[number];
/**
 * Proof to gather: the brand's own, which AI can't find elsewhere, as Brief ›
 * Your input takes it (experience, data, quotes; a case or a test as
 * experience).
 */
export const PROOF_KINDS = ['experience', 'data', 'case', 'test', 'quote'] as const;
export type ProofKind = (typeof PROOF_KINDS)[number];

/**
 * A fact a section states: what, the kind of source it needs, and the source
 * it was given for it, kept as a suggestion keeps its (00248): by kind and
 * ref, with its name, never its number in one run (S1…).
 */
export interface BriefFact {
  claim: string;
  sourceType: FactSource;
  source: SuggestionSource | null;
}

/** A page to link to: its address, the words to link, the section it goes in (null: anywhere). */
export interface BriefLink {
  url: string;
  anchor: string;
  section: string | null;
}

export interface BriefSection {
  heading: string;
  keyPoints: string[];
  /** The fan-out the H2 answers, as the Sources tab lists it; null for none. */
  fanout: string | null;
  /** The platform key that ran it (perplexity-web, copilot-web…). */
  platform: string | null;
  /** What the section's first, direct answer must say: a note to the writer, not the answer. */
  answer?: string | null;
  format?: BriefFormat | null;
  facts?: BriefFact[];
}

export interface DraftBrief {
  goal: string;
  audience: string;
  outline: BriefSection[];
  keywords: string[];
  origin: BriefOrigin;
  /** When Rebuild outline last wrote it. */
  builtAt: string | null;
  /** The sources it was built from, by group. */
  builtFrom: { prompts: number; fanouts: number; pages: number; queries: number } | null;
  /**
   * How long the cited pages are, in characters (the median of those read),
   * and how many were read when it was rebuilt (CE-030); null or absent when
   * none could be.
   */
  citedLength?: { characters: number; pages: number } | null;
  /**
   * What Site Audit's checks find on the same cited pages (learning C2): the
   * checks at least half of them pass, by name, and on how many pages.
   */
  citedFeatures?: {
    pages: number;
    checks: { key: string; label: string; pages: number }[];
  } | null;
  /** 2 once it plans with the brief rules (2026); absent before. */
  version?: 2;
  /** The page's essentials, for its top. */
  tldr?: string | null;
  /** What the page says that commodity pages don't. */
  angle?: string | null;
  /**
   * The brand's own proof to gather. Whether Brief › Your input has it is read
   * from Your input when shown, never kept here: it changes after a rebuild.
   */
  proof?: { kind: ProofKind; what: string }[];
  /** Fan-outs kept out: another topic, for another page. */
  leftOut?: string[];
  /** A dated point to give, an "Updated" line, the year in the title. */
  freshness?: { datedPoint: string | null; updatedLine: boolean; yearInTitle: boolean } | null;
  /** Names as they are written: the brand, its products, the competitors given. */
  entities?: { brand: string; products: string[]; competitors: string[] } | null;
  links?: { internal: BriefLink[]; outbound: BriefLink[] } | null;
}

/** Limits a brief keeps to, the server's (contentBrief.js) and the column's (00212). */
export const MAX_BRIEF_SECTIONS = 12;
/** content_drafts.brief's check (00212), as jsonb writes it as text. */
export const MAX_BRIEF_BYTES = 65_536;
const text = (max: number) => z.string().trim().max(max);

/**
 * Version 2's limits: the server cuts its brief to them (contentBrief.js),
 * and the editor reads past them by cutting too, so a newer server's brief
 * still shows. __fixtures__/brief-v2.json is the sample both sides test; the
 * server's test reads this file for the limits and the kinds.
 */
export const BRIEF_V2_LIMITS = {
  answer: 600,
  facts: 4,
  claim: 300,
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
  url: 2048,
  anchor: 120,
  linkSection: 300,
} as const;
const L = BRIEF_V2_LIMITS;

/** A text of version 2: cut to its limit, null or absent for none. */
const v2text = (max: number) =>
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().slice(0, max) : value),
    z.string().nullish(),
  );
/**
 * A list of version 2: the items this editor reads, up to its limit; one it
 * can't (a kind from a newer server, an address that isn't http) is left
 * out, not the whole brief.
 */
const v2list = <T extends z.ZodType>(item: T, max: number) =>
  z.preprocess(
    (value) =>
      Array.isArray(value) ? value.filter((v) => item.safeParse(v).success).slice(0, max) : value,
    z.array(item).max(max).optional(),
  );
/** An http(s) address only: a link the Brief tab shows is never "javascript:…". */
const address = z
  .string()
  .trim()
  .max(L.url)
  .pipe(z.url({ protocol: /^https?$/ }));
const linkSchema = z.object({
  url: address,
  anchor: text(L.anchor),
  section: text(L.linkSection).nullable(),
});

export const draftBriefSchema = z.object({
  goal: text(500),
  audience: text(500),
  outline: z
    .array(
      z.object({
        heading: text(300).min(1),
        keyPoints: z.array(text(500).min(1)).max(8),
        fanout: text(300).nullable(),
        platform: text(60).nullable(),
        answer: v2text(L.answer),
        format: z.enum(BRIEF_FORMATS).nullish().catch(null),
        facts: v2list(
          z.object({
            claim: text(L.claim).min(1),
            sourceType: z.enum(FACT_SOURCES),
            source: z
              .object({
                kind: z.enum(SUGGESTION_SOURCE_KINDS),
                ref: text(L.url).min(1),
                label: text(L.claim).min(1),
              })
              .nullable(),
          }),
          L.facts,
        ),
      }),
    )
    .max(MAX_BRIEF_SECTIONS),
  keywords: z.array(text(80).min(1)).max(15),
  origin: z.enum(BRIEF_ORIGINS),
  builtAt: z.string().max(40).nullable(),
  builtFrom: z
    .object({
      prompts: z.number().int().min(0),
      fanouts: z.number().int().min(0),
      pages: z.number().int().min(0),
      queries: z.number().int().min(0),
    })
    .nullable(),
  citedLength: z
    .object({
      characters: z.number().int().min(0).max(1_000_000),
      pages: z.number().int().min(1).max(30),
    })
    .nullable()
    .optional(),
  citedFeatures: z
    .object({
      pages: z.number().int().min(1).max(30),
      checks: z
        .array(
          z.object({
            key: z.string().min(1).max(60),
            label: z.string().min(1).max(120),
            pages: z.number().int().min(1).max(30),
          }),
        )
        .max(20),
    })
    .nullable()
    .optional()
    .catch(undefined),
  // A later version reads as the rules it shares with this one.
  version: z.literal(2).optional().catch(undefined),
  tldr: v2text(L.tldr),
  angle: v2text(L.angle),
  proof: v2list(z.object({ kind: z.enum(PROOF_KINDS), what: text(L.proofWhat).min(1) }), L.proof),
  leftOut: v2list(text(L.leftOutQuery).min(1), L.leftOut),
  freshness: z
    .object({
      datedPoint: v2text(L.datedPoint).transform((v) => v ?? null),
      updatedLine: z.boolean(),
      yearInTitle: z.boolean(),
    })
    .nullish()
    .catch(null),
  entities: z
    .object({
      brand: v2text(L.entity).transform((v) => v ?? ''),
      products: v2list(text(L.entity).min(1), L.entities).transform((v) => v ?? []),
      competitors: v2list(text(L.entity).min(1), L.entities).transform((v) => v ?? []),
    })
    .nullish()
    .catch(null),
  links: z
    .object({
      internal: v2list(linkSchema, L.internalLinks).transform((v) => v ?? []),
      outbound: v2list(linkSchema, L.outboundLinks).transform((v) => v ?? []),
    })
    .nullish()
    .catch(null),
});

/** The brief of the opportunity a draft started from, until the draft has its own. */
export function briefFromOpportunity(brief: ContentBrief): DraftBrief {
  return {
    goal: brief.callToAction ?? '',
    audience: '',
    outline: (brief.outline ?? []).map((section) => ({
      heading: section.heading,
      keyPoints: section.keyPoints ?? [],
      fanout: null,
      platform: null,
    })),
    keywords: brief.targetKeywords ?? [],
    origin: 'opportunity',
    builtAt: null,
    builtFrom: null,
  };
}

/** What Rebuild outline sends the server: the sources kept, the page as written, its length. */
export interface RebuildSources {
  promptIds: string[];
  fanouts: { query: string; platforms: string[] }[];
  pages: { url: string; kind: string }[];
  queries: string[];
  headings: string[];
  length: number;
}

/** The most of each the agent takes (contentBrief.js rebuildSources). */
export const REBUILD_LIMITS = {
  prompts: 100,
  fanouts: 40,
  pages: 30,
  queries: 20,
  headings: 30,
} as const;

/**
 * The sources a rebuild uses: the ones checked in the Sources tab, as it
 * lists them; the page's H2s and H3s as written now; and the length the
 * rules ask for.
 */
export function rebuildSources(
  data: DraftSourcesData,
  choices: DraftSourceChoice[],
  draft: { title: string; sourceUrl: string | null; html: string; length: number },
): RebuildSources {
  const groups = buildSourceGroups(data, choices, draft);
  const kept = (kind: string) =>
    groups.find((g) => g.kind === kind)?.rows.filter((r) => r.included) ?? [];
  // The server's limits (contentBrief.js rebuildSources).
  return {
    promptIds: kept('prompt')
      .map((r) => r.ref)
      .slice(0, REBUILD_LIMITS.prompts),
    fanouts: kept('fanout')
      .flatMap((r) => (r.kind === 'fanout' ? [{ query: r.name, platforms: r.platforms }] : []))
      .slice(0, REBUILD_LIMITS.fanouts),
    pages: kept('cited_page')
      .flatMap((r) => (r.kind === 'cited_page' ? [{ url: r.name, kind: r.category }] : []))
      .slice(0, REBUILD_LIMITS.pages),
    queries: kept('gsc_query')
      .map((r) => r.name)
      .slice(0, REBUILD_LIMITS.queries),
    headings: readDraftDoc(draft.html)
      .headings.filter((h) => h.level > 1 && h.text)
      .map((h) => h.text)
      .slice(0, REBUILD_LIMITS.headings),
    length: draft.length,
  };
}

/** The sources a brief was built from, counted together. */
export function builtFromCount(brief: DraftBrief): number {
  const from = brief.builtFrom;
  return from ? from.prompts + from.fanouts + from.pages + from.queries : 0;
}
