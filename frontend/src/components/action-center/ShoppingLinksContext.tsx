'use client';

import { useTranslations } from 'next-intl';
import { ExternalLink } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { contentEditorPath } from '@/lib/content/drafts';
import { pagePath } from '@/lib/content/overlap';

const STATES = ['sold_out', 'refused', 'gone'] as const;
type LinkState = (typeof STATES)[number];

/** The payload's products, read defensively: any may be missing or of the wrong shape. */
function productsOf(raw: unknown): { title: string; state: LinkState | null }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      const p = (item ?? {}) as Record<string, unknown>;
      const state = (STATES as readonly unknown[]).includes(p.state)
        ? (p.state as LinkState)
        : null;
      return { title: typeof p.title === 'string' ? p.title.trim() : '', state };
    })
    .filter((p) => p.title || p.state);
}

/**
 * What the catalog check's action carries (shopping path, part 7): the live
 * page and its draft to swap them in, the products it links that no longer
 * sell and why, and the ones of its shopping path in stock to link instead.
 */
export function ShoppingLinksContext({ payload }: { payload: Record<string, unknown> }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.shoppingLinks');
  const draftId = typeof payload.draftId === 'string' ? payload.draftId : null;
  const page = typeof payload.pageUrl === 'string' ? payload.pageUrl : null;
  const products = productsOf(payload.products);
  const swaps = productsOf(payload.swaps).filter((p) => p.title);

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
      {page && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('page')}</p>
          <p className="mt-1 truncate" title={page}>
            {pagePath(page)}
          </p>
        </div>
      )}
      {products.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('products')}</p>
          <ul className="mt-1 space-y-1">
            {products.map((product, i) => (
              <li key={`${product.title}:${i}`} className="flex flex-wrap items-baseline gap-x-2">
                <span className="min-w-0 break-words">{product.title || '—'}</span>
                {product.state && (
                  <span className="text-xs text-red-700 dark:text-red-400">
                    {t(`states.${product.state}`)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {swaps.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">{t('swaps')}</p>
          <p className="mt-1 break-words">{swaps.map((p) => p.title).join(' · ')}</p>
        </div>
      )}
      <p className="text-xs text-muted-foreground">{t('check')}</p>
    </section>
  );
}
