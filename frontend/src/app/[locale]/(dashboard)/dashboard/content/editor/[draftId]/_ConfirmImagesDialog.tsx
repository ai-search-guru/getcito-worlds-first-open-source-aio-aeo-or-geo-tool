'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/**
 * Quality's Confirm (CE-049, 00270): the page's images, each with "Our own
 * image, not stock". Only the person can tell: their word is kept with who
 * gave it, and E-E-A-T counts the page's own images as visual proof. A
 * confirmation stays (there's nothing to take back: it's their statement).
 */
export function ConfirmImagesDialog({
  images,
  own,
  onConfirm,
  onClose,
}: {
  images: readonly { src: string; alt: string }[];
  own: ReadonlySet<string>;
  onConfirm: (src: string) => void;
  onClose: () => void;
}) {
  const t = useTranslations('contentEditor.editor.quality.confirmImages');
  const id = useId();
  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>
        <ul className="divide-y rounded-xl border">
          {images.map((image, i) => {
            const mine = own.has(image.src);
            return (
              <li key={image.src} className="flex items-center gap-3 px-3 py-2.5">
                {/* The image as the page shows it; its host sees no referrer. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.src}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="h-12 w-16 shrink-0 rounded-md border bg-muted object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{image.alt || t('noAlt')}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Checkbox
                      id={`${id}-${i}`}
                      checked={mine}
                      // Kept in reach (focus stays on it once ticked); nothing to untick.
                      aria-disabled={mine}
                      onCheckedChange={(on) => on === true && !mine && onConfirm(image.src)}
                    />
                    <label htmlFor={`${id}-${i}`} className="text-xs text-muted-foreground">
                      {mine ? t('confirmed') : t('own')}
                    </label>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
