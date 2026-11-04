'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { contentEditorPath, isPageType } from '@/lib/content/drafts';
import { pagePath } from '@/lib/content/overlap';

/**
 * What a draft sent from the Content Editor's Start carries (CE-015): the
 * draft to open, its page type, the page it optimizes (or a new page), and
 * how many prompts it should answer.
 */
export function ContentDraftContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.contentDraft');
  const tTypes = useTranslations('contentEditor.pageTypes');
  const draftId = typeof payload.draftId === 'string' ? payload.draftId : null;
  const pageType = typeof payload.pageType === 'string' ? payload.pageType : null;
  const page =
    Array.isArray(payload.pages) && typeof payload.pages[0] === 'string' ? payload.pages[0] : null;
  const prompts = typeof payload.targetCount === 'number' ? payload.targetCount : 0;

  return (
    <section className="space-y-3">
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('source')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span>{t('sourceValue')}</span>
          {draftId && (
            <Link
              href={contentEditorPath(draftId)}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {t('openDraft')}
              <ExternalLink className="h-3 w-3" />
            </Link>
          )}
        </div>
      </div>
      {isPageType(pageType) && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('pageType')}</p>
          <p className="mt-1">{tTypes(pageType)}</p>
        </div>
      )}
      <div>
        <p className="text-xs font-medium text-muted-foreground">{t('page')}</p>
        <p className="mt-1 truncate" title={page ?? undefined}>
          {page ? pagePath(page) : t('newPage')}
        </p>
      </div>
      {prompts > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('prompts')}</p>
          <p className="mt-1 tabular-nums">{t('promptsValue', { count: prompts })}</p>
        </div>
      )}
    </section>
  );
}
