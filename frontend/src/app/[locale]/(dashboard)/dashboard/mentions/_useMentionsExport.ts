'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { exportMentions, getMentionsOverview } from '@/lib/actions/mentions';
import {
  mentionsCsv,
  mentionsExportFileName,
  utcMinute,
  type ExportFact,
} from '@/lib/mentionsExport';
import { mentionsQuery, type MentionsFilters } from '@/lib/mentionsFilters';
import { exportFileWord } from '@/lib/white-label/exportName';
import { mentionPlatformLabel, wholeNet } from '@/lib/mentionsHeadline';
import { NO_COMPETITOR, type MentionsList, type MentionsTableState } from '@/lib/mentionsList';
import {
  changeBasis,
  isLowSample,
  LOW_SAMPLE_MENTIONS,
  mentionRate,
  relativeChange,
  sentimentSplit,
  type MentionsOverview,
} from '@/lib/mentionsOverview';
import { numberFormat } from '@/lib/numberFormat';
import { regionLabel } from '@/lib/region';
import type { Competitor, Topic } from '@/types';
import { signedValue, upIsGood } from '../insights/kpiFormat';
import { headlineSentences, windowRange } from './_headline';

// Written out so Excel reads the CSV as UTF-8 and keeps Turkish characters.
const BYTE_ORDER_MARK = String.fromCharCode(0xfeff);

/** Saves a file the browser built, as the Action Center's export does. */
function save(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  // Revoked once the download has started; at once, some browsers drop it.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Puts text on the clipboard that is still being read. Safari lets a page
 * write the clipboard only within the click, so the text goes over as a
 * promise where the browser takes one; elsewhere it is written once ready.
 */
async function copyText(text: Promise<string>) {
  // Missing outside a secure context (e.g. a self-hosted install over http).
  if (!navigator.clipboard) throw new Error('Clipboard unavailable');
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
    try {
      const blob = text.then((s) => new Blob([s], { type: 'text/plain' }));
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return;
    } catch {
      // A browser that doesn't take a promise: write the text itself below.
    }
  }
  await navigator.clipboard.writeText(await text);
}

/**
 * Export CSV and Copy summary for the Mentions & Sentiment page (MS-13).
 * Both read what they need when clicked, under the page's filters, and say
 * which filters and how many responses and mentions they rest on (spec §16).
 */
export function useMentionsExport({
  brandId,
  brand,
  slug,
  filters,
  topics,
  competitors,
}: {
  brandId: string;
  brand: string;
  slug: string;
  filters: MentionsFilters;
  topics: Topic[];
  competitors: Competitor[];
}) {
  const t = useTranslations('mentions.export');
  const tMentions = useTranslations('mentions');
  const tFilters = useTranslations('mentions.filters');
  const tTable = useTranslations('mentions.table');
  const tSentiment = useTranslations('mentions.overview.sentiment');
  const tHeadline = useTranslations('mentions.overview.headline');
  const tKpi = useTranslations('mentions.overview.kpi');
  const locale = useLocale();
  const f = numberFormat(locale);
  const query = useMemo(() => mentionsQuery(filters), [filters]);
  const [busy, setBusy] = useState<'csv' | 'copy' | null>(null);

  // The page's filters, an "All …" value for each one left open.
  const filterValues = () => {
    const topic = topics.find((x) => x.id === filters.topic)?.name ?? filters.topic;
    return {
      platform: filters.platform
        ? mentionPlatformLabel(filters.platform)
        : tFilters('allPlatforms'),
      country: filters.region ? regionLabel(filters.region) : tFilters('allCountries'),
      topic: filters.topic ? topic : tFilters('allTopics'),
      search: filters.q.trim(),
    };
  };

  const period = (w: MentionsOverview['window']) =>
    w.source === 'answers'
      ? t('facts.periodMoments', { from: utcMinute(w.from), to: utcMinute(w.to) })
      : t('facts.periodDays', { from: w.dayFrom, to: w.dayTo, days: w.days });

  /**
   * Saves the mentions as CSV: every one under the filters (and, from the
   * Mentions tab, the table's), or the rows ticked in the table.
   */
  const exportCsv = async (
    table: MentionsTableState,
    selection?: Pick<MentionsList, 'total' | 'prompts' | 'rows'>,
  ) => {
    if (!query || busy) return;
    setBusy('csv');
    try {
      const [overview, list] = await Promise.all([
        getMentionsOverview(brandId, query),
        selection ?? exportMentions(brandId, query, table),
      ]);
      if (!overview || !list) throw new Error('Mentions are unavailable');
      if (list.rows.length === 0) {
        toast.info(t('nothing'));
        return;
      }

      const shown = { shown: f.number(list.rows.length), total: f.number(list.total) };
      const capped = !selection && list.rows.length < list.total;
      const values = filterValues();
      const competitor =
        table.competitor === NO_COMPETITOR
          ? tTable('noCompetitor')
          : (competitors.find((c) => c.id === table.competitor)?.name ?? table.competitor);
      const facts: ExportFact[] = [
        { label: tMentions('title'), value: brand },
        { label: t('facts.period'), value: period(overview.window) },
        { label: tFilters('platform'), value: values.platform },
        { label: tFilters('country'), value: values.country },
        { label: tFilters('topic'), value: values.topic },
        ...(values.search ? [{ label: tFilters('search'), value: values.search }] : []),
        ...(table.sentiment
          ? [{ label: tTable('sentiment'), value: tSentiment(table.sentiment) }]
          : []),
        ...(table.competitor ? [{ label: tTable('coMentioned'), value: competitor }] : []),
        { label: t('facts.responses'), value: overview.current.answers },
        // The card's Total mentions (every time a response names the brand),
        // then the responses the rows below are.
        { label: t('facts.totalMentions'), value: overview.current.occurrences },
        { label: t('facts.namedResponses'), value: list.total },
        { label: t('facts.prompts'), value: list.prompts },
        { label: t('facts.inFile'), value: list.rows.length },
        ...(capped ? [{ label: t('facts.note'), value: t('facts.capped', shown) }] : []),
        { label: t('facts.exported'), value: utcMinute(new Date()) },
      ];
      save(
        new Blob([BYTE_ORDER_MARK, mentionsCsv(facts, list.rows)], {
          type: 'text/csv;charset=utf-8;',
        }),
        mentionsExportFileName(slug, new Date(), await exportFileWord()),
      );
      if (capped) toast.warning(t('capped', shown));
    } catch {
      toast.error(t('exportFailed'));
    } finally {
      setBusy(null);
    }
  };

  /** The Overview's figures as text: the summary line, the KPIs with their n, and the filters. */
  const summaryText = (overview: MentionsOverview): string => {
    const { current: cur } = overview;
    // The change as the Total mentions card takes it: on the prompts both
    // windows answered (changeBasis), as Insights does, not all of each.
    const { current: base, previous: prev } = changeBasis(overview);
    const plain = (key: string, values: Record<string, string | number>) =>
      tHeadline.markup(key, { ...values, b: (chunks) => chunks, tone: (chunks) => chunks });
    const line = (label: string, value: string, change?: string) =>
      change
        ? t('summary.kpiChange', { label, value, change })
        : t('summary.kpi', { label, value });

    const values = filterValues();
    // As the Total mentions card counts them: every time a response names the brand.
    const change = relativeChange(base.occurrences, prev.occurrences);
    const total = upIsGood(change === null ? null : Math.round(change), { percent: true, locale });
    const rate = mentionRate(cur);
    const net = wholeNet(cur);
    const split = sentimentSplit(cur);

    return [
      t('summary.title', { brand }),
      [
        values.platform,
        values.country,
        values.topic,
        ...(values.search ? [t('summary.search', { q: values.search })] : []),
      ].join(' · '),
      headlineSentences(overview, brand, locale, tHeadline)
        .map((s) => plain(s.key, s.values))
        .join(' '),
      line(tKpi('totalMentions'), f.number(cur.occurrences), total?.text),
      line(
        tKpi('mentionRate'),
        rate === null
          ? '—'
          : cur.answers < LOW_SAMPLE_MENTIONS
            ? `${f.percent(rate, 1)} · ${tKpi('lowSample', { count: cur.answers })}`
            : `${f.percent(rate, 1)} ${tKpi('mentionRateSub', { count: f.number(cur.answers) })}`,
      ),
      line(
        tKpi('promptsWithMentions'),
        `${f.number(cur.promptsWithMentions)} ${tKpi('promptsWithMentionsSub', {
          count: f.number(cur.prompts),
        })}`,
      ),
      line(
        tKpi('netSentiment'),
        net === null || !split
          ? '—'
          : isLowSample(cur)
            ? `${signedValue(net, locale)} · ${tKpi('lowSample', { count: cur.mentions })}`
            : t('summary.net', {
                net: signedValue(net, locale),
                split: tKpi('splitLabel', {
                  positive: f.percent(split.positive, 0),
                  neutral: f.percent(split.neutral, 0),
                  negative: f.percent(split.negative, 0),
                }),
                count: cur.mentions,
              }),
      ),
      tHeadline('basis', {
        range: windowRange(overview.window, locale),
        answers: cur.answers,
        mentions: cur.occurrences,
      }),
    ].join('\n');
  };

  /** Copies the Overview's summary under the page's filters. */
  const copySummary = async () => {
    if (!query || busy) return;
    setBusy('copy');
    const text = getMentionsOverview(brandId, query).then((overview) => {
      if (!overview) throw new Error('Mentions are unavailable');
      return summaryText(overview);
    });
    try {
      await copyText(text);
      toast.success(t('copied'));
    } catch {
      // A failed read can be tried again; a clipboard the browser refused needs the reader.
      const read = await text.then(
        () => true,
        () => false,
      );
      toast.error(read ? t('copyBlocked') : t('copyFailed'));
    } finally {
      setBusy(null);
    }
  };

  return { ready: query !== null, busy, exportCsv, copySummary };
}
