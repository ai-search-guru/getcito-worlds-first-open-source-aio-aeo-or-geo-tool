'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { listCatalogSources } from '@/lib/actions/catalog';
import { CATALOG_SETTINGS_PATH } from '@/lib/content/feedMatch';

/**
 * My Products' note (#1270), for a brand with no catalog source yet: the
 * table is the products AI shopping cards showed, not the catalog, and what
 * connecting a catalog does (the Content Editor's price, GTIN and stock
 * check, CE-053). Shown only once the sources are read and there are none;
 * a failed read shows nothing.
 */
export function CatalogNote({ brandId }: { brandId: string }) {
  const t = useTranslations('shopping');
  // Whether the brand has no source, as read for that brand.
  const [read, setRead] = useState<{ brandId: string; none: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCatalogSources(brandId).then(
      (sources) => {
        if (!cancelled) setRead({ brandId, none: sources.length === 0 });
      },
      () => {
        if (!cancelled) setRead({ brandId, none: false });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [brandId]);

  if (read?.brandId !== brandId || !read.none) return null;
  return (
    <p className="text-sm text-muted-foreground">
      {t.rich('connectCatalog', {
        link: (chunks) => (
          <Link
            href={CATALOG_SETTINGS_PATH}
            className="font-medium text-foreground underline underline-offset-4"
          >
            {chunks}
          </Link>
        ),
      })}
    </p>
  );
}
