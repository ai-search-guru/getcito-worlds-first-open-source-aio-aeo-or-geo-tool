#!/usr/bin/env tsx
/**
 * Benchmark: Postgres analytics query performance.
 *
 * Imports the production functions from postgres-read.ts and measures
 * their latency across the top N brands.
 *
 * Usage:
 *   cd apps/web
 *   pnpm tsx --env-file=../../.env scripts/benchmark-postgres-analytics.ts
 *   pnpm tsx --env-file=../../.env scripts/benchmark-postgres-analytics.ts --iterations=10
 *   pnpm tsx --env-file=../../.env scripts/benchmark-postgres-analytics.ts --brands=3
 */

import * as pgRead from "../src/lib/postgres-read";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";

const db = drizzle(process.env.DATABASE_URL!);

const ITERATIONS = parseInt(process.argv.find((a) => a.startsWith("--iterations="))?.split("=")[1] || "5");
const WARMUP = 1;

// ============================================================================
// Timing
// ============================================================================

interface BenchResult {
	name: string;
	avg: number;
	min: number;
	p95: number;
	rows: number;
}

async function timeOne(fn: () => Promise<unknown>): Promise<{ avg: number; min: number; p95: number; rows: number }> {
	let rows = 0;
	for (let i = 0; i < WARMUP; i++) {
		const r = await fn();
		rows = Array.isArray(r) ? r.length : 1;
	}
	const times: number[] = [];
	for (let i = 0; i < ITERATIONS; i++) {
		const start = performance.now();
		await fn();
		times.push(Math.round(performance.now() - start));
	}
	times.sort((a, b) => a - b);
	return {
		avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
		min: times[0],
		p95: times[Math.floor(times.length * 0.95)],
		rows,
	};
}

async function bench(name: string, pgFn: () => Promise<unknown>): Promise<BenchResult> {
	process.stdout.write(`  ${name} ... `);
	const timing = await timeOne(pgFn);
	console.log(`${timing.avg}ms (min ${timing.min}ms, p95 ${timing.p95}ms, ${timing.rows} rows)`);
	return { name, ...timing };
}

// ============================================================================
// Main
// ============================================================================

async function benchBrand(
	brandId: string,
	runCount: number,
	hasCitations: boolean,
): Promise<BenchResult[]> {
	const promptResult = await db.execute<{ id: string }>(sql`
		SELECT id FROM prompts WHERE brand_id = ${brandId} AND enabled = true LIMIT 20
	`);
	const promptIds = promptResult.rows.map((r) => r.id);
	const firstPromptId = promptIds[0];
	if (!firstPromptId) { console.log(`  Skipping ${brandId} — no enabled prompts`); return []; }

	const toDate = new Date().toISOString().split("T")[0];
	const fromDate = new Date(Date.now() - 30 * 86400000).toISOString().split("T")[0];
	const tz = "UTC";
	const brandedPromptIds = promptIds.slice(0, Math.ceil(promptIds.length / 2));

	console.log(`\n### Brand: ${brandId.slice(0, 8)}... (${runCount} runs, ${promptIds.length} prompts)\n`);

	const results: BenchResult[] = [];

	results.push(await bench("getDashboardSummary",
		() => pgRead.getDashboardSummary(brandId, fromDate, toDate, tz, promptIds)));

	results.push(await bench("getVisibilityTimeSeries",
		() => pgRead.getVisibilityTimeSeries(brandId, fromDate, toDate, tz, brandedPromptIds, promptIds)));

	results.push(await bench("getPromptsSummary",
		() => pgRead.getPromptsSummary(brandId, fromDate, toDate, tz)));

	results.push(await bench("getPromptsFirstEvaluatedAt",
		() => pgRead.getPromptsFirstEvaluatedAt(brandId, promptIds)));

	results.push(await bench("getPromptDailyStats",
		() => pgRead.getPromptDailyStats(firstPromptId, fromDate, toDate, tz)));

	results.push(await bench("getPromptCompetitorDailyStats",
		() => pgRead.getPromptCompetitorDailyStats(firstPromptId, fromDate, toDate, tz)));

	results.push(await bench("getPromptWebQueriesForMapping",
		() => pgRead.getPromptWebQueriesForMapping(firstPromptId, fromDate, toDate, tz)));

	results.push(await bench("getPromptMentionSummary",
		() => pgRead.getPromptMentionSummary(firstPromptId, fromDate, toDate, tz)));

	results.push(await bench("getPromptTopCompetitorMentions",
		() => pgRead.getPromptTopCompetitorMentions(firstPromptId, fromDate, toDate, tz, 10)));

	results.push(await bench("getBatchChartData",
		() => pgRead.getBatchChartData(brandId, promptIds, fromDate, toDate, tz)));

	results.push(await bench("getBrandEarliestRunDate",
		() => pgRead.getBrandEarliestRunDate(brandId)));

	if (hasCitations) {
		results.push(await bench("getCitationDomainStats",
			() => pgRead.getCitationDomainStats(brandId, fromDate, toDate, tz, promptIds)));

		results.push(await bench("getCitationUrlStats",
			() => pgRead.getCitationUrlStats(brandId, fromDate, toDate, tz, promptIds)));

		results.push(await bench("getDailyCitationStats",
			() => pgRead.getDailyCitationStats(brandId, fromDate, toDate, tz, promptIds)));

		results.push(await bench("getPromptCitationUrlStats",
			() => pgRead.getPromptCitationUrlStats(firstPromptId, fromDate, toDate, tz)));
	}

	return results;
}

async function main(): Promise<void> {
	const NUM_BRANDS = parseInt(process.argv.find((a) => a.startsWith("--brands="))?.split("=")[1] || "5");
	console.log(`Benchmark: ${ITERATIONS} iterations + ${WARMUP} warmup, top ${NUM_BRANDS} brands\n`);

	await db.execute(sql`SET statement_timeout = '30s'`);

	const topBrands = await db.execute<{ brand_id: string; run_count: number }>(sql`
		SELECT brand_id, count(*)::int AS run_count
		FROM prompt_runs WHERE brand_id IS NOT NULL
		GROUP BY brand_id ORDER BY run_count DESC LIMIT ${NUM_BRANDS}
	`);
	if (topBrands.rows.length === 0) { console.error("No prompt_runs with brand_id."); process.exit(1); }

	const citResult = await db.execute<{ count: number }>(sql`SELECT count(*)::int AS count FROM citations`);
	const hasCitations = citResult.rows[0].count > 0;
	if (!hasCitations) console.log("Citations table empty — skipping citation benchmarks\n");

	const allResults: BenchResult[] = [];

	for (const brand of topBrands.rows) {
		const brandResults = await benchBrand(brand.brand_id, brand.run_count, hasCitations);
		allResults.push(...brandResults);
	}

	// === Admin queries (run once) ===
	console.log("\n### Admin queries\n");

	allResults.push(await bench("getAdminRunsOverTime", () => pgRead.getAdminRunsOverTime()));
	allResults.push(await bench("getAdminBrandRunStats", () => pgRead.getAdminBrandRunStats()));

	// ============================================================================
	// Output
	// ============================================================================

	console.log("\n## Summary\n");
	console.log(`| Query | Avg (ms) | Min (ms) | P95 (ms) | Rows |`);
	console.log(`|-------|----------|----------|----------|------|`);

	let totalAvg = 0;
	for (const r of allResults) {
		totalAvg += r.avg;
		console.log(`| ${r.name} | ${r.avg} | ${r.min} | ${r.p95} | ${r.rows} |`);
	}
	console.log(`| **TOTAL** | **${totalAvg}** | | | |`);

	const over200 = allResults.filter((r) => r.avg > 200 && !r.name.startsWith("getAdmin"));
	const over600 = allResults.filter((r) => r.avg > 600 && r.name.startsWith("getAdmin"));
	if (over200.length > 0 || over600.length > 0) {
		console.log("\nQueries exceeding target latency:");
		for (const r of [...over200, ...over600]) {
			console.log(`  - ${r.name}: ${r.avg}ms avg`);
		}
	} else {
		console.log("\nAll queries within target latency (user-facing <200ms, admin <600ms)");
	}

	process.exit(0);
}

main().catch((err) => {
	console.error("Fatal error:", err);
	process.exit(1);
});
