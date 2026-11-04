import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import {
  parseScorecardRow,
  sortScorecard,
  successRate,
  topDismissReason,
  type ScorecardRow,
} from '@/lib/action-center/scorecard';
import type { ActionDismissReason } from '@/lib/action-center/registry';
import { brandAllowed } from './data';

/**
 * What worked at a brand, by kind of action (learning B3), for the MCP tool
 * get_action_scorecard and its REST mirror: the History tab's scorecard.
 */

/** One kind of action at the brand, as the History tab's scorecard reads it. */
export interface McpScorecardRow {
  kind: string;
  completed: number;
  improved: number;
  mixed: number;
  no_change: number;
  declined: number;
  not_measurable: number;
  /** Completed, not read yet. */
  pending: number;
  /** Completed and read for the last time, a month after it closed. */
  final: number;
  /** improved ÷ the results with a verdict, 0–100; null below three verdicts. */
  success_rate: number | null;
  /** The median change in each one's main metric, in percent (15 is +15%). */
  median_change_percent: number | null;
  dismissed: number;
  /** Dismissals by the reason given; `none` when none was. */
  dismiss_reasons: Partial<Record<ActionDismissReason | 'none', number>>;
  /** The reason given most often for dismissing this kind. */
  top_dismiss_reason: ActionDismissReason | null;
}

function mcpScorecardRow(row: ScorecardRow): McpScorecardRow {
  return {
    kind: row.kind,
    completed: row.completed,
    improved: row.improved,
    mixed: row.mixed,
    no_change: row.noChange,
    declined: row.declined,
    not_measurable: row.notMeasurable,
    pending: row.pending,
    final: row.final,
    success_rate: successRate(row),
    median_change_percent:
      row.medianChange == null ? null : Math.round(row.medianChange * 1000) / 10,
    dismissed: row.dismissed,
    dismiss_reasons: row.dismissReasons,
    top_dismiss_reason: topDismissReason(row),
  };
}

/**
 * The brand's actions raised since `since` (every one without it), summed
 * by kind in the database (action_scorecard, 00368), busiest kinds first.
 * Null for a brand outside the key's organization.
 */
export async function getActionScorecardFor(
  auth: McpAuthContext,
  params: { brandId: string; since?: string },
): Promise<McpScorecardRow[] | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  const { data, error } = await supabaseAdmin.rpc('action_scorecard', {
    p_brand_id: params.brandId,
    p_since: params.since ? new Date(params.since).toISOString() : null,
  });
  if (error) throw new Error(error.message);
  return sortScorecard(
    ((data ?? []) as unknown[])
      .map(parseScorecardRow)
      .filter((row): row is ScorecardRow => row !== null),
  ).map(mcpScorecardRow);
}
