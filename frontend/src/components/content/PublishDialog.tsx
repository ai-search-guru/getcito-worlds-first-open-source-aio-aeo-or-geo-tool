'use client';

import { useEffect, useRef, useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingDots } from '@/components/ui/loading-dots';
import { setContentDraftStatus } from '@/lib/actions/contentDrafts';
import { publishPage, readPublishAddress } from '@/lib/content/publishClient';
import { useUpgradeGate } from '@/components/context/upgradeGate';

/**
 * Mark published (CE-013): the person gives the address the page is live
 * at, and tracking starts there (the editor's Live page tab, a linked
 * action's results). It starts from where the page went live, else the page
 * it optimizes, else the brand's site with its slug. From the Library's
 * status menu and the editor; rendered only while open.
 *
 * An API without the publish route yet (the web goes out first): a page not
 * yet published becomes Published as before, without its address, and the
 * person is told; a published page's address can't be changed until then.
 */
export function PublishDialog({
  draftId,
  published,
  onClose,
  onPublished,
}: {
  draftId: string;
  /** Already published: the dialog changes its address. */
  published: boolean;
  onClose: () => void;
  /** Where the page is live now; null when the address couldn't be kept. */
  onPublished: (publishedUrl: string | null) => void;
}) {
  const t = useTranslations('contentEditor.publish');
  const tFailure = useTranslations('apiFailure');
  const { openUpgrade } = useUpgradeGate();
  // Undefined while the starting address is read.
  const [url, setUrl] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    readPublishAddress(draftId)
      .catch(() => '')
      .then((address) => {
        if (cancelled) return;
        setUrl((now) => now ?? address);
        // Disabled while it was read: the field takes focus once it can be typed in.
        requestAnimationFrame(() => input.current?.focus());
      });
    return () => {
      cancelled = true;
    };
  }, [draftId]);

  const save = async () => {
    if (!url?.trim()) return;
    setSaving(true);
    setProblem(null);
    const result = await publishPage(draftId, url.trim());
    if (!result.ok && result.code === 'no_route' && !published) {
      const kept = await setContentDraftStatus(draftId, 'published').then(
        () => true,
        (err) => {
          console.error('Failed to mark the page published:', err);
          return false;
        },
      );
      setSaving(false);
      if (!kept) {
        setProblem(t('failed'));
        return;
      }
      toast.warning(t('addressNotKept'));
      onPublished(null);
      onClose();
      return;
    }
    setSaving(false);
    if (!result.ok) {
      // A read-only workspace: the upgrade dialog, with the reason kept here.
      if (result.code === 'subscription') openUpgrade();
      setProblem(
        result.code === 'invalid_url'
          ? t('invalidUrl')
          : result.code === 'session' ||
              result.code === 'workspace' ||
              result.code === 'busy' ||
              result.code === 'subscription'
            ? tFailure(result.code)
            : t(result.code === 'not_found' ? 'notFound' : 'failed'),
      );
      return;
    }
    if (result.onBrandDomain) toast.success(t('done'));
    else toast.warning(t('offDomain'));
    onPublished(result.publishedUrl);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-1.5"
          // The address is checked by the API, its words from en.json, not the browser's.
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (!saving) void save();
          }}
        >
          <Label htmlFor="publish-url">{t('label')}</Label>
          <Input
            ref={input}
            id="publish-url"
            type="url"
            inputMode="url"
            autoComplete="url"
            placeholder="https://"
            disabled={url === undefined}
            value={url ?? ''}
            onChange={(e) => {
              setUrl(e.target.value);
              setProblem(null);
            }}
            aria-invalid={problem ? true : undefined}
            aria-describedby="publish-url-hint"
          />
          <p
            id="publish-url-hint"
            // Always there, so a problem in it is read out as it comes.
            aria-live="polite"
            className={
              problem ? 'text-xs text-red-700 dark:text-red-400' : 'text-xs text-muted-foreground'
            }
          >
            {problem ?? t('hint')}
          </p>
        </form>
        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={saving} onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button disabled={saving || !url?.trim()} onClick={() => void save()}>
            {saving && <LoadingDots className="mr-1" />}
            {t('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
