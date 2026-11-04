'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getMentionsOverview } from '@/lib/actions/mentions';
import { mentionsQuery, type MentionsFilters } from '@/lib/mentionsFilters';
import type { MentionsOverview } from '@/lib/mentionsOverview';
import { cn } from '@/lib/utils';
import { CompetitorTable } from './_CompetitorTable';
import { Headline } from './_headline';
import { OverviewKpis } from './_OverviewKpis';
import { PlatformTable } from './_PlatformTable';
import { TrendCard } from './_TrendCard';

/** Typing in the search box reads once it pauses, not on every key. */
const READ_DELAY_MS = 250;

type Loaded =
  | { brandId: string; key: string; status: 'ok'; overview: MentionsOverview | null }
  | { brandId: string; key: string; status: 'error' };

function Message({ children }: { children: React.ReactNode }) {
  return (
    <Card>
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * The Overview tab (MS-06), top-down as in the mockup: the summary line, the
 * KPI cards, the trend beside the platform table, and the competitor
 * framing. One read per filter change; a newer change wins over a read
 * still on its way.
 */
export function MentionsOverviewTab({
  brandId,
  brand,
  filters,
}: {
  brandId: string;
  brand: string;
  filters: MentionsFilters;
}) {
  const t = useTranslations('mentions.overview');
  const query = useMemo(() => mentionsQuery(filters), [filters]);
  const key = query ? JSON.stringify([brandId, query]) : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);

  useEffect(() => {
    if (!key || !query) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getMentionsOverview(brandId, query)
        .then((overview) => {
          if (!cancelled) setLoaded({ brandId, key, status: 'ok', overview });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ brandId, key, status: 'error' });
        });
    }, READ_DELAY_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [brandId, key, query]);

  if (!query) return <Message>{t('pickDates')}</Message>;
  // Another brand's figures are never shown under this one's name.
  if (!loaded || loaded.brandId !== brandId) return <OverviewSkeleton />;
  if (loaded.status === 'error') {
    // A failed read gives way to the skeleton once a newer one is on its way.
    return loaded.key === key ? <Message>{t('loadError')}</Message> : <OverviewSkeleton />;
  }
  if (!loaded.overview) return <Message>{t('unavailable')}</Message>;

  const overview = loaded.overview;
  // The last read stays on screen, dimmed, while a newer one is on its way.
  const stale = loaded.key !== key;
  return (
    <section
      aria-label={t('sectionLabel')}
      aria-busy={stale}
      className={cn('flex flex-col gap-3 transition-opacity', stale && 'opacity-60')}
    >
      {overview.current.answers === 0 ? (
        <Message>{t('empty')}</Message>
      ) : (
        <>
          <Headline overview={overview} brand={brand} />
          <OverviewKpis overview={overview} brand={brand} />
          {/* Each card keeps its own height: the table grows with the platforms. */}
          <div className="grid items-start gap-3 xl:grid-cols-2">
            <TrendCard overview={overview} />
            <PlatformTable rows={overview.platforms} />
          </div>
          <CompetitorTable overview={overview} brand={brand} />
        </>
      )}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-[72px] w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[124px] rounded-xl" />
        ))}
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <Skeleton className="h-[300px] rounded-xl" />
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    </div>
  );
}
