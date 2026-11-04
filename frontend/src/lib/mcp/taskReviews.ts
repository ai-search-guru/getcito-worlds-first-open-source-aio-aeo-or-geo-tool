import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/admin';
import type { McpAuthContext } from '@/lib/mcpAuth';
import {
  TASK_CHECKS,
  TASK_DETAIL_LIMITS,
  cleanTaskDetailsEdit,
  parseTaskDetails,
  type TaskDetailsEdit,
} from '@/lib/action-center/taskDetails';
import { brandAllowed, mayUseBrand, mcpTaskDetails } from './data';
import { requireManager } from './roleGate';

/**
 * Tasks waiting for review (AC-010, 00293) for the MCP tools
 * list_task_reviews, approve_task_review and dismiss_task_review and their
 * REST mirrors: tasks an agent wrote without the exact page, the change, Done
 * when or how it is checked. An admin or a manager fills what they miss and
 * approves them onto their action's list, or dismisses them, as on the
 * Action Center's Needs review tab. The key's user must be one
 * (requireManager): everyone else reads and changes none, as the table's RLS
 * has it.
 *
 * On a demo brand (00380) the tools and their REST mirrors refuse both
 * (WRITE_TOOL_BRANDS, demoBrandRefusal in lib/mcp/demoGate.ts) before
 * anything is written: these write as the service role, which the demo
 * trigger (00381) lets through.
 */

/** A field a task waiting for review was written without, as the MCP names it. */
export type McpReviewField = 'url' | 'change' | 'done_when' | 'check';

const FIELD_NAMES: Record<string, McpReviewField> = {
  url: 'url',
  change: 'change',
  doneWhen: 'done_when',
  check: 'check',
};

export interface McpTaskReview {
  id: string;
  action_id: string;
  action_no: number | null;
  title: string;
  /** What it was written without: fill these to approve it. */
  missing: McpReviewField[];
  /** The task as it was written, in get_action's task shape. */
  details: ReturnType<typeof mcpTaskDetails>;
  /** Who wrote it: the AI task writer or an agent. */
  source: string;
  created_at: string;
}

export type TaskReviewError = {
  error: 'forbidden' | 'missing' | 'closed' | 'incomplete';
  message: string;
};

/** The REST status for each refusal. */
export const TASK_REVIEW_ERROR_STATUS: Record<TaskReviewError['error'], number> = {
  forbidden: 403,
  missing: 404,
  closed: 409,
  incomplete: 422,
};

const FORBIDDEN: TaskReviewError = {
  error: 'forbidden',
  message: "Only an admin or a manager of the brand's organization reviews tasks",
};
const MISSING: TaskReviewError = {
  error: 'missing',
  message: 'Task review not found: approved or dismissed already, or not in this organization',
};

/**
 * A review of a brand of the key's organization that its owner may use, with
 * what is stored for it; null when there is none.
 */
async function ownedReview(auth: McpAuthContext, reviewId: string) {
  if (!auth.organizationId) return null;
  const { data, error } = await supabaseAdmin
    .from('action_task_reviews')
    .select('id, action_id, title, details, actions!inner(brand_id, brands!inner(organization_id))')
    .eq('id', reviewId)
    .eq('actions.brands.organization_id', auth.organizationId as string)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const review = data as {
    id: string;
    action_id: string;
    title: string;
    details: unknown;
    actions: { brand_id?: string } | null;
  } | null;
  return review && (await mayUseBrand(auth, review.actions?.brand_id)) ? review : null;
}

const LIST_DEFAULT = 50;
const LIST_MAX = 200;

/**
 * The brand's tasks waiting for review, the oldest first; none of an action
 * that is deleted or closed, which can't take them. Null for a brand outside
 * the key's organization. Throws RoleRequiredError for anyone but an admin
 * or a manager.
 */
export async function listTaskReviewsFor(
  auth: McpAuthContext,
  params: { brandId: string; limit?: number },
): Promise<McpTaskReview[] | null> {
  if (!(await brandAllowed(auth, params.brandId))) return null;
  requireManager(auth);

  const limit = Math.min(Math.max(params.limit ?? LIST_DEFAULT, 1), LIST_MAX);
  const { data, error } = await supabaseAdmin
    .from('action_task_reviews')
    .select(
      'id, action_id, title, details, missing, source, created_at, actions!inner(action_no, brand_id, status, deleted_at)',
    )
    .eq('actions.brand_id', params.brandId)
    .is('actions.deleted_at', null)
    .not('actions.status', 'in', '(completed,dismissed)')
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => {
    const action = (Array.isArray(row.actions) ? row.actions[0] : row.actions) as {
      action_no: number | null;
    } | null;
    return {
      id: row.id as string,
      action_id: row.action_id as string,
      action_no: action?.action_no ?? null,
      title: row.title as string,
      missing: ((row.missing ?? []) as string[])
        .map((field) => FIELD_NAMES[field])
        .filter((field): field is McpReviewField => field !== undefined),
      details: mcpTaskDetails(row.details),
      source: row.source as string,
      created_at: row.created_at as string,
    };
  });
}

/**
 * What approve_task_review takes, shared by the MCP tool and its REST mirror:
 * the fields to fill or change; the rest stays as written.
 */
export const taskReviewEditShape = {
  title: z.string().trim().min(1).max(200).optional().describe('The task title.'),
  url: z
    .string()
    .max(TASK_DETAIL_LIMITS.url)
    .optional()
    .describe('The exact page the change is made on: a path or a full URL.'),
  change: z
    .object({
      before: z.string().max(TASK_DETAIL_LIMITS.change).optional(),
      after: z.string().min(1).max(TASK_DETAIL_LIMITS.change),
    })
    .optional()
    .describe('The change to make there: the text before (none when it adds text) and after.'),
  done_when: z
    .string()
    .max(TASK_DETAIL_LIMITS.doneWhen)
    .optional()
    .describe('The measurable check that closes it.'),
  check: z
    .enum(TASK_CHECKS)
    .optional()
    .describe(
      'How it is checked: auto (the page fetched again), rerun (the prompts run again) or manual (a person confirms).',
    ),
  where: z.string().max(TASK_DETAIL_LIMITS.where).optional(),
  why: z.string().max(TASK_DETAIL_LIMITS.why).optional(),
  how: z
    .array(z.string().max(TASK_DETAIL_LIMITS.step))
    .max(TASK_DETAIL_LIMITS.steps)
    .optional()
    .describe('The steps, in order.'),
};

export type TaskReviewEdit = z.infer<z.ZodObject<typeof taskReviewEditShape>>;

/** The four fields a task needs to be approved, as the database checks them (00293). */
function stillMissing(details: Record<string, unknown>): McpReviewField[] {
  const filled = (value: unknown) => typeof value === 'string' && value.trim() !== '';
  const change = (details.change ?? null) as { after?: unknown } | null;
  return [
    ...(filled(details.url) ? [] : (['url'] as const)),
    ...(filled(change?.after) ? [] : (['change'] as const)),
    ...(filled(details.doneWhen) ? [] : (['done_when'] as const)),
    ...(details.check === 'auto' || details.check === 'rerun' || details.check === 'manual'
      ? []
      : (['check'] as const)),
  ];
}

/**
 * A reviewed task onto its action's list, as the Needs review tab's Approve
 * does (approve_action_task_review, 00293 and 00375): the fields given
 * replace the written ones, the rest stays, and the four it needs must be
 * filled. The trail says the key's user added it. Throws RoleRequiredError
 * for anyone but an admin or a manager, before reading the review.
 */
export async function approveTaskReviewFor(
  auth: McpAuthContext,
  reviewId: string,
  input: TaskReviewEdit,
): Promise<{ task_id: string; action_id: string; title: string } | TaskReviewError> {
  requireManager(auth);
  const review = await ownedReview(auth, reviewId);
  if (!review) return MISSING;

  const stored =
    review.details && typeof review.details === 'object' && !Array.isArray(review.details)
      ? (review.details as Record<string, unknown>)
      : {};
  const current = parseTaskDetails(stored);
  const edit: TaskDetailsEdit = {
    url: input.url ?? current?.url ?? '',
    where: input.where ?? current?.where ?? '',
    why: input.why ?? current?.why ?? '',
    before: input.change ? (input.change.before ?? '') : (current?.change?.before ?? ''),
    after: input.change ? input.change.after : (current?.change?.after ?? ''),
    how: input.how ?? current?.how ?? [],
    doneWhen: input.done_when ?? current?.doneWhen ?? '',
    check: input.check ?? current?.check ?? null,
    type: current?.type ?? null,
    effort: current?.effort ?? '',
    role: current?.role ?? '',
  };
  // What the writer stored beside them (its evidence refs) stays, as on the tab.
  const details = { ...stored, ...cleanTaskDetailsEdit(edit) };
  const missing = stillMissing(details);
  if (missing.length) {
    return { error: 'incomplete', message: `The task still misses: ${missing.join(', ')}` };
  }
  const title = (input.title ?? review.title).trim().slice(0, 200);

  const { data, error } = await supabaseAdmin.rpc('approve_action_task_review', {
    p_review_id: reviewId,
    p_title: title,
    p_details: details,
    p_user_id: auth.userId,
  });
  if (error) {
    if (error.code === '42501') return FORBIDDEN;
    if (error.code === '55000') {
      return { error: 'closed', message: 'Its action is closed or deleted: it takes no tasks' };
    }
    if (error.code === '22023') {
      return { error: 'incomplete', message: 'The task needs a title and its four fields' };
    }
    throw new Error(error.message);
  }
  if (!data) return MISSING;
  return { task_id: data as string, action_id: review.action_id, title };
}

/**
 * A task waiting for review dropped, as the tab's Dismiss does: it never
 * reaches the action. Throws RoleRequiredError for anyone but an admin or a
 * manager.
 */
export async function dismissTaskReviewFor(
  auth: McpAuthContext,
  reviewId: string,
): Promise<{ id: string; dismissed: true } | TaskReviewError> {
  requireManager(auth);
  const review = await ownedReview(auth, reviewId);
  if (!review) return MISSING;
  const { data, error } = await supabaseAdmin
    .from('action_task_reviews')
    .delete()
    .eq('id', reviewId)
    .select('id');
  if (error) throw new Error(error.message);
  // Approved or dismissed meanwhile: nothing was dropped.
  if (!data?.length) return MISSING;
  return { id: reviewId, dismissed: true };
}
