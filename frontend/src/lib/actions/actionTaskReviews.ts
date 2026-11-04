'use server';

import { createClient } from '@/lib/supabase/server';
import {
  cleanTaskDetailsEdit,
  isTaskDetailsEdit,
  parseTaskDetails,
  type ActionTaskDetails,
  type TaskDetailsEdit,
} from '@/lib/action-center/taskDetails';
import { assertWritable } from '@/lib/subscriptionGuard';

/**
 * Tasks waiting for review (AC-010, 00293): ones an agent wrote without the
 * exact page, the change, Done when or how it is checked. They aren't tasks
 * yet; an admin or a manager fills what they miss and approves them onto
 * their action's list, or dismisses them. Read through the caller's RLS, so
 * anyone else reads none.
 */

export type TaskReviewField = 'url' | 'change' | 'doneWhen' | 'check';

export interface TaskReview {
  id: string;
  actionId: string;
  actionNo: number | null;
  title: string;
  details: ActionTaskDetails | null;
  /** What it was written without. */
  missing: TaskReviewField[];
  createdAt: string;
}

const FIELDS: readonly TaskReviewField[] = ['url', 'change', 'doneWhen', 'check'];

/**
 * The brand's tasks waiting for review, the oldest first; none of an action
 * that is deleted or closed, which can't take them.
 */
export async function getTaskReviews(brandId: string): Promise<TaskReview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('action_task_reviews')
    .select(
      'id, action_id, title, details, missing, created_at, actions!inner(action_no, brand_id, status, deleted_at)',
    )
    .eq('actions.brand_id', brandId)
    .is('actions.deleted_at', null)
    .not('actions.status', 'in', '(completed,dismissed)')
    .order('created_at', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => {
    const action = (Array.isArray(row.actions) ? row.actions[0] : row.actions) as {
      action_no: number | null;
    } | null;
    return {
      id: row.id,
      actionId: row.action_id,
      actionNo: action?.action_no ?? null,
      title: row.title,
      details: parseTaskDetails(row.details),
      missing: (row.missing ?? []).filter((field: string): field is TaskReviewField =>
        (FIELDS as readonly string[]).includes(field),
      ),
      createdAt: row.created_at,
    };
  });
}

/** How many of the brand's tasks wait for review, for the tab; 0 when the read fails. */
export async function getTaskReviewCount(brandId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from('action_task_reviews')
    .select('id, actions!inner(brand_id, status, deleted_at)', { count: 'exact', head: true })
    .eq('actions.brand_id', brandId)
    .is('actions.deleted_at', null)
    .not('actions.status', 'in', '(completed,dismissed)');
  return error ? 0 : (count ?? 0);
}

export type ApproveTaskReviewResult =
  { taskId: string } | { error: 'invalid' | 'incomplete' | 'gone' | 'not_allowed' | 'closed' };

/**
 * A reviewed task onto its action's list, as edited, its four fields
 * filled. What the writer stored beside them (its evidence refs) stays.
 */
export async function approveTaskReview(
  brandId: string,
  reviewId: string,
  edit: TaskDetailsEdit & { title: string },
): Promise<ApproveTaskReviewResult> {
  await assertWritable({ brandId });
  if (!isTaskDetailsEdit(edit) || typeof edit.title !== 'string') return { error: 'invalid' };
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from('action_task_reviews')
    .select('details, actions!inner(brand_id)')
    .eq('id', reviewId)
    .eq('actions.brand_id', brandId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) return { error: 'gone' };

  const stored =
    row.details && typeof row.details === 'object' && !Array.isArray(row.details)
      ? (row.details as Record<string, unknown>)
      : {};
  const details = { ...stored, ...cleanTaskDetailsEdit(edit) };
  const { data, error } = await supabase.rpc('approve_action_task_review', {
    p_review_id: reviewId,
    p_title: edit.title.trim().slice(0, 200),
    p_details: details,
  });
  if (error) {
    if (error.code === '22023') return { error: 'incomplete' };
    if (error.code === '42501') return { error: 'not_allowed' };
    if (error.code === '55000') return { error: 'closed' };
    throw new Error(error.message);
  }
  return data ? { taskId: data } : { error: 'gone' };
}

/** A task waiting for review dropped: it never reaches the action. */
export async function dismissTaskReview(brandId: string, reviewId: string): Promise<void> {
  await assertWritable({ brandId });
  const supabase = await createClient();
  const { data: row, error: readError } = await supabase
    .from('action_task_reviews')
    .select('id, actions!inner(brand_id)')
    .eq('id', reviewId)
    .eq('actions.brand_id', brandId)
    .maybeSingle();
  if (readError) throw new Error(readError.message);
  if (!row) return;
  const { error } = await supabase.from('action_task_reviews').delete().eq('id', reviewId);
  if (error) throw new Error(error.message);
}
