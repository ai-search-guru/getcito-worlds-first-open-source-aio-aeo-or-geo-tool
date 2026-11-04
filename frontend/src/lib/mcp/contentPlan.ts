import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import { mayUseBrand } from '@/lib/mcp/data';
import { contentEditorPath } from '@/lib/content/drafts';
import { siteTypeOf } from '@/lib/content/pageTypes';
import {
  buildPlan,
  rowsFor,
  type PlanCard,
  type PlanPeriod,
  type PlanRow,
  type PlanScorePart,
  type PlanWhy,
} from '@/lib/content/plan';
import { readContentPlan } from '@/lib/content/planRead';

/**
 * The Content plan (CE-014) for the MCP tool get_content_plan and its REST
 * mirror: the brand's pages and opportunities ranked by the Priority Score,
 * as the Content plan page ranks them (buildPlan), from the same reads
 * (readContentPlan) through the service role, once the brand is the key's.
 */

export interface McpPlanRow {
  /** The row's key: `opportunity:<id>` or the page's address. */
  key: string;
  /** create (a new page), optimize (a page losing citations or an opportunity on it) or protect (a top page). */
  action: PlanRow['action'];
  title: string;
  /** The page it works on; null for a new page. */
  page: string | null;
  page_type: string | null;
  /** Why it's on the plan. */
  why: Record<string, unknown>;
  /** The Priority Score, 0–100, and what it's made of. */
  score: number;
  score_parts: Record<string, unknown>[];
  opportunity_id: string | null;
  /** The draft already being written for it, if any. */
  draft: {
    id: string;
    author: 'user' | 'agent';
    method: string;
    assignee: { id: string; name: string } | null;
    editor_path: string;
  } | null;
  /** Marked as a priority: at the top, as on the page. */
  priority: boolean;
}

export interface McpContentPlan {
  days: PlanPeriod;
  /** How many rows each card holds (create, optimize, protect, priority). */
  counts: Record<PlanCard, number>;
  /** Rows hidden from the plan by a person. */
  hidden: number;
  /** When the brand's tracking began, and where the earlier period starts. */
  tracked_since: string | null;
  previous_from: string | null;
  rows: McpPlanRow[];
}

/** camelCase keys as the MCP's snake_case, one level deep. */
function snake(value: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, v]) => [
      key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`),
      v,
    ]),
  );
}

function mcpPlanRow(row: PlanRow): McpPlanRow {
  return {
    key: row.key,
    action: row.action,
    title: row.title,
    page: row.page,
    page_type: row.pageType,
    why: snake(row.why as PlanWhy),
    score: row.score,
    score_parts: row.scoreParts.map((part: PlanScorePart) => snake(part)),
    opportunity_id: row.opportunityId,
    draft: row.draft
      ? {
          id: row.draft.id,
          author: row.draft.author,
          method: row.draft.method,
          assignee: row.draft.assignee,
          editor_path: contentEditorPath(row.draft.id),
        }
      : null,
    priority: row.priority,
  };
}

/**
 * The brand's Content plan over `days` (7, 30 or 90), its rows ranked as the
 * page shows them: the first 50 of a card, or of every row without one.
 * Null for a brand outside the key's organization, or one its owner may not use.
 */
export async function getContentPlanFor(
  auth: McpAuthContext,
  params: { brandId: string; days: PlanPeriod; card?: PlanCard },
): Promise<McpContentPlan | null> {
  if (!auth.organizationId) return null;
  const { data: brand, error } = await supabaseAdmin
    .from('brands')
    .select('id, site_type, industry, shopping_mode_enabled')
    .eq('id', params.brandId)
    .eq('organization_id', auth.organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!brand || !(await mayUseBrand(auth, brand.id))) return null;

  const read = await readContentPlan(
    supabaseAdmin,
    params.brandId,
    params.days,
    Promise.resolve(auth.userId),
  );
  if (!read) return null;
  const plan = buildPlan({
    ...read,
    siteType: siteTypeOf({
      siteType: brand.site_type as string | null,
      industry: brand.industry as string | null,
      shoppingModeEnabled: brand.shopping_mode_enabled === true,
    }),
  });
  return {
    days: params.days,
    counts: plan.counts,
    hidden: plan.hidden.length,
    tracked_since: read.tracking.trackedSince,
    previous_from: read.tracking.prevFrom,
    rows: rowsFor(plan.rows, params.card ?? null).map(mcpPlanRow),
  };
}
