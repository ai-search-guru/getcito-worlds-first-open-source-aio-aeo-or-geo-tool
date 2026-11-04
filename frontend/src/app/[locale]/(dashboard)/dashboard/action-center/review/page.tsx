'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { ArrowUpRight } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { useBrandStore } from '@/state/useBrandStore';
import {
  approveTaskReview,
  dismissTaskReview,
  getTaskReviews,
  type TaskReview,
} from '@/lib/actions/actionTaskReviews';
import type { TaskDetailsEdit } from '@/lib/action-center/taskDetails';
import { TASK_REVIEWS_CHANGED } from '@/lib/action-center/tabs';
import { ActionCenterTabs } from '@/components/action-center/ActionCenterTabs';
import { TaskDetailForm, TaskDetailView } from '@/components/action-center/TaskDetail';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Needs review (AC-010): tasks an agent wrote without the exact page, the
 * change, Done when or how we check it. An admin or a manager fills what
 * each misses and approves it onto its action's list, or dismisses it.
 */
export default function ActionCenterReviewPage() {
  const brand = useBrandStore((s) => s.getActiveBrand());
  const t = useTranslations('actionCenter.reviewPage');

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
      </HeaderWithAiUsage>
      <ActionCenterTabs />
      {brand ? (
        <ReviewContent key={brand.id} brandId={brand.id} />
      ) : (
        <p className="py-20 text-center text-sm text-muted-foreground">{t('noBrand')}</p>
      )}
    </div>
  );
}

function ReviewContent({ brandId }: { brandId: string }) {
  const t = useTranslations('actionCenter.reviewPage');
  const { canManage } = useUserRole();
  const [reviews, setReviews] = useState<TaskReview[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // A read-only workspace (plan not active): Edit (which approves) and Dismiss
  // open the upgrade dialog instead.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const load = useCallback(async () => {
    try {
      setReviews(await getTaskReviews(brandId));
    } catch (err) {
      console.error('Failed to load the tasks waiting for review:', err);
      setReviews([]);
      toast.error(t('loadFailed'));
    }
  }, [brandId, t]);

  useEffect(() => {
    if (canManage) void load();
  }, [canManage, load]);

  if (!canManage) {
    return <p className="py-20 text-center text-sm text-muted-foreground">{t('managersOnly')}</p>;
  }
  if (reviews === null) {
    return (
      <div className="space-y-3">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }
  if (reviews.length === 0) {
    return <p className="py-20 text-center text-sm text-muted-foreground">{t('empty')}</p>;
  }

  const ref = (review: TaskReview) => (review.actionNo !== null ? `AC-${review.actionNo}` : '');
  const gone = (id: string) => {
    setReviews((list) => (list ?? []).filter((r) => r.id !== id));
    // The tab's count, on this same page.
    window.dispatchEvent(new Event(TASK_REVIEWS_CHANGED));
  };

  const approve = async (review: TaskReview, edit: TaskDetailsEdit & { title: string | null }) => {
    setBusy(review.id);
    try {
      const result = await approveTaskReview(brandId, review.id, {
        ...edit,
        title: edit.title ?? review.title,
      });
      if ('taskId' in result) {
        toast.success(t('approved', { ref: ref(review) }));
        setEditing(null);
        gone(review.id);
      } else if (result.error === 'gone') {
        toast(t('gone'));
        gone(review.id);
      } else {
        toast.error(
          t(
            result.error === 'incomplete'
              ? 'incomplete'
              : result.error === 'not_allowed'
                ? 'notAllowed'
                : result.error === 'closed'
                  ? 'closed'
                  : 'failed',
          ),
        );
      }
    } catch (err) {
      console.error('Failed to approve the task:', err);
      toast.error(t('failed'));
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (review: TaskReview) => {
    setBusy(review.id);
    try {
      await dismissTaskReview(brandId, review.id);
      toast(t('dismissed'));
      setDismissing(null);
      gone(review.id);
    } catch (err) {
      console.error('Failed to dismiss the task:', err);
      toast.error(t('failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <ul className="space-y-3">
      {reviews.map((review) => (
        <li key={review.id} className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-start justify-between gap-2 px-4 pt-3">
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-medium break-words">{review.title}</p>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                {t('missing')}:
                {review.missing.map((field) => (
                  <Badge
                    key={field}
                    variant="outline"
                    className="border-amber-500/40 text-[10px] text-amber-700 dark:text-amber-400"
                  >
                    {t(`fields.${field}`)}
                  </Badge>
                ))}
              </div>
            </div>
            {review.actionNo !== null && (
              <Link
                href={`/dashboard/action-center/actions?action=${review.actionId}`}
                className="inline-flex shrink-0 items-center gap-0.5 text-xs font-medium underline-offset-2 hover:underline"
              >
                {t('openAction', { ref: ref(review) })}
                <ArrowUpRight className="h-3 w-3" />
              </Link>
            )}
          </div>
          {editing === review.id ? (
            <TaskDetailForm
              text={review.title}
              details={review.details}
              disabled={busy === review.id}
              requireSpec
              submitLabel={t('approve')}
              onSave={(edit) => approve(review, edit)}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <TaskDetailView
              details={review.details}
              disabled={busy !== null}
              onEdit={guard(() => setEditing(review.id), { action: tActions('approveTasks') })}
            />
          )}
          {editing !== review.id && (
            <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2 text-xs">
              {dismissing === review.id ? (
                <>
                  <span className="text-muted-foreground">{t('confirmDismiss')}</span>
                  <Button
                    type="button"
                    variant="destructive"
                    size="sm"
                    disabled={busy === review.id}
                    onClick={() => void dismiss(review)}
                    className="h-7 text-xs"
                  >
                    {t('confirmDismissButton')}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy === review.id}
                    onClick={() => setDismissing(null)}
                    className="h-7 text-xs"
                  >
                    {t('cancel')}
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={guard(() => setDismissing(review.id), {
                    action: tActions('dismissTasks'),
                  })}
                  className="h-7 text-xs text-muted-foreground"
                >
                  {t('dismiss')}
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
