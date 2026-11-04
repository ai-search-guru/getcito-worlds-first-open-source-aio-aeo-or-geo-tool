import { KPI_REGISTRY, type KpiKey } from './registry';

/**
 * The ready-made KPIs a brand opens with when it has none: the answer-engine
 * set plus Positive Sentiment, and AI Referral Traffic only when Google
 * Analytics is mapped (without it the KPI would read 0 forever). Each aims
 * 20% above its last 30 days, the user's chosen first step; a KPI without a
 * value yet starts from the registry's default target.
 */

export const PRESET_KPIS: readonly KpiKey[] = [
  'ai_visibility',
  'mentions',
  'citations',
  'share_of_voice',
  'positive_sentiment',
];

/** The first target is this much above the last 30 days. */
export const PRESET_GROWTH = 1.2;

export function presetKpiKeys(gaConnected: boolean): KpiKey[] {
  return gaConnected ? [...PRESET_KPIS, 'ai_referral_traffic'] : [...PRESET_KPIS];
}

/**
 * The first target for a KPI from its last 30 days: 20% more, rounded up to a
 * whole number for counts, to one decimal (between 0.1 and 100) for percents.
 */
export function presetTarget(key: KpiKey, value: number | null): number {
  const meta = KPI_REGISTRY[key];
  if (value === null || !Number.isFinite(value) || value <= 0) return meta.defaultTarget;
  const raised = value * PRESET_GROWTH;
  // At least 0.1: a sliver of a percent would otherwise round to a 0 target.
  if (meta.unit === 'percent') return Math.min(100, Math.max(0.1, Math.round(raised * 10) / 10));
  return Math.ceil(raised);
}
