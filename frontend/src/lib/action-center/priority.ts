import type { ActionItem } from '@/lib/actions/actionCenter';
import { OPEN_ACTION_STATUSES } from '@/lib/action-center/registry';
import { levelOf } from '@/lib/priorityCore';

/**
 * An action's priority as the app shows it (AC-006): the 0–100 score and its
 * level, worked out on the server (backend/src/lib/action-center/priority.js),
 * the order the Actions list and the Top Actions card follow, and the
 * "Why this priority?" sentence written from the facts the score rests on.
 */

export const PRIORITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;
export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

const CHANGES = ['lost', 'dropped', 'slipping', 'gap', 'issue', 'opportunity', 'gain'] as const;
type PriorityChange = (typeof CHANGES)[number];

/** The facts the server stored with the score (`actions.priority_reason`). */
export interface PriorityReason {
  /** The worst finding's change; null when nothing open supports the action. */
  change: PriorityChange | null;
  subject: { entity: string | null; count: number | null };
  /** Measured demand; null when nothing measures it. */
  demand: 'high' | 'medium' | 'low' | null;
  /**
   * The prompts' measured demand level (PROMPT-014: Search Console, Google
   * Trends, People Also Ask, YouTube), the highest, when it raised the score:
   * High or Medium. Null otherwise: Low raises nothing, so it's no reason.
   */
  realDemand: 'high' | 'medium' | null;
  commercial: boolean;
  /** Ground the brand held and lost. */
  heldBefore: boolean;
  /** Days since the newest evidence; null for an action a person sent. */
  days: number | null;
  /** Independent data sources behind it. */
  sources: number;
  /**
   * How the brand's earlier actions of its kind turned out (learning B4):
   * results with a verdict, how many improved, and the points that moved
   * its score. Null with no history, or from a scorer before it.
   */
  pastSuccess?: { improved: number; results: number; points: number } | null;
  /** How sure the score is of what it rests on; null from a scorer before it was kept. */
  confidence?: PriorityConfidence | null;
}

export type ConfidenceLevel = 'low' | 'medium' | 'high';

/**
 * The score's confidence factor as the server weighs it (priority.js
 * `confidenceOf`): 0.3 for one kind of finding from one source, 0.2 more for
 * each further kind and each further source; an action a person sent carries
 * its own. Read as a level and why, never as the bare number.
 */
export interface PriorityConfidence {
  level: ConfidenceLevel;
  /** The 0–1 factor the score used. */
  score: number;
  /** Kinds of finding and data sources behind it; none for an action a person sent. */
  kinds: number;
  sources: number;
}

/** A 0–1 confidence's level: High from 0.7, Medium from 0.5, else Low. */
export function confidenceLevelOf(score: number): ConfidenceLevel {
  return score >= 0.7 ? 'high' : score >= 0.5 ? 'medium' : 'low';
}

function confidenceOf(r: Record<string, unknown>): PriorityConfidence | null {
  const factors = (r.factors && typeof r.factors === 'object' ? r.factors : {}) as Record<
    string,
    unknown
  >;
  const score = factors.confidence;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  const count = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  return {
    level: confidenceLevelOf(score),
    score,
    kinds: count(r.kinds),
    sources: count(r.sources),
  };
}

/**
 * Why the confidence is what it is, in English, for the MCP server: "one kind
 * of finding from one source".
 */
export function confidenceNote(confidence: PriorityConfidence): string {
  const count = (n: number, one: string, many: string) => (n === 1 ? `one ${one}` : `${n} ${many}`);
  if (confidence.kinds === 0) {
    return 'rated from what the action was sent with, not from detected findings';
  }
  const kinds = count(confidence.kinds, 'kind of finding', 'kinds of finding');
  return confidence.sources > 0
    ? `${kinds} from ${count(confidence.sources, 'source', 'sources')}`
    : kinds;
}

/** Days New with no one's event before an action is stale: the server's staleAfterDays (config/actionEngine.js). */
export const STALE_AFTER_DAYS = 30;

/** Stale (00432): New for a month with no one's event. Only a New action reads as stale. */
export function isStale(action: { status: string; staleAt?: string | null }): boolean {
  return action.status === 'new' && Boolean(action.staleAt);
}

/** How many actions the Top Actions card names (spec: at most five). */
export const TOP_ACTIONS = 5;

export function isPriorityLevel(value: unknown): value is PriorityLevel {
  return (PRIORITY_LEVELS as readonly unknown[]).includes(value);
}

/** The server's level cut-offs (config/actionEngine.js `priority`): critical 90+, high 75+, medium 50+. */
const LEVEL_CUTOFFS = { critical: 90, high: 75, medium: 50 };

/** A score's level, as the server assigns it. */
export function priorityLevelOf(score: number): PriorityLevel {
  return levelOf(score, LEVEL_CUTOFFS);
}

/** The stored level, or the score's when the stored one is missing or unknown. */
export function storedPriorityLevel(level: unknown, score: number | null): PriorityLevel | null {
  if (isPriorityLevel(level)) return level;
  return score === null ? null : priorityLevelOf(score);
}

/** The highest of these levels — what a summary card shows; null when none is scored. */
export function highestPriorityLevel(levels: (PriorityLevel | null)[]): PriorityLevel | null {
  return PRIORITY_LEVELS.find((level) => levels.includes(level)) ?? null;
}

const DAY_MS = 86_400_000;

/**
 * The stored reason, read defensively: a row from an older scorer may lack
 * parts. Its `days` were counted when it was scored; with `scoredAt` they are
 * brought up to `now`.
 */
export function parsePriorityReason(
  value: unknown,
  { scoredAt, now = new Date() }: { scoredAt?: string | null; now?: Date } = {},
): PriorityReason | null {
  if (!value || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  const subject = (r.subject && typeof r.subject === 'object' ? r.subject : {}) as Record<
    string,
    unknown
  >;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return {
    change: (CHANGES as readonly unknown[]).includes(r.change)
      ? (r.change as PriorityChange)
      : null,
    subject: {
      entity: typeof subject.entity === 'string' ? subject.entity : null,
      count: num(subject.count),
    },
    demand: r.demand === 'high' || r.demand === 'medium' || r.demand === 'low' ? r.demand : null,
    realDemand: r.realDemand === 'high' || r.realDemand === 'medium' ? r.realDemand : null,
    commercial: r.commercial === true,
    heldBefore: r.heldBefore === true,
    days: daysSince(num(r.days), scoredAt, now),
    sources: num(r.sources) ?? 0,
    pastSuccess: pastSuccessOf(r.pastSuccess),
    confidence: confidenceOf(r),
  };
}

function pastSuccessOf(value: unknown): PriorityReason['pastSuccess'] {
  if (!value || typeof value !== 'object') return null;
  const p = value as Record<string, unknown>;
  const [improved, results, points] = [p.improved, p.results, p.points].map((v) =>
    typeof v === 'number' && Number.isFinite(v) ? v : null,
  );
  if (improved === null || results === null || points === null || results < 1) return null;
  return { improved, results, points };
}

function daysSince(days: number | null, scoredAt: string | null | undefined, now: Date) {
  if (days === null) return null;
  const at = Date.parse(scoredAt ?? '');
  if (!Number.isFinite(at)) return days;
  return days + Math.max(0, Math.floor((now.getTime() - at) / DAY_MS));
}

const IMPACT_RANK: Record<ActionItem['impact'], number> = { high: 3, medium: 2, low: 1 };

/**
 * Impact first, then weight of evidence, then recency: the order before
 * scores, kept to break ties and to order actions not scored yet.
 */
function compareImpact(a: ActionItem, b: ActionItem): number {
  return (
    IMPACT_RANK[b.impact] - IMPACT_RANK[a.impact] ||
    b.signalCount - a.signalCount ||
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

/**
 * Highest priority first. An action not scored yet (before its first nightly
 * pass) comes after the scored ones, in impact order.
 */
export function comparePriority(a: ActionItem, b: ActionItem): number {
  if (a.priorityScore !== null && b.priorityScore !== null) {
    return b.priorityScore - a.priorityScore || compareImpact(a, b);
  }
  if (a.priorityScore !== null) return -1;
  if (b.priorityScore !== null) return 1;
  return compareImpact(a, b);
}

/** The Top Actions card: the open actions to work on next, at most five. */
export function topActionIds(actions: ActionItem[]): Set<string> {
  return new Set(
    actions
      .filter((action) => OPEN_ACTION_STATUSES.includes(action.status))
      .sort(comparePriority)
      .slice(0, TOP_ACTIONS)
      .map((action) => action.id),
  );
}

type Translator = (key: string, values?: Record<string, string | number>) => string;

/** Entities a count reads naturally with "high-demand" in front. */
const DEMANDED = new Set(['prompts', 'queries', 'pages', 'topics']);
const SUBJECTS = new Set([
  'prompts',
  'pages',
  'queries',
  'topics',
  'platforms',
  'regions',
  'competitors',
  'sources',
]);

/**
 * "Why this priority?": what changed, on what, how recently, and what makes
 * it matter — from the action's own facts, in the reader's language
 * (actionsPage.priority.reason). "Lost ground on 7 high-demand prompts
 * 2 days ago — measured demand High, commercial intent, previously visible."
 */
export function priorityReasonText(reason: PriorityReason, t: Translator): string {
  const { entity, count } = reason.subject;
  const adjective =
    reason.demand === 'high' || reason.demand === 'low' ? t(`reason.demand.${reason.demand}`) : '';
  const inSubject =
    Boolean(adjective) && entity !== null && DEMANDED.has(entity) && count !== null && count > 0;
  const known = entity !== null && SUBJECTS.has(entity) && count !== null && count > 0;
  const what = !reason.change
    ? t('reason.change.none')
    : known
      ? t(`reason.change.${reason.change}`, {
          subject: t(`reason.subject.${entity}`, {
            count,
            demand: inSubject ? `${adjective} ` : '',
          }),
        })
      : t(`reason.alone.${reason.change}`);
  const when =
    reason.change && reason.days !== null
      ? reason.days === 0
        ? t('reason.when.today')
        : t('reason.when.days', { days: reason.days })
      : '';

  const extras: string[] = [];
  if (reason.demand === 'high' && !inSubject) extras.push(t('reason.highDemand'));
  if (reason.realDemand) extras.push(t(`reason.realDemand.${reason.realDemand}`));
  if (reason.commercial) extras.push(t('reason.commercial'));
  if (
    reason.heldBefore &&
    (reason.change === 'lost' || reason.change === 'dropped' || reason.change === 'slipping')
  ) {
    extras.push(t('reason.heldBefore'));
  }
  if (reason.sources >= 2) extras.push(t('reason.sources', { count: reason.sources }));
  // Its kind's track here (learning B4), once it moved the score a point or more.
  const past = reason.pastSuccess;
  if (past && Math.abs(past.points) >= 1) {
    extras.push(
      t(past.points > 0 ? 'reason.pastSuccess.worked' : 'reason.pastSuccess.rarely', {
        improved: past.improved,
        results: past.results,
      }),
    );
  }

  let text = when ? t('reason.sentence.withWhen', { what, when }) : what;
  if (extras.length) {
    text = t('reason.sentence.withExtras', {
      text,
      extras: extras.join(t('reason.sentence.separator')),
    });
  }
  return t('reason.sentence.end', { text });
}

/** "Low confidence — one kind of finding from one source." */
export function priorityConfidenceText(confidence: PriorityConfidence, t: Translator): string {
  return t('reason.confidence.line', {
    level: t(`reason.confidence.${confidence.level}`),
    why:
      confidence.kinds > 0
        ? t('reason.confidence.found', { kinds: confidence.kinds, sources: confidence.sources })
        : t('reason.confidence.sent'),
  });
}
