
import { useMemo } from "react";
import {
	type CitationCategory,
	CATEGORY_CONFIG,
	CITATION_CATEGORIES,
	CITATION_PAGE_TYPES,
	PAGE_TYPE_CONFIG,
} from "@/lib/domain-categories";
import type { CitationData } from "@/components/citations/types";
import { CATEGORY_META, PAGE_TYPE_META } from "@/components/citations/shared";
import { CitationStatsCards } from "@/components/citations/stats-cards";
import { TrendAreaChart } from "@/components/citations/trend-area-chart";
import { RecentChangesCard } from "@/components/citations/recent-changes-card";
import { ContentGapsCard } from "@/components/citations/content-gaps-card";
import { TopDomainsCard } from "@/components/citations/top-domains-card";
import { TopUrlsCard } from "@/components/citations/top-urls-card";
import { GoogleShoppingCard } from "@/components/citations/google-shopping-card";
import { RedditCard, useSubredditData } from "@/components/citations/reddit-card";

export type {
	CitationData,
	GoogleModuleData,
	GoogleProductRow,
	GoogleQueryRow,
} from "@/components/citations/types";

interface CitationsDisplayProps {
	citationData: CitationData;
	brandId?: string;
	brandName?: string;
	showStats?: boolean;
	maxDomains?: number;
	maxUrls?: number;
	days?: number;
	onCompetitorAdded?: () => void;
}

/** Composes the citation sections. Each card owns its own in-card filter
 *  state (search, tabs, pagination); this component only derives the data
 *  every section shares. Section visibility keys off the UNFILTERED data —
 *  in-card filters must never hide a whole section (issue #322). */
export function CitationsDisplay({
	citationData,
	brandId,
	brandName,
	showStats = false,
	maxDomains = 10,
	maxUrls = 20,
	days = 7,
	onCompetitorAdded,
}: CitationsDisplayProps) {
	// Match the last point of the Citation Categories chart exactly (smoothed daily
	// brand share), falling back to the window aggregate if there's no time series.
	const lastTrendPoint = citationData.citationTimeSeries?.[citationData.citationTimeSeries.length - 1];
	const brandShare = lastTrendPoint
		? (lastTrendPoint.brand ?? 0)
		: citationData.totalCitations > 0
			? Math.round((citationData.categoryCounts.brand / citationData.totalCitations) * 100)
			: 0;

	const hasGaps = !!(citationData.competitorOnlyPrompts && citationData.competitorOnlyPrompts.length > 0 && brandId);

	// Single source of truth for which categories / page types appear. Derived from
	// the RAW aggregates (categoryCounts / pageTypeDistribution), NOT the smoothed %
	// time series: a tiny category that rounds to 0% on every day would otherwise
	// vanish from both the chart keys and the tab filters despite having real
	// citations (and being filterable in the URL list). The same lists feed the tab
	// filters and the chart `keys`, so the two stay consistent.
	const chartSourceCategories = useMemo(
		() => CITATION_CATEGORIES.filter((c: CitationCategory) => (citationData.categoryCounts[c] ?? 0) > 0),
		[citationData.categoryCounts],
	);
	const chartPageTypes = useMemo(() => {
		const present = new Set((citationData.pageTypeDistribution ?? []).filter((d) => d.count > 0).map((d) => d.pageType));
		return CITATION_PAGE_TYPES.filter((p) => present.has(p));
	}, [citationData.pageTypeDistribution]);
	const urlSourceTabs = useMemo<{ key: string; label: string }[]>(
		() => [{ key: "all", label: "All Sources" }, ...chartSourceCategories.map((c) => ({ key: c as string, label: CATEGORY_CONFIG[c].label }))],
		[chartSourceCategories],
	);
	const domainSourceTabs = urlSourceTabs; // identical by construction (same chart-category list)
	const urlPageTypeTabs = useMemo<{ key: string; label: string }[]>(
		() => [{ key: "all", label: "All Page Types" }, ...chartPageTypes.map((p) => ({ key: p as string, label: PAGE_TYPE_CONFIG[p].label }))],
		[chartPageTypes],
	);

	const googleModule = citationData.googleModule;
	const subredditData = useSubredditData(citationData.specificUrls, citationData.whatsChanged);
	const whatsChanged = citationData.whatsChanged;
	const totalChanges = whatsChanged
		? whatsChanged.newUrls.length +
			whatsChanged.droppedUrls.length +
			whatsChanged.titleChanges.length +
			whatsChanged.newDomains.length +
			whatsChanged.droppedDomains.length
		: 0;

	// Bail out only AFTER every hook above has run unconditionally (Rules of Hooks).
	if (citationData.totalCitations === 0) return null;

	return (
		<>
			{showStats && (
				<CitationStatsCards
					brandShare={brandShare}
					uniqueDomains={citationData.uniqueDomains}
					totalCitations={citationData.totalCitations}
				/>
			)}

			{/* Citation Categories over time */}
			{citationData.citationTimeSeries && citationData.citationTimeSeries.length > 0 && (
				<TrendAreaChart
					title="Citation Categories"
					tooltip="Share of citations by source category over time, as a percentage of all citations each day. Smoothed to account for staggered prompt schedules; Google AI Mode search/shopping are excluded (see the Google Shopping section)."
					data={(citationData.citationTimeSeries ?? []) as unknown as Array<Record<string, number | string>>}
					keys={chartSourceCategories}
					meta={CATEGORY_META}
				/>
			)}

			{/* Citation Page Types over time */}
			{citationData.pageTypeTimeSeries && citationData.pageTypeTimeSeries.length > 0 && (
				<TrendAreaChart
					title="Citation Page Types"
					tooltip="Share of citations by page type over time — what kind of page each citation points to, inferred from the URL and title."
					data={(citationData.pageTypeTimeSeries ?? []) as unknown as Array<Record<string, number | string>>}
					keys={chartPageTypes}
					meta={PAGE_TYPE_META}
				/>
			)}

			{/* Recent Changes + Content Gaps (side by side) */}
			{(totalChanges > 0 || hasGaps) && (
				<div className={totalChanges > 0 && hasGaps ? "grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch" : "contents"}>
					{totalChanges > 0 && whatsChanged && <RecentChangesCard whatsChanged={whatsChanged} days={days} />}
					{hasGaps && (
						<ContentGapsCard
							prompts={citationData.competitorOnlyPrompts!}
							brandId={brandId!}
						/>
					)}
				</div>
			)}

			{/* Top Cited Domains */}
			{citationData.domainDistribution.length > 0 && (
				<TopDomainsCard
					domains={citationData.domainDistribution}
					sourceTabs={domainSourceTabs}
					maxDomains={maxDomains}
					brandId={brandId}
					brandName={brandName}
					competitors={citationData.competitors}
					onCompetitorAdded={onCompetitorAdded}
				/>
			)}

			{/* Top Cited URLs */}
			{citationData.specificUrls.length > 0 && (
				<TopUrlsCard
					urls={citationData.specificUrls}
					sourceTabs={urlSourceTabs}
					pageTypeTabs={urlPageTypeTabs}
					maxUrls={maxUrls}
					brandId={brandId}
					brandName={brandName}
					brandShare={brandShare}
					brandIsCited={citationData.categoryCounts.brand > 0}
				/>
			)}

			{/* Google Shopping */}
			{googleModule && googleModule.shopping.products.length > 0 && (
				<GoogleShoppingCard googleModule={googleModule} brandId={brandId} />
			)}

			{/* Top Cited Subreddits */}
			{subredditData.length > 0 && <RedditCard subreddits={subredditData} />}
		</>
	);
}
