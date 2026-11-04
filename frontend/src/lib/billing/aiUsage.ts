import { USAGE_WARNING_RATIO, type UsageTone } from '@/lib/contentUsage';

/**
 * The Billing page's "This period's AI usage" meter: how much of the
 * workspace's monthly AI allowance (the plan's AI usage, one budget that
 * Improve suggestions, the Content Editor's AI, the Action Center's task
 * writer and the Content Editor's Quality checks all draw on) is used, by
 * feature, and when it renews. The figures
 * come from GET /api/billing/ai-usage, as shares of the allowance; this
 * only decides how they read.
 */

/**
 * The meter's rows, in order: Chat's (00405) only with Chat on for the
 * workspace, its agents, scheduled runs and images as they come.
 */
export const AI_USAGE_FEATURES = [
  'improve',
  'content',
  'action_center',
  'chat',
  'agent',
  'schedule',
  'image',
  'other',
] as const;
export type AiUsageFeature = (typeof AI_USAGE_FEATURES)[number];

export interface AiUsage {
  plan: string;
  planName: string | null;
  /** The free trial's smaller allowance: more comes with starting the plan. */
  trial?: boolean;
  periodStart: string | null;
  periodEnd: string | null;
  /** No allowance to meter (self-hosted, or a plan without one). */
  unlimited: boolean;
  /** Share of the allowance used, 0–100, to a tenth; null when unlimited. */
  percentUsed: number | null;
  /**
   * Each feature's share of the allowance, listed only when it used some (the
   * Content Editor's quality checks in its row): one under a twentieth of a
   * percent comes as 0, read with featurePercentLabel.
   */
  features: { feature: AiUsageFeature; percent: number }[];
  /**
   * Chat draws on the allowance too (CHAT_AGENTIC on for the workspace;
   * missing from an older API: off). Off, it runs on the workspace's own key.
   */
  chatMetered?: boolean;
  /**
   * Purchased AI credits are left (CHAT-18 §F, with Chat on): AI calls go on
   * running on them past 100% of the allowance. Missing: none.
   */
  creditsLeft?: boolean;
  /**
   * What work a page asks about before it runs typically takes, as shares of
   * the allowance to a tenth (customer priorities item 9): Write this's brief
   * and page, and a draft's AI checks for its Site Audit estimate. Missing
   * from an older API: the page says nothing of it.
   */
  estimates?: {
    writeThis?: number;
    auditAiChecks?: number;
    /** The Content Editor's agent runs, for the Next step window (the user, 2026-11-03). */
    editorBrief?: number;
    editorFix?: number;
    editorRewrite?: number;
    editorWrite?: number;
  };
}

/** A count against its plan's limit this period. */
export interface UsageCount {
  used: number;
  limit: number;
}

/**
 * The limits that aren't AI, beside the header meter (AI usage spec §2):
 * each null when the plan has no cap or it couldn't be read.
 */
export interface UsageLimits {
  auditPages: UsageCount | null;
  promptLocations: UsageCount | null;
}

/**
 * A share as it is now, to the tenth the server sends ("1.1%", "28.3%",
 * "99.9%"; "28%" when whole), so each run shows; a sliver under a tenth
 * as "<0.1%". Rounded down, so nothing reads as all of it before it is
 * (the server sends 100 only once the allowance is spent).
 */
export function percentLabel(percent: number): string {
  if (percent > 0 && percent < 0.1) return '<0.1%';
  // The tiny nudge keeps a tenth the server sent (2.3 × 10) from flooring below it.
  return `${Math.floor(percent * 10 + 1e-9) / 10}%`;
}

/**
 * A feature's share in the list of what used the allowance: the server lists
 * only features that used some, so one it rounds to 0 reads as "<0.1%", not
 * as unused.
 */
export function featurePercentLabel(percent: number): string {
  return percent > 0 ? percentLabel(percent) : '<0.1%';
}

/**
 * The usage as the API answers it, read the same from an API older than
 * the web: that one lists every feature, unused ones at 0, and the quality
 * checks in a row of their own. Those fold into the Content Editor's row
 * and the unused rows drop, so none reads as "<0.1%" and a workspace that
 * used nothing reads as such. Drop it once every API answers the new way.
 */
export function aiUsageFromApi(raw: AiUsage): AiUsage {
  const rows = raw?.features as { feature: string; percent: number }[] | undefined;
  if (!Array.isArray(rows) || !rows.some((f) => f.feature === 'quality')) return raw;
  const by = new Map<string, number>();
  for (const { feature, percent } of rows) {
    const key = feature === 'quality' ? 'content' : feature;
    by.set(key, (by.get(key) ?? 0) + percent);
  }
  return {
    ...raw,
    features: AI_USAGE_FEATURES.flatMap((feature) => {
      const percent = Math.round((by.get(feature) ?? 0) * 10) / 10;
      return percent > 0 ? [{ feature, percent }] : [];
    }),
  };
}

/**
 * Warning from 80% of the allowance, used up at 100%, unless purchased AI
 * credits are left: the calls run on them then, so it stays a warning.
 */
export function aiUsageTone(usage: AiUsage): UsageTone {
  if (usage.unlimited || usage.percentUsed === null) return 'unlimited';
  if (usage.percentUsed >= 100) return usage.creditsLeft ? 'warning' : 'exhausted';
  return usage.percentUsed >= USAGE_WARNING_RATIO * 100 ? 'warning' : 'normal';
}

/** Where a browser keeps the last AI usage toast it showed: "{periodStart}:{plan}", ":trial" in the free trial. */
export const AI_USAGE_TOAST_KEY = 'aeo:ai-usage-toast';

/**
 * The mark a toast leaves: the period and the plan it warned about, and the
 * free trial's apart, so a plan started within the trial's period warns again.
 */
export const aiUsageToastMark = (usage: AiUsage) =>
  `${usage.periodStart}:${usage.plan}${usage.trial ? ':trial' : ''}`;

/**
 * Whether a read calls for the toast (AI usage spec §4), given the mark of the
 * last one this browser showed: once a period on reaching 80%. A new period,
 * or a plan changed within it, starts over; a used-up allowance has its red
 * banner instead.
 */
export function aiUsageToastDue(usage: AiUsage, shown: string | null): boolean {
  return aiUsageTone(usage) === 'warning' && shown !== aiUsageToastMark(usage);
}
