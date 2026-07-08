/**
 * Server functions for visibility and chart data.
 * Replaces:
 *   - apps/web/src/app/api/brands/[id]/batch-chart-data/route.ts
 *   - apps/web/src/app/api/brands/[id]/filtered-visibility/route.ts
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { db } from "@workspace/lib/db/db";
import { brands, competitors } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { type LookbackPeriod } from "@/lib/chart-utils";
import { getTimezoneLookbackRange, resolveTimezone } from "@/lib/timezone-utils";
import { resolveFilteredPrompts } from "@/server/prompt-resolution";
import {
	getBatchChartData,
	getVisibilityDailyAggregate,
	getCitationsTotalCount,
	type ProcessedBatchChartDataPoint,
} from "@/lib/postgres-read";
import { getEffectiveBrandedStatus } from "@workspace/lib/tag-utils";

// ============================================================================
// Types
// ============================================================================

export interface BatchChartDataResponse {
	chartData: ProcessedBatchChartDataPoint[];
	brand: {
		id: string;
		name: string;
	};
	competitors: Array<{
		id: string;
		name: string;
	}>;
	dateRange: {
		fromDate: string;
		toDate: string;
	};
}

export interface VisibilityTimeSeriesPoint {
	date: string;
	visibility: number | null;
}

export interface FilteredVisibilityResponse {
	currentVisibility: number;
	totalRuns: number;
	totalPrompts: number;
	totalCitations: number;
	visibilityTimeSeries: VisibilityTimeSeriesPoint[];
	lookback: LookbackPeriod;
}

// ============================================================================
// Server functions
// ============================================================================

export const getBatchChartDataFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			lookback: z.enum(["1w", "1m", "3m", "6m", "1y", "all"]).default("1m"),
			model: z.string().optional(),
			tags: z.string().optional(),
			search: z.string().optional(),
			timezone: z.string().default("UTC"),
		}),
	)
	.handler(async ({ data }): Promise<BatchChartDataResponse> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const timezone = resolveTimezone(data.timezone);
		const lookbackParam = data.lookback as LookbackPeriod;

		// `allStrategy: "1y"` guarantees concrete bounds for every lookback
		// (including "all"), so the dates are never null here.
		const { fromDateStr, toDateStr } = getTimezoneLookbackRange(lookbackParam, timezone, {
			allStrategy: "1y",
		}) as { fromDateStr: string; toDateStr: string };

		// Resolve the in-scope prompts server-side from the filter criteria so
		// the client never ships the full prompt-id list (issue #68).
		const resolvedPrompts = await resolveFilteredPrompts(data.brandId, {
			tags: data.tags,
			search: data.search,
		});
		const promptIds = resolvedPrompts.map((p) => p.id);

		// Get brand and competitors from PostgreSQL
		const [brandResult, competitorsResult] = await Promise.all([
			db
				.select({ id: brands.id, name: brands.name })
				.from(brands)
				.where(eq(brands.id, data.brandId))
				.limit(1),
			db
				.select({ id: competitors.id, name: competitors.name })
				.from(competitors)
				.where(eq(competitors.brandId, data.brandId)),
		]);

		if (brandResult.length === 0) {
			throw new Error("Brand not found");
		}

		const brand = brandResult[0];

		// No prompts match the current filters — return an empty-but-valid
		// payload rather than erroring (the page renders an empty state).
		if (promptIds.length === 0) {
			return {
				chartData: [],
				brand: { id: brand.id, name: brand.name },
				competitors: competitorsResult,
				dateRange: { fromDate: fromDateStr, toDate: toDateStr },
			};
		}

		// Fetch batch chart data
		const chartData = await getBatchChartData(
			data.brandId,
			promptIds,
			fromDateStr,
			toDateStr,
			timezone,
			undefined,
			data.model,
		);

		return {
			chartData,
			brand: { id: brand.id, name: brand.name },
			competitors: competitorsResult,
			dateRange: {
				fromDate: fromDateStr,
				toDate: toDateStr,
			},
		};
	});

export const getFilteredVisibilityFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			lookback: z.enum(["1w", "1m", "3m", "6m", "1y", "all"]).default("1m"),
			model: z.string().optional(),
			tags: z.string().optional(),
			search: z.string().optional(),
			timezone: z.string().default("UTC"),
		}),
	)
	.handler(async ({ data }): Promise<FilteredVisibilityResponse> => {
		const session = await requireAuthSession();
		const lookbackParam = data.lookback as LookbackPeriod;

		await requireOrgAccess(session.user.id, data.brandId);

		// Resolve the in-scope prompts server-side from the filter criteria so
		// the client never ships the full prompt-id list (issue #68).
		const resolvedPrompts = await resolveFilteredPrompts(data.brandId, {
			tags: data.tags,
			search: data.search,
		});
		const promptIds = resolvedPrompts.map((p) => p.id);
		const totalPrompts = promptIds.length;

		if (totalPrompts === 0) {
			return {
				currentVisibility: 0,
				totalRuns: 0,
				totalPrompts: 0,
				totalCitations: 0,
				visibilityTimeSeries: [],
				lookback: lookbackParam,
			};
		}

		const timezone = resolveTimezone(data.timezone);

		// Determine branded prompt IDs from effective branded status
		const brandedPromptIds = resolvedPrompts
			.filter((p) => getEffectiveBrandedStatus(p.systemTags, p.tags).isBranded)
			.map((p) => p.id);

		// `allStrategy: "1y"` caps the "all" lookback at a one-year window so
		// the visibility bar matches the chart section. Every other lookback
		// already returns concrete bounds, so we can destructure without
		// null-checking.
		const { fromDateStr: fromDate, toDateStr: toDate } = getTimezoneLookbackRange(
			lookbackParam,
			timezone,
			{ allStrategy: "1y" },
		) as { fromDateStr: string; toDateStr: string };

		const [daily, totalCitations] = await Promise.all([
			getVisibilityDailyAggregate(
				data.brandId,
				fromDate,
				toDate,
				timezone,
				promptIds,
				brandedPromptIds,
				data.model,
			),
			getCitationsTotalCount(data.brandId, fromDate, toDate, timezone, promptIds, data.model),
		]);

		// Roll the period run totals from the raw observation sums (actual_*);
		// the visibility time-series uses the per-day LVCF sums so gaps in
		// individual prompt schedules don't scallop the line.
		let totalBrandedRuns = 0;
		let totalNonBrandedRuns = 0;
		const visibilityTimeSeries: VisibilityTimeSeriesPoint[] = daily.map((row) => {
			totalBrandedRuns += row.actual_branded_runs;
			totalNonBrandedRuns += row.actual_nonbranded_runs;
			const t = row.lvcf_branded_runs + row.lvcf_nonbranded_runs;
			const m = row.lvcf_branded_mentioned + row.lvcf_nonbranded_mentioned;
			return { date: row.date, visibility: t === 0 ? null : Math.round((m / t) * 100) };
		});

		const totalRuns = totalBrandedRuns + totalNonBrandedRuns;
		// "Current" = the latest plotted point (last non-null LVCF day), so the headline
		// number matches the right end of the trend/sparkline beside it — and the
		// overview's current-visibility hero — rather than the whole-window average.
		let currentVisibility = 0;
		for (let i = visibilityTimeSeries.length - 1; i >= 0; i--) {
			const v = visibilityTimeSeries[i].visibility;
			if (v != null) {
				currentVisibility = v;
				break;
			}
		}

		return {
			currentVisibility,
			totalRuns,
			totalPrompts,
			totalCitations,
			visibilityTimeSeries,
			lookback: lookbackParam,
		};
	});
