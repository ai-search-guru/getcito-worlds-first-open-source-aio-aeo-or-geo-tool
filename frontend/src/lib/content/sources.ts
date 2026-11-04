import { classifyDomain, normalizeDomain, type SourceCategory } from '@/lib/citations/classify';

/**
 * The editor's Sources tab (Content Editor CE-008, spec §10): every source a
 * draft draws on, by name, with where the draft uses it. The brand's data
 * comes from content_draft_sources (00211); a person's choices — a source
 * left out, a page or query added — from the table of the same name.
 */

export const DRAFT_SOURCE_KINDS = ['prompt', 'fanout', 'cited_page', 'gsc_query'] as const;
export type DraftSourceKind = (typeof DRAFT_SOURCE_KINDS)[number];

/**
 * What an agent's suggestion can be written from: the Sources tab's kinds,
 * and Brief › Your input (Quality spec §6, CE-048), the person's own.
 */
export const SUGGESTION_SOURCE_KINDS = [...DRAFT_SOURCE_KINDS, 'input'] as const;
export type SuggestionSourceKind = (typeof SUGGESTION_SOURCE_KINDS)[number];

/** The sources of the last 30 days, as content_draft_sources reads them. */
export const SOURCES_DAYS = 30;
/** Search Console queries shown beside the draft, the most clicked first. */
export const MAX_GSC_SOURCES = 10;

export interface DraftSourcesData {
  prompts: {
    id: string;
    text: string;
    inDraft: boolean;
    citesPage: boolean;
    answers: number;
    mentioned: number;
  }[];
  fanouts: { query: string; platforms: string[]; searched: number }[];
  citedPages: {
    url: string;
    title: string | null;
    domain: string;
    citations: number;
    answers: number;
  }[];
  gscQueries: { query: string; clicks: number; impressions: number }[];
  brandDomains: string[];
  competitorDomains: string[];
  /** The sites the brand trusts (00449), read with the draft's brand; none before it. */
  trustedDomains?: string[];
}

/** A person's choice on one source: left out, or added by hand. */
export interface DraftSourceChoice {
  kind: DraftSourceKind;
  ref: string;
  included: boolean;
  added: boolean;
}

/** One row of the tab. */
export type DraftSourceRow = {
  kind: DraftSourceKind;
  /** What a choice is stored under: a prompt id, a normalized query or an address. */
  ref: string;
  /** The full name or address. */
  name: string;
  included: boolean;
  added: boolean;
} & (
  | { kind: 'prompt'; answers: number; mentioned: number; citesPage: boolean }
  | { kind: 'fanout'; platforms: string[]; searched: number }
  | { kind: 'cited_page'; category: SourceCategory; citations: number | null }
  | { kind: 'gsc_query'; clicks: number | null; impressions: number | null }
);

export interface DraftSourceGroup {
  kind: DraftSourceKind;
  rows: DraftSourceRow[];
}

/** A query as one source: trimmed, spaces collapsed, lowercased (as 00211 groups fan-outs). */
export function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

const STOP_WORDS = new Set(
  (
    'the and for with what which how are is was were you your our from that this does do did can ' +
    'vs not but has have had who why when where will would should could into about than then there ' +
    'their they them its it as at by of on in to or be an a'
  ).split(' '),
);

/** A text's words for matching: lowercased, three letters or more, plurals as singulars. */
export function wordsOf(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words
    .filter((w) => (w.length >= 3 || /^\d+$/.test(w)) && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w));
}

/** Whether `words` cover at least `share` of a source's words (and at least one). */
function covers(sourceWords: string[], words: Set<string>, share: number): boolean {
  const unique = [...new Set(sourceWords)];
  if (!unique.length) return false;
  const hits = unique.filter((w) => words.has(w)).length;
  return hits > 0 && hits / unique.length >= share;
}

/**
 * Search Console keeps no queries per page, so the draft's are the brand's
 * queries sharing half their words with the draft's title, prompts and page
 * address — as pagePromptSuggestions.js matches queries to a page.
 */
export function relatedQueries(
  rows: DraftSourcesData['gscQueries'],
  draftText: string[],
  limit = MAX_GSC_SOURCES,
): DraftSourcesData['gscQueries'] {
  const words = new Set(draftText.flatMap(wordsOf));
  return rows.filter((row) => covers(wordsOf(row.query), words, 0.5)).slice(0, limit);
}

/** A page address's path as words ("/guides/home-espresso" → "guides home espresso"): its host names the brand, not the page. */
function pathWords(url: string | null): string {
  if (!url) return '';
  try {
    return new URL(url).pathname.replace(/[/_.-]+/g, ' ');
  } catch {
    return '';
  }
}

/** The parts of the draft a source can be used in. */
export interface DraftDoc {
  headings: { level: number; text: string; words: Set<string> }[];
  paragraphs: Set<string>[];
  links: string[];
}

/** Reads the draft's headings, paragraphs and links from its HTML. */
export function readDraftDoc(html: string): DraftDoc {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const headings = [...doc.querySelectorAll('h1, h2, h3')].map((h) => {
    const text = (h.textContent ?? '').trim();
    return { level: Number(h.tagName.slice(1)), text, words: new Set(wordsOf(text)) };
  });
  const paragraphs = [...doc.querySelectorAll('p, li')].map(
    (p) => new Set(wordsOf(p.textContent ?? '')),
  );
  const links = [...doc.querySelectorAll('a[href]')]
    .map((a) => pageKey(a.getAttribute('href') ?? ''))
    .filter((key): key is string => key !== null);
  return { headings, paragraphs, links };
}

/** An address as one page: host without www, path without its trailing slash, lowercased. */
export function pageKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) return null;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return `${host}${parsed.pathname.replace(/\/+$/, '').toLowerCase()}`;
  } catch {
    return null;
  }
}

export type UsedIn =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; index: number }
  | { kind: 'thisPage' }
  | { kind: 'internalLink' }
  | { kind: 'outboundLink' };

/** The share of a source's words a heading or paragraph carries to count as using it. */
const USED_SHARE = 0.75;

/**
 * Where the draft uses a source, as written now: a page is used where the
 * draft links to it (or is the page itself); a prompt, fan-out or query in
 * the first heading, then the first paragraph, carrying three quarters of
 * its words.
 */
export function usedIn(
  row: DraftSourceRow,
  doc: DraftDoc,
  ctx: { sourceUrl: string | null },
): UsedIn | null {
  if (row.kind === 'cited_page') {
    const key = pageKey(row.name);
    if (!key) return null;
    if (ctx.sourceUrl && pageKey(ctx.sourceUrl) === key) return { kind: 'thisPage' };
    if (!doc.links.includes(key)) return null;
    return row.category === 'you' ? { kind: 'internalLink' } : { kind: 'outboundLink' };
  }
  const words = wordsOf(row.name);
  const heading = doc.headings.find((h) => covers(words, h.words, USED_SHARE));
  if (heading) return { kind: 'heading', level: heading.level, text: heading.text };
  const index = doc.paragraphs.findIndex((p) => covers(words, p, USED_SHARE));
  return index >= 0 ? { kind: 'paragraph', index: index + 1 } : null;
}

/**
 * Where a fan-out an engine joined splits: at a semicolon, not one that ends
 * an HTML entity ("what&#39;s", "&amp;"). The same rule as the tracker's
 * (backend/src/lib/cloroScraper.js, SEARCH_SEPARATOR).
 */
const FANOUT_SEPARATOR = /(?<!&#?\w+);/u;

/**
 * A fan-out as the searches it holds: an engine can send several as one,
 * joined by semicolons ("chatgpt subscription;gemini subscription"), and a
 * page's heading or FAQ question needs one search, not the list. Each is
 * trimmed, and an empty one dropped, as the tracker stores them.
 */
export function fanoutQueries(query: string): string[] {
  return query
    .split(FANOUT_SEPARATOR)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * The tab's groups — Prompts · Fan-outs · Cited pages · Search Console — from
 * the brand's data and a person's choices: a source left out stays listed,
 * unchecked; a page or query added by hand joins its group.
 */
export function buildSourceGroups(
  data: DraftSourcesData,
  choices: DraftSourceChoice[],
  draft: { title: string; sourceUrl: string | null },
): DraftSourceGroup[] {
  const choice = new Map(choices.map((c) => [`${c.kind}:${c.ref}`, c]));
  const included = (kind: DraftSourceKind, ref: string) =>
    choice.get(`${kind}:${ref}`)?.included ?? true;
  const ctx = {
    brandDomains: data.brandDomains.map(normalizeDomain),
    competitorDomains: data.competitorDomains.map(normalizeDomain),
  };
  const categoryOf = (url: string): SourceCategory => {
    const host = normalizeDomain(url);
    return host ? classifyDomain(host, ctx) : 'other';
  };

  const prompts: DraftSourceRow[] = data.prompts.map((p) => ({
    kind: 'prompt',
    ref: p.id,
    name: p.text,
    included: included('prompt', p.id),
    added: false,
    answers: p.answers,
    mentioned: p.mentioned,
    citesPage: p.citesPage && !p.inDraft,
  }));

  // An engine's searches sent as one ("a;b;c") are read as each search, and
  // one met twice as one row: its platforms together, its searches added up.
  // A search with no choice of its own keeps the one made for the row it was
  // in (stored under the joined query): left out only when every row it was
  // in was. The most searched first again, as the brief keeps the first ones.
  const fanoutRows = new Map<
    string,
    { name: string; platforms: Set<string>; searched: number; shown: boolean }
  >();
  for (const f of data.fanouts) {
    const shown = included('fanout', normalizeQuery(f.query));
    for (const query of fanoutQueries(f.query)) {
      const ref = normalizeQuery(query);
      const row = fanoutRows.get(ref);
      if (row) {
        for (const platform of f.platforms) row.platforms.add(platform);
        row.searched += f.searched;
        row.shown ||= shown;
      } else {
        fanoutRows.set(ref, {
          name: query,
          platforms: new Set(f.platforms),
          searched: f.searched,
          shown,
        });
      }
    }
  }
  const fanouts: DraftSourceRow[] = [...fanoutRows]
    .sort(([, a], [, b]) => b.searched - a.searched)
    .map(([ref, f]) => ({
      kind: 'fanout',
      ref,
      name: f.name,
      included: choice.get(`fanout:${ref}`)?.included ?? f.shown,
      added: false,
      platforms: [...f.platforms],
      searched: f.searched,
    }));

  const pages: DraftSourceRow[] = data.citedPages.map((c) => ({
    kind: 'cited_page',
    ref: c.url,
    name: c.url,
    included: included('cited_page', c.url),
    added: false,
    category: categoryOf(c.url),
    citations: c.citations,
  }));
  const listedPages = new Set(pages.map((p) => p.ref));
  for (const c of choices) {
    if (c.kind !== 'cited_page' || !c.added || listedPages.has(c.ref)) continue;
    pages.push({
      kind: 'cited_page',
      ref: c.ref,
      name: c.ref,
      included: c.included,
      added: true,
      category: categoryOf(c.ref),
      citations: null,
    });
  }

  const byQuery = new Map(data.gscQueries.map((q) => [normalizeQuery(q.query), q]));
  const related = relatedQueries(data.gscQueries, [
    draft.title,
    ...data.prompts.map((p) => p.text),
    pathWords(draft.sourceUrl),
  ]);
  const queries: DraftSourceRow[] = related.map((q) => {
    const ref = normalizeQuery(q.query);
    return {
      kind: 'gsc_query',
      ref,
      name: q.query,
      included: included('gsc_query', ref),
      added: false,
      clicks: q.clicks,
      impressions: q.impressions,
    };
  });
  const listedQueries = new Set(queries.map((q) => q.ref));
  for (const c of choices) {
    if (c.kind !== 'gsc_query' || !c.added || listedQueries.has(c.ref)) continue;
    const row = byQuery.get(c.ref);
    queries.push({
      kind: 'gsc_query',
      ref: c.ref,
      name: row?.query ?? c.ref,
      included: c.included,
      added: true,
      clicks: row?.clicks ?? null,
      impressions: row?.impressions ?? null,
    });
  }

  return [
    { kind: 'prompt', rows: prompts },
    { kind: 'fanout', rows: fanouts },
    { kind: 'cited_page', rows: pages },
    { kind: 'gsc_query', rows: queries },
  ];
}

/** The included sources per group, for the summary line. */
export function includedCounts(groups: DraftSourceGroup[]): Record<DraftSourceKind, number> {
  const counts = { prompt: 0, fanout: 0, cited_page: 0, gsc_query: 0 };
  for (const group of groups) counts[group.kind] = group.rows.filter((r) => r.included).length;
  return counts;
}
