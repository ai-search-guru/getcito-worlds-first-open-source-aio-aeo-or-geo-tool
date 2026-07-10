/**
 * Server functions for dashboard data.
 * Replaces apps/web/src/app/api/brands/[id]/dashboard-summary/route.ts
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { db } from "@workspace/lib/db/db";
import { prompts, competitors, brands } from "@workspace/lib/db/schema";
import { eq, and, count } from "drizzle-orm";
import { generateDateRange, getDaysFromLookback, applyPerPromptLVCF, applyPerPromptCitationLVCF, type LookbackPeriod } from "@/lib/chart-utils";
import {
	getDashboardSummary,
	getPerPromptVisibilityTimeSeries,
	getPerPromptDailyCitationStats,
} from "@/lib/postgres-read";
import { getEffectiveBrandedStatus } from "@workspace/lib/tag-utils";
import { type CitationCategory, extractDomain, toRoundedPercentages, emptyCategoryCounts } from "@/lib/domain-categories";
import { categorizeDomain } from "@/lib/domain-categories.server";

export interface VisibilityTimeSeriesPoint {
	date: string;
	overall: number | null;
	nonBranded: number | null;
	branded: number | null;
}

export type CitationTimeSeriesPoint = { date: string } & Record<CitationCategory, number>;

export interface DashboardSummaryResponse {
	totalPrompts: number;
	totalRuns: number;
	averageVisibility: number;
	nonBrandedVisibility: number;
	brandedVisibility: number;
	visibilityTimeSeries: VisibilityTimeSeriesPoint[];
	citationTimeSeries: CitationTimeSeriesPoint[];
	lastUpdatedAt: string | null;
}

// ============================================================================
// Server Function
// ============================================================================

/**
 * Get dashboard summary with visibility and citation time series.
 */
export const getDashboardSummaryFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			lookback: z.enum(["1w", "1m", "3m", "6m", "1y", "all"]).default("1m"),
		}),
	)
	.handler(async ({ data }): Promise<DashboardSummaryResponse> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const lookbackParam = data.lookback as LookbackPeriod;
		const timezone = "UTC";

		let fromDateStr: string | null = null;
		let toDateStr: string | null = null;

		if (lookbackParam !== "all") {
			const toDate = new Date();
			const fromDate = new Date(toDate);
			fromDate.setDate(fromDate.getDate() - getDaysFromLookback(lookbackParam));
			fromDateStr = fromDate.toISOString().split("T")[0];
			toDateStr = toDate.toISOString().split("T")[0];
		}

		// Get brand info, competitors, and prompts from PostgreSQL
		const [brandResult, competitorsList, enabledPromptsResult, totalPromptsResult] = await Promise.all([
			db.select({ name: brands.name, website: brands.website, additionalDomains: brands.additionalDomains, delayOverrideHours: brands.delayOverrideHours }).from(brands).where(eq(brands.id, data.brandId)).limit(1),
			db.select().from(competitors).where(eq(competitors.brandId, data.brandId)),
			db.select({ id: prompts.id, value: prompts.value, systemTags: prompts.systemTags, tags: prompts.tags })
				.from(prompts).where(and(eq(prompts.brandId, data.brandId), eq(prompts.enabled, true))),
			db.select({ count: count() }).from(prompts).where(and(eq(prompts.brandId, data.brandId), eq(prompts.enabled, true))),
		]);

		const brandWebsite = brandResult[0]?.website || "";
		const primaryBrandDomain = extractDomain(brandWebsite);
		const additionalBrandDomains = (brandResult[0]?.additionalDomains || []).map(extractDomain);
		const brandDomains = new Set([primaryBrandDomain, ...additionalBrandDomains].filter(Boolean));
		const competitorDomains = new Set(competitorsList.flatMap((c) => c.domains.map(extractDomain)).filter(Boolean));
		const totalPrompts = totalPromptsResult[0]?.count || 0;

		const enabledPromptIds = enabledPromptsResult.map((p) => p.id);
		const brandedPromptIds = enabledPromptsResult
			.filter((p) => getEffectiveBrandedStatus(p.systemTags || [], p.tags || []).isBranded)
			.map((p) => p.id);

		const [summaryResult, perPromptVisibility, perPromptCitations] = await Promise.all([
			getDashboardSummary(data.brandId, fromDateStr, toDateStr, timezone, enabledPromptIds),
			getPerPromptVisibilityTimeSeries(data.brandId, fromDateStr, toDateStr, timezone, enabledPromptIds),
			fromDateStr && toDateStr
				? getPerPromptDailyCitationStats(data.brandId, fromDateStr, toDateStr, timezone, enabledPromptIds)
				: Promise.resolve([]),
		]);

		// Process summary
		const summary = summaryResult[0];
		const totalRuns = summary ? Number(summary.total_runs) : 0;
		const lastUpdatedAt = summary?.last_updated || null;

		// Generate date range (needed for LVCF before processing visibility)
		const rawDates = perPromptVisibility.map((r) => String(r.date)).sort();
		let startDate: Date, endDate: Date;
		if (lookbackParam === "all" && rawDates.length > 0) {
			startDate = new Date(rawDates[0]);
			endDate = new Date(rawDates[rawDates.length - 1]);
		} else {
			const daysToSubtract = getDaysFromLookback(lookbackParam);
			const currentDateInTimezone = new Date().toLocaleDateString("en-CA", { timeZone: timezone });
			endDate = new Date(currentDateInTimezone);
			startDate = new Date(endDate);
			startDate.setDate(startDate.getDate() - (daysToSubtract - 1));
		}
		const dateRange = generateDateRange(startDate, endDate);

		// Process visibility via per-prompt LVCF smoothing
		const {
			dailyVisibilityMap,
			totalBrandedRuns,
			totalBrandedMentioned,
			totalNonBrandedRuns,
			totalNonBrandedMentioned,
		} = applyPerPromptLVCF(perPromptVisibility, dateRange, brandedPromptIds);

		const totalQualifyingRuns = totalBrandedRuns + totalNonBrandedRuns;
		const totalMentioned = totalBrandedMentioned + totalNonBrandedMentioned;
		const averageVisibility = totalQualifyingRuns > 0 ? Math.round((totalMentioned / totalQualifyingRuns) * 100) : 0;
		const nonBrandedVisibility = totalNonBrandedRuns > 0 ? Math.round((totalNonBrandedMentioned / totalNonBrandedRuns) * 100) : 0;
		const brandedVisibility = totalBrandedRuns > 0 ? Math.round((totalBrandedMentioned / totalBrandedRuns) * 100) : 100;

		// Build visibility time series directly from LVCF-smoothed data (no rolling window needed)
		const visibilityTimeSeries: VisibilityTimeSeriesPoint[] = dateRange.map((date) => {
			const d = dailyVisibilityMap.get(date);
			if (!d) return { date, overall: null, nonBranded: null, branded: null };
			const t = d.branded.total + d.nonBranded.total;
			const m = d.branded.mentioned + d.nonBranded.mentioned;
			if (t === 0) return { date, overall: null, nonBranded: null, branded: null };
			return {
				date,
				overall: Math.round((m / t) * 100),
				nonBranded: d.nonBranded.total > 0 ? Math.round((d.nonBranded.mentioned / d.nonBranded.total) * 100) : null,
				branded: d.branded.total > 0 ? Math.round((d.branded.mentioned / d.branded.total) * 100) : null,
			};
		});

		const smoothedCitations = applyPerPromptCitationLVCF(
			perPromptCitations, dateRange, brandResult[0]?.delayOverrideHours,
			(domain: string) => categorizeDomain(domain, brandDomains, competitorDomains),
		);
		const citationTimeSeries: CitationTimeSeriesPoint[] = dateRange.map((date) => {
			const c = smoothedCitations.get(date);
			if (!c) return { date, ...emptyCategoryCounts() };
			return { date, ...(toRoundedPercentages(c) as Record<CitationCategory, number>) };
		});

		return {
			totalPrompts: Number(totalPrompts),
			totalRuns,
			averageVisibility,
			nonBrandedVisibility,
			brandedVisibility,
			visibilityTimeSeries,
			citationTimeSeries,
			lastUpdatedAt,
		};
	});
