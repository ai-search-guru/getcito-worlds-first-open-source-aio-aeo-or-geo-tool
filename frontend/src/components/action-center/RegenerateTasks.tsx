'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUserRole } from '@/hooks/useUserRole';
import { useUpgradeGate } from '@/components/context/upgradeGate';
import { regenerateActionTasks } from '@/lib/actions/actionTaskWriter';

/** Whether this deployment writes tasks (AC-004); the server has its own switch. */
export function taskWriterEnabled(): boolean {
  return process.env.NEXT_PUBLIC_ACTION_TASKS_AI === 'true';
}

/** Server reasons this build has words for (actionsPage.drawer.regenerate.errors). */
const KNOWN_ERRORS = [
  'disabled',
  'not_found',
  'sent',
  'closed',
  'busy',
  'no_targets',
  'no_valid_tasks',
  'budget',
];

/**
 * "Regenerate tasks" (AC-004): the action's tasks written again from its
 * evidence. It replaces work on the list, so it asks first, and it says what
 * stays.
 */
export function RegenerateTasks({
  actionId,
  disabled,
  onBusyChange,
  onDone,
}: {
  actionId: string;
  disabled: boolean;
  /** The rest of the tab waits while the tasks are rewritten: an edit made meanwhile would be lost. */
  onBusyChange: (busy: boolean) => void;
  /** Called once the new tasks are written, to reload them. */
  onDone: () => void | Promise<void>;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.regenerate');
  // Needs review is an admin's or a manager's tab: anyone else is told who reviews.
  const { canManage } = useUserRole();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  // A read-only workspace (plan not active): the upgrade dialog instead of the question.
  const { guard } = useUpgradeGate();
  const tActions = useTranslations('readOnly.actions');

  const run = async () => {
    setBusy(true);
    onBusyChange(true);
    try {
      const result = await regenerateActionTasks(actionId);
      if ('written' in result) {
        toast.success(
          result.reviews > 0
            ? t(canManage ? 'doneWithReviews' : 'doneWithReviewsMember', {
                count: result.written,
                reviews: result.reviews,
              })
            : t('done', { count: result.written }),
        );
        await onDone();
      } else {
        toast.error(
          result.error !== 'server'
            ? t(result.error)
            : result.code && KNOWN_ERRORS.includes(result.code)
              ? t(`errors.${result.code}`)
              : result.message,
        );
      }
    } finally {
      setBusy(false);
      setConfirming(false);
      onBusyChange(false);
    }
  };

  if (busy) {
    return (
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('busy')}
      </p>
    );
  }

  if (confirming) {
    return (
      <div className="mt-3 space-y-2 rounded-md border bg-muted/30 px-3 py-2">
        <p className="text-xs">{t('confirm')}</p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={disabled}
            onClick={() => void run()}
            className="h-7 text-xs"
          >
            {t('confirmButton')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => setConfirming(false)}
            className="h-7 text-xs"
          >
            {t('cancel')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      onClick={guard(() => setConfirming(true), { action: tActions('regenerateTasks') })}
      className="mt-2 h-8 w-full text-xs"
    >
      <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
      {t('button')}
    </Button>
  );
}
