'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { LoadingDots } from '@/components/ui/loading-dots';
import { getContentDraft } from '@/lib/actions/contentDrafts';
import { CONTENT_NEW_PATH, contentEditorPath } from '@/lib/content/drafts';
import { forgetLastDraft, readLastDraft } from '@/lib/content/lastDraft';
import { useBrandStore } from '@/state/useBrandStore';

/**
 * Content › Editor: the brand's draft last opened in the editor, in this
 * browser; with none (or one deleted or archived since), a new page's start,
 * the Library with New content open.
 */
export default function ContentEditorStartPage() {
  const t = useTranslations('contentEditor.library');
  const router = useRouter();
  const activeBrandId = useBrandStore((s) => s.activeBrandId);

  useEffect(() => {
    if (!activeBrandId) return;
    const last = readLastDraft(activeBrandId);
    if (!last) {
      router.replace(CONTENT_NEW_PATH);
      return;
    }
    let cancelled = false;
    getContentDraft(last)
      .then((draft) => {
        if (cancelled) return;
        if (draft?.brandId === activeBrandId && !draft.archivedAt) {
          router.replace(contentEditorPath(draft.id));
          return;
        }
        // Deleted, archived (not the one to open, 00233), or no longer the
        // member's to read.
        forgetLastDraft(activeBrandId);
        router.replace(CONTENT_NEW_PATH);
      })
      // A failed look isn't a draft gone: the editor reads it again.
      .catch((err) => {
        console.error('Failed to read the last draft:', err);
        if (!cancelled) router.replace(contentEditorPath(last));
      });
    return () => {
      cancelled = true;
    };
  }, [activeBrandId, router]);

  if (!activeBrandId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-muted-foreground">{t('selectBrand')}</p>
      </div>
    );
  }
  return (
    <div className="flex min-h-[400px] items-center justify-center" aria-busy="true">
      <LoadingDots size="md" className="text-muted-foreground" />
    </div>
  );
}
