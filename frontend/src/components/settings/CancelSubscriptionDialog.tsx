'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { sendCancelFeedback } from '@/lib/actions/cancelFeedback';
import {
  CANCEL_MESSAGE_MAX,
  CANCEL_REASONS,
  WAIT_DAYS,
  canWait,
  waitUntil,
  type CancelReason,
} from '@/lib/billing/cancelFeedback';
import { cn } from '@/lib/utils';

const formatDate = (date: Date) =>
  date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

/**
 * Cancel Subscription asks what went wrong first: reasons to tick and a
 * message, both optional, which go to the team. Then the customer cancels
 * (at the end of the period, as before) or gives the team three days to put
 * it right, the plan unchanged. Waiting isn't offered when the plan renews
 * within those days, so no one is charged while they wait.
 */
export function CancelSubscriptionDialog({
  open,
  onOpenChange,
  currentPeriodEnd,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentPeriodEnd: string | null;
  /** Cancels the plan at the end of the period; false when that failed (it says why). */
  onCancel: () => Promise<boolean>;
}) {
  const t = useTranslations('settings');
  const [reasons, setReasons] = useState<CancelReason[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<'cancel' | 'wait' | null>(null);
  const [answerBy, setAnswerBy] = useState<Date | null>(null);
  // The server said waiting can't work (renews too soon, or the team can't
  // be told): only cancelling is left.
  const [waitRefused, setWaitRefused] = useState(false);

  const said = reasons.length > 0 || message.trim().length > 0;
  const offerWait = canWait(currentPeriodEnd) && !waitRefused;

  function reset() {
    setReasons([]);
    setMessage('');
    setAnswerBy(null);
  }

  function toggle(reason: CancelReason) {
    setReasons((current) =>
      current.includes(reason) ? current.filter((r) => r !== reason) : [...current, reason],
    );
  }

  async function cancel() {
    setBusy('cancel');
    try {
      if (!(await onCancel())) return;
      // The plan is cancelled either way: a message that doesn't reach the
      // team isn't worth an error now.
      await sendCancelFeedback({ reasons, message, choice: 'cancel' }).catch(() => null);
      onOpenChange(false);
      reset();
    } finally {
      setBusy(null);
    }
  }

  async function wait() {
    setBusy('wait');
    try {
      const result = await sendCancelFeedback({ reasons, message, choice: 'wait' });
      if ('ok' in result) {
        setAnswerBy(waitUntil());
      } else if (result.error === 'too_late' || result.error === 'not_sent') {
        setWaitRefused(true);
        toast.error(
          result.error === 'too_late' ? t('cancelFeedbackTooLate') : t('cancelFeedbackNotSent'),
        );
      } else {
        toast.error(
          result.error === 'too_many' ? t('cancelFeedbackTooMany') : t('cancelFeedbackFailed'),
        );
      }
    } finally {
      setBusy(null);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
        if (!next) reset();
      }}
    >
      <DialogContent className="max-w-lg">
        {answerBy ? (
          <>
            <DialogHeader>
              <DialogTitle>{t('cancelWaitSentTitle')}</DialogTitle>
              <DialogDescription>
                {t('cancelWaitSent', { date: formatDate(answerBy) })}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                onClick={() => {
                  onOpenChange(false);
                  reset();
                }}
              >
                {t('cancelWaitClose')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{t('cancelFeedbackTitle')}</DialogTitle>
              <DialogDescription>{t('cancelFeedbackDescription')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div
                className="flex flex-wrap gap-1.5"
                role="group"
                aria-label={t('cancelReasonsLabel')}
              >
                {CANCEL_REASONS.map((reason) => (
                  <button
                    key={reason}
                    type="button"
                    aria-pressed={reasons.includes(reason)}
                    onClick={() => toggle(reason)}
                    className={cn(
                      'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                      reasons.includes(reason)
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'bg-background hover:bg-muted',
                    )}
                  >
                    {t(`cancelReasons.${reason}`)}
                  </button>
                ))}
              </div>
              <label htmlFor="cancel-feedback-message" className="sr-only">
                {t('cancelMessageLabel')}
              </label>
              <Textarea
                id="cancel-feedback-message"
                value={message}
                maxLength={CANCEL_MESSAGE_MAX}
                rows={4}
                placeholder={t('cancelMessagePlaceholder')}
                onChange={(e) => setMessage(e.target.value)}
              />
              {offerWait && (
                <p className="rounded-md border bg-muted/30 p-3 text-sm">
                  {t.rich('cancelWaitOffer', {
                    days: WAIT_DAYS,
                    date: formatDate(waitUntil()),
                    b: (chunks) => <span className="font-medium">{chunks}</span>,
                  })}
                  {!said && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {t('cancelWaitNeedsInput')}
                    </span>
                  )}
                </p>
              )}
              <p className="text-xs text-muted-foreground">{t('cancelConfirmDescription')}</p>
            </div>
            <DialogFooter>
              <Button
                variant={offerWait ? 'outline' : 'destructive'}
                className={offerWait ? 'text-destructive hover:text-destructive' : undefined}
                onClick={cancel}
                disabled={busy != null}
              >
                {busy === 'cancel'
                  ? t('processing')
                  : said
                    ? t('sendAndCancel')
                    : t('cancelSubscription')}
              </Button>
              {offerWait && (
                <Button onClick={wait} disabled={busy != null || !said}>
                  {busy === 'wait' ? t('processing') : t('sendAndWait', { days: WAIT_DAYS })}
                </Button>
              )}
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
