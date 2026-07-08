/**
 * Server function for the Query Fanout page. Read-only — derived entirely from
 * `prompt_runs.web_queries` (the sub-queries engines run while answering a
 * prompt), uniformly across providers. Engines that don't expose their
 * searches contribute runs but no queries. No schema changes.
 *
 * Filters (tags/search → prompt IDs, lookback → date range in the user's
 * timezone) are resolved server-side exactly like Share of Voice, so the same
 * prompt set and window back every figure on the page. See `server/analysis.ts`.
 */
import { createServerFn } from "@tanstack/react-start";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import type { LookbackPeriod } from "@/lib/chart-utils";
import { LOOKBACK, resolveRange } from "@/server/analysis";
import { getFanoutBreakdown, getFanoutModelTotals, getFanoutPromptTotals } from "@/lib/postgres-read";
import { resolveFilteredPrompts } from "@/server/prompt-resolution";
import { computeFanoutAnalysis, type FanoutAnalysis } from "@/lib/fanout-analysis";

export interface QueryFanoutResponse extends FanoutAnalysis {
	brandName: string;
	model: string | null;
}

function emptyResponse(brandName: string, model: string | null): QueryFanoutResponse {
	return {
		brandName,
		model,
		totalQueries: 0,
		uniqueQueries: 0,
		fanoutRuns: 0,
		totalRuns: 0,
		avgPerExecution: 0,
		coverageRate: 0,
		topQueries: [],
		terms: [],
		wordChanges: { added: [], dropped: [], preserved: [] },
		byModel: [],
		byPrompt: [],
		topByPrompts: [],
		topByRuns: [],
	};
}

export const getQueryFanoutFn = createServerFn({ method: "GET" })
	.validator(
		z.object({
			brandId: z.string(),
			lookback: LOOKBACK.default("1m"),
			model: z.string().optional(),
			tags: z.string().optional(),
			search: z.string().optional(),
			/** Scope to a single prompt (prompt-details Web Queries tab) — lists come back uncapped. */
			promptId: z.string().optional(),
			timezone: z.string().default("UTC"),
		}),
	)
	.handler(async ({ data }): Promise<QueryFanoutResponse> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const { timezone, fromDateStr, toDateStr } = resolveRange(data.lookback as LookbackPeriod, data.timezone);
		const model = data.model;

		const [brandRow, allResolved] = await Promise.all([
			db.select({ name: brands.name }).from(brands).where(eq(brands.id, data.brandId)).limit(1),
			resolveFilteredPrompts(data.brandId, { tags: data.tags, search: data.search }),
		]);
		const brandName = brandRow[0]?.name ?? "Your brand";
		// Resolving then filtering (rather than trusting the input id) keeps the
		// brand-ownership check: a promptId from another brand resolves to nothing.
		const resolved = data.promptId ? allResolved.filter((p) => p.id === data.promptId) : allResolved;
		const promptIds = resolved.map((p) => p.id);
		if (promptIds.length === 0) return emptyResponse(brandName, model ?? null);

		const promptValueMap = new Map(resolved.map((p) => [p.id, p.value]));

		const [breakdown, modelTotals, promptTotalsRows] = await Promise.all([
			getFanoutBreakdown(data.brandId, fromDateStr, toDateStr, timezone, promptIds, model),
			getFanoutModelTotals(data.brandId, fromDateStr, toDateStr, timezone, promptIds, model),
			getFanoutPromptTotals(data.brandId, fromDateStr, toDateStr, timezone, promptIds, model),
		]);
		const promptRuns = new Map(promptTotalsRows.map((r) => [r.prompt_id, r.runs]));

		// Single-prompt mode shows every variation (the prompt-details tab) — 2000 is
		// a payload-size backstop, far above the largest observed prompt (~700).
		const limits = data.promptId ? { topQueries: 2000, perModelTop: 2000, variations: 2000 } : undefined;
		const analysis = computeFanoutAnalysis(breakdown, modelTotals, promptValueMap, { promptRuns, limits });

		return { brandName, model: model ?? null, ...analysis };
	});
