import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { ProcessedBatchChartDataPoint } from "@/lib/postgres-read";
import type { Brand, Competitor } from "@workspace/lib/db/schema";
import { generateDateRange } from "@/lib/chart-utils";

// Chart data for a single prompt (pre-processed for rendering)
export interface ProcessedChartData {
	chartData: Array<{
		date: string;
		[key: string]: number | string | null;
	}>;
	totalRuns: number;
	hasVisibilityData: boolean;
	lastBrandVisibility: number | null;
}

// Context value
interface ChartDataContextValue {
	batchData: ProcessedBatchChartDataPoint[] | null;
	brand: Brand | null;
	competitors: Competitor[];
	dateRange: string[];
	getChartDataForPrompt: (promptId: string) => ProcessedChartData | null;
	isLoading: boolean;
}

const ChartDataContext = createContext<ChartDataContextValue | null>(null);

interface ChartDataProviderProps {
	children: ReactNode;
	batchData: ProcessedBatchChartDataPoint[] | null;
	brand: Brand | null;
	competitors: Competitor[];
	startDate: Date;
	endDate: Date;
	isLoading: boolean;
}

export function ChartDataProvider({
	children,
	batchData,
	brand,
	competitors,
	startDate,
	endDate,
	isLoading,
}: ChartDataProviderProps) {
	const dateRange = useMemo(() => {
		return generateDateRange(startDate, endDate);
	}, [startDate, endDate]);

	const sortedCompetitors = useMemo(() => {
		return [...competitors].sort((a, b) => a.name.localeCompare(b.name));
	}, [competitors]);

	// Index batch data by prompt_id for O(1) lookup
	const dataByPrompt = useMemo(() => {
		if (!batchData) return new Map<string, ProcessedBatchChartDataPoint[]>();

		const map = new Map<string, ProcessedBatchChartDataPoint[]>();
		for (const point of batchData) {
			const existing = map.get(point.prompt_id) || [];
			existing.push(point);
			map.set(point.prompt_id, existing);
		}
		return map;
	}, [batchData]);

	const getChartDataForPrompt = useMemo(() => {
		return (promptId: string): ProcessedChartData | null => {
			if (!brand || !batchData) return null;

			const promptData = dataByPrompt.get(promptId) || [];

			const dailyStatsMap = new Map<string, ProcessedBatchChartDataPoint>();
			for (const stat of promptData) {
				dailyStatsMap.set(String(stat.date), stat);
			}

			const chartData: Array<{ date: string; [key: string]: number | string | null }> = dateRange.map((date) => {
				const dayStat = dailyStatsMap.get(date);
				const totalRuns = dayStat ? Number(dayStat.total_runs) : 0;

				const dataPoint: { date: string; [key: string]: number | string | null } = { date };

				if (totalRuns === 0) {
					dataPoint[brand.id] = null;
					sortedCompetitors.forEach((competitor) => {
						dataPoint[competitor.id] = null;
					});
					return dataPoint;
				}

				const brandMentions = dayStat ? Number(dayStat.brand_mentioned_count) : 0;
				const brandVisibility = Math.round((brandMentions / totalRuns) * 100);
				dataPoint[brand.id] = brandVisibility;

				const competitorCounts = dayStat?.competitor_counts || {};
				sortedCompetitors.forEach((competitor) => {
					const competitorMentions = competitorCounts[competitor.name] || 0;
					const competitorVisibility = Math.round((competitorMentions / totalRuns) * 100);
					dataPoint[competitor.id] = competitorVisibility;
				});

				return dataPoint;
			});

			const totalRuns = promptData.reduce((sum, s) => sum + Number(s.total_runs), 0);

			const hasVisibilityData = chartData.some((dataPoint) => {
				const allIds = [brand.id, ...sortedCompetitors.map((c) => c.id)];
				return allIds.some((id) => {
					const visibility = dataPoint[id];
					return visibility !== null && visibility !== undefined && Number(visibility) > 0;
				});
			});

			const lastDataPoint = chartData.filter((point) => point[brand.id] !== null).pop();
			const lastBrandVisibility = lastDataPoint ? (lastDataPoint[brand.id] as number) : null;

			return {
				chartData,
				totalRuns,
				hasVisibilityData,
				lastBrandVisibility,
			};
		};
	}, [brand, batchData, dataByPrompt, dateRange, sortedCompetitors]);

	const value: ChartDataContextValue = {
		batchData,
		brand,
		competitors: sortedCompetitors,
		dateRange,
		getChartDataForPrompt,
		isLoading,
	};

	return <ChartDataContext.Provider value={value}>{children}</ChartDataContext.Provider>;
}

export function useChartDataContext() {
	const context = useContext(ChartDataContext);
	if (!context) {
		throw new Error("useChartDataContext must be used within a ChartDataProvider");
	}
	return context;
}

export function useOptionalChartDataContext() {
	return useContext(ChartDataContext);
}
