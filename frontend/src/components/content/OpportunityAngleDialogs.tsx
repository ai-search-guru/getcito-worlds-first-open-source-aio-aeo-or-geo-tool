'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
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
import { LoadingDots } from '@/components/ui/loading-dots';
import { cn } from '@/lib/utils';
import { getContentUsage } from '@/lib/actions/content';

/** Longest direction the server accepts (IDEA_MAX_LENGTH in opportunityGenerator.js). */
const DIRECTION_MAX_LENGTH = 500;

/**
 * "Another angle" (CONTENT-006): ask for one more opportunity for the same
 * need with a different angle, optionally steered by a short direction. It
 * uses one of the month's opportunities, which the dialog says up front.
 */
export function AlternativeDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Starts generation; resolves to whether it started. */
  onSubmit: (direction: string | null) => Promise<boolean>;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        {/* Mounted per opening, so every opening starts from a fresh form. */}
        {open && <AlternativeForm onSubmit={onSubmit} onClose={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function AlternativeForm({
  onSubmit,
  onClose,
}: {
  onSubmit: (direction: string | null) => Promise<boolean>;
  onClose: () => void;
}) {
  const t = useTranslations('content.alternative');
  const tCommon = useTranslations('common');
  const [direction, setDirection] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // null while loading; -1 when the month is unlimited.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    getContentUsage().then(
      (usage) => {
        if (!cancelled) {
          setRemaining(usage.opportunities.limit === -1 ? -1 : usage.opportunities.remaining);
        }
      },
      () => !cancelled && setRemaining(-1),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const noneLeft = remaining === 0;

  const submit = async () => {
    if (submitting || noneLeft) return;
    setSubmitting(true);
    const ok = await onSubmit(direction.trim() || null);
    setSubmitting(false);
    if (ok) onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{t('title')}</DialogTitle>
        <DialogDescription>{t('description')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <label
            htmlFor="alternative-direction"
            className="text-xs font-medium text-muted-foreground"
          >
            {t('direction')}
          </label>
          <Textarea
            id="alternative-direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value.slice(0, DIRECTION_MAX_LENGTH))}
            placeholder={t('directionPlaceholder')}
            rows={2}
            className="text-sm"
          />
        </div>
        {remaining !== null && (
          <p
            className={cn(
              'rounded-md border bg-muted/40 px-3 py-2 text-xs',
              noneLeft && 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400',
            )}
          >
            {noneLeft
              ? t('noneLeft')
              : remaining === -1
                ? t('usesUnlimited')
                : t('uses', { remaining, after: remaining - 1 })}
          </p>
        )}
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={submitting}>
          {tCommon('cancel')}
        </Button>
        <Button onClick={submit} disabled={submitting || noneLeft} className="gap-2">
          {submitting ? <LoadingDots /> : <RefreshCw className="h-4 w-4" />}
          {t('generate')}
        </Button>
      </DialogFooter>
    </>
  );
}

export type DismissReason = 'not_relevant' | 'wrong_angle';

/**
 * Why an opportunity is being dismissed (CONTENT-006): the topic doesn't
 * matter to the brand, or the topic is right and the angle wrong — which
 * goes on to ask for another angle.
 */
export function DismissReasonDialog({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (reason: DismissReason) => void;
}) {
  const t = useTranslations('content.dismissReason');
  const choose = (reason: DismissReason) => {
    onOpenChange(false);
    onChoose(reason);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {(['not_relevant', 'wrong_angle'] as const).map((reason) => (
            <button
              key={reason}
              type="button"
              onClick={() => choose(reason)}
              className="rounded-md border px-3 py-2.5 text-left transition-colors hover:bg-muted/50"
            >
              <p className="text-sm font-medium">{t(`${reason}.label`)}</p>
              <p className="text-xs text-muted-foreground">{t(`${reason}.hint`)}</p>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
