'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useChatPageContext } from '@/components/chat/panel/chatPanelContext';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { getCompetitors } from '@/lib/actions/competitor';
import { getTopics } from '@/lib/actions/topic';
import { getBrandFilterOptions } from '@/lib/actions/tracking';
import { rangeChipLabel } from '@/lib/chat/pageContext';
import {
  DEFAULT_MENTIONS_FILTERS,
  DEFAULT_MENTIONS_TAB,
  MENTIONS_TABS,
  mentionsStateParams,
  readMentionsState,
  type MentionsFilters,
  type MentionsTab,
} from '@/lib/mentionsFilters';
import { POSITION_PLATFORMS } from '@/lib/promptPositions';
import { formatRegionDisplay } from '@/lib/region';
import { writeUrlParams } from '@/lib/urlState';
import { useBrandStore } from '@/state/useBrandStore';
import type { Competitor, Topic } from '@/types';
import { MentionsFilterBar } from './_FilterBar';
import { MentionsHeaderActions } from './_HeaderActions';
import { MentionsListTab } from './_MentionsTab';
import { MentionsOverviewTab } from './_overview';
import { MentionsPerceptionTab } from './_perception';
import { useMentionsExport } from './_useMentionsExport';
import { HeaderWithAiUsage } from '@/components/ai-usage/AiUsageMeter';

/**
 * Mentions & Sentiment (MS-05): where AI mentions the brand, how it describes
 * it, and what to do about it — built from the answers tracking already
 * stores, so opening the page or changing a filter never calls an LLM.
 *
 * Top-down as the spec orders it: the header's Copy summary, Export CSV and
 * Reports, the tabs, then the filters every tab shares, then the tab's
 * content. Tab and filters live in the URL. Chat's side panel sees the
 * page's name, dates and filters, three questions about it, and its trend
 * chart and platform table (W1-08).
 */
export default function MentionsPage() {
  const t = useTranslations('mentions');
  const activeBrandId = useBrandStore((s) => s.activeBrandId);
  const activeBrand = useBrandStore((s) => s.brands.find((b) => b.id === s.activeBrandId));
  const brandName = activeBrand?.name ?? '';
  const brandDomains = useMemo(
    () => (activeBrand?.domains ?? []).map((d) => d.domain).filter(Boolean),
    [activeBrand],
  );

  const [tab, setTab] = useState<MentionsTab>(DEFAULT_MENTIONS_TAB);
  const [filters, setFilters] = useState<MentionsFilters>(DEFAULT_MENTIONS_FILTERS);
  // Read after mount (window isn't available during the server render), as
  // Citations does; the URL is written only once it has been read.
  const [urlRead, setUrlRead] = useState(false);
  useEffect(() => {
    const state = readMentionsState(new URLSearchParams(window.location.search));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one read of the URL after mount
    setTab(state.tab);
    setFilters(state.filters);
    setUrlRead(true);
  }, []);
  useEffect(() => {
    if (urlRead) writeUrlParams(mentionsStateParams(tab, filters));
  }, [urlRead, tab, filters]);

  const [regions, setRegions] = useState<string[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [competitors, setCompetitors] = useState<Competitor[]>([]);
  useEffect(() => {
    if (!activeBrandId) return;
    let cancelled = false;
    getBrandFilterOptions(activeBrandId)
      .then((options) => {
        if (!cancelled) setRegions([...options.regions].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
    getTopics(activeBrandId)
      .then((rows) => {
        if (!cancelled) setTopics(rows);
      })
      .catch(() => {});
    getCompetitors(activeBrandId)
      .then((rows) => {
        if (!cancelled) setCompetitors(rows);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeBrandId]);

  const tRange = useTranslations('chatPanel.range');
  const tFilters = useTranslations('mentions.filters');
  const tTrend = useTranslations('mentions.overview.trend');
  const tPlatforms = useTranslations('mentions.overview.platforms');
  const platformName = POSITION_PLATFORMS.find((p) => p.id === filters.platform)?.label;
  const topicName = topics.find((topic) => topic.id === filters.topic)?.name;
  useChatPageContext(
    activeBrandId
      ? {
          pageName: t('title'),
          dateRange: {
            from: filters.range === 'custom' ? filters.from : filters.range,
            to: filters.range === 'custom' ? filters.to : null,
            label: rangeChipLabel(filters.range, filters, (key, values) => tRange(key, values)),
          },
          filters: [
            {
              key: 'platform',
              label: platformName ?? tFilters('allPlatforms'),
              value: filters.platform,
            },
            ...(filters.region
              ? [
                  {
                    key: 'region',
                    label: formatRegionDisplay(filters.region),
                    value: filters.region,
                  },
                ]
              : []),
            ...(filters.topic && topicName
              ? [{ key: 'topic', label: topicName, value: filters.topic }]
              : []),
          ],
          suggestions: [t('chat.leastPlatform'), t('chat.insteadOfUs'), t('chat.actions')],
          referenceables: [
            { type: 'chart', id: 'mentions-trend', label: tTrend('title') },
            { type: 'table', id: 'mentions-by-platform', label: tPlatforms('title') },
          ],
        }
      : null,
  );

  const exporter = useMentionsExport({
    brandId: activeBrandId ?? '',
    brand: brandName,
    slug: activeBrand?.slug ?? '',
    filters,
    topics,
    competitors,
  });

  if (!activeBrandId) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-muted-foreground">{t('selectBrand')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <HeaderWithAiUsage>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
            <p className="text-sm text-muted-foreground">{t('description')}</p>
          </div>
          {urlRead && <MentionsHeaderActions tab={tab} exporter={exporter} />}
        </div>
      </HeaderWithAiUsage>

      <Tabs value={tab} onValueChange={(v) => setTab(v as MentionsTab)}>
        <TabsList aria-label={t('tabs.label')}>
          {MENTIONS_TABS.map((id) => (
            <TabsTrigger key={id} value={id}>
              {t(`tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        <div className="mt-4">
          <MentionsFilterBar
            filters={filters}
            onChange={(patch) => setFilters((prev) => ({ ...prev, ...patch }))}
            regions={regions}
            topics={topics}
            searchPlaceholder={
              tab === 'perception' ? t('filters.searchPlaceholderPerception') : undefined
            }
          />
        </div>

        <TabsContent value="overview" className="mt-4">
          {/* Read once the URL's filters are in, so the first read is the right one. */}
          {urlRead && (
            <MentionsOverviewTab brandId={activeBrandId} brand={brandName} filters={filters} />
          )}
        </TabsContent>
        <TabsContent value="mentions" className="mt-4">
          {urlRead && (
            <MentionsListTab
              brandId={activeBrandId}
              filters={filters}
              competitors={competitors}
              brandDomains={brandDomains}
              showCountry={regions.length > 1}
              exporter={exporter}
            />
          )}
        </TabsContent>
        <TabsContent value="perception" className="mt-4">
          {urlRead && (
            <MentionsPerceptionTab brandId={activeBrandId} brand={brandName} filters={filters} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
