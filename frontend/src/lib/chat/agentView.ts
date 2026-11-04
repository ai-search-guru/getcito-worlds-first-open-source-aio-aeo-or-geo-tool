import type { TeamRole } from '@/components/context/RoleProvider';
import { ALL_MODELS, ALL_SCRAPERS } from '@/config/promptOptions';
import { parseRecurringRule, type RruleDay } from './agentSchedule';
import type { AgentListView, AgentStatus } from './agentRules';
import type { AgentOutcome, AgentTriggerView } from './agents';

/**
 * Chat › Agents as the browser shows it (CHAT-21 §B, §C; CHAT-27 items
 * 24–25): the tabs, the status dot, what a row offers the person, an
 * agent's triggers in short, times as "Today 09:14", and shares of the
 * monthly AI limit as percents — never dollars. Pure: the pages put the
 * words around it.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An agent's id from its page's address, or null (W2-15's /agents/new is no agent). */
export const agentPageId = (value: string) => (UUID.test(value) ? value : null);

/** The list's tabs, in the mockup's order (§B item 5). */
export const AGENT_TABS: readonly AgentListView[] = ['mine', 'workspace', 'paused', 'archived'];

/** Agent Center's tabs (AGENTS plan §1): Ready to use first, then Your agents (the list above). */
export const AGENT_CENTER_TABS = ['ready', 'yours'] as const;
export type AgentCenterTab = (typeof AGENT_CENTER_TABS)[number];

/** The tab an address names (`?tab=`): Ready to use unless it says Your agents. */
export const agentCenterTabOf = (value: unknown): AgentCenterTab =>
  value === 'yours' ? 'yours' : 'ready';

/** The outcome vocabulary (§I item 43), in the order a summary lists it. */
export const AGENT_OUTCOME_ORDER: readonly AgentOutcome[] = [
  'improved',
  'pending',
  'no_meaningful_change',
  'declined',
  'not_measurable',
];

/** The status dot (§B item 6): Active green, Paused amber, Draft and Archived grey. */
export type AgentDot = 'active' | 'paused' | 'idle';

export function agentDot(status: AgentStatus): AgentDot {
  if (status === 'active') return 'active';
  if (status === 'paused') return 'paused';
  return 'idle';
}

/** Admins and Managers make, run and change agents; Analysts and Agency partners read (§K item 51). */
export const writesAgents = (role: TeamRole) => role === 'admin' || role === 'manager';

/**
 * A share of the monthly AI limit as a percent: 0.032 → "3.2%", 0.1 →
 * "10%", 0.125 → "13%"; above 0 but under 0.05% → "<0.1%". Never a dollar.
 */
export function percentOf(share: number): string {
  if (!Number.isFinite(share) || share <= 0) return '0%';
  const percent = share * 100;
  if (percent < 0.05) return '<0.1%';
  const shown = percent >= 10 ? Math.round(percent) : Math.round(percent * 10) / 10;
  return `${shown.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

/** The thin bar's fill, as a percent of the monthly limit: a sliver for any use at all. */
export function barWidth(share: number): number {
  if (!Number.isFinite(share) || share <= 0) return 0;
  return Math.min(100, Math.max(2, Math.round(share * 1000) / 10));
}

/** What runs used on average: the share over the runs that spent anything. */
export function averageShare(share: number, runs: number): number {
  return runs > 0 ? share / runs : 0;
}

/** The last 30 days' outcomes that happened, in vocabulary order. */
export function outcomeCounts(
  outcomes: Record<AgentOutcome, number>,
): { outcome: AgentOutcome; count: number }[] {
  return AGENT_OUTCOME_ORDER.flatMap((outcome) =>
    outcomes[outcome] > 0 ? [{ outcome, count: outcomes[outcome] }] : [],
  );
}

/** An engine in a scope by its name ("Perplexity"), or its id when it isn't known. */
export function engineName(id: string): string {
  return (
    ALL_SCRAPERS.find((engine) => engine.id === id)?.label ??
    ALL_MODELS.find((model) => model.id === id)?.label ??
    id
  );
}

// ─── Triggers ────────────────────────────────────────────────────────────────

const WEEKDAYS: readonly RruleDay[] = ['MO', 'TU', 'WE', 'TH', 'FR'];

/** A trigger as its parts, for words like "Every Mon 09:00" or "New Recover signal". */
export type TriggerSummary =
  | { kind: 'schedule'; repeat: 'daily' | 'weekdays' | 'days'; days: RruleDay[]; time: string }
  | { kind: 'schedule'; repeat: 'monthly'; monthDay: number; time: string }
  | { kind: 'schedule'; repeat: 'once'; at: string }
  | { kind: 'schedule'; repeat: 'unknown' }
  | { kind: 'signal'; category: string | null; definitions: number }
  | {
      kind: 'kpi';
      kpi: string | null;
      direction: 'up' | 'down' | 'any';
      threshold: number;
      unit: 'absolute' | 'percent';
      period: 'day' | 'week' | 'month';
    }
  | { kind: 'watch_rule' };

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const pick = <T extends string>(value: unknown, known: readonly T[], fallback: T): T =>
  known.find((k) => k === value) ?? fallback;

const clock = (hour: number, minute: number) =>
  `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

/** A trigger's settings, as kept (chat_agent_triggers.config_json), read into its parts. */
export function triggerSummary(trigger: Pick<AgentTriggerView, 'kind' | 'config'>): TriggerSummary {
  const config = record(trigger.config);
  switch (trigger.kind) {
    case 'schedule': {
      if (config.type === 'once' && typeof config.at === 'string') {
        return { kind: 'schedule', repeat: 'once', at: config.at };
      }
      const rule =
        config.type === 'recurring' && typeof config.rrule === 'string'
          ? parseRecurringRule(config.rrule)
          : null;
      if (!rule) return { kind: 'schedule', repeat: 'unknown' };
      const time = clock(rule.hour, rule.minute);
      if (rule.freq === 'MONTHLY') {
        return { kind: 'schedule', repeat: 'monthly', monthDay: rule.byMonthDay ?? 1, time };
      }
      const days = rule.byDay ?? [];
      if (days.length === 0 || days.length === 7) {
        return { kind: 'schedule', repeat: 'daily', days: [], time };
      }
      const weekdays = days.length === 5 && WEEKDAYS.every((d) => days.includes(d));
      return { kind: 'schedule', repeat: weekdays ? 'weekdays' : 'days', days, time };
    }
    case 'signal':
      return {
        kind: 'signal',
        category: typeof config.category === 'string' ? config.category : null,
        definitions: Array.isArray(config.definition_ids) ? config.definition_ids.length : 0,
      };
    case 'kpi':
      return {
        kind: 'kpi',
        kpi: typeof config.kpi === 'string' ? config.kpi : null,
        direction: pick(config.direction, ['up', 'down', 'any'] as const, 'any'),
        threshold: typeof config.threshold === 'number' ? config.threshold : 0,
        unit: pick(config.unit, ['absolute', 'percent'] as const, 'percent'),
        period: pick(config.period, ['day', 'week', 'month'] as const, 'week'),
      };
    case 'watch_rule':
      return { kind: 'watch_rule' };
  }
}

/**
 * A schedule's time zone (its RRULE's clock), so its times are written on
 * that clock: "Every Mon 07:00" fires at 07:00 there. Null for a one-off
 * (an instant) and for other triggers.
 */
export function triggerZone(trigger: Pick<AgentTriggerView, 'kind' | 'config'>): string | null {
  if (trigger.kind !== 'schedule') return null;
  const config = record(trigger.config);
  return config.type === 'recurring' && typeof config.timezone === 'string'
    ? config.timezone
    : null;
}

/**
 * When the agent runs next: the soonest of its switched-on schedules, with
 * the zone it is written in, or `event` when only event triggers (Signal,
 * KPI, watch rule) are on, or `manual` when nothing is on but Run now.
 */
export function nextRunOf(
  triggers: readonly Pick<AgentTriggerView, 'kind' | 'config' | 'enabled' | 'nextFireAt'>[],
): { kind: 'at'; at: string; zone: string | null } | { kind: 'event' } | { kind: 'manual' } {
  const on = triggers.filter((t) => t.enabled);
  const next = on
    .filter((t): t is typeof t & { nextFireAt: string } => !!t.nextFireAt)
    .sort((a, b) => Date.parse(a.nextFireAt) - Date.parse(b.nextFireAt))[0];
  if (next) return { kind: 'at', at: next.nextFireAt, zone: triggerZone(next) };
  if (on.some((t) => t.kind !== 'schedule')) return { kind: 'event' };
  return { kind: 'manual' };
}

// ─── Times ───────────────────────────────────────────────────────────────────

/** An instant as the lists say it: Today, Yesterday, Tomorrow, a weekday within 6 days, else a date. */
export interface WhenParts {
  kind: 'today' | 'yesterday' | 'tomorrow' | 'week' | 'date';
  /** "09:14", 24-hour. */
  time: string;
  /** "Mon". */
  weekday: string;
  /** "Oct 19", with the year when it isn't this one. */
  date: string;
}

/** A calendar day in a zone, as days since 1970 (for counting days apart). */
function dayNumber(at: Date, timeZone?: string): number {
  const [y, m, d] = at
    .toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone })
    .split('-')
    .map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

export function whenParts(iso: string, now: Date, timeZone?: string): WhenParts {
  const at = new Date(iso);
  const apart = dayNumber(at, timeZone) - dayNumber(now, timeZone);
  const sameYear =
    at.toLocaleDateString('en-US', { year: 'numeric', timeZone }) ===
    now.toLocaleDateString('en-US', { year: 'numeric', timeZone });
  return {
    kind:
      apart === 0
        ? 'today'
        : apart === -1
          ? 'yesterday'
          : apart === 1
            ? 'tomorrow'
            : Math.abs(apart) <= 6
              ? 'week'
              : 'date',
    time: at.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }),
    weekday: at.toLocaleDateString('en-US', { weekday: 'short', timeZone }),
    date: at.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(sameYear ? {} : { year: 'numeric' }),
      timeZone,
    }),
  };
}

// ─── Runs ────────────────────────────────────────────────────────────────────

/** A run's state as the list dot shows it (Chat agentic plan §2). */
export type RunDot = 'idle' | 'running' | 'needsYou' | 'done' | 'failed' | 'paused';

export function runDot(status: string): RunDot {
  switch (status) {
    case 'running':
      return 'running';
    case 'needs_you':
      return 'needsYou';
    case 'done':
      return 'done';
    case 'failed':
    case 'stopped':
      return 'failed';
    case 'paused_cap':
      return 'paused';
    default:
      return 'idle';
  }
}

/** The Runs table's filter (mockup `#g-agent`): All · Improved · Pending · Stopped. */
export type RunFilter = 'all' | 'improved' | 'pending' | 'stopped';
export const RUN_FILTERS: readonly RunFilter[] = ['all', 'improved', 'pending', 'stopped'];

export function runMatches(run: { status: string; outcome: string | null }, filter: RunFilter) {
  if (filter === 'all') return true;
  if (filter === 'stopped') return run.status === 'stopped' || run.status === 'failed';
  return run.outcome === filter;
}
