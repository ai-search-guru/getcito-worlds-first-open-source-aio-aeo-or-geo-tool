/**
 * The shapes the History tab reads, and the honest state of each one.
 *
 * History answers a narrower question than the Actions tab: not "what should
 * we do", but "what did we do, and did it work". The second half of that has
 * two parts, and only one of them exists yet.
 *
 * What the product already knows, and this tab shows from real rows: which
 * action ran, what kind it was, what it touched, which signals opened it,
 * what its goal was, which tasks were carried out, who it was assigned to,
 * when it closed and how long that took.
 *
 * What nothing yet measures: the result. An action's `baseline` captures the
 * triggering signals' values at the moment it was created, so the "before"
 * half is recorded — but no pass re-reads those metrics afterwards, so there
 * is no "after" to compare it to. Visibility change, citations change, prompts
 * improved: none of them have a source.
 *
 * So `results` comes back empty and `outcome` reads `pending_measurement`
 * rather than a number, and the UI says so plainly instead of implying a
 * measurement that did not happen. The types below are the full shape the
 * validation pass (#818, phase 2) will fill in; adding it is a matter of
 * populating these, not reshaping them.
 */

import type {
  ActionCategory,
  ActionDismissReason,
  ActionOutcome,
  ActionStatus,
  TaskStatus,
} from './registry';
import { highestPriorityLevel, type PriorityLevel } from './priority';
import type { SignalSource } from '@/lib/signals/registry';
import type { ImproveOutcome } from '@/lib/improveOutcome';

/** A metric an action moved, read before and after it ran. */
export interface ActionResultMetric {
  id: string;
  label: string;
  metric:
    | 'visibility'
    | 'citations'
    | 'mentions'
    | 'traffic'
    | 'share_of_voice'
    | 'prompts_improved'
    | 'custom';
  before?: number;
  after?: number;
  delta?: number;
  deltaPercent?: number;
  unit: 'percent' | 'number' | 'sessions' | 'citations' | 'mentions' | 'prompts';
  direction: 'higher_is_better' | 'lower_is_better';
}

/** Something an action touched. Deliberately generic — an action's subject is
 *  prompts for one kind and pages for another, and the column shows whichever
 *  the payload actually carries. */
export interface AffectedEntity {
  id: string;
  type: 'prompt' | 'url' | 'keyword' | 'topic' | 'citation' | 'competitor' | 'platform';
  /** Either a named entity, or a bare count when the payload holds only a number. */
  name: string;
  count?: number;
  url?: string;
  platform?: string;
  beforeValue?: string | number;
  afterValue?: string | number;
}

/** A task as it stood when the action closed. */
export interface ActionHistoryTask {
  id: string;
  /** Resolved text: the user's title when they wrote one, else the template. */
  title: string;
  status: TaskStatus;
  completedAt?: string;
}

/**
 * The day after closing an action's final reading is taken on (learning
 * B1): the API's validation.finalReadingDay (server config/actionEngine.js).
 */
export const FINAL_READING_DAY = 30;

/** One reading of an action's effect: the day after closing, and its verdict. */
export interface OutcomeReading {
  day: number;
  outcome: ActionOutcome;
}

/** An action's change net of a control basket's (learning B2). */
export interface ControlNet {
  basis: 'topics' | 'brand';
  prompts: number;
  net: { metric: string; net: number; unit: 'points' | 'percent' }[];
}

/**
 * Its change net of the control basket, as the validation sweep keeps it
 * (`validation.control`), the metrics it can name; null when it has none.
 */
export function controlNetOf(
  validation: {
    control?: {
      basis?: string;
      prompts?: number;
      net?: { metric?: string; net?: number; unit?: string }[];
    };
  } | null,
): ControlNet | null {
  const control = validation?.control;
  if (!control || !Array.isArray(control.net)) return null;
  const net = control.net.flatMap((m) =>
    typeof m?.metric === 'string' &&
    typeof m.net === 'number' &&
    Number.isFinite(m.net) &&
    (m.unit === 'points' || m.unit === 'percent')
      ? [{ metric: m.metric, net: m.net, unit: m.unit as 'points' | 'percent' }]
      : [],
  );
  if (!net.length || !Number.isInteger(control.prompts)) return null;
  return {
    basis: control.basis === 'topics' ? 'topics' : 'brand',
    prompts: control.prompts as number,
    net,
  };
}

/** A signal that opened the action. Several signals consolidate into one
 *  action, so this is a list rather than a field. */
export interface TriggerSignal {
  signalId: string;
  kind: string;
  detectedAt: string;
}

/**
 * What became of the signals that raised an action, when it was measured
 * (learning A3): ended (the condition gone), replaced (still there as
 * another kind), dismissed by a person, or still open.
 */
export interface SignalOutcome {
  total: number;
  ended: number;
  replaced: number;
  dismissed: number;
  open: number;
}

export interface ActionHistoryItem {
  id: string;
  actionNo: number;
  kind: string;
  /** Grow / Recover / Protect / Fix / Compete — the module's one classification. */
  type: ActionCategory;
  /**
   * The priority score and level (AC-006). An open action's are from last
   * night's scoring; a closed one keeps the last it had. Null if never scored.
   */
  priorityScore: number | null;
  priorityLevel: PriorityLevel | null;
  status: ActionStatus;
  /** Did it help? Read from the action's own column, not inferred here. */
  outcome: ActionOutcome;
  payload: Record<string, unknown>;
  kpiKeys: string[];
  sources: SignalSource[];
  triggerSignals: TriggerSignal[];
  affected: AffectedEntity[];
  /** Empty until something measures an action's effect. */
  results: ActionResultMetric[];
  /**
   * Its readings a week, two weeks and a month after it closed (learning
   * B1), and whether the last, final one is in. Empty before the first.
   */
  readings?: OutcomeReading[];
  outcomeFinal?: boolean;
  /** Why it was dismissed, when someone said (learning A5). */
  dismissReason?: ActionDismissReason | null;
  /** Its signals when it was measured; absent before, or with no signal behind it. */
  signalsAfter?: SignalOutcome | null;
  /**
   * The prompts or pages it named, when it was measured on them (learning
   * A1), with the brand-wide figures kept as a second line.
   */
  measuredOn?: { entity: 'prompts' | 'pages'; count: number } | null;
  /**
   * Nights tracking missed in its before and after windows (learning A6);
   * `tooMany` when past the limit, the result then not measurable.
   */
  dataGaps?: { before: number; after: number; tooMany: boolean } | null;
  /** The metric its result is judged by (learning A4); absent before it was measured. */
  primaryMetric?: string | null;
  /** A Site Audit fix's pages audited again since it closed, and how many pass (learning A2). */
  auditAfter?: { pages: number; audited: number; passed: number } | null;
  brandWideResults?: ActionResultMetric[];
  /**
   * Its change net of the brand's prompts it didn't touch over the same
   * days (learning B2): a rate in points, a count in percent. `basis` says
   * whether they share its topics or are the brand's others.
   */
  controlNet?: ControlNet | null;
  /** Improve actions only: positions per platform against the baseline (PROMPT-008). */
  positionOutcome: ImproveOutcome | null;
  tasks: ActionHistoryTask[];
  assignee: { id: string; fullName: string | null; avatarUrl: string | null } | null;
  /** `YYYY-MM-DD`; the Goal's date when set (AC-003). */
  dueDate: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Calendar days from creation to close. Real — both stamps are recorded. */
  timeToCloseDays: number | null;
}

export interface HistorySummary {
  totalActions: number;
  completed: number;
  completedPercent: number;
  inProgress: number;
  inProgressPercent: number;
  noImprovement: number;
  noImprovementPercent: number;
  dismissed: number;
  dismissedPercent: number;
  /** Highest priority among the actions in range — a readout of what was
   *  worked on, not a claim about what it achieved. That claim needs validation. */
  topPriority: PriorityLevel | null;
}

/** Statuses History covers: an action that has run its course, plus the ones
 *  still running so the tab shows the whole arc rather than only its end. */
export const HISTORY_STATUSES: readonly ActionStatus[] = [
  'in_progress',
  'on_hold',
  'completed',
  'dismissed',
];

export const HISTORY_SORTS = ['newest', 'oldest', 'priority'] as const;
export type HistorySort = (typeof HISTORY_SORTS)[number];

export const HISTORY_PAGE_SIZE = 10;

/** The order the History list shows for a sort, by the date each row shows. */
export function compareHistory(sort: HistorySort) {
  return (a: ActionHistoryItem, b: ActionHistoryItem): number => {
    const aDate = a.completedAt ?? a.createdAt;
    const bDate = b.completedAt ?? b.createdAt;
    switch (sort) {
      case 'oldest':
        return aDate.localeCompare(bDate);
      case 'priority':
        // Highest score first; never-scored actions last.
        return (b.priorityScore ?? -1) - (a.priorityScore ?? -1) || bDate.localeCompare(aDate);
      default:
        return bDate.localeCompare(aDate);
    }
  };
}

const pct = (part: number, total: number) => (total === 0 ? 0 : Math.round((part / total) * 100));

export function summarize(items: ActionHistoryItem[]): HistorySummary {
  const total = items.length;
  const count = (status: ActionStatus) => items.filter((i) => i.status === status).length;
  const completed = count('completed');
  const inProgress = count('in_progress');
  // An outcome, not a status: an action reaches it by being completed and
  // then measured, so it is counted from the outcome column.
  const noImprovement = items.filter((i) => i.outcome === 'no_meaningful_change').length;
  const dismissed = count('dismissed');

  return {
    totalActions: total,
    completed,
    completedPercent: pct(completed, total),
    inProgress,
    inProgressPercent: pct(inProgress, total),
    noImprovement,
    noImprovementPercent: pct(noImprovement, total),
    dismissed,
    dismissedPercent: pct(dismissed, total),
    topPriority: highestPriorityLevel(items.map((i) => i.priorityLevel)),
  };
}

/** Whole days between two stamps, floored — "4 days" means four elapsed. */
export function daysBetween(fromIso: string, toIso: string): number {
  const ms = new Date(toIso).getTime() - new Date(fromIso).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
