'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowUpRight, BarChart3 } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  bareUrl,
  hostOf,
  leaderText,
  pathOf,
  type Affected,
  type AffectedPage,
  type AffectedPrompt,
} from '@/lib/action-center/affected';
import { getPlatformName } from '@/lib/trafficPlatforms';
import { sumEstimates, type VolumeEstimate } from '@/lib/volumeEstimate';
import {
  EstimateBadge,
  EstimateNoteTooltip,
  EstimateRange,
  createEstimateNoteHandle,
} from '@/components/prompts/VolumeEstimate';
import { SignalWhereLine } from './SignalTable';

/**
 * The Affected tab (AC-003): the prompts and pages behind an action's counts.
 * Columns follow what the action's signals record, so a citation recovery
 * shows where each prompt was lost, the page that lost it and what is cited
 * instead, and a traffic action its pages' AI visits. A column nothing fills
 * is left out.
 */
export function AffectedTab({
  affected,
  volumes,
}: {
  affected: Affected;
  /** Estimated monthly AI searches per prompt id; null until read, or when they can't be. */
  volumes: Map<string, VolumeEstimate> | null;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.affected');
  const hasRows = affected.prompts.length > 0 || affected.pages.length > 0;

  return (
    <div className="space-y-6">
      {affected.prompts.length > 0 && (
        <PromptsTable rows={affected.prompts} total={affected.promptTotal} volumes={volumes} />
      )}
      {affected.pages.length > 0 && <PagesTable rows={affected.pages} total={affected.pageTotal} />}
      {affected.competitors.length > 0 &&
        !affected.prompts.some((row) => row.leaders.length > 0) && (
          <NameList label={t('competitors')} names={affected.competitors} />
        )}
      {affected.topics.length > 0 && <NameList label={t('topics')} names={affected.topics} />}
      {!hasRows && affected.competitors.length === 0 && affected.topics.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('empty')}</p>
      )}
    </div>
  );
}

function PromptsTable({
  rows,
  total,
  volumes,
}: {
  rows: AffectedPrompt[];
  total: number;
  volumes: Map<string, VolumeEstimate> | null;
}) {
  const t = useTranslations('actionCenter.actionsPage.drawer.affected');
  // One method note for the column's ranges, as the Prompts tables do.
  const volumeNote = useMemo(() => createEstimateNoteHandle(), []);
  const volumeOf = (row: AffectedPrompt) => (row.id ? (volumes?.get(row.id) ?? null) : null);
  const show = {
    volume: rows.some((row) => volumeOf(row) !== null),
    platforms: rows.some((row) => row.platforms.length > 0),
    lost: rows.some((row) => row.lostPages.length > 0),
    citedInstead: rows.some((row) => row.citedInstead.length > 0),
    ahead: rows.some((row) => row.leaders.length > 0),
  };

  return (
    <section>
      <Heading title={t('prompts', { count: total })} shown={rows.length} total={total} />
      <div className="mt-2 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">{t('prompt')}</TableHead>
              {show.volume && (
                <TableHead className="text-right text-xs">
                  {/* The column's estimates as one total, so its badge says
                      what they are and where they come from. */}
                  <span className="inline-flex items-center gap-1.5">
                    {t('volume')}
                    <EstimateBadge
                      estimate={sumEstimates(
                        rows.map(volumeOf).filter((v): v is VolumeEstimate => v !== null),
                      )}
                      kind="total"
                    />
                  </span>
                </TableHead>
              )}
              {show.platforms && (
                <TableHead className="text-xs">
                  {show.lost ? t('lostOn') : t('platforms')}
                </TableHead>
              )}
              {show.lost && <TableHead className="text-xs">{t('lostPage')}</TableHead>}
              {show.citedInstead && <TableHead className="text-xs">{t('citedInstead')}</TableHead>}
              {show.ahead && <TableHead className="text-xs">{t('ahead')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => {
              const volume = volumeOf(row);
              return (
                <TableRow key={row.id ?? row.text}>
                  <TableCell className="min-w-[10rem] whitespace-normal align-top text-xs">
                    <div className="flex items-start gap-1.5">
                      <div className="min-w-0">
                        {row.id ? (
                          <Link
                            href={`/dashboard/prompts/${row.id}`}
                            className="font-medium underline-offset-2 hover:underline"
                          >
                            {row.text}
                          </Link>
                        ) : (
                          <span className="font-medium">{row.text}</span>
                        )}
                        {row.topics.length > 0 && (
                          <p className="text-[11px] text-muted-foreground">
                            {row.topics.join(', ')}
                          </p>
                        )}
                      </div>
                      {row.id && (
                        <Link
                          href={`/dashboard/prompts?tab=all&positions=${row.id}`}
                          aria-label={t('positions', { prompt: row.text })}
                          title={t('positionsShort')}
                          className="mt-0.5 shrink-0 text-muted-foreground hover:text-foreground"
                        >
                          <BarChart3 className="h-3.5 w-3.5" />
                        </Link>
                      )}
                    </div>
                  </TableCell>
                  {show.volume && (
                    <TableCell className="text-right align-top text-xs tabular-nums">
                      {volume !== null ? (
                        <EstimateRange estimate={volume} handle={volumeNote} />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  )}
                  {show.platforms && (
                    <TableCell className="whitespace-normal align-top text-xs">
                      {row.platforms.length > 0 ? (
                        <SignalWhereLine
                          where={{ platforms: row.platforms, regions: [], topics: [] }}
                        />
                      ) : (
                        '—'
                      )}
                    </TableCell>
                  )}
                  {show.lost && (
                    <TableCell className="min-w-[8rem] whitespace-normal align-top text-xs">
                      <Urls urls={row.lostPages} path />
                    </TableCell>
                  )}
                  {show.citedInstead && (
                    <TableCell className="min-w-[7rem] whitespace-normal align-top text-xs">
                      <Urls urls={row.citedInstead} short />
                    </TableCell>
                  )}
                  {show.ahead && (
                    <TableCell className="min-w-[9rem] whitespace-normal align-top text-xs">
                      {row.leaders.length > 0
                        ? row.leaders.map((leader) => (
                            <p key={`${leader.competitor}:${leader.platform}`}>
                              {leaderText(leader, t)}
                            </p>
                          ))
                        : '—'}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        <EstimateNoteTooltip handle={volumeNote} />
      </div>
    </section>
  );
}

function PagesTable({ rows, total }: { rows: AffectedPage[]; total: number }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.affected');
  const show = {
    visits: rows.some((row) => row.sessions !== null),
    from: rows.some((row) => row.platforms.length > 0),
    issues: rows.some((row) => row.issues.length > 0),
  };

  return (
    <section>
      <Heading title={t('pages', { count: total })} shown={rows.length} total={total} />
      <div className="mt-2 overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">{t('page')}</TableHead>
              {show.visits && <TableHead className="text-right text-xs">{t('visits')}</TableHead>}
              {show.from && <TableHead className="text-xs">{t('from')}</TableHead>}
              {show.issues && <TableHead className="text-xs">{t('issues')}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.url}>
                <TableCell className="min-w-[10rem] whitespace-normal align-top text-xs">
                  <Urls urls={[row.url]} />
                </TableCell>
                {show.visits && (
                  <TableCell className="whitespace-nowrap text-right align-top text-xs tabular-nums">
                    {row.sessions === null
                      ? '—'
                      : row.before === null
                        ? row.sessions
                        : t('visitsValue', { before: row.before, now: row.sessions })}
                  </TableCell>
                )}
                {show.from && (
                  <TableCell className="whitespace-normal align-top text-xs">
                    {row.platforms.map(getPlatformName).join(', ') || '—'}
                  </TableCell>
                )}
                {show.issues && (
                  <TableCell className="whitespace-normal align-top text-xs">
                    {row.issues.join(', ') || '—'}
                  </TableCell>
                )}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

function Heading({ title, shown, total }: { title: string; shown: number; total: number }) {
  const t = useTranslations('actionCenter.actionsPage.drawer.affected');
  return (
    <div className="flex items-baseline justify-between gap-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {total > shown && (
        <p className="text-[11px] text-muted-foreground">{t('more', { shown, total })}</p>
      )}
    </div>
  );
}

function NameList({ label, names }: { label: string; names: string[] }) {
  return (
    <section>
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {names.map((name) => (
          <Badge key={name} variant="outline" className="text-[10px]">
            {name}
          </Badge>
        ))}
      </div>
    </section>
  );
}

/**
 * URLs, linked when they are absolute. `short` shows another site's domain,
 * `path` the brand's own page by its path: the domain is the brand's.
 */
function Urls({
  urls,
  short = false,
  path = false,
}: {
  urls: string[];
  short?: boolean;
  path?: boolean;
}) {
  if (urls.length === 0) return <>—</>;
  return (
    <div className="space-y-0.5">
      {urls.map((url) => {
        const text = short ? (hostOf(url) ?? url) : path ? pathOf(url) : bareUrl(url);
        return /^https?:\/\//.test(url) ? (
          <a
            key={url}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            title={url}
            className="flex items-center gap-0.5 break-words underline-offset-2 hover:underline"
          >
            {text}
            <ArrowUpRight className="h-3 w-3 shrink-0" />
          </a>
        ) : (
          <p key={url} title={url} className="break-words">
            {text}
          </p>
        );
      })}
    </div>
  );
}
