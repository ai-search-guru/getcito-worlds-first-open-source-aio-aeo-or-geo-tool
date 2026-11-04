'use client';

import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { attributeShares, biggestGap, type MentionsPerception } from '@/lib/mentionsPerception';
import { GapNote } from './_PerceptionCards';
import type { ShapeSeries } from './_BrandShapeChart';

const BrandShapeChart = dynamic(() => import('./_BrandShapeChart').then((m) => m.BrandShapeChart), {
  ssr: false,
  loading: () => <Skeleton className="h-[280px] w-full" />,
});

/** The radar compares you with up to this many competitors (spec §9). */
const RADAR_COMPETITORS = 3;
/**
 * Your brand in ink, as the rest of the Mentions page draws it (#1217,
 * #1220); the competitors in hues that aren't the brand's or violet.
 */
const BRAND_STROKE = 'var(--primary)';
const COMPETITOR_STROKES = ['#f97316', '#0d9488', '#ef4444'];
/** A shape needs at least this many attributes to have one. */
const MIN_ATTRIBUTES = 3;

/**
 * "Brand shape: you vs top competitors" (MS-09): a radar of the brand and its
 * three most mentioned competitors on the attributes that tell them apart,
 * in the Insights trend's colors, with the biggest gap beneath it.
 */
export function BrandShapeCard({
  perception,
  brand,
  className,
}: {
  perception: MentionsPerception;
  brand: string;
  className?: string;
}) {
  const t = useTranslations('mentions.perception.shape');
  const entities = perception.entities.slice(0, RADAR_COMPETITORS + 1);
  const rows = attributeShares({ ...perception, entities });
  const series: ShapeSeries[] = entities.map((e, i) => ({
    key: `e${i}`,
    name: e.isBrand ? brand : e.name,
    color: e.isBrand ? BRAND_STROKE : COMPETITOR_STROKES[(i - 1) % COMPETITOR_STROKES.length],
  }));
  const data = rows.map((row) => ({
    attribute: row.term,
    ...Object.fromEntries(row.shares.map((share, i) => [`e${i}`, share])),
  }));
  const drawable = rows.length >= MIN_ATTRIBUTES && entities.length >= 2;
  // Among the brands drawn, so the note never names one the radar doesn't show.
  const gap = biggestGap({ ...perception, entities });

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t('title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {drawable ? (
          <figure aria-label={t('chartLabel')}>
            <BrandShapeChart data={data} series={series} />
            <figcaption className="flex flex-wrap justify-center gap-3 text-xs text-muted-foreground">
              {series.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: s.color }}
                  />
                  {s.name}
                </span>
              ))}
            </figcaption>
          </figure>
        ) : (
          <p className="text-sm text-muted-foreground">{t('notEnough')}</p>
        )}
        {gap && <GapNote gap={gap} brand={brand} />}
      </CardContent>
    </Card>
  );
}
