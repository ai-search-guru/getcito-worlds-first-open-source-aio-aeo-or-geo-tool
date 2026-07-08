import { describe, it, expect } from "vitest";
import {
	computePromptSoV,
	computeOverallSoV,
	computeCompetitorSoVs,
	selectRepresentativePrompts,
	findContentGaps,
	analyzeWebQueries,
	analyzeCompetitorFrequency,
	analyzeByEngine,
	computeReportUnstableStats,
	getSoVColor,
	getSoVLevel,
	type ReportPromptRun,
	type ReportCompetitor,
	type PromptSoV,
	type FullPromptRun,
	type ReportRawPromptRuns,
} from "./report-metrics";

const competitors: ReportCompetitor[] = [
	{ name: "CompA", domain: "compa.com" },
	{ name: "CompB", domain: "compb.com" },
];

function makeRun(overrides: Partial<ReportPromptRun> & { promptId: string }): ReportPromptRun {
	return {
		brandMentioned: false,
		competitorsMentioned: [],
		...overrides,
	};
}

describe("computePromptSoV", () => {
	it("returns null SoV when no runs exist for prompt", () => {
		const result = computePromptSoV("p1", [], competitors);
		expect(result.sov).toBeNull();
		expect(result.totalRuns).toBe(0);
	});

	it("returns null SoV when no one is mentioned", () => {
		const runs = [
			makeRun({ promptId: "p1" }),
			makeRun({ promptId: "p1" }),
		];
		const result = computePromptSoV("p1", runs, competitors);
		expect(result.sov).toBeNull();
		expect(result.totalRuns).toBe(2);
		expect(result.brandMentionCount).toBe(0);
	});

	it("returns 100% SoV when only brand is mentioned", () => {
		const runs = [
			makeRun({ promptId: "p1", brandMentioned: true }),
			makeRun({ promptId: "p1", brandMentioned: true }),
			makeRun({ promptId: "p1" }),
		];
		const result = computePromptSoV("p1", runs, competitors);
		expect(result.sov).toBe(100);
		expect(result.brandMentionCount).toBe(2);
	});

	it("returns 0% SoV when only competitors are mentioned", () => {
		const runs = [
			makeRun({ promptId: "p1", competitorsMentioned: ["CompA"] }),
			makeRun({ promptId: "p1", competitorsMentioned: ["CompB"] }),
		];
		const result = computePromptSoV("p1", runs, competitors);
		expect(result.sov).toBe(0);
		expect(result.totalCompetitorMentions).toBe(2);
	});

	it("computes correct SoV with mixed mentions", () => {
		const runs = [
			makeRun({ promptId: "p1", brandMentioned: true, competitorsMentioned: ["CompA"] }),
			makeRun({ promptId: "p1", competitorsMentioned: ["CompA", "CompB"] }),
			makeRun({ promptId: "p1", brandMentioned: true }),
		];
		// brand mentions: 2, competitor mentions: 3 (CompA twice, CompB once)
		// SoV = 2 / (2 + 3) = 40%
		const result = computePromptSoV("p1", runs, competitors);
		expect(result.sov).toBe(40);
		expect(result.brandMentionCount).toBe(2);
		expect(result.totalCompetitorMentions).toBe(3);
		expect(result.competitorMentions).toEqual({ CompA: 2, CompB: 1 });
	});

	it("ignores competitors not in the competitors list", () => {
		const runs = [
			makeRun({ promptId: "p1", brandMentioned: true, competitorsMentioned: ["Unknown"] }),
		];
		const result = computePromptSoV("p1", runs, competitors);
		expect(result.sov).toBe(100);
		expect(result.totalCompetitorMentions).toBe(0);
	});

	it("only counts runs for the specified prompt", () => {
		const runs = [
			makeRun({ promptId: "p1", brandMentioned: true }),
			makeRun({ promptId: "p2", competitorsMentioned: ["CompA"] }),
		];
		const result = computePromptSoV("p1", runs, competitors);
		expect(result.sov).toBe(100);
		expect(result.totalRuns).toBe(1);
	});
});

describe("computeOverallSoV", () => {
	it("returns null when no mentions at all", () => {
		const runs = [makeRun({ promptId: "p1" }), makeRun({ promptId: "p2" })];
		expect(computeOverallSoV(runs, competitors)).toBeNull();
	});

	it("returns null for empty runs", () => {
		expect(computeOverallSoV([], competitors)).toBeNull();
	});

	it("aggregates across all prompts", () => {
		const runs = [
			makeRun({ promptId: "p1", brandMentioned: true }),
			makeRun({ promptId: "p1", competitorsMentioned: ["CompA"] }),
			makeRun({ promptId: "p2", brandMentioned: true, competitorsMentioned: ["CompB"] }),
			makeRun({ promptId: "p2", competitorsMentioned: ["CompA"] }),
		];
		// brand: 2, competitors: 3 => SoV = 2/5 = 40%
		expect(computeOverallSoV(runs, competitors)).toBe(40);
	});

	it("returns 100% when only brand mentioned across prompts", () => {
		const runs = [
			makeRun({ promptId: "p1", brandMentioned: true }),
			makeRun({ promptId: "p2", brandMentioned: true }),
		];
		expect(computeOverallSoV(runs, competitors)).toBe(100);
	});
});

describe("computeCompetitorSoVs", () => {
	it("returns empty array when no mentions", () => {
		const runs = [makeRun({ promptId: "p1" })];
		expect(computeCompetitorSoVs(runs, competitors)).toEqual([]);
	});

	it("computes per-competitor SoV sorted by SoV descending", () => {
		const runs = [
			makeRun({ promptId: "p1", brandMentioned: true, competitorsMentioned: ["CompA"] }),
			makeRun({ promptId: "p1", competitorsMentioned: ["CompA", "CompB"] }),
			makeRun({ promptId: "p2", brandMentioned: true, competitorsMentioned: ["CompB"] }),
		];
		// Total: brand=2, CompA=2, CompB=2 => total=6
		// Brand SoV = 33%, CompA SoV = 33%, CompB SoV = 33%
		const result = computeCompetitorSoVs(runs, competitors);
		expect(result).toHaveLength(2);
		expect(result[0].sov + result[1].sov).toBeLessThanOrEqual(68); // rounding
		expect(result[0].mentionCount).toBe(2);
	});

	it("handles competitors with zero mentions", () => {
		const runs = [
			makeRun({ promptId: "p1", brandMentioned: true, competitorsMentioned: ["CompA"] }),
		];
		const result = computeCompetitorSoVs(runs, competitors);
		const compB = result.find((c) => c.name === "CompB");
		expect(compB?.sov).toBe(0);
		expect(compB?.mentionCount).toBe(0);
	});
});

describe("selectRepresentativePrompts", () => {
	const isBranded = (id: string) => id === "branded1";

	it("selects 2 strengths and 2 opportunities", () => {
		const sovs: PromptSoV[] = [
			{ promptId: "p1", sov: 80, brandMentionCount: 4, totalRuns: 5, totalCompetitorMentions: 1, competitorMentions: { CompA: 1 } },
			{ promptId: "p2", sov: 60, brandMentionCount: 3, totalRuns: 5, totalCompetitorMentions: 2, competitorMentions: { CompA: 2 } },
			{ promptId: "p3", sov: 10, brandMentionCount: 1, totalRuns: 5, totalCompetitorMentions: 9, competitorMentions: { CompA: 5, CompB: 4 } },
			{ promptId: "p4", sov: 0, brandMentionCount: 0, totalRuns: 5, totalCompetitorMentions: 4, competitorMentions: { CompA: 4 } },
		];

		const result = selectRepresentativePrompts(sovs, isBranded);
		expect(result).toHaveLength(4);

		const strengths = result.filter((r) => r.category === "strength");
		const opportunities = result.filter((r) => r.category === "opportunity");
		expect(strengths).toHaveLength(2);
		expect(opportunities).toHaveLength(2);

		// Strengths should be p1 (80%) and p2 (60%)
		expect(strengths.map((s) => s.promptId)).toEqual(["p1", "p2"]);
		// Opportunities: p3 (10% - non-zero, preferred) then p4 (0% - at most 1 zero allowed)
		expect(opportunities.map((o) => o.promptId)).toEqual(["p3", "p4"]);
	});

	it("fills from other bucket when one has fewer than 2", () => {
		const sovs: PromptSoV[] = [
			{ promptId: "p1", sov: 80, brandMentionCount: 4, totalRuns: 5, totalCompetitorMentions: 1, competitorMentions: {} },
			{ promptId: "p2", sov: 60, brandMentionCount: 3, totalRuns: 5, totalCompetitorMentions: 2, competitorMentions: {} },
			{ promptId: "p3", sov: 50, brandMentionCount: 2, totalRuns: 5, totalCompetitorMentions: 2, competitorMentions: {} },
		];

		// No real opportunities (no prompts with competitor mentions but low brand SoV)
		const result = selectRepresentativePrompts(sovs, isBranded);
		expect(result.length).toBeGreaterThanOrEqual(3);
	});

	it("prefers non-branded prompts", () => {
		const sovs: PromptSoV[] = [
			{ promptId: "branded1", sov: 90, brandMentionCount: 4, totalRuns: 5, totalCompetitorMentions: 1, competitorMentions: {} },
			{ promptId: "p1", sov: 70, brandMentionCount: 3, totalRuns: 5, totalCompetitorMentions: 2, competitorMentions: {} },
			{ promptId: "p2", sov: 50, brandMentionCount: 2, totalRuns: 5, totalCompetitorMentions: 3, competitorMentions: {} },
			{ promptId: "p3", sov: 10, brandMentionCount: 1, totalRuns: 5, totalCompetitorMentions: 5, competitorMentions: { CompA: 5 } },
			{ promptId: "p4", sov: 0, brandMentionCount: 0, totalRuns: 5, totalCompetitorMentions: 4, competitorMentions: { CompA: 4 } },
		];

		const result = selectRepresentativePrompts(sovs, isBranded);
		// branded1 should not be selected when there are enough non-branded
		expect(result.every((r) => r.promptId !== "branded1")).toBe(true);
	});

	it("allows at most 1 zero-SoV prompt", () => {
		const sovs: PromptSoV[] = [
			{ promptId: "p1", sov: 80, brandMentionCount: 4, totalRuns: 5, totalCompetitorMentions: 1, competitorMentions: { CompA: 1 } },
			{ promptId: "p2", sov: 60, brandMentionCount: 3, totalRuns: 5, totalCompetitorMentions: 2, competitorMentions: { CompA: 2 } },
			{ promptId: "p3", sov: 0, brandMentionCount: 0, totalRuns: 5, totalCompetitorMentions: 5, competitorMentions: { CompA: 5 } },
			{ promptId: "p4", sov: 0, brandMentionCount: 0, totalRuns: 5, totalCompetitorMentions: 4, competitorMentions: { CompA: 4 } },
			{ promptId: "p5", sov: 0, brandMentionCount: 0, totalRuns: 5, totalCompetitorMentions: 3, competitorMentions: { CompA: 3 } },
		];

		const result = selectRepresentativePrompts(sovs, isBranded);
		const zeroSovCount = result.filter((r) => r.sov === 0 || r.sov === null).length;
		expect(zeroSovCount).toBeLessThanOrEqual(1);
	});

	it("prefers non-zero SoV opportunities over zero SoV", () => {
		const sovs: PromptSoV[] = [
			{ promptId: "p1", sov: 80, brandMentionCount: 4, totalRuns: 5, totalCompetitorMentions: 1, competitorMentions: { CompA: 1 } },
			{ promptId: "p2", sov: 70, brandMentionCount: 3, totalRuns: 5, totalCompetitorMentions: 1, competitorMentions: { CompA: 1 } },
			{ promptId: "p3", sov: 15, brandMentionCount: 1, totalRuns: 5, totalCompetitorMentions: 6, competitorMentions: { CompA: 6 } },
			{ promptId: "p4", sov: 0, brandMentionCount: 0, totalRuns: 5, totalCompetitorMentions: 10, competitorMentions: { CompA: 10 } },
		];

		const result = selectRepresentativePrompts(sovs, isBranded);
		const opportunities = result.filter((r) => r.category === "opportunity");
		// p3 (15% SoV, non-zero) should be picked before p4 (0%)
		expect(opportunities[0].promptId).toBe("p3");
	});

	it("returns empty array when no prompts", () => {
		expect(selectRepresentativePrompts([], isBranded)).toEqual([]);
	});

	it("handles case where all prompts have null SoV", () => {
		const sovs: PromptSoV[] = [
			{ promptId: "p1", sov: null, brandMentionCount: 0, totalRuns: 5, totalCompetitorMentions: 0, competitorMentions: {} },
			{ promptId: "p2", sov: null, brandMentionCount: 0, totalRuns: 5, totalCompetitorMentions: 0, competitorMentions: {} },
		];
		const result = selectRepresentativePrompts(sovs, isBranded);
		expect(result).toEqual([]);
	});
});

// ---------- Rich Analysis Tests ----------

function makeFullRun(overrides: Partial<FullPromptRun> & { promptId: string }): FullPromptRun {
	return {
		promptValue: "test prompt",
		brandMentioned: false,
		competitorsMentioned: [],
		webQueries: [],
		textContent: "",
		model: "openai",
		...overrides,
	};
}

describe("findContentGaps", () => {
	it("finds prompts where competitors mentioned but brand is not", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", promptValue: "best crm", competitorsMentioned: ["CompA", "CompB"] }),
			makeFullRun({ promptId: "p1", promptValue: "best crm", competitorsMentioned: ["CompA"] }),
			makeFullRun({ promptId: "p2", promptValue: "top tools", brandMentioned: true, competitorsMentioned: ["CompA"] }),
		];
		const gaps = findContentGaps(runs);
		expect(gaps).toHaveLength(1);
		expect(gaps[0].promptId).toBe("p1");
		expect(gaps[0].competitorsMentioned).toEqual(expect.arrayContaining(["CompA", "CompB"]));
		expect(gaps[0].competitorCount).toBe(2);
	});

	it("returns empty when brand is mentioned in all prompts", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", brandMentioned: true, competitorsMentioned: ["CompA"] }),
			makeFullRun({ promptId: "p2", brandMentioned: true }),
		];
		expect(findContentGaps(runs)).toEqual([]);
	});

	it("excludes prompts with no competitor mentions", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1" }),
			makeFullRun({ promptId: "p1" }),
		];
		expect(findContentGaps(runs)).toEqual([]);
	});

	it("sorts by competitor count descending and respects maxResults", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", promptValue: "q1", competitorsMentioned: ["CompA"] }),
			makeFullRun({ promptId: "p2", promptValue: "q2", competitorsMentioned: ["CompA", "CompB", "CompC"] }),
			makeFullRun({ promptId: "p3", promptValue: "q3", competitorsMentioned: ["CompA", "CompB"] }),
		];
		const gaps = findContentGaps(runs, 2);
		expect(gaps).toHaveLength(2);
		expect(gaps[0].promptId).toBe("p2");
		expect(gaps[1].promptId).toBe("p3");
	});

	it("deduplicates competitors across runs for same prompt", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", promptValue: "q", competitorsMentioned: ["CompA", "CompB"] }),
			makeFullRun({ promptId: "p1", promptValue: "q", competitorsMentioned: ["CompA", "CompC"] }),
		];
		const gaps = findContentGaps(runs);
		expect(gaps[0].competitorCount).toBe(3);
		expect(gaps[0].competitorsMentioned).toHaveLength(3);
	});
});

describe("analyzeWebQueries", () => {
	it("counts and ranks queries by frequency", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", webQueries: ["best crm software", "top crm tools"] }),
			makeFullRun({ promptId: "p2", webQueries: ["best crm software", "best crm software"] }),
			makeFullRun({ promptId: "p3", webQueries: ["enterprise solutions"] }),
		];
		const insights = analyzeWebQueries(runs);
		expect(insights[0].query).toBe("best crm software");
		expect(insights[0].count).toBe(3);
		expect(insights[1].query).toBe("top crm tools");
		expect(insights[1].count).toBe(1);
	});

	it("computes brand mention rate per query", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", brandMentioned: true, webQueries: ["best crm"] }),
			makeFullRun({ promptId: "p2", brandMentioned: false, webQueries: ["best crm"] }),
			makeFullRun({ promptId: "p3", brandMentioned: true, webQueries: ["best crm"] }),
		];
		const insights = analyzeWebQueries(runs);
		expect(insights[0].query).toBe("best crm");
		expect(insights[0].brandMentionRate).toBe(67); // 2/3 rounded
	});

	it("normalizes queries to lowercase", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", webQueries: ["Best CRM"] }),
			makeFullRun({ promptId: "p2", webQueries: ["best crm"] }),
		];
		const insights = analyzeWebQueries(runs);
		expect(insights).toHaveLength(1);
		expect(insights[0].count).toBe(2);
	});

	it("skips short queries (< 3 chars)", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", webQueries: ["ab", "", "valid query"] }),
		];
		const insights = analyzeWebQueries(runs);
		expect(insights).toHaveLength(1);
		expect(insights[0].query).toBe("valid query");
	});

	it("returns empty for runs with no web queries", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", webQueries: [] }),
			makeFullRun({ promptId: "p2" }),
		];
		expect(analyzeWebQueries(runs)).toEqual([]);
	});

	it("respects maxResults", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", webQueries: ["query a", "query b", "query c"] }),
		];
		const insights = analyzeWebQueries(runs, 2);
		expect(insights).toHaveLength(2);
	});
});

describe("analyzeCompetitorFrequency", () => {
	it("counts mentions and unique prompts per competitor", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", competitorsMentioned: ["CompA", "CompB"] }),
			makeFullRun({ promptId: "p1", competitorsMentioned: ["CompA"] }),
			makeFullRun({ promptId: "p2", competitorsMentioned: ["CompA"] }),
		];
		const result = analyzeCompetitorFrequency(runs, competitors);
		const compA = result.find((c) => c.name === "CompA")!;
		expect(compA.mentionCount).toBe(3);
		expect(compA.promptCount).toBe(2);
		const compB = result.find((c) => c.name === "CompB")!;
		expect(compB.mentionCount).toBe(1);
		expect(compB.promptCount).toBe(1);
	});

	it("sorts by mention count descending", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", competitorsMentioned: ["CompB", "CompB"] }),
			makeFullRun({ promptId: "p2", competitorsMentioned: ["CompA"] }),
		];
		const result = analyzeCompetitorFrequency(runs, competitors);
		expect(result[0].name).toBe("CompB");
	});

	it("computes co-mention rate (competitor mentioned alongside brand)", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", brandMentioned: true, competitorsMentioned: ["CompA"] }),
			makeFullRun({ promptId: "p2", brandMentioned: false, competitorsMentioned: ["CompA"] }),
			makeFullRun({ promptId: "p3", brandMentioned: true, competitorsMentioned: ["CompA"] }),
		];
		const result = analyzeCompetitorFrequency(runs, competitors);
		const compA = result.find((c) => c.name === "CompA")!;
		expect(compA.coMentionRate).toBe(67); // 2/3
	});

	it("handles competitors with zero mentions", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", competitorsMentioned: ["CompA"] }),
		];
		const result = analyzeCompetitorFrequency(runs, competitors);
		const compB = result.find((c) => c.name === "CompB")!;
		expect(compB.mentionCount).toBe(0);
		expect(compB.promptCount).toBe(0);
		expect(compB.coMentionRate).toBe(0);
	});

	it("ignores competitors not in the list", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", competitorsMentioned: ["Unknown"] }),
		];
		const result = analyzeCompetitorFrequency(runs, competitors);
		expect(result.every((c) => c.mentionCount === 0)).toBe(true);
	});
});

describe("analyzeByEngine", () => {
	it("computes mention rate per engine", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", model: "openai", brandMentioned: true }),
			makeFullRun({ promptId: "p2", model: "openai", brandMentioned: false }),
			makeFullRun({ promptId: "p3", model: "anthropic", brandMentioned: true }),
			makeFullRun({ promptId: "p4", model: "anthropic", brandMentioned: true }),
			makeFullRun({ promptId: "p5", model: "google", brandMentioned: false }),
		];
		const result = analyzeByEngine(runs);
		const claude = result.find((e) => e.engine === "Claude")!;
		expect(claude.totalRuns).toBe(2);
		expect(claude.brandMentions).toBe(2);
		expect(claude.mentionRate).toBe(100);

		const chatgpt = result.find((e) => e.engine === "ChatGPT")!;
		expect(chatgpt.totalRuns).toBe(2);
		expect(chatgpt.brandMentions).toBe(1);
		expect(chatgpt.mentionRate).toBe(50);

		const google = result.find((e) => e.engine === "Google AI")!;
		expect(google.mentionRate).toBe(0);
	});

	it("sorts by mention rate descending", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", model: "openai", brandMentioned: false }),
			makeFullRun({ promptId: "p2", model: "anthropic", brandMentioned: true }),
		];
		const result = analyzeByEngine(runs);
		expect(result[0].engine).toBe("Claude");
		expect(result[1].engine).toBe("ChatGPT");
	});

	it("returns empty for no runs", () => {
		expect(analyzeByEngine([])).toEqual([]);
	});

	it("title-cases unknown engine ids via getModelMeta", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", model: "my-custom-engine", brandMentioned: true }),
		];
		const result = analyzeByEngine(runs);
		// `getModelMeta` turns unknown ids into title-cased labels.
		expect(result[0].engine).toBe("My Custom Engine");
	});

	it("renames known engine ids to their display labels", () => {
		const runs: FullPromptRun[] = [
			makeFullRun({ promptId: "p1", model: "perplexity", brandMentioned: true }),
		];
		const result = analyzeByEngine(runs);
		expect(result[0].engine).toBe("Perplexity");
	});
});

describe("computeReportUnstableStats", () => {
	it("computes all stats from raw prompt runs", () => {
		const raw: ReportRawPromptRuns = {
			competitors: [
				{ name: "CompA", domain: "compa.com" },
				{ name: "CompB", domain: "compb.com" },
			],
			promptRuns: [
				{
					promptValue: "best tools",
					runs: [
						{ brandMentioned: true, competitorsMentioned: ["CompA"] },
						{ brandMentioned: false, competitorsMentioned: ["CompA", "CompB"] },
						{ brandMentioned: true, competitorsMentioned: [] },
					],
				},
				{
					promptValue: "top software",
					runs: [
						{ brandMentioned: false, competitorsMentioned: ["CompB"] },
						{ brandMentioned: false, competitorsMentioned: [] },
					],
				},
			],
		};

		const stats = computeReportUnstableStats(raw);

		expect(stats.totalPrompts).toBe(2);
		expect(stats.totalPromptRuns).toBe(5);
		expect(stats.promptsWithBrandMentions).toBe(1); // only first prompt has brand mentions
		expect(stats.promptRunsWithBrandMentions).toBe(2); // 2 individual runs had brand mentioned

		// visibility = brandMentions / totalPromptRuns = 2/5 = 0.4
		expect(stats.visibility).toBe(2 / 5);

		// sov = brandMentions / (brandMentions + competitorMentions) = 2 / (2 + 4)
		expect(stats.sov).toBe(2 / 6);

		// Competitors should be sorted by SoV descending
		expect(stats.competitors).toHaveLength(2);
		const compA = stats.competitors.find((c) => c.name === "CompA")!;
		const compB = stats.competitors.find((c) => c.name === "CompB")!;
		// competitor sov = mentions / totalAllMentions = 2 / 6
		expect(compA.sov).toBe(2 / 6);
		expect(compB.sov).toBe(2 / 6);
		// CompA mentioned in 2 runs across 1 prompt, CompB in 2 runs across 2 prompts
		expect(compA.promptRunsWithMentions).toBe(2);
		expect(compA.promptsWithMentions).toBe(1);
		expect(compB.promptRunsWithMentions).toBe(2);
		expect(compB.promptsWithMentions).toBe(2);
		// visibility = runs with this competitor / total runs
		expect(compA.visibility).toBe(2 / 5);
		expect(compB.visibility).toBe(2 / 5);
	});

	it("returns null sov and 0 visibility when no mentions", () => {
		const raw: ReportRawPromptRuns = {
			competitors: [{ name: "CompA", domain: "compa.com" }],
			promptRuns: [
				{
					promptValue: "test",
					runs: [
						{ brandMentioned: false, competitorsMentioned: [] },
						{ brandMentioned: false, competitorsMentioned: [] },
					],
				},
			],
		};

		const stats = computeReportUnstableStats(raw);
		expect(stats.sov).toBeNull();
		expect(stats.visibility).toBe(0);
		expect(stats.promptsWithBrandMentions).toBe(0);
		expect(stats.promptRunsWithBrandMentions).toBe(0);
	});

	it("handles empty prompt runs", () => {
		const raw: ReportRawPromptRuns = {
			competitors: [],
			promptRuns: [],
		};

		const stats = computeReportUnstableStats(raw);
		expect(stats.totalPrompts).toBe(0);
		expect(stats.totalPromptRuns).toBe(0);
		expect(stats.visibility).toBe(0);
		expect(stats.sov).toBeNull();
		expect(stats.competitors).toEqual([]);
	});

	it("returns 1.0 visibility and sov when only brand mentioned", () => {
		const raw: ReportRawPromptRuns = {
			competitors: [{ name: "CompA", domain: "compa.com" }],
			promptRuns: [
				{
					promptValue: "brand query",
					runs: [
						{ brandMentioned: true, competitorsMentioned: [] },
						{ brandMentioned: true, competitorsMentioned: [] },
					],
				},
			],
		};

		const stats = computeReportUnstableStats(raw);
		expect(stats.visibility).toBe(1);
		expect(stats.sov).toBe(1);
		expect(stats.promptsWithBrandMentions).toBe(1);
	});

	it("counts promptsWithBrandMentions correctly across multiple prompts", () => {
		const raw: ReportRawPromptRuns = {
			competitors: [],
			promptRuns: [
				{
					promptValue: "p1",
					runs: [{ brandMentioned: true, competitorsMentioned: [] }],
				},
				{
					promptValue: "p2",
					runs: [{ brandMentioned: false, competitorsMentioned: [] }],
				},
				{
					promptValue: "p3",
					runs: [
						{ brandMentioned: false, competitorsMentioned: [] },
						{ brandMentioned: true, competitorsMentioned: [] },
					],
				},
			],
		};

		const stats = computeReportUnstableStats(raw);
		expect(stats.totalPrompts).toBe(3);
		expect(stats.promptsWithBrandMentions).toBe(2); // p1 and p3
	});
});

describe("getSoVColor", () => {
	it("returns correct colors for SoV ranges", () => {
		expect(getSoVColor(null)).toBe("text-gray-400");
		expect(getSoVColor(10)).toBe("text-rose-500");
		expect(getSoVColor(30)).toBe("text-amber-500");
		expect(getSoVColor(50)).toBe("text-emerald-600");
	});
});

describe("getSoVLevel", () => {
	it("returns correct levels for SoV ranges", () => {
		expect(getSoVLevel(null).label).toBe("No Data");
		expect(getSoVLevel(10).label).toBe("Low");
		expect(getSoVLevel(30).label).toBe("Moderate");
		expect(getSoVLevel(50).label).toBe("Strong");
	});
});
