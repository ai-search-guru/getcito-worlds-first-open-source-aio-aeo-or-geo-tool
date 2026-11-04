'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getMentionsPerception } from '@/lib/actions/mentions';
import { mentionsQuery, type MentionsFilters } from '@/lib/mentionsFilters';
import type { MentionsPerception } from '@/lib/mentionsPerception';
import { cn } from '@/lib/utils';
import { BrandShapeCard } from './_BrandShape';
import { CoMentionsCard, HeatmapCard, TermsCard } from './_PerceptionCards';

/** Typing in the search box reads once it pauses, not on every key. */
const READ_DELAY_MS = 250;
/** A read still on its way after this says it is still reading. */
const SLOW_MS = 4_000;

type Loaded =
  | { brandId: string; key: string; status: 'ok'; perception: MentionsPerception | null }
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
 * The Perception tab (MS-09), as in the mockup: what AI associates with the
 * brand and the brand's shape against its competitors, then the brand ×
 * attribute heat map and the competitors named beside it. One read per
 * filter change; a newer change wins over a read still on its way. A read
 * that fails is tried once more before the tab says so (a cold read past
 * the database's limit usually answers the second time), and a slow one
 * says it is still reading.
 */
export function MentionsPerceptionTab({
  brandId,
  brand,
  filters,
}: {
  brandId: string;
  brand: string;
  filters: MentionsFilters;
}) {
  const t = useTranslations('mentions.perception');
  const common = useTranslations('common');
  const query = useMemo(() => mentionsQuery(filters), [filters]);
  const key = query ? JSON.stringify([brandId, query]) : null;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Try again reads the same filters once more.
  const [attempt, setAttempt] = useState(0);
  // The read (for these filters, this try) still on its way after SLOW_MS.
  const [slow, setSlow] = useState<string | null>(null);
  const readKey = key ? `${key}#${attempt}` : null;

  useEffect(() => {
    if (!key || !query) return;
    let cancelled = false;
    const read = () => getMentionsPerception(brandId, query);
    const timer = setTimeout(() => {
      read()
        // Once more before saying it failed.
        .catch((err) => (cancelled ? Promise.reject(err) : read()))
        .then((perception) => {
          if (!cancelled) setLoaded({ brandId, key, status: 'ok', perception });
        })
        .catch(() => {
          if (!cancelled) setLoaded({ brandId, key, status: 'error' });
        });
    }, READ_DELAY_MS);
    const slowTimer = setTimeout(() => {
      if (!cancelled) setSlow(`${key}#${attempt}`);
    }, SLOW_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearTimeout(slowTimer);
      // Back on these filters later, the read starts over: not slow yet.
      setSlow((s) => (s === `${key}#${attempt}` ? null : s));
    };
  }, [brandId, key, query, attempt]);

  const isSlow = slow !== null && slow === readKey;
  const skeleton = <PerceptionSkeleton slow={isSlow} />;
  if (!query) return <Message>{t('pickDates')}</Message>;
  if (!loaded || loaded.brandId !== brandId) return skeleton;
  if (loaded.status === 'error') {
    return loaded.key === key ? (
      <Message>
        <p>{t('loadError')}</p>
        <Button
          className="mt-4 gap-2"
          size="sm"
          variant="outline"
          onClick={() => {
            setLoaded(null);
            setAttempt((n) => n + 1);
          }}
        >
          <RotateCw className="h-4 w-4" />
          {common('retry')}
        </Button>
      </Message>
    ) : (
      skeleton
    );
  }
  if (!loaded.perception) return <Message>{t('unavailable')}</Message>;

  const perception = loaded.perception;
  const stale = loaded.key !== key;
  const mentions = perception.entities.find((e) => e.isBrand)?.mentions ?? 0;

  return (
    <div className="flex flex-col gap-3">
      {/* The figures shown are the last filters': a slow read of the new ones says so. */}
      <SlowNote slow={stale && isSlow} />
      <section
        aria-label={t('sectionLabel')}
        aria-busy={stale}
        className={cn('flex flex-col gap-3 transition-opacity', stale && 'opacity-60')}
      >
        {mentions === 0 ? (
          <Message>{t('noMentions', { brand })}</Message>
        ) : (
          <>
            <div className="grid items-start gap-3 xl:grid-cols-2">
              <TermsCard perception={perception} brand={brand} />
              <BrandShapeCard perception={perception} brand={brand} />
            </div>
            <div className="grid items-start gap-3 xl:grid-cols-2">
              <HeatmapCard perception={perception} />
              <CoMentionsCard perception={perception} />
            </div>
            <p className="text-xs text-muted-foreground">{t('method')}</p>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Says a read is still on its way. Always in the page, empty until then, so
 * screen readers announce the words when they come.
 */
function SlowNote({ slow }: { slow: boolean }) {
  const t = useTranslations('mentions.perception');
  return (
    <p role="status" className={cn('text-sm text-muted-foreground', !slow && 'sr-only')}>
      {slow ? t('slow') : ''}
    </p>
  );
}

function PerceptionSkeleton({ slow }: { slow: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <SlowNote slow={slow} />
      <div className="grid gap-3 xl:grid-cols-2" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[300px] rounded-xl" />
        ))}
      </div>
    </div>
  );
}
