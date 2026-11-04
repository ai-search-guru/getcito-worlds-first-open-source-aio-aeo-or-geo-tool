'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Layers, MessageCircle, Percent, Smile } from 'lucide-react';
import { numberFormat } from '@/lib/numberFormat';
import { wholeNet } from '@/lib/mentionsHeadline';
import {
  changeBasis,
  isLowSample,
  LOW_SAMPLE_MENTIONS,
  mentionRate,
  mentionTrend,
  relativeChange,
  sentimentSplit,
  type MentionsOverview,
} from '@/lib/mentionsOverview';
import { MetricCard } from '../insights/_KpiCards';
import { signedValue, upIsGood } from '../insights/kpiFormat';
import { SentimentLegend, SentimentSplitBar } from './_SentimentSplit';

/** A share as a bar where the Insights cards draw their sparkline. */
function ShareBar({ value, label }: { value: number; label: string }) {
  return (
    <div
      role="img"
      aria-label={label}
      className="my-[9px] h-1.5 overflow-hidden rounded-full bg-muted"
    >
      <div className="h-full rounded-full bg-foreground/60" style={{ width: `${value}%` }} />
    </div>
  );
}

/**
 * The Overview's KPI cards (MS-06), as in the mockup: Total mentions (every
 * time a response names the brand, as on Insights), Mention rate, Prompts with
 * mentions and Net sentiment with its split and n. Each
 * change is against the window of the same length before; a rate taken over
 * fewer than 20 responses is a "Low sample" and shows no change.
 */
export function OverviewKpis({ overview, brand }: { overview: MentionsOverview; brand: string }) {
  const t = useTranslations('mentions.overview.kpi');
  const locale = useLocale();
  const f = numberFormat(locale);
  const { current: cur } = overview;
  // Every change is taken on the prompts both windows answered, as Insights
  // takes its changes (changeBasis); the values are the whole window's.
  const { current: base, previous: prev } = changeBasis(overview);
  const trend = mentionTrend(overview);
  const round = (n: number | null, digits = 0) =>
    n === null ? null : Math.round(n * 10 ** digits) / 10 ** digits;

  const rate = mentionRate(cur);
  const baseRate = mentionRate(base);
  const prevRate = mentionRate(prev);
  const lowAnswers = cur.answers < LOW_SAMPLE_MENTIONS;
  // A change also needs both shared windows to clear the floor, as the
  // summary line's does (mentionsHeadline.ts), each over its own sample:
  // the rate's is the responses, the net's the responses naming the brand.
  const rateChangeLow =
    lowAnswers || base.answers < LOW_SAMPLE_MENTIONS || prev.answers < LOW_SAMPLE_MENTIONS;
  const netChangeLow = isLowSample(cur) || isLowSample(base) || isLowSample(prev);
  const net = wholeNet(cur);
  const baseNet = wholeNet(base);
  const prevNet = wholeNet(prev);
  const split = sentimentSplit(cur);
  const promptShare = cur.prompts > 0 ? (cur.promptsWithMentions * 100) / cur.prompts : 0;

  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricCard
        label={t('totalMentions')}
        tooltip={t('totalMentionsTip', { brand })}
        icon={MessageCircle}
        // Every time a response names the brand, as Insights counts mentions.
        value={f.number(cur.occurrences)}
        delta={upIsGood(round(relativeChange(base.occurrences, prev.occurrences)), {
          percent: true,
          locale,
        })}
        sub={t('totalMentionsSub', { brand })}
        spark={trend.map((d) => d.occurrences)}
      />
      <MetricCard
        label={t('mentionRate')}
        tooltip={`${t('mentionRateTip', { brand })} ${t('sampleTip', { count: cur.answers })}`}
        icon={Percent}
        value={rate === null ? '—' : f.percent(rate, 1)}
        delta={
          rateChangeLow || rate === null || baseRate === null || prevRate === null
            ? null
            : upIsGood(round(baseRate - prevRate, 1), { locale })
        }
        sub={
          rate !== null && lowAnswers
            ? t('lowSample', { count: cur.answers })
            : t('mentionRateSub', { count: f.number(cur.answers) })
        }
        spark={trend.map((d) => d.rate)}
      />
      <MetricCard
        label={t('promptsWithMentions')}
        tooltip={t('promptsWithMentionsTip', { brand })}
        icon={Layers}
        value={f.number(cur.promptsWithMentions)}
        delta={upIsGood(round(relativeChange(base.promptsWithMentions, prev.promptsWithMentions)), {
          percent: true,
          locale,
        })}
        sub={t('promptsWithMentionsSub', { count: f.number(cur.prompts) })}
        footer={
          <ShareBar
            value={promptShare}
            label={`${f.number(cur.promptsWithMentions)} ${t('promptsWithMentionsSub', {
              count: f.number(cur.prompts),
            })}`}
          />
        }
      />
      <MetricCard
        label={t('netSentiment')}
        tooltip={`${t('netSentimentTip', { brand })} ${t('sampleTipNamed', {
          count: cur.mentions,
          brand,
        })}`}
        icon={Smile}
        value={net === null ? '—' : signedValue(net, locale)}
        delta={
          netChangeLow || net === null || baseNet === null || prevNet === null
            ? null
            : upIsGood(baseNet - prevNet, { locale })
        }
        sub={
          split === null ? null : isLowSample(cur) ? (
            t('lowSample', { count: cur.mentions })
          ) : (
            <SentimentLegend split={split} />
          )
        }
        footer={
          split ? <SentimentSplitBar split={split} className="my-[9px]" /> : <div className="h-6" />
        }
      />
    </div>
  );
}
