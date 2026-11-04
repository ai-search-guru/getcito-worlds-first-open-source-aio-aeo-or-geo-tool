import { NextResponse } from 'next/server';
import { isCloud } from '@/config/plans';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { DEMO_BRAND, DemoBrandError } from '@/lib/subscriptionGuard';

/**
 * The demo brand (00380) on the API key surface: its data is a sample, so
 * the MCP tools and REST routes read it like any brand, and refuse to write,
 * run or spend anything on it, whatever the plan, with the body the web
 * app's writes answer (DEMO_BRAND), which tells the agent the same thing
 * runs on the workspace's own brand once a plan is picked. Demo brands are
 * GetCito Cloud's: self-hosted is never checked.
 */
export { DEMO_BRAND, DemoBrandError };

type Args = Record<string, unknown>;

/** How a tool that writes, runs or spends finds the brand it acts on; null when it names none. */
type BrandOf = (args: Args) => Promise<string | null>;

const idIn = (args: Args, key: string): string | null =>
  typeof args?.[key] === 'string' ? (args[key] as string) : null;

/** One row's column, by id; null when the row isn't there. */
async function columnOf(table: string, id: string | null, column: string): Promise<string | null> {
  if (!id) return null;
  const { data, error } = await supabaseAdmin
    .from(table as never)
    .select(column)
    .eq('id', id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const value = (data as Record<string, unknown> | null)?.[column];
  return typeof value === 'string' ? value : null;
}

const brandOfRow =
  (table: string, key: string): BrandOf =>
  (args) =>
    columnOf(table, idIn(args, key), 'brand_id');

/** A task waiting for review (00293) belongs to its action's brand. */
const brandOfTaskReview: BrandOf = async (args) =>
  columnOf(
    'actions',
    await columnOf('action_task_reviews', idIn(args, 'review_id'), 'action_id'),
    'brand_id',
  );

/**
 * Every MCP tool that writes, runs or spends, and how it finds its brand.
 * Its test fails on a tool missing here, so a new one can't skip the demo
 * brand's refusal.
 */
export const WRITE_TOOL_BRANDS: Record<string, BrandOf> = {
  accept_topic_suggestion: brandOfRow('topic_suggestions', 'suggestion_id'),
  dismiss_topic_suggestion: brandOfRow('topic_suggestions', 'suggestion_id'),
  accept_prompt_suggestion: brandOfRow('prompt_suggestions', 'suggestion_id'),
  dismiss_prompt_suggestion: brandOfRow('prompt_suggestions', 'suggestion_id'),
  generate_content_brief: brandOfRow('content_opportunities', 'opportunity_id'),
  update_opportunity_status: brandOfRow('content_opportunities', 'opportunity_id'),
  run_site_audit: async (args) => idIn(args, 'brand_id'),
  update_task_status: async (args) =>
    columnOf(
      'actions',
      await columnOf('action_tasks', idIn(args, 'task_id'), 'action_id'),
      'brand_id',
    ),
  create_improve_action: async (args) =>
    columnOf(
      'prompt_sets',
      await columnOf('prompts', idIn(args, 'prompt_id'), 'prompt_set_id'),
      'brand_id',
    ),
  override_mention_sentiment: brandOfRow('prompt_results', 'id'),
  create_content_draft: async (args) => idIn(args, 'brand_id'),
  add_content_source: brandOfRow('content_drafts', 'draft_id'),
  suggest_content_changes: brandOfRow('content_drafts', 'draft_id'),
  set_content_draft_ready: brandOfRow('content_drafts', 'draft_id'),
  mark_content_draft_published: brandOfRow('content_drafts', 'draft_id'),
  approve_task_review: brandOfTaskReview,
  dismiss_task_review: brandOfTaskReview,
};

/**
 * Whether a brand of the organization is its demo brand. Another
 * organization's brand reads as not: the call itself then answers it as
 * missing, as it always has.
 */
export async function isDemoBrandOf(
  organizationId: string | null,
  brandId: string | null,
): Promise<boolean> {
  if (!isCloud() || !organizationId || !brandId) return false;
  const { data, error } = await supabaseAdmin
    .from('brands')
    .select('is_demo')
    .eq('id', brandId)
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.is_demo === true;
}

/**
 * Refuse a costly call on the demo brand (a brief, a Site Audit, an Improve
 * action), whoever calls it: an MCP tool, a REST route or the in-product
 * agent, as assertSubscriptionActive refuses it while read-only.
 */
export async function assertNotDemoBrand(
  organizationId: string | null,
  brandId: string | null,
): Promise<void> {
  if (await isDemoBrandOf(organizationId, brandId)) throw new DemoBrandError();
}

/** Whether a tool's call acts on the organization's demo brand. */
export async function callOnDemoBrand(
  name: string,
  organizationId: string | null,
  args: unknown,
): Promise<boolean> {
  const brandOf = WRITE_TOOL_BRANDS[name];
  if (!brandOf || !isCloud() || !organizationId) return false;
  return isDemoBrandOf(organizationId, await brandOf((args ?? {}) as Args));
}

/** A tool's answer to a call on the demo brand: a tool error carrying the same body. */
export function demoBrandToolResult() {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(DEMO_BRAND, null, 2) }],
    isError: true,
  };
}

/**
 * A REST mirror's answer to a write on the demo brand: 402 with the body the
 * tool answers, or null when the call may go on. `tool` and `args` are the
 * mirrored tool's, so the route finds the brand as the tool does. A brand
 * that can't be read refuses too (500): the write never runs unchecked.
 * Every REST route that writes, runs or spends calls this, or a data
 * function that refuses the demo brand itself (demoGate.test.ts).
 */
export async function demoBrandRefusal(
  tool: keyof typeof WRITE_TOOL_BRANDS,
  organizationId: string | null,
  args: Args,
): Promise<NextResponse | null> {
  try {
    if (!(await callOnDemoBrand(tool, organizationId, args))) return null;
    return NextResponse.json(DEMO_BRAND, { status: 402 });
  } catch (err) {
    console.error('[mcp] demo brand check failed:', err);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
