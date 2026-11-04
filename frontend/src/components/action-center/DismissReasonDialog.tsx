'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ACTION_DISMISS_REASONS, type ActionDismissReason } from '@/lib/action-center/registry';

/**
 * Why an action is being dismissed (learning A5), as a content opportunity
 * asks (CONTENT-006): a reason, or none. Choosing dismisses it; closing the
 * dialog doesn't.
 */
export function DismissReasonDialog({
  open,
  onOpenChange,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChoose: (reason: ActionDismissReason | null) => void;
}) {
  const t = useTranslations('actionCenter.dismissReason');
  const choose = (reason: ActionDismissReason | null) => {
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
          {ACTION_DISMISS_REASONS.map((reason) => (
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
        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={() => choose(null)}>
            {t('skip')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
