/**
 * The Content plan (Content Editor CE-014, spec v2 §4): one ranked list of
 * what to create, optimize or protect next, built from the brand's open
 * Content Opportunities (new pages AI needs, pages to improve; tasks sent
 * from the Action Center become opportunities too) and its own pages as AI
 * cites them (content_plan_pages, 00220): pages losing citations and the
 * top pages. More of the brand's pages cited for the same prompts is no
 * loss (AI answers aren't a ranking), so that is not a reason to list a
 * page. A page loses ground when
 * it is cited less per tracked answer than in the period before, so a week
 * with fewer runs, or prompts added or removed, moves no page.
 */

import { opportunityPageType } from './assetTypes';
import { detectPageType, type SiteType } from './pageTypes';
import type { DraftMethod, PageType } from './drafts';
import { pageKey } from './sources';
import type { PriorityLevel } from '@/lib/action-center/priority';
import { levelOf, logScale, round } from '@/lib/priorityCore';

/** The Plan's periods: a week, a month, a quarter. */
export const PLAN_PERIODS = [7, 30, 90] as const;
export type PlanPeriod = (typeof PLAN_PERIODS)[number];

export type PlanAction = 'create' | 'optimize' | 'protect';
/** The cards over the list, each a filter: by its action, or the rows marked as a priority. */
export const PLAN_CARDS = ['create', 'optimize', 'protect', 'priority'] as const;
export type PlanCard = (typeof PLAN_CARDS)[number];

/** The brand's tracked answers in each period: what makes their citations comparable. */
export interface PlanAnswers {
  cur: number;
  prev: number;
}

/**
 * When the brand's tracking began, against the earlier period's first day
 * (UTC dates): an earlier period before it is only partly tracked, or not
 * at all, so pages are compared per answer, or not at all.
 */
export interface PlanTracking {
  prevFrom: string | null;
  trackedSince: string | null;
}

/** One of the brand's pages, as content_plan_pages (00220) reads it. */
export interface PlanPage {
  page: string;
  title: string | null;
  citations: { cur: number; prev: number };
  /** Platform keys citing it at a lower rate than before, the biggest drop first. */
  platformsDown: string[];
  aiVisits: number;
  /**
   * Conversions from AI journeys that landed on, went through or converted
   * on the page (CE-017, 00291), as the Live page tab counts them; null for a
   * brand with conversions off.
   */
  conversions: number | null;
}

/** An open opportunity for one of the brand's own pages. */
export interface PlanOpportunity {
  id: string;
  title: string;
  /** The brief's suggested page title, when it has one. */
  pageTitle: string | null;
  decision: string | null;
  score: number;
  /** The page it works on, for an existing page, and that page's title. */
  targetPage: string | null;
  targetTitle: string | null;
  competitorsCited: string[];
  visibility: number | null;
  prompts: number;
  /** Its primary asset's type as stored (assetTypes.ts): the page type it names. */
  assetType: string | null;
}

/** A draft still being written, to open rather than start another. */
export interface PlanDraft {
  id: string;
  author: 'user' | 'agent';
  isMine: boolean;
  method: DraftMethod;
  opportunityId: string | null;
  sourceUrl: string | null;
  /** The Action Center task it was sent as (Start's Team), and who it is assigned to. */
  actionId: string | null;
  assignee: { id: string; name: string } | null;
}

/** An admin's or manager's mark on a row (content_plan_marks, 00229), by the row's key. */
export interface PlanMark {
  rowKey: string;
  priority: boolean;
  hidden: boolean;
}

/** Why a row is on the list, and where the signal comes from. */
export type PlanWhy =
  | { kind: 'competitors'; names: string[]; visibility: number | null }
  | { kind: 'opportunity'; prompts: number }
  | { kind: 'citationsDown'; pct: number; platforms: string[] }
  | { kind: 'top'; citations: number; aiVisits: number };

export interface PlanRow {
  key: string;
  action: PlanAction;
  title: string;
  /** The page it works on; null for a new page. */
  page: string | null;
  pageType: PageType | null;
  why: PlanWhy;
  source: 'opportunity' | 'citations' | 'protect';
  score: number;
  /** What the score is made of (the Priority Score's breakdown). */
  scoreParts: PlanScorePart[];
  opportunityId: string | null;
  draft: PlanDraft | null;
  /** Marked as a priority: at the top of the list, tagged. */
  priority: boolean;
}

/**
 * A page losing this share of its citations per answer, from at least this
 * many citations, is losing ground.
 */
export const DROP_SHARE = 0.2;
export const MIN_PREV_CITATIONS = 3;
/** Top pages: cited at least this often, and not losing ground. */
export const MIN_TOP_CITATIONS = 5;
export const MAX_PROTECT = 5;
export const MAX_ROWS = 50;

/**
 * The Priority Score (spec v2: the Action Center's model, AC-006 priority.js):
 * 0–100 from four factors, each 0–1 and weighted. An unknown value counts as
 * neutral, not as zero, so a brand without AI traffic data, or a page still
 * to write, isn't pushed down for what nobody can know yet.
 */
export const SCORE_WEIGHTS = { severity: 40, opportunity: 30, pageValue: 20, citations: 10 };

/**
 * The Plan badge's level from its score: its own cut-offs, not the Action
 * Center's 90/75/50. Under SCORE_WEIGHTS a new page tops out at 60, an
 * existing page with no drop at 74 and a top page with no opportunity at 50,
 * so on those nearly every row read Low. Here a new page reads High from an
 * opportunity score of about 82, an existing page can too, a top page with
 * no opportunity tops out at Medium (a defend opportunity can reach High),
 * and only a page losing citations can be Critical.
 */
export const PLAN_LEVEL_CUTOFFS = { critical: 75, high: 55, medium: 40 } as const;

export function planPriorityLevel(score: number): PriorityLevel {
  return levelOf(score, PLAN_LEVEL_CUTOFFS);
}

/** How bad the signal is, by what the row is (a drop is reckoned, 0.6–1). */
const SEVERITY = { create: 0.5, opportunity: 0.35, protect: 0.2 } as const;
/** A page row with no opportunity behind it: neither good nor bad. */
const NO_OPPORTUNITY = 0.4;
/** A page still to write, or a brand with no AI traffic data. */
const NEUTRAL_PAGE_VALUE = 0.5;
/** AI visits in the period that count in full (on a log scale), and citations. */
const FULL_VISITS = 1000;
/** Conversions in the period that count in full (on a log scale). */
const FULL_CONVERSIONS = 20;
/**
 * The conversions' share of a page's value, with its AI visits the rest (spec
 * v2: page value is visits and conversions), once FULL_CONVERSIONS are counted
 * on the listed pages; it grows to it with the data, so one conversion doesn't
 * re-weigh every page.
 */
const CONVERSIONS_SHARE = 0.4;
const FULL_CITATIONS = 30;
/** Citations lost that make a drop as bad as losing them all. */
const FULL_LOST = 20;

/** A drop's severity: 0.6, and up to 0.4 more for its share or the citations lost, whichever says more. */
export function dropSeverity(pct: number, lost: number): number {
  return Math.min(1, 0.6 + 0.4 * Math.max(pct / 100, Math.min(1, lost / FULL_LOST)));
}
/** A page's AI visits as value: log10(1 + visits) against FULL_VISITS'. */
export function visitsValue(visits: number): number {
  return logScale(visits, FULL_VISITS);
}
/** A page's conversions as value: log10(1 + conversions) against FULL_CONVERSIONS'. */
export function conversionsValue(conversions: number): number {
  return logScale(conversions, FULL_CONVERSIONS);
}
/**
 * A page's value: its AI visits, and with conversions weighed (a count, not
 * null) the conversions' `share`, 40% once the listed pages have 20.
 */
export function pageValueOf(
  visits: number,
  conversions: number | null,
  share: number = CONVERSIONS_SHARE,
): number {
  return conversions === null
    ? visitsValue(visits)
    : (1 - share) * visitsValue(visits) + share * conversionsValue(conversions);
}

/** The conversions' share of page value: up to 40%, by the conversions counted on the listed pages. */
export function conversionsShareOf(pages: PlanPage[]): number {
  const seen = pages.reduce((n, p) => n + (p.conversions ?? 0), 0);
  return CONVERSIONS_SHARE * Math.min(1, seen / FULL_CONVERSIONS);
}

/**
 * What a row's score is made of, for the Priority Score's breakdown: each
 * factor's value (0–1) and the points it gives (value × weight, to one
 * decimal). The score is their sum.
 */
export type PlanScorePart = { value: number; points: number; max: number } & (
  | { kind: 'severity'; reason: 'drop'; pct: number; lost: number }
  | { kind: 'severity'; reason: 'create' | 'opportunity' | 'protect' }
  | { kind: 'opportunity'; score: number | null }
  | { kind: 'pageValue'; reason: 'visits'; visits: number; conversions: number | null }
  | { kind: 'pageValue'; reason: 'newPage' | 'unknown' }
  | { kind: 'citations'; citations: number }
);

/** A part's own fields: its points and weight follow from them. */
type PartFields = PlanScorePart extends infer P
  ? P extends PlanScorePart
    ? Omit<P, 'points' | 'max'>
    : never
  : never;
/** To one decimal: whole points would tie pages a citation apart. */
const round1 = (n: number) => round(n, 1);
function part(fields: PartFields): PlanScorePart {
  const max = SCORE_WEIGHTS[fields.kind];
  return { ...fields, max, points: round1(fields.value * max) } as PlanScorePart;
}

/** The score: the parts' points, at most 100, to one decimal (shown whole). */
export function scoreOf(parts: PlanScorePart[]): number {
  return round1(
    Math.min(
      100,
      parts.reduce((sum, p) => sum + p.points, 0),
    ),
  );
}

/** The four parts of a row's score, from what the row is and the page it works on. */
function scoreParts({
  action,
  drop,
  opportunityScore,
  page,
  trafficKnown,
  conversionsShare,
}: {
  action: PlanAction;
  drop: { pct: number; lost: number } | null;
  /** The opportunity's own score; null for a page row with none. */
  opportunityScore: number | null;
  /** The page as AI cites it; absent for a new page, or one not cited. */
  page: PlanPage | undefined;
  /** Whether the brand has AI traffic data at all. */
  trafficKnown: boolean;
  /** The conversions' share of page value (conversionsShareOf): 0 until a listed page has any. */
  conversionsShare: number;
}): PlanScorePart[] {
  const create = action === 'create';
  return [
    drop
      ? part({
          kind: 'severity',
          reason: 'drop',
          pct: drop.pct,
          lost: drop.lost,
          value: dropSeverity(drop.pct, drop.lost),
        })
      : part({
          kind: 'severity',
          reason: create ? 'create' : action === 'protect' ? 'protect' : 'opportunity',
          value: SEVERITY[create ? 'create' : action === 'protect' ? 'protect' : 'opportunity'],
        }),
    part({
      kind: 'opportunity',
      score: opportunityScore,
      value: opportunityScore === null ? NO_OPPORTUNITY : opportunityScore / 100,
    }),
    create
      ? part({ kind: 'pageValue', reason: 'newPage', value: NEUTRAL_PAGE_VALUE })
      : trafficKnown && page
        ? part({
            kind: 'pageValue',
            reason: 'visits',
            visits: page.aiVisits,
            conversions: conversionsShare > 0 ? page.conversions : null,
            value: pageValueOf(
              page.aiVisits,
              conversionsShare > 0 ? page.conversions : null,
              conversionsShare,
            ),
          })
        : part({ kind: 'pageValue', reason: 'unknown', value: NEUTRAL_PAGE_VALUE }),
    part({
      kind: 'citations',
      citations: create ? 0 : (page?.citations.cur ?? 0),
      value: create ? 0 : Math.min(1, (page?.citations.cur ?? 0) / FULL_CITATIONS),
    }),
  ];
}

const CREATE_DECISIONS = new Set(['create']);
/** An opportunity to defend a page the brand holds: protecting it, not optimizing. */
const PROTECT_DECISIONS = new Set(['defend']);

/**
 * Every row, ranked, and what each card counts: the list shows the first
 * MAX_ROWS of a card's rows (rowsFor), so a card never counts rows it can't
 * show. Rows marked as a priority come first; hidden rows leave the list
 * and its counts for `hidden`, to be shown again.
 */
export function buildPlan({
  pages,
  answers,
  opportunities,
  drafts,
  marks = [],
  siteType,
}: {
  pages: PlanPage[];
  answers: PlanAnswers;
  opportunities: PlanOpportunity[];
  drafts: PlanDraft[];
  marks?: PlanMark[];
  siteType: SiteType;
}): { rows: PlanRow[]; hidden: PlanRow[]; counts: Record<PlanCard, number> } {
  const byPage = new Map<string, PlanPage>();
  for (const page of pages) {
    const key = pageKey(page.page);
    if (key && !byPage.has(key)) byPage.set(key, page);
  }
  const draftFor = (opportunityId: string | null, page: string | null): PlanDraft | null => {
    const key = page ? pageKey(page) : null;
    return (
      drafts.find(
        (d) =>
          (opportunityId && d.opportunityId === opportunityId) ||
          (key && d.method === 'optimize' && d.sourceUrl && pageKey(d.sourceUrl) === key),
      ) ?? null
    );
  };
  const typeOf = (title: string, page: string | null) =>
    detectPageType({ title, url: page ?? undefined }, siteType);

  const rows: PlanRow[] = [];
  const pagesTaken = new Set<string>();

  // No page with an AI visit or a conversion: the brand has no AI traffic
  // data (no Analytics, no snippet), so a page's value is unknown, not nothing.
  const trafficKnown = pages.some((p) => p.aiVisits > 0 || (p.conversions ?? 0) > 0);
  // Conversions weigh once some listed page has any, and more as they come:
  // turned on with none yet in the window, they'd cut every visited page's
  // value before any data. Each conversion a listed page counts adds 2%, so
  // the first, on one page, moves a row by 0.4 points at most.
  const conversionsShare = conversionsShareOf(pages);

  for (const o of opportunities) {
    const create = !o.decision || CREATE_DECISIONS.has(o.decision) || !o.targetPage;
    const key = o.targetPage ? pageKey(o.targetPage) : null;
    const page = key ? byPage.get(key) : undefined;
    // A new page by the title its brief suggests; an existing one by its own.
    const title = (create ? o.pageTitle : o.targetTitle) || o.title;
    const drop = page ? dropOf(page, answers) : null;
    const action: PlanAction = create
      ? 'create'
      : PROTECT_DECISIONS.has(o.decision ?? '')
        ? 'protect'
        : 'optimize';
    const parts = scoreParts({
      action,
      drop,
      opportunityScore: Math.round(o.score),
      page,
      trafficKnown,
      conversionsShare,
    });
    rows.push({
      key: `opportunity:${o.id}`,
      action,
      title,
      page: create ? null : o.targetPage,
      // A new page is what the opportunity names; an existing one is what
      // its address or title shows, else what the opportunity names.
      pageType: create
        ? (opportunityPageType(o.assetType, siteType) ?? typeOf(title, null))
        : (typeOf(title, o.targetPage) ?? opportunityPageType(o.assetType, siteType)),
      // The period's own signal, when the page is losing ground, says more.
      why:
        page && drop
          ? dropWhy(page, drop)
          : o.competitorsCited.length
            ? { kind: 'competitors', names: o.competitorsCited, visibility: o.visibility }
            : { kind: 'opportunity', prompts: o.prompts },
      source: drop ? 'citations' : 'opportunity',
      score: scoreOf(parts),
      scoreParts: parts,
      opportunityId: o.id,
      draft: draftFor(o.id, create ? null : o.targetPage),
      priority: false,
    });
    if (key && !create) pagesTaken.add(key);
  }

  const protect: PlanRow[] = [];
  for (const [key, page] of byPage) {
    if (pagesTaken.has(key)) continue;
    const title = page.title?.trim() || page.page;
    const base = {
      title,
      page: page.page,
      pageType: typeOf(title, page.page),
      opportunityId: null,
      draft: draftFor(null, page.page),
      priority: false,
    };
    const drop = dropOf(page, answers);
    if (drop) {
      const parts = scoreParts({
        action: 'optimize',
        drop,
        opportunityScore: null,
        page,
        trafficKnown,
        conversionsShare,
      });
      rows.push({
        ...base,
        key: `page:${key}`,
        action: 'optimize',
        why: dropWhy(page, drop),
        source: 'citations',
        score: scoreOf(parts),
        scoreParts: parts,
      });
    } else if (page.citations.cur >= MIN_TOP_CITATIONS) {
      const parts = scoreParts({
        action: 'protect',
        drop: null,
        opportunityScore: null,
        page,
        trafficKnown,
        conversionsShare,
      });
      protect.push({
        ...base,
        key: `page:${key}`,
        action: 'protect',
        why: { kind: 'top', citations: page.citations.cur, aiVisits: page.aiVisits },
        source: 'protect',
        score: scoreOf(parts),
        scoreParts: parts,
      });
    }
  }
  protect.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  rows.push(...protect.slice(0, MAX_PROTECT));

  const markOf = new Map(marks.map((m) => [m.rowKey, m]));
  const hidden: PlanRow[] = [];
  const listed: PlanRow[] = [];
  for (const row of rows) {
    const mark = markOf.get(row.key);
    if (mark?.hidden) hidden.push(row);
    else listed.push({ ...row, priority: Boolean(mark?.priority) });
  }
  const ranked = (a: PlanRow, b: PlanRow) => b.score - a.score || a.title.localeCompare(b.title);
  listed.sort((a, b) => Number(b.priority) - Number(a.priority) || ranked(a, b));
  hidden.sort(ranked);
  return {
    rows: listed,
    hidden,
    counts: {
      create: listed.filter((r) => r.action === 'create').length,
      optimize: listed.filter((r) => r.action === 'optimize').length,
      protect: listed.filter((r) => r.action === 'protect').length,
      priority: listed.filter((r) => r.priority).length,
    },
  };
}

/**
 * The rows a card shows, the first MAX_ROWS: its action's, or the
 * priorities; all without a card. A page type (the mix's filter) narrows
 * them before the cut, so its rows are never cut off by others.
 */
export function rowsFor(
  rows: PlanRow[],
  card: PlanCard | null,
  pageType: PageType | null = null,
): PlanRow[] {
  return rows
    .filter(
      (r) =>
        (!card || (card === 'priority' ? r.priority : r.action === card)) &&
        (!pageType || r.pageType === pageType),
    )
    .slice(0, MAX_ROWS);
}

/** Whether the earlier period was tracked in full, partly, or not at all. */
export function earlierPeriod(
  answers: PlanAnswers,
  tracking: PlanTracking,
): 'full' | 'partial' | 'none' {
  if (answers.prev <= 0) return 'none';
  if (tracking.prevFrom && tracking.trackedSince && tracking.trackedSince > tracking.prevFrom) {
    return 'partial';
  }
  return 'full';
}

/**
 * How much ground a page lost, per tracked answer: null when it isn't losing
 * any (or the brand had no answers in a period to compare). `lost` is the
 * citations it would have had at the earlier rate, less the ones it got.
 */
function dropOf(page: PlanPage, answers: PlanAnswers): { pct: number; lost: number } | null {
  const { cur, prev } = page.citations;
  if (prev < MIN_PREV_CITATIONS || answers.cur <= 0 || answers.prev <= 0) return null;
  const rateNow = cur / answers.cur;
  const rateBefore = prev / answers.prev;
  if (rateNow > rateBefore * (1 - DROP_SHARE)) return null;
  return {
    pct: Math.round(((rateBefore - rateNow) / rateBefore) * 100),
    lost: Math.max(0, Math.round(rateBefore * answers.cur - cur)),
  };
}

function dropWhy(page: PlanPage, drop: { pct: number }): PlanWhy {
  return { kind: 'citationsDown', pct: drop.pct, platforms: page.platformsDown };
}
