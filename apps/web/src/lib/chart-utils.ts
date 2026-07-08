import type { PerPromptVisibilityPoint, PerPromptDailyCitationStats } from "@/lib/postgres-read";
import { getDefaultDelayHours } from "@workspace/lib/constants";
import { type CitationCategory, CITATION_CATEGORIES } from "@/lib/domain-categories";

export type LookbackPeriod = "1w" | "1m" | "3m" | "6m" | "1y" | "all";

/**
 * Determines the default lookback period based on the brand's data history.
 * Returns "1m" (1 month) if the brand has more than 1 week of data or if data hasn't loaded yet,
 * otherwise returns "1w" (1 week) for new brands with less than a week of data.
 * 
 * Note: We default to "1m" when data is unavailable because most established brands
 * have more than a week of data, and this prevents inconsistent defaults when brand
 * data loads asynchronously (which was causing chart type mismatches downstream).
 * 
 * @param earliestDataDate - ISO date string of the earliest data point, or null if no data
 * @returns The recommended default lookback period
 */
export function getDefaultLookbackPeriod(earliestDataDate: string | null | undefined): LookbackPeriod {
	if (!earliestDataDate) {
		// Data hasn't loaded yet - default to 1 month as a safe default
		// (most brands have > 1 week of data, and this prevents default mismatches)
		return "1m";
	}

	const earliestDate = new Date(earliestDataDate);
	const now = new Date();
	const diffInMs = now.getTime() - earliestDate.getTime();
	const diffInDays = diffInMs / (1000 * 60 * 60 * 24);

	// If brand has more than 7 days of data, default to 1 month
	// Otherwise, default to 1 week (for new brands)
	return diffInDays > 7 ? "1m" : "1w";
}

export function getDaysFromLookback(lookback: LookbackPeriod): number {
	switch (lookback) {
		case "1w":
			return 7;
		case "1m":
			return 30;
		case "3m":
			return 90;
		case "6m":
			return 180;
		case "1y":
			return 365;
		case "all":
			return 365 * 2; // 2 years for "all"
	}
}

export function generateDateRange(startDate: Date, endDate: Date): string[] {
	const dates: string[] = [];
	const current = new Date(startDate);

	while (current <= endDate) {
		dates.push(current.toISOString().split("T")[0]);
		current.setDate(current.getDate() + 1);
	}

	return dates;
}

/**
 * Citation comparison window for a lookback of `days` days — computed entirely in
 * UTC so it's independent of server timezone. The current window is `days` calendar
 * days ending on `today` (inclusive): [today-(days-1), today]. The previous window
 * is the contiguous equal-length window ending the day before the current one
 * starts. `dateRange` is the current window as one YYYY-MM-DD per day (what the
 * trend charts iterate) so totals and charts cover exactly the same span.
 */
export function citationDateWindow(
	today: Date,
	days: number,
): { fromDateStr: string; toDateStr: string; prevFromDateStr: string; prevToDateStr: string; dateRange: string[] } {
	const iso = (d: Date) => d.toISOString().split("T")[0];
	const shift = (base: Date, deltaDays: number) => {
		const d = new Date(base);
		d.setUTCDate(d.getUTCDate() + deltaDays);
		return d;
	};
	const span = Math.max(1, days);
	const from = shift(today, -(span - 1));
	const prevTo = shift(from, -1);
	const prevFrom = shift(prevTo, -(span - 1));
	const dateRange: string[] = [];
	for (let i = 0; i < span; i++) dateRange.push(iso(shift(from, i)));
	return { fromDateStr: iso(from), toDateStr: iso(today), prevFromDateStr: iso(prevFrom), prevToDateStr: iso(prevTo), dateRange };
}

// ============================================================================
// Smoothing utilities
// ============================================================================

export interface DailyVisibilityBucket {
	branded: { total: number; mentioned: number };
	nonBranded: { total: number; mentioned: number };
}

/**
 * Per-prompt Last Value Carried Forward (LVCF) for visibility data.
 *
 * For each prompt, carries forward its last known (total_runs, brand_mentioned_count)
 * to fill gap days when it didn't run. Then aggregates across all prompts per day,
 * split by branded/non-branded status.
 *
 * This eliminates periodic artifacts caused by staggered prompt schedules:
 * every prompt contributes to every day's aggregate via its last observation.
 */
export function applyPerPromptLVCF(
	perPromptData: PerPromptVisibilityPoint[],
	dateRange: string[],
	brandedPromptIds: string[],
): {
	dailyVisibilityMap: Map<string, DailyVisibilityBucket>;
	totalBrandedRuns: number;
	totalBrandedMentioned: number;
	totalNonBrandedRuns: number;
	totalNonBrandedMentioned: number;
} {
	const brandedSet = new Set(brandedPromptIds);

	// Group raw data by prompt_id -> date -> values
	const byPrompt = new Map<string, Map<string, { total: number; mentioned: number }>>();
	for (const row of perPromptData) {
		if (!byPrompt.has(row.prompt_id)) byPrompt.set(row.prompt_id, new Map());
		byPrompt.get(row.prompt_id)!.set(String(row.date), {
			total: Number(row.total_runs),
			mentioned: Number(row.brand_mentioned_count),
		});
	}

	const dailyVisibilityMap = new Map<string, DailyVisibilityBucket>();
	let totalBrandedRuns = 0;
	let totalBrandedMentioned = 0;
	let totalNonBrandedRuns = 0;
	let totalNonBrandedMentioned = 0;

	// For each prompt, walk the date range with LVCF, accumulating into the daily map.
	// Pre-seed carried value with the prompt's earliest observation so that
	// dates before the first run still get a contribution (avoids ramp-up artifact).
	for (const [promptId, dateMap] of byPrompt) {
		const isBranded = brandedSet.has(promptId);
		const sortedEntries = [...dateMap.entries()].sort(([a], [b]) => a.localeCompare(b));
		let carried: { total: number; mentioned: number } | null = sortedEntries.length > 0 ? sortedEntries[0][1] : null;

		for (const date of dateRange) {
			const actual = dateMap.get(date);
			if (actual) {
				carried = actual;
			}
			// Only contribute if we have a value (actual or carried forward)
			if (!carried) continue;

			if (!dailyVisibilityMap.has(date)) {
				dailyVisibilityMap.set(date, {
					branded: { total: 0, mentioned: 0 },
					nonBranded: { total: 0, mentioned: 0 },
				});
			}
			const bucket = dailyVisibilityMap.get(date)!;
			const target = isBranded ? bucket.branded : bucket.nonBranded;
			target.total += carried.total;
			target.mentioned += carried.mentioned;

			// Only count actual (non-carried) data toward period totals
			if (actual) {
				if (isBranded) {
					totalBrandedRuns += actual.total;
					totalBrandedMentioned += actual.mentioned;
				} else {
					totalNonBrandedRuns += actual.total;
					totalNonBrandedMentioned += actual.mentioned;
				}
			}
		}
	}

	return { dailyVisibilityMap, totalBrandedRuns, totalBrandedMentioned, totalNonBrandedRuns, totalNonBrandedMentioned };
}

export type CitationCategories = Record<CitationCategory, number>;

/**
 * Generalized per-prompt LVCF with cadence normalization over arbitrary string
 * keys (citation category, page type, …). For each prompt, carries forward its
 * last known per-key counts, normalized by the brand's cadence so daily totals
 * reflect a steady rate rather than spiking on run days. Pre-seeds each prompt
 * with its earliest observation to avoid ramp-up artifacts.
 */
export function applyPerPromptKeyedLVCF<K extends string>(
	rows: { prompt_id: string; date: string | Date; key: K; count: number }[],
	dateRange: string[],
	cadenceHours: number | null | undefined,
	allKeys: readonly K[],
): Map<string, Record<K, number>> {
	const cadenceDays = Math.max(1, Math.ceil((cadenceHours ?? getDefaultDelayHours()) / 24));
	const empty = (): Record<K, number> => Object.fromEntries(allKeys.map((k) => [k, 0])) as Record<K, number>;

	// Group by prompt_id -> date -> per-key totals
	const byPrompt = new Map<string, Map<string, Record<K, number>>>();
	for (const row of rows) {
		if (!byPrompt.has(row.prompt_id)) byPrompt.set(row.prompt_id, new Map());
		const dateMap = byPrompt.get(row.prompt_id)!;
		const dateStr = String(row.date);
		if (!dateMap.has(dateStr)) dateMap.set(dateStr, empty());
		dateMap.get(dateStr)![row.key] += Number(row.count);
	}

	const daily = new Map<string, Record<K, number>>();
	for (const [, dateMap] of byPrompt) {
		// Pre-seed with the earliest observation to avoid ramp-up
		const sortedEntries = [...dateMap.entries()].sort(([a], [b]) => a.localeCompare(b));
		let carried: Record<K, number> | null = sortedEntries.length > 0 ? sortedEntries[0][1] : null;
		for (const date of dateRange) {
			const actual = dateMap.get(date);
			if (actual) carried = actual;
			if (!carried) continue;
			if (!daily.has(date)) daily.set(date, empty());
			const day = daily.get(date)!;
			for (const k of allKeys) day[k] += carried[k] / cadenceDays;
		}
	}

	// Values are intentionally left fractional (not rounded to ints): both consumers
	// convert to percentages via toRoundedPercentages, where the 1/cadenceDays factor
	// cancels exactly — so cadence can't shift the chart, and a tiny category isn't
	// pre-zeroed by an intermediate round before the percentage is taken.
	return daily;
}

/** Category-keyed LVCF (back-compat wrapper used by the dashboard). */
export function applyPerPromptCitationLVCF(
	perPromptData: PerPromptDailyCitationStats[],
	dateRange: string[],
	cadenceHours: number | null | undefined,
	categorizeDomain: (domain: string) => CitationCategory,
): Map<string, CitationCategories> {
	return applyPerPromptKeyedLVCF(
		perPromptData.map((r) => ({ prompt_id: r.prompt_id, date: r.date, key: categorizeDomain(r.domain), count: Number(r.count) })),
		dateRange,
		cadenceHours,
		CITATION_CATEGORIES,
	);
}

// Function to normalize values from 0-500 range to 0-100% and round down to nearest 20%
export const normalizeToPercentage = (value: number): number => {
	const percentage = (value / 500) * 100;
	const roundedPercentage = Math.floor(percentage / 20) * 20;
	return Math.min(roundedPercentage, 100); // Ensure it never exceeds 100%
};

export function getBadgeVariant(value: number): "default" | "secondary" | "destructive" {
	if (value > 75) return "default";
	if (value > 45) return "secondary";
	return "destructive";
}

export function getBadgeClassName(value: number): string {
	if (value > 75) return "bg-emerald-600 hover:bg-emerald-600 text-white";
	if (value > 45) return "bg-amber-500 hover:bg-amber-500 text-white";
	return "bg-rose-500 hover:bg-rose-500 text-white";
}

export interface ChartDataPoint {
	date: string;
	[key: string]: number | string | boolean | null; // Dynamic keys for brand/competitor IDs and _extended_ flags
}

import type { PromptRun, Brand, Competitor } from "@workspace/lib/db/schema";

/**
 * Calculate visibility percentages for brand vs competitors from prompt runs
 */
export function calculateVisibilityPercentages(
	promptRuns: PromptRun[],
	brand: Brand,
	competitors: Competitor[],
	lookback: LookbackPeriod,
	userTimezone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): ChartDataPoint[] {
	let startDate: Date;
	let endDate: Date;

	if (lookback === "all" && promptRuns.length > 0) {
		// For "all", use the actual data range from first to last prompt run
		const sortedRuns = [...promptRuns].sort(
			(a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
		);
		const firstRun = sortedRuns[0];
		const lastRun = sortedRuns[sortedRuns.length - 1];

		startDate = new Date(firstRun.createdAt);
		endDate = new Date(lastRun.createdAt);

		// Convert to date-only (remove time component) in user's timezone, then back to UTC Date objects
		const startDateString = startDate.toLocaleDateString("en-CA", { timeZone: userTimezone });
		const endDateString = endDate.toLocaleDateString("en-CA", { timeZone: userTimezone });
		startDate = new Date(startDateString);
		endDate = new Date(endDateString);
	} else {
		// For other lookback periods, use timezone-aware date range
		const daysToSubtract = getDaysFromLookback(lookback);

		// Get current date in user's timezone (not UTC) to avoid including "tomorrow"
		const now = new Date();
		const currentDateInTimezone = now.toLocaleDateString("en-CA", { timeZone: userTimezone });
		endDate = new Date(currentDateInTimezone);

		// Calculate start date from the timezone-aware end date
		startDate = new Date(endDate);
		startDate.setDate(startDate.getDate() - (daysToSubtract - 1));
	}

	// Generate complete UTC date range for the lookback period
	const dateRange = generateDateRange(startDate, endDate);

	// Sort competitors alphabetically by name for consistent color assignment
	const sortedCompetitors = [...competitors].sort((a, b) => a.name.localeCompare(b.name));

	// Group prompt runs by date (in user's timezone) - this is the key bucketing step
	const runsByDate = promptRuns.reduce(
		(acc, run) => {
			const runDate = new Date(run.createdAt);
			// Convert to user's timezone and get date string - this buckets events by local date
			const dateKey = runDate.toLocaleDateString("en-CA", { timeZone: userTimezone }); // YYYY-MM-DD format

			if (!acc[dateKey]) {
				acc[dateKey] = [];
			}
			acc[dateKey].push(run);
			return acc;
		},
		{} as Record<string, PromptRun[]>,
	);

	// Calculate visibility percentages for each date in the UTC range
	return dateRange.map((date) => {
		const runsForDate = runsByDate[date] || [];
		const totalRuns = runsForDate.length;

		const dataPoint: ChartDataPoint = { date };

		if (totalRuns === 0) {
			// Set null values for brand and all competitors
			dataPoint[brand.id] = null;
			sortedCompetitors.forEach((competitor) => {
				dataPoint[competitor.id] = null;
			});
			return dataPoint;
		}

		// Calculate brand visibility percentage
		const brandMentions = runsForDate.filter((run) => run.brandMentioned).length;
		const brandVisibility = Math.round((brandMentions / totalRuns) * 100);
		dataPoint[brand.id] = brandVisibility;

		// Calculate competitor visibility percentages
		sortedCompetitors.forEach((competitor) => {
			const competitorMentions = runsForDate.filter(
				(run) => run.competitorsMentioned && run.competitorsMentioned.includes(competitor.name),
			).length;
			const competitorVisibility = Math.round((competitorMentions / totalRuns) * 100);
			dataPoint[competitor.id] = competitorVisibility;
		});

		return dataPoint;
	});
}
/**
 * Get competitor color based on alphabetical position using white label colors
 */
export function getCompetitorColor(
	competitorName: string,
	competitors: Competitor[],
	whitelabelColors: string[],
): string {
	const sortedCompetitors = [...competitors].sort((a, b) => a.name.localeCompare(b.name));
	const index = sortedCompetitors.findIndex((c) => c.name === competitorName);

	// Start from index 1 (skip the first color which is for the brand)
	const colorIndex = (index + 1) % whitelabelColors.length;
	return whitelabelColors[colorIndex] || whitelabelColors[1];
}

// Helper function to calculate average visibility for a competitor
function calculateAverageVisibility(data: ChartDataPoint[], competitorId: string): number {
	const validValues = data
		.map((point) => point[competitorId] as number | null)
		.filter((value) => value !== null && value !== undefined) as number[];

	if (validValues.length === 0) return 0;
	return validValues.reduce((sum, value) => sum + value, 0) / validValues.length;
}

// Helper function to select top competitors to display by visibility
export function selectCompetitorsToDisplay(
	competitors: Competitor[],
	data: ChartDataPoint[],
	maxCompetitors: number = 3,
): Competitor[] {
	// Calculate average visibility for each competitor
	const competitorsWithAvgVisibility = competitors.map((competitor) => ({
		competitor,
		avgVisibility: calculateAverageVisibility(data, competitor.id),
	}));

	// Sort by highest average visibility
	const sortedByVisibility = competitorsWithAvgVisibility.sort((a, b) => b.avgVisibility - a.avgVisibility);

	// Take top competitors by visibility
	const topCompetitors = sortedByVisibility.slice(0, maxCompetitors).map((item) => item.competitor);

	// If we have fewer than maxCompetitors, fill with remaining competitors in alphabetical order
	if (topCompetitors.length < maxCompetitors) {
		const selectedIds = new Set(topCompetitors.map((c) => c.id));
		const remaining = competitors
			.filter((c) => !selectedIds.has(c.id))
			.sort((a, b) => a.name.localeCompare(b.name)) // Sort alphabetically
			.slice(0, maxCompetitors - topCompetitors.length);

		topCompetitors.push(...remaining);
	}

	return topCompetitors;
}

/**
 * Get brand color (always first color in white label config)
 */
export function getBrandColor(whitelabelColors: string[]): string {
	return whitelabelColors[0];
}

export function filterAndCompleteChartData(chartData: ChartDataPoint[], lookback: LookbackPeriod): ChartDataPoint[] {
	// For "all", return the data as-is since it already contains the correct range
	if (lookback === "all") {
		return chartData;
	}

	const daysToSubtract = getDaysFromLookback(lookback);

	// Use timezone-aware date range to be consistent with calculateVisibilityPercentages
	const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	const now = new Date();
	const currentDateInTimezone = now.toLocaleDateString("en-CA", { timeZone: userTimezone });
	const referenceDate = new Date(currentDateInTimezone);

	const startDate = new Date(referenceDate);
	startDate.setDate(startDate.getDate() - (daysToSubtract - 1));

	// Generate complete date range for the lookback period
	const dateRange = generateDateRange(startDate, referenceDate);

	// Filter existing data
	const filteredData = chartData.filter((item) => {
		const date = new Date(item.date);
		return date >= startDate && date <= referenceDate;
	});

	// Create a complete dataset with null values for missing dates
	return dateRange.map((date) => {
		const existingData = filteredData.find((item) => item.date === date);
		return (
			existingData || {
				date,
				// Note: We can't set default values here since we don't know the keys
				// The calling code should handle missing data appropriately
			}
		);
	});
}

/**
 * Extends line chart data to the edges of the time frame.
 * For each entity (brand/competitor), extends the first non-null value backward
 * to fill the start of the chart, and extends the last non-null value forward
 * to fill the end of the chart. This prevents gaps at the edges of the chart
 * when data collection started mid-period or hasn't been collected yet for recent dates.
 * 
 * Extended points are marked with `_extended_{key}: true` so the chart can:
 * - Skip rendering dots for extended points
 * - Skip showing extended values in tooltips
 */
export function extendLinesToChartEdges(
	chartData: ChartDataPoint[],
	dataKeys: string[]
): ChartDataPoint[] {
	if (chartData.length === 0) return chartData;

	// Deep clone the chart data to avoid mutating the original
	const extendedData = chartData.map((point) => ({ ...point }));

	for (const key of dataKeys) {
		// Find the first and last indices with non-null values for this key
		let firstValidIndex = -1;
		let lastValidIndex = -1;
		let firstValue: number | null = null;
		let lastValue: number | null = null;

		for (let i = 0; i < extendedData.length; i++) {
			const value = extendedData[i][key];
			if (value !== null && value !== undefined) {
				if (firstValidIndex === -1) {
					firstValidIndex = i;
					firstValue = value as number;
				}
				lastValidIndex = i;
				lastValue = value as number;
			}
		}

		// If we found valid data, extend it to the edges
		if (firstValidIndex !== -1 && lastValidIndex !== -1) {
			// Extend backward from the first valid value to the start
			for (let i = 0; i < firstValidIndex; i++) {
				extendedData[i][key] = firstValue;
				extendedData[i][`_extended_${key}`] = true;
			}

			// Extend forward from the last valid value to the end
			for (let i = lastValidIndex + 1; i < extendedData.length; i++) {
				extendedData[i][key] = lastValue;
				extendedData[i][`_extended_${key}`] = true;
			}
		}
	}

	return extendedData;
}

/**
 * Check if a data point's value for a specific key is an extended/synthetic value
 */
export function isExtendedDataPoint(dataPoint: ChartDataPoint, key: string): boolean {
	return dataPoint[`_extended_${key}`] === true;
}

/**
 * Create a mapping from prompt IDs to their oldest web query (first alphabetically if multiple from same time)
 */
export function createPromptToWebQueryMapping(promptRuns: PromptRun[]): Record<string, string> {
	const promptToWebQuery: Record<string, string> = {};

	// Group prompt runs by prompt ID
	const promptRunsByPromptId = promptRuns.reduce(
		(acc, run) => {
			if (!acc[run.promptId]) {
				acc[run.promptId] = [];
			}
			acc[run.promptId].push(run);
			return acc;
		},
		{} as Record<string, PromptRun[]>,
	);

	// For each prompt, find the oldest web query
	Object.entries(promptRunsByPromptId).forEach(([promptId, runs]) => {
		// Filter runs that have web queries
		const runsWithWebQueries = runs.filter((run) => run.webQueries && run.webQueries.length > 0);

		if (runsWithWebQueries.length === 0) return;

		// Sort by creation date (oldest first)
		runsWithWebQueries.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

		// Group by creation date to handle ties
		const oldestDate = runsWithWebQueries[0].createdAt;
		const oldestRuns = runsWithWebQueries.filter(
			(run) => new Date(run.createdAt).getTime() === new Date(oldestDate).getTime(),
		);

		// Get all web queries from the oldest runs and find first alphabetically
		const allWebQueries: string[] = [];
		oldestRuns.forEach((run) => {
			if (run.webQueries) {
				allWebQueries.push(...run.webQueries);
			}
		});

		if (allWebQueries.length > 0) {
			// Sort alphabetically and take the first
			allWebQueries.sort();
			promptToWebQuery[promptId] = allWebQueries[0];
		}
	});

	return promptToWebQuery;
}
