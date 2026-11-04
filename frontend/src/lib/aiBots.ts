/**
 * The AI bots source card's state (AT-010), kept apart from the card so it is
 * tested on its own.
 */

import type { BotConnection, BotConnections, BotUsage } from '@/lib/actions/aiBots';
import type { TrafficBots } from '@/lib/actions/traffic';
import { isNoPlan } from '@/lib/billing/noPlan';
import { PLANS, type PlanId } from '@/config/plans';

/**
 * locked — the plan has no bot report (Starter: Upgrade); without an active
 *   plan, the plan it was on decides (reportLocked);
 * off — nothing connected yet;
 * waiting — connected, no request has arrived yet;
 * on — requests arrive.
 */
export type BotsCardState = 'locked' | 'off' | 'waiting' | 'on';

/** The newest request any connection sent, or null. */
export function lastBotEvent(connections: BotConnection[]): string | null {
  return connections.reduce<string | null>(
    (latest, c) => (c.lastEventAt && (!latest || c.lastEventAt > latest) ? c.lastEventAt : latest),
    null,
  );
}

/**
 * Read-only once the plan has ended: the workspace is locked (`isLocked`,
 * useUpgradeGate) and the plan it was on (`planId`, usePlanContext).
 */
export interface BotPlan {
  isLocked?: boolean;
  planId?: PlanId;
}

/**
 * The report is locked on a plan without it (cap 0). Without an active plan
 * (isNoPlan) the caps read 0 whatever the plan was, so the plan it was on
 * decides: one without the report (Starter) keeps its Upgrade; one with it
 * shows its connections and stored data, and connecting opens the plan dialog.
 */
function reportLocked(usage: BotUsage, { isLocked = false, planId }: BotPlan): boolean {
  if (isNoPlan(usage, isLocked)) {
    return planId !== undefined && PLANS[planId]?.limits.maxBotEventsPerMonth === 0;
  }
  return usage.cap === 0;
}

export function botsCardState(
  { connections, usage }: BotConnections,
  plan: BotPlan = {},
): BotsCardState {
  if (reportLocked(usage, plan)) return 'locked';
  if (connections.length === 0) return 'off';
  return lastBotEvent(connections) ? 'on' : 'waiting';
}

/** The first day of the month after `month` ("2026-10-01" → "2026-11-01"); null if malformed. */
function nextMonth(month: string): string | null {
  if (!/^\d{4}-\d{2}-01$/.test(month)) return null;
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

/**
 * The day detailed rows start again when this month's cap was reached
 * ("Detailed rows paused until Nov 1, totals still counted", spec §6.3);
 * null while under the cap.
 */
export function rowsPausedUntil(usage: BotUsage): string | null {
  if (!usage.cappedAt || usage.cap <= 0) return null;
  return nextMonth(usage.month);
}

/** Connections that send log files, counted against the raw cap (a Worker's batches aren't). */
export function hasLogSender({ connections }: BotConnections): boolean {
  return connections.some((c) => c.kind !== 'cloudflare_worker');
}

/**
 * The day log files are read again when this month's raw cap was reached
 * (§6.3). Past it a Logpush job's or a Vercel drain's files are only
 * counted: no rows and no totals, so the report stops until then. Null
 * while under the cap, or without a log sender.
 *
 * Read against today's plan, as the server decides (raw < cap), not from
 * rawCappedAt: 00184 sets that once a month and never clears it, so a raised
 * plan reads files again under it, and a lowered one stops without it.
 */
export function logsPausedUntil(info: BotConnections): string | null {
  const { usage } = info;
  if (usage.rawCap <= 0 || usage.raw < usage.rawCap || !hasLogSender(info)) return null;
  return nextMonth(usage.month);
}

/**
 * What the bot report section shows (AT-011, spec §3.7): locked with sample
 * data and Upgrade (Starter); sample data under Connect while nothing is
 * connected; waiting for the first request; or the brand's own data.
 */
export type BotReportState = 'locked' | 'off' | 'waiting' | 'data';

export function botReportState(
  info: BotConnections,
  report: TrafficBots | null,
  plan: BotPlan = {},
): BotReportState {
  if (reportLocked(info.usage, plan)) return 'locked';
  // Bots counted before a connection was revoked still show.
  if (report?.lastSeen) return 'data';
  return info.connections.length === 0 ? 'off' : 'waiting';
}

/**
 * The sample the locked and unconnected report shows: the mockup's numbers
 * (spec §3.7), last seen 2 hours, 40 minutes and 5 minutes before `now`.
 */
export function sampleBotTypes(now = Date.now()): TrafficBots['types'] {
  const ago = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  return [
    { type: 'training', hits: 8420, pages: 612, lastSeen: ago(120), bots: ['gptbot', 'claudebot'] },
    {
      type: 'search',
      hits: 3115,
      pages: 488,
      lastSeen: ago(40),
      bots: ['oai-searchbot', 'perplexitybot'],
    },
    {
      type: 'user',
      hits: 1302,
      pages: 214,
      lastSeen: ago(5),
      bots: ['chatgpt-user', 'claude-user'],
    },
  ];
}
