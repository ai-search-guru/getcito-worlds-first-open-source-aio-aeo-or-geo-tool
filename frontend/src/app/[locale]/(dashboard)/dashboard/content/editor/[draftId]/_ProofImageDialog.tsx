'use client';

import { useRef, useState } from 'react';
import type { Editor } from '@tiptap/core';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { safeImageSrc } from '@/lib/content/editor';
import type { ProofSpot } from '@/lib/content/pageRead';
import { textRanges } from './_claimMarks';

/** The longest image address the dialog takes, as the database keeps an own image's (00270). */
const MAX_IMAGE_SRC_LENGTH = 2048;

/**
 * A visual proof spot's Add image (Quality spec §4b, CE-049): the image by
 * its address (one the business hosts), its alt text drafted from the
 * passage, and an optional caption, put in right after the passage's
 * block (its list or quote, whole). The caption is an italic paragraph
 * under it. A passage gone from the page meanwhile says so.
 */
export function insertProofImage(
  editor: Editor,
  spot: ProofSpot,
  image: { src: string; alt: string; caption: string },
): boolean {
  const [range] = textRanges(editor.state.doc, spot.passage, spot.block);
  if (!range) return false;
  const at = editor.state.doc.resolve(range.from).after(1);
  const caption = image.caption.trim();
  return editor
    .chain()
    .focus()
    .insertContentAt(at, [
      { type: 'image', attrs: { src: image.src, alt: image.alt } },
      ...(caption
        ? [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: caption, marks: [{ type: 'italic' }] }],
            },
          ]
        : []),
    ])
    .run();
}

export function ProofImageDialog({
  editor,
  spot,
  onClose,
  onOwn,
}: {
  editor: Editor;
  spot: ProofSpot;
  onClose: () => void;
  /** The image put in is the person's own, not stock (CE-049, part d): they ticked it. */
  onOwn?: (src: string) => void;
}) {
  const t = useTranslations('contentEditor.editor.proofSpots.dialog');
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState(spot.alt);
  const [caption, setCaption] = useState('');
  const [own, setOwn] = useState(false);
  const [invalid, setInvalid] = useState<'src' | 'alt' | null>(null);
  const fieldRef = useRef<HTMLInputElement>(null);

  const insert = () => {
    // https only (an http image on an https page may not show), as the page keeps addresses.
    const checked = safeImageSrc(src.trim());
    const safe =
      checked?.startsWith('https:') && checked.length <= MAX_IMAGE_SRC_LENGTH ? checked : null;
    if (!safe) {
      setInvalid('src');
      return;
    }
    if (!alt.trim()) {
      setInvalid('alt');
      return;
    }
    if (!insertProofImage(editor, spot, { src: safe, alt: alt.trim(), caption })) {
      toast.error(t('gone'));
    } else if (own) {
      onOwn?.(safe);
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="sm:max-w-md" initialFocus={fieldRef}>
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{spot.image}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            insert();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="proof-image-src">{t('srcLabel')}</Label>
            <Input
              id="proof-image-src"
              ref={fieldRef}
              value={src}
              maxLength={MAX_IMAGE_SRC_LENGTH}
              placeholder="https://"
              aria-invalid={invalid === 'src'}
              aria-describedby="proof-image-src-hint"
              onChange={(e) => {
                setSrc(e.target.value);
                setInvalid(null);
              }}
            />
            <p id="proof-image-src-hint" className="text-xs text-muted-foreground">
              {invalid === 'src' ? (
                <span className="text-destructive">{t('invalid')}</span>
              ) : (
                t('srcHint')
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proof-image-alt">{t('altLabel')}</Label>
            <Input
              id="proof-image-alt"
              value={alt}
              maxLength={125}
              aria-invalid={invalid === 'alt'}
              aria-describedby="proof-image-alt-hint"
              onChange={(e) => {
                setAlt(e.target.value);
                setInvalid(null);
              }}
            />
            <p id="proof-image-alt-hint" className="text-xs text-muted-foreground">
              {invalid === 'alt' ? (
                <span className="text-destructive">{t('altRequired')}</span>
              ) : (
                t('altHint')
              )}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="proof-image-caption">{t('captionLabel')}</Label>
            <Input
              id="proof-image-caption"
              value={caption}
              maxLength={200}
              onChange={(e) => setCaption(e.target.value)}
            />
          </div>
          {/* Enter in any field adds it. */}
          <button type="submit" hidden />
        </form>
        {onOwn && (
          <div className="flex items-start gap-2">
            <Checkbox
              id="proof-image-own"
              className="mt-px"
              checked={own}
              onCheckedChange={(on) => setOwn(on === true)}
            />
            <Label htmlFor="proof-image-own" className="text-xs leading-snug font-normal">
              {t('own')}
            </Label>
          </div>
        )}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{t('cancel')}</DialogClose>
          <Button onClick={insert}>{t('insert')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
