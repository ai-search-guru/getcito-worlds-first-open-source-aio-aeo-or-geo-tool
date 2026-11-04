'use client';

import { useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingDots } from '@/components/ui/loading-dots';
import { takeDownDraft } from '@/lib/actions/cmsTakeDown';
import { hostOf } from '@/lib/action-center/affected';
import { CMS_NAMES } from '@/lib/content/cmsNames';
import type { CmsTarget } from '@/lib/content/cmsSendClient';

/** The page taken down: its draft, title, live address and the CMS it went live in. */
export interface TakeDownPage {
  draftId: string;
  title: string;
  url: string | null;
  target: CmsTarget;
}

/**
 * Take down (AUTONOMOUS-GO-LIVE §6.4, PR 10): a person's click that takes a
 * page published through GetCito back down to a draft in its CMS, from the
 * Inbox notice, Chat's Activity and the Content Library. It says first what
 * happens, Keep it live focused; a refusal stays in the dialog, in the
 * CMS's words. Rendered only while open.
 */
export function TakeDownDialog({
  page,
  onClose,
  onDone,
}: {
  page: TakeDownPage;
  onClose: () => void;
  /** The page is a draft in its CMS again. */
  onDone: () => void;
}) {
  const t = useTranslations('contentEditor.takeDown');
  const keepRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const cms = CMS_NAMES[page.target];
  const site = (page.url && hostOf(page.url)) || cms;

  const confirm = async () => {
    setBusy(true);
    setProblem(null);
    const result = await takeDownDraft(page.draftId);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message || t('failed'));
      return;
    }
    toast.success(t('done', { cms: result.target ? CMS_NAMES[result.target] : cms }));
    onDone();
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        showCloseButton={false}
        initialFocus={keepRef}
        className="grid-cols-[minmax(0,1fr)] sm:max-w-md"
        data-slot="take-down-dialog"
      >
        <DialogTitle className="leading-snug [overflow-wrap:anywhere]">
          {t('title', { title: page.title })}
        </DialogTitle>
        <DialogDescription>{t('body', { site, cms })}</DialogDescription>
        {problem && (
          <p role="alert" className="text-sm text-red-700 dark:text-red-400">
            {problem}
          </p>
        )}
        <DialogFooter>
          <Button
            ref={keepRef}
            variant="outline"
            data-action="takeDown.keep"
            disabled={busy}
            onClick={onClose}
          >
            {t('keep')}
          </Button>
          <Button
            data-action="takeDown.confirm"
            disabled={busy}
            onClick={() => void confirm()}
            className="bg-red-600 text-white hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600"
          >
            {busy ? <LoadingDots label={t('working')} /> : t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
