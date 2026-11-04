import type { McpAuthContext } from '@/lib/mcpAuth';
import { getTrackingWindow } from '@/lib/actions/tracking';
import { getVisibilitySummaryFor } from './data';
import { asService } from './chatFacts';

/**
 * Chat's overview read (CHAT-20 §9 row 11): the brand's headline numbers
 * (Brand Visibility's, as the visibility summary reads them) with when its
 * tracking last ran and runs next. `data_as_of` is the last completed run
 * (§15a). Null for a brand outside the organization.
 */
export async function getOverviewSummaryFor(
  auth: McpAuthContext,
  params: { brandId: string; dateFrom?: string; dateTo?: string; model?: string },
) {
  const summary = await getVisibilitySummaryFor(auth, params);
  if (!summary) return null;
  const window = await asService(() => getTrackingWindow(params.brandId));
  return {
    ...summary,
    last_run_at: window.lastRunAt ?? null,
    next_run_at: window.nextRunAt ?? null,
    data_as_of: window.lastRunAt ?? null,
  };
}
