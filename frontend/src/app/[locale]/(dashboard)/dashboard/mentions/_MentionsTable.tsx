'use client';

import { Fragment } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { AIProviderAvatar, resolveAIProvider } from '@/components/AiProviderAvatar';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { mentionPlatformLabel } from '@/lib/mentionsHeadline';
import type { MentionGroup, MentionRow } from '@/lib/mentionsList';
import { formatRegionDisplay } from '@/lib/region';
import { Highlighted, SentimentPill, type MentionNames } from './_MentionParts';

/**
 * The Mentions table (MS-07), as in the mockup: per answer naming the brand,
 * the prompt (pinned while the table scrolls sideways, under a pinned
 * header), platform, country, the passage around the mention with the names
 * marked, sentiment, position, the competitors named beside you, topic and
 * date. With grouping on, each group opens with its name and size. A row
 * opens the answer; its box ticks it for a bulk action.
 */
export function MentionsTable({
  rows,
  names,
  group,
  showCountry,
  selected,
  onSelect,
  onOpen,
}: {
  rows: MentionRow[];
  names: MentionNames;
  group: MentionGroup | '';
  showCountry: boolean;
  /** The answers ticked for a bulk action, by id. */
  selected: ReadonlySet<string>;
  /** Ticks or unticks answers; the header box takes every row on the page. */
  onSelect: (ids: string[], on: boolean) => void;
  onOpen: (row: MentionRow) => void;
}) {
  const t = useTranslations('mentions.table');
  const tActions = useTranslations('mentions.actions');
  const ticked = rows.filter((r) => selected.has(r.id)).length;
  const locale = useLocale();
  const columns = showCountry ? 9 : 8;
  const day = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { month: 'short', day: 'numeric' });

  return (
    <Table stickyHeader stickyFirstColumn aria-label={t('tableLabel')}>
      <TableHeader>
        <TableRow>
          <TableHead className="min-w-[240px] pl-4">
            <span className="flex items-center gap-3">
              <Checkbox
                aria-label={tActions('selectAll')}
                checked={ticked === 0 ? false : ticked === rows.length ? true : 'indeterminate'}
                onCheckedChange={(on) =>
                  onSelect(
                    rows.map((r) => r.id),
                    on === true,
                  )
                }
              />
              {t('columns.prompt')}
            </span>
          </TableHead>
          <TableHead>{t('columns.platform')}</TableHead>
          {showCountry && <TableHead>{t('columns.country')}</TableHead>}
          <TableHead className="min-w-[320px]">{t('columns.context')}</TableHead>
          <TableHead>{t('columns.sentiment')}</TableHead>
          <TableHead>{t('columns.position')}</TableHead>
          <TableHead className="min-w-[140px]">{t('columns.coMentioned')}</TableHead>
          <TableHead>{t('columns.topic')}</TableHead>
          <TableHead className="pr-4">{t('columns.date')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row, i) => {
          const platform = mentionPlatformLabel(row.platform);
          const opensGroup = group !== '' && row.groupKey !== rows[i - 1]?.groupKey;
          return (
            <Fragment key={row.id}>
              {opensGroup && (
                <TableRow className="hover:bg-transparent">
                  <TableCell
                    colSpan={columns}
                    className="bg-muted/60 py-1.5 pl-4 text-xs font-medium text-muted-foreground"
                  >
                    {t('groupRow', {
                      label: group === 'prompt' ? row.promptText : platform,
                      count: row.groupCount ?? 0,
                    })}
                  </TableCell>
                </TableRow>
              )}
              <TableRow
                tabIndex={0}
                aria-label={t('openRow', { prompt: row.promptText, platform })}
                className="cursor-pointer align-top hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                onClick={() => onOpen(row)}
                onKeyDown={(e) => {
                  // Space on the row's box ticks it; only the row itself opens.
                  if (e.target !== e.currentTarget) return;
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onOpen(row);
                  }
                }}
              >
                <TableCell className="max-w-[280px] pl-4 whitespace-normal">
                  <span className="flex items-start gap-3">
                    <Checkbox
                      aria-label={tActions('selectRow', { prompt: row.promptText, platform })}
                      checked={selected.has(row.id)}
                      onClick={(e) => e.stopPropagation()}
                      onCheckedChange={(on) => onSelect([row.id], on === true)}
                      className="mt-0.5"
                    />
                    <span className="line-clamp-2 text-sm font-medium" title={row.promptText}>
                      {row.promptText}
                    </span>
                  </span>
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-sm">
                    <AIProviderAvatar
                      plain
                      provider={resolveAIProvider(row.platform, row.platform)}
                      className="h-4 w-4"
                    />
                    {platform}
                  </span>
                </TableCell>
                {showCountry && (
                  <TableCell className="whitespace-nowrap text-sm">
                    {row.region ? formatRegionDisplay(row.region) : '—'}
                  </TableCell>
                )}
                <TableCell className="max-w-[420px] whitespace-normal">
                  <span className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                    <Highlighted text={row.excerpt} names={names} />
                  </span>
                </TableCell>
                <TableCell>
                  <SentimentPill sentiment={row.sentiment} />
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm tabular-nums">
                  {row.position === null
                    ? '—'
                    : row.brandsNamed
                      ? t('positionOf', { position: row.position, count: row.brandsNamed })
                      : t('positionOnly', { position: row.position })}
                </TableCell>
                <TableCell className="max-w-[200px] whitespace-normal">
                  <span className="line-clamp-2 text-xs text-muted-foreground">
                    {row.coMentioned.length > 0
                      ? row.coMentioned.map((c) => c.name).join(', ')
                      : '—'}
                  </span>
                </TableCell>
                <TableCell className="max-w-[180px] whitespace-normal">
                  <span className="line-clamp-2 text-xs">{row.topicName ?? '—'}</span>
                </TableCell>
                <TableCell className="whitespace-nowrap pr-4 text-xs text-muted-foreground">
                  {day(row.createdAt)}
                </TableCell>
              </TableRow>
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
