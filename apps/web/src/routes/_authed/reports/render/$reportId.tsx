/**
 * /reports/render/$reportId - Standalone report rendering page
 *
 * Production-quality printable report (US Letter 8.5 x 11 in).
 * Uses Share of Voice as the primary metric with rich competitive analysis.
 */
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { requireAuthSession, hasReportAccess } from "@/lib/auth/helpers";
import { getReportByIdFn } from "@/server/reports";
import { PromptChartPrint } from "@/components/prompt-chart-print";
import { Target, BarChart3, Rocket } from "lucide-react";
import { Logo } from "@/components/logo";
import { useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import {
	computeOverallSoV,
	computePromptSoV,
	computeCompetitorSoVs,
	selectRepresentativePrompts,
	findContentGaps,
	analyzeWebQueries,
	analyzeCompetitorFrequency,
	analyzeByEngine,
	getSoVColor,
	getSoVLevel,
	type ReportPromptRun,
	type FullPromptRun,
	type PromptCategory,
} from "@workspace/lib/report-metrics";

// ---------- Types ----------

interface ReportData {
	competitors: CompetitorResult[];
	prompts: PromptData[];
	promptRuns: PromptRunResult[];
}

interface CompetitorResult { name: string; domain: string; }
interface PromptData { value: string; }

interface PromptRunResult {
	promptValue: string;
	runs: Array<{
		model: string;
		version: string;
		webSearchEnabled: boolean;
		rawOutput: any;
		webQueries: string[];
		textContent: string;
		brandMentioned: boolean;
		competitorsMentioned: string[];
	}>;
}

interface MockPrompt { id: string; brandId: string; value: string; enabled: boolean; createdAt: Date; }

// ---------- Server function ----------

const loadReportData = createServerFn({ method: "GET" })
	.validator((d: string) => d)
	.handler(async ({ data: reportId }) => {
		const session = await requireAuthSession();
		if (!hasReportAccess(session)) throw new Error("Not authorized");
		return getReportByIdFn({ data: { reportId } });
	});

function isPromptBranded(promptValue: string, brandName: string, brandWebsite: string): boolean {
	const promptLower = promptValue.toLowerCase();
	const brandNameLower = brandName.toLowerCase();
	try {
		const url = new URL(brandWebsite.startsWith("http") ? brandWebsite : `https://${brandWebsite}`);
		const domain = url.hostname.replace(/^www\./, "").toLowerCase();
		const domainWithoutTld = domain.split(".")[0];
		return promptLower.includes(brandNameLower) || promptLower.includes(domain) || promptLower.includes(domainWithoutTld);
	} catch {
		return promptLower.includes(brandNameLower);
	}
}

// ---------- Route ----------

export const Route = createFileRoute("/_authed/reports/render/$reportId")({
	loader: async ({ params }) => {
		const report = await loadReportData({ data: params.reportId });
		if (!report) throw notFound();
		return { report };
	},
	head: () => ({
		meta: [
			{ title: "AI Share of Voice Report" },
			{ name: "robots", content: "noindex, nofollow" },
		],
	}),
	component: ReportRenderPage,
});

// ---------- Color helpers ----------

function sovBgColor(sov: number | null): string {
	if (sov === null) return "bg-slate-300";
	if (sov >= 40) return "bg-emerald-500";
	if (sov >= 20) return "bg-amber-500";
	return "bg-rose-500";
}

// ---------- Main component ----------

function ReportRenderPage() {
	const { report } = Route.useLoaderData();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const branding = context.clientConfig?.branding;

	if (report.status !== "completed") {
		return (
			<div className="max-w-3xl mx-auto p-8 text-center">
				<p className="text-slate-500">Report status: <span className="font-medium">{report.status}</span></p>
			</div>
		);
	}

	const data: ReportData = report.rawOutput as ReportData;

	// Build mock data structures for chart component compatibility
	const mockBrand = {
		id: "brand-1", name: report.brandName, website: report.brandWebsite,
		enabled: true, onboarded: true, delayOverrideHours: null,
		createdAt: new Date(), updatedAt: new Date(),
	};
	const mockCompetitors = data.competitors.map((comp, i) => ({
		id: `comp-${i + 1}`, name: comp.name, domain: comp.domain,
		brandId: mockBrand.id, createdAt: new Date(), updatedAt: new Date(),
	}));
	const mockPrompts: MockPrompt[] = data.prompts.map((p, i) => ({
		id: `prompt-${i + 1}`, brandId: mockBrand.id, value: p.value, enabled: true, createdAt: new Date(),
	}));

	// Build run arrays
	const simpleRuns: ReportPromptRun[] = [];
	const fullRuns: FullPromptRun[] = [];
	const chartRuns: any[] = [];

	data.promptRuns.forEach((pr, pi) => {
		pr.runs.forEach((run, ri) => {
			const promptId = `prompt-${pi + 1}`;
			simpleRuns.push({ promptId, brandMentioned: run.brandMentioned, competitorsMentioned: run.competitorsMentioned });
			fullRuns.push({
				promptId, promptValue: pr.promptValue,
				brandMentioned: run.brandMentioned, competitorsMentioned: run.competitorsMentioned,
				webQueries: run.webQueries || [], textContent: run.textContent || "", model: run.model,
			});
			chartRuns.push({
				id: `run-${pi}-${ri}`, promptId, brandMentioned: run.brandMentioned,
				competitorsMentioned: run.competitorsMentioned, createdAt: new Date(),
				model: run.model, version: run.version,
				webSearchEnabled: run.webSearchEnabled, rawOutput: run.rawOutput, webQueries: run.webQueries,
			});
		});
	});

	// Deduplicate competitors by name (case-insensitive) and filter out brand
	const brandNameLower = report.brandName.toLowerCase().trim();
	const isBrandName = (name: string) => name.toLowerCase().trim() === brandNameLower;
	const seenCompetitorNames = new Set<string>();
	const filteredCompetitors = data.competitors.filter((c) => {
		const key = c.name.toLowerCase().trim();
		if (isBrandName(c.name) || seenCompetitorNames.has(key)) return false;
		seenCompetitorNames.add(key);
		return true;
	});

	// Core metrics
	const overallSoV = computeOverallSoV(simpleRuns, filteredCompetitors);
	const competitorSoVs = computeCompetitorSoVs(simpleRuns, filteredCompetitors);
	const promptSoVs = mockPrompts.map((p) => computePromptSoV(p.id, simpleRuns, filteredCompetitors));
	const promptMap = new Map(mockPrompts.map((p) => [p.id, p]));

	const selectedPrompts = selectRepresentativePrompts(
		promptSoVs,
		(id: string) => {
			const p = promptMap.get(id);
			return p ? isPromptBranded(p.value, report.brandName, report.brandWebsite) : false;
		},
	);

	// Rich analysis
	const contentGaps = findContentGaps(fullRuns, 5);
	const allWebQueries = analyzeWebQueries(fullRuns, 1000);
	const competitorFreq = analyzeCompetitorFrequency(fullRuns, filteredCompetitors);
	const engineBreakdown = analyzeByEngine(fullRuns);

	// Enrich web queries with competitor mention data
	const queryCompetitorMap = new Map<string, { brandMentioned: boolean; competitorCount: number }>();
	for (const run of fullRuns) {
		for (const query of (run.webQueries || [])) {
			const normalized = query.toLowerCase().trim();
			if (!normalized || normalized.length < 3) continue;
			const existing = queryCompetitorMap.get(normalized);
			const compCount = run.competitorsMentioned.length;
			if (!existing) {
				queryCompetitorMap.set(normalized, { brandMentioned: run.brandMentioned, competitorCount: compCount });
			} else {
				if (run.brandMentioned) existing.brandMentioned = true;
				existing.competitorCount = Math.max(existing.competitorCount, compCount);
			}
		}
	}
	// Mix of top-frequency + brand-mentioned queries
	const enrichedQueries = allWebQueries.map((q) => {
		const extra = queryCompetitorMap.get(q.query);
		return { ...q, brandMentioned: extra?.brandMentioned ?? false, competitorCount: extra?.competitorCount ?? 0 };
	});
	const topSearchQueries: typeof enrichedQueries = [];
	const usedQueries = new Set<string>();
	const byFrequency = [...enrichedQueries].sort((a, b) => b.count - a.count);
	const withBrand = enrichedQueries.filter((q) => q.brandMentioned).sort((a, b) => b.count - a.count);
	for (const q of byFrequency) {
		if (topSearchQueries.length >= 3) break;
		if (!usedQueries.has(q.query)) { topSearchQueries.push(q); usedQueries.add(q.query); }
	}
	for (const q of withBrand) {
		if (topSearchQueries.length >= 6) break;
		if (!usedQueries.has(q.query)) { topSearchQueries.push(q); usedQueries.add(q.query); }
	}
	for (const q of byFrequency) {
		if (topSearchQueries.length >= 6) break;
		if (!usedQueries.has(q.query)) { topSearchQueries.push(q); usedQueries.add(q.query); }
	}
	topSearchQueries.sort((a, b) => b.competitorCount - a.competitorCount);

	const sovLevel = getSoVLevel(overallSoV);
	const sovColor = getSoVColor(overallSoV);
	const totalPrompts = mockPrompts.length;
	const promptsWithMentions = promptSoVs.filter((p) => p.brandMentionCount > 0).length;
	const mentionRate = totalPrompts > 0 ? Math.round((promptsWithMentions / totalPrompts) * 100) : 0;

	// Charts: 2 per page
	const chartPairs: Array<typeof selectedPrompts> = [];
	for (let i = 0; i < selectedPrompts.length; i += 2) {
		chartPairs.push(selectedPrompts.slice(i, i + 2));
	}

	return (
		<div className="max-w-[780px] mx-auto bg-white print:max-w-none text-slate-900">
			<style dangerouslySetInnerHTML={{ __html: `
				@media print {
					@page { size: letter; margin: 0.5in 0.6in; }
					body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
				}
			`}} />

			{/* ===== PAGE 1: COVER ===== */}
			<div className="print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<div className="h-[3px] bg-slate-800 -mx-10 print:-mx-0 mb-8" />

				<div className="flex items-center justify-between mb-16">
					<Logo iconClassName="!size-5" textClassName="text-sm font-semibold text-slate-400" />
					<span className="text-xs tracking-wide text-slate-400">
						{new Date(report.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
					</span>
				</div>

				<div className="flex-1 flex flex-col justify-center">
					<div className="text-[10px] font-semibold tracking-[0.25em] uppercase text-slate-400 mb-4">
						AI Share of Voice Report
					</div>
					<h1 className="text-4xl font-bold tracking-tight mb-2">{report.brandName}</h1>
					<div className="w-16 h-[2px] bg-slate-800 mb-12" />

					<div className="bg-slate-50 rounded-xl p-8 max-w-md mb-12">
						<div className="flex items-baseline gap-4">
							<span className={`text-6xl font-extrabold tracking-tighter ${sovColor}`}>
								{overallSoV !== null ? `${overallSoV}%` : "N/A"}
							</span>
							<div>
								<div className="text-sm font-semibold">Share of Voice</div>
								<div className="text-xs text-slate-500">{sovLevel.label} &mdash; {sovLevel.description}</div>
							</div>
						</div>
						<div className="mt-4 w-full bg-slate-200 rounded-full h-2">
							<div className={`h-2 rounded-full ${sovBgColor(overallSoV)}`} style={{ width: `${Math.max(2, overallSoV ?? 0)}%` }} />
						</div>
					</div>

					<div className="grid grid-cols-3 gap-6 max-w-lg">
						<CoverStat value={String(totalPrompts)} label="Prompts Tested" />
						<CoverStat value={String(promptsWithMentions)} label="Brand Mentions" />
						<CoverStat value={String(filteredCompetitors.length)} label="Competitors" />
					</div>
				</div>

				<PageFooter branding={branding} />
			</div>

			{/* ===== PAGE 2: COMPETITIVE OVERVIEW ===== */}
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section title="AI Engine Performance" subtitle={`Brand mention rate across ${engineBreakdown.reduce((s, e) => s + e.totalRuns, 0)} evaluations`} />
				<div className="grid grid-cols-3 gap-3 mb-8">
					{engineBreakdown.map((eng) => (
						<div key={eng.engine} className="border border-slate-200 rounded-lg p-4">
							<div className="text-[11px] font-medium text-slate-500 mb-2">{eng.engine}</div>
							<div className={`text-3xl font-bold ${getSoVColor(eng.mentionRate)}`}>{eng.mentionRate}%</div>
							<div className="text-[10px] text-slate-400 mt-1">{eng.brandMentions} of {eng.totalRuns} runs</div>
							<div className="mt-2.5 w-full bg-slate-100 rounded-full h-1.5">
								<div className={`h-1.5 rounded-full ${sovBgColor(eng.mentionRate)}`} style={{ width: `${Math.max(2, eng.mentionRate)}%` }} />
							</div>
						</div>
					))}
				</div>

				<Section title="Competitive Landscape" subtitle="Share of voice comparison across all tested prompts" />
				<div className="border border-slate-200 rounded-lg overflow-hidden mb-8 print:pb-px">
					<table className="w-full">
						<thead>
							<tr className="bg-slate-50 border-b border-slate-200">
								<TH align="left">Brand</TH>
								<TH align="right" className="w-16">SoV</TH>
								<TH align="left" className="w-[40%]">Share</TH>
							</tr>
						</thead>
						<tbody className="divide-y divide-slate-100">
							{[
								{ name: report.brandName, sov: overallSoV ?? 0, isBrand: true },
								...competitorSoVs.filter((c) => !isBrandName(c.name)).slice(0, 3).map((c) => ({ name: c.name, sov: c.sov, isBrand: false })),
							]
								.sort((a, b) => b.sov - a.sov)
								.map((row, i) => (
								<tr key={`sov-${i}`} className={row.isBrand ? "bg-blue-50/30" : ""}>
									<td className={`py-2.5 px-4 text-sm ${row.isBrand ? "font-semibold" : "text-slate-600"}`}>{row.name}</td>
									<td className="py-2.5 px-4 text-right">
										<span className={`text-sm font-bold ${row.isBrand ? sovColor : "text-slate-500"}`}>{row.sov}%</span>
									</td>
									<td className="py-2.5 px-4"><Bar value={row.sov} color={row.isBrand ? "bg-blue-500" : "bg-slate-300"} /></td>
								</tr>
							))}
						</tbody>
					</table>
				</div>

				{competitorFreq.length > 0 && (
					<>
						<Section title="Mention Rate" subtitle="Each prompt is evaluated multiple times across AI engines — mentions show total appearances, unique prompts show how many distinct prompts include the brand" />
						<div className="border border-slate-200 rounded-lg overflow-hidden print:pb-px">
							<table className="w-full">
								<thead>
									<tr className="bg-slate-50 border-b border-slate-200">
										<TH align="left">Brand</TH>
										<TH align="center">Mentions</TH>
										<TH align="center">Unique Prompts</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{[
										{ name: report.brandName, mentionCount: simpleRuns.filter((r) => r.brandMentioned).length, promptCount: promptsWithMentions, isBrand: true },
										...competitorFreq.filter((c) => !isBrandName(c.name)).slice(0, 3).map((c) => ({ ...c, isBrand: false })),
									]
										.sort((a, b) => b.mentionCount - a.mentionCount)
										.map((c, i) => (
										<tr key={`mention-${i}`} className={c.isBrand ? "bg-blue-50/30" : ""}>
											<td className={`py-2 px-4 text-xs font-medium ${c.isBrand ? "text-slate-900" : "text-slate-700"}`}>{c.name}</td>
											<td className="py-2 px-4 text-center text-xs text-slate-600">{c.mentionCount}<span className="text-slate-400">/{simpleRuns.length}</span></td>
											<td className="py-2 px-4 text-center text-xs text-slate-600">{c.promptCount}<span className="text-slate-400">/{totalPrompts}</span></td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}

				<div className="mt-auto"><PageFooter branding={branding} /></div>
			</div>

			{/* ===== CHART PAGES ===== */}
			{chartPairs.map((pair, pageIdx) => (
				<div key={pageIdx} className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
					<RunningHeader brand={report.brandName} />

					{pageIdx === 0 ? (
						<Section title="Prompt Analysis" subtitle="Share of voice for representative prompts — strengths and growth opportunities" />
					) : (
						<div className="text-xs text-slate-400 italic mb-4">Prompt Analysis (continued)</div>
					)}

					<div className="flex-1 flex flex-col gap-5">
						{pair.map((selected) => {
							const prompt = promptMap.get(selected.promptId);
							if (!prompt) return null;
							return (
								<div key={selected.promptId} className="flex-1 flex flex-col">
									<PromptChartPrint
										lookback="1m"
										promptName={prompt.value}
										promptId={prompt.id}
										brand={mockBrand as any}
										competitors={mockCompetitors as any}
										promptRuns={chartRuns}
										category={selected.category}
									/>
								</div>
							);
						})}
					</div>

					<div className="mt-auto"><PageFooter branding={branding} /></div>
				</div>
			))}

			{/* ===== OPPORTUNITIES ===== */}
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section title="Content Gaps" subtitle={`Prompts where competitors appear but ${report.brandName} does not — highest-value opportunities`} />

				{contentGaps.length > 0 ? (
					<div className="border border-slate-200 rounded-lg overflow-hidden mb-8">
						<table className="w-full">
							<thead>
								<tr className="bg-slate-50 border-b border-slate-200">
									<TH align="left">Prompt</TH>
									<TH align="left" className="w-[50%]">Competitors Found</TH>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{contentGaps.map((gap) => (
									<tr key={gap.promptId}>
										<td className="py-2.5 px-4 text-xs text-slate-700 leading-relaxed max-w-[320px]">{gap.promptValue}</td>
										<td className="py-2.5 px-4">
											<div className="flex flex-wrap gap-1">
												{gap.competitorsMentioned.slice(0, 3).map((c) => (
													<span key={c} className="inline-block px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[10px] font-medium">{c}</span>
												))}
												{gap.competitorsMentioned.length > 3 && (
													<span className="text-[10px] text-slate-400">+{gap.competitorsMentioned.length - 3}</span>
												)}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="border border-slate-200 rounded-lg p-6 text-center mb-8">
						<p className="text-slate-500 text-sm">{report.brandName} appears in all prompts where competitors are mentioned.</p>
					</div>
				)}

				{topSearchQueries.length > 0 && (
					<>
						<Section title="Top AI Search Queries" subtitle="Common web search queries AI models run when answering prompts in your category" />
						<div className="border border-slate-200 rounded-lg overflow-hidden">
							<table className="w-full">
								<thead>
									<tr className="bg-slate-50 border-b border-slate-200">
										<TH align="left">Query</TH>
										<TH align="center" className="w-28">Competitors Found</TH>
										<TH align="center" className="w-24">Brand Mentioned</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{topSearchQueries.map((q) => (
										<tr key={q.query}>
											<td className="py-2.5 px-4 text-xs text-slate-700 max-w-[350px] break-words">{q.query}</td>
											<td className="py-2.5 px-4 text-center text-xs text-slate-600">{q.competitorCount}</td>
											<td className="py-2.5 px-4 text-center">
												{q.brandMentioned
													? <span className="text-emerald-600 font-semibold text-xs">&#10003;</span>
													: <span className="text-slate-300 text-xs">&mdash;</span>}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}

				<div className="mt-auto"><PageFooter branding={branding} /></div>
			</div>

			{/* ===== SoV OPPORTUNITY + WHAT TO DO NEXT ===== */}
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section title="Share of Voice Opportunity" subtitle="Overview of your current AI share of voice and growth potential" />

				<div className="border border-slate-200 rounded-lg overflow-hidden mb-8">
					<table className="w-full">
						<thead>
							<tr className="bg-slate-50 border-b border-slate-200">
								<TH align="center">Prompts With Mentions</TH>
								<TH align="center">Total Prompts Tested</TH>
								<TH align="center">Overall SoV</TH>
								<TH align="center">Opportunity</TH>
								<TH align="left">Recommendation</TH>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td className="text-center py-3 px-4 text-sm font-semibold">{promptsWithMentions}</td>
								<td className="text-center py-3 px-4 text-sm text-slate-600">{totalPrompts}</td>
								<td className="text-center py-3 px-4"><span className={`text-sm font-bold ${sovColor}`}>{overallSoV ?? 0}%</span></td>
								<td className="text-center py-3 px-4">
									<span className={`inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold ${(overallSoV ?? 0) < 20 ? "bg-rose-50 text-rose-700" : (overallSoV ?? 0) < 40 ? "bg-amber-50 text-amber-700" : "bg-emerald-50 text-emerald-700"}`}>
										{(overallSoV ?? 0) < 20 ? "High" : (overallSoV ?? 0) < 40 ? "Medium" : "Low"}
									</span>
								</td>
								<td className="py-3 px-4 text-xs text-slate-600">
									{(overallSoV ?? 0) < 20
										? "Prioritize content creation to establish AI presence"
										: (overallSoV ?? 0) < 40
											? "Expand content to increase brand share of voice"
											: "Maintain leadership and defend competitive position"}
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<Section title="What Should I Do Next?" subtitle={`Prompts where competitors outperform ${report.brandName} — your biggest growth opportunities`} />

				{(() => {
					const opportunities = promptSoVs
						.filter((p) => p.totalCompetitorMentions > 0)
						.map((p) => {
							const prompt = promptMap.get(p.promptId);
							const brandSoV = p.sov ?? 0;
							// Find the single highest competitor's SoV for this prompt
							const topCompMentions = Math.max(...Object.values(p.competitorMentions), 0);
							const denom = p.brandMentionCount + p.totalCompetitorMentions;
							const maxCompSoV = denom > 0 ? Math.round((topCompMentions / denom) * 100) : 0;
							const gap = maxCompSoV - brandSoV;
							// Goal: match or slightly beat the top competitor
							const margin = gap > 30 ? 5 : gap > 15 ? 8 : 10;
							const goalSoV = Math.min(100, maxCompSoV + margin);
							// Article count scales with gap
							const articleCount = gap > 40 ? 8 : gap > 25 ? 6 : gap > 10 ? 5 : 4;
							return {
								promptValue: prompt?.value ?? p.promptId,
								brandSoV,
								maxCompSoV,
								gap,
								goalSoV,
								articleCount,
							};
						})
						.filter((o) => o.gap > 0)
						// Prefer prompts where brand has SOME presence (more actionable), then by gap
						.sort((a, b) => {
							if (a.brandSoV > 0 && b.brandSoV === 0) return -1;
							if (a.brandSoV === 0 && b.brandSoV > 0) return 1;
							return b.gap - a.gap;
						})
						.slice(0, 5);

					if (opportunities.length === 0) {
						return (
							<div className="border border-slate-200 rounded-lg p-6 text-center">
								<p className="text-slate-500 text-sm">{report.brandName} leads or matches competitors across all tested prompts.</p>
							</div>
						);
					}

					return (
						<div className="border border-slate-200 rounded-lg overflow-hidden">
							<table className="w-full">
								<thead>
									<tr className="bg-slate-50 border-b border-slate-200">
										<TH align="left">Prompt</TH>
										<TH align="center">Current SoV</TH>
										<TH align="center">Top Competitor SoV</TH>
										<TH align="center">Goal SoV</TH>
										<TH align="left">Recommendation</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{opportunities.map((o) => (
										<tr key={o.promptValue}>
											<td className="py-2.5 px-4 text-xs text-slate-700 max-w-[200px] break-words leading-relaxed">{o.promptValue}</td>
											<td className="py-2.5 px-4 text-center">
												<span className={`text-xs font-semibold ${getSoVColor(o.brandSoV)}`}>{o.brandSoV}%</span>
											</td>
											<td className="py-2.5 px-4 text-center text-xs font-semibold text-slate-600">{o.maxCompSoV}%</td>
											<td className="py-2.5 px-4 text-center text-xs font-semibold text-emerald-600">{o.goalSoV}%</td>
											<td className="py-2.5 px-4 text-xs text-slate-600">
												Write {o.articleCount} LLM-friendly articles on &ldquo;{o.promptValue}&rdquo;
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				})()}

				<div className="mt-auto"><PageFooter branding={branding} /></div>
			</div>

			{/* ===== CTA ===== */}
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col print:justify-center p-10 print:p-0">
				<div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-10 text-center">
					<h2 className="text-2xl font-bold text-slate-800 mb-2">Ready to Optimize Your AI Visibility?</h2>
					<p className="text-slate-600 text-base mb-8">
						Take your brand's AI presence to the next level with {branding?.name || "Getcito"}
					</p>

					<div className="grid grid-cols-3 gap-6 mb-8">
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<Target className="h-8 w-8 text-slate-600" />
							</div>
							<h3 className="font-semibold text-slate-800 mb-2">Strategic Optimization</h3>
							<p className="text-sm text-slate-600 leading-relaxed">
								Develop content strategies that increase your brand's share of voice in AI responses
							</p>
						</div>
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<BarChart3 className="h-8 w-8 text-slate-600" />
							</div>
							<h3 className="font-semibold text-slate-800 mb-2">Continuous Monitoring</h3>
							<p className="text-sm text-slate-600 leading-relaxed">
								Track your AI share of voice across hundreds of relevant prompts and topics
							</p>
						</div>
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<Rocket className="h-8 w-8 text-slate-600" />
							</div>
							<h3 className="font-semibold text-slate-800 mb-2">Competitive Advantage</h3>
							<p className="text-sm text-slate-600 leading-relaxed">
								Stay ahead of competitors in the rapidly evolving AI search landscape
							</p>
						</div>
					</div>

					<div className="pt-6 border-t border-blue-200">
						<p className="text-slate-800 font-medium mb-2">
							Get started with {branding?.name || "Getcito"} today
						</p>
						<p className="text-slate-600 text-sm text-balance">
							Visit{" "}
							<a
								href={branding?.url || "https://getcito.chat"}
								target="_blank"
								rel="noopener noreferrer"
								className="font-bold text-blue-600 hover:underline hover:text-blue-700"
							>
								{branding?.url || "Getcito.chat"}
							</a>{" "}
							to learn more about our AI visibility platform and services.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------- Sub-components ----------

function RunningHeader({ brand }: { brand: string }) {
	return (
		<div className="flex items-center justify-between mb-6 pb-3 border-b border-slate-100">
			<span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-slate-400">AI Share of Voice Report</span>
			<span className="text-[10px] font-medium text-slate-400">{brand}</span>
		</div>
	);
}

function Section({ title, subtitle }: { title: string; subtitle?: string }) {
	return (
		<div className="border-l-[3px] border-slate-800 pl-3 mb-4">
			<h2 className="text-base font-semibold">{title}</h2>
			{subtitle && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>}
		</div>
	);
}

function TH({ children, align, className = "" }: { children: React.ReactNode; align: "left" | "center" | "right"; className?: string }) {
	const alignCls = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
	return (
		<th className={`py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-slate-500 ${alignCls} ${className}`}>
			{children}
		</th>
	);
}

function CoverStat({ value, label }: { value: string; label: string }) {
	return (
		<div className="border-t-2 border-slate-800 pt-3">
			<div className="text-2xl font-bold">{value}</div>
			<div className="text-[10px] text-slate-500 mt-0.5">{label}</div>
		</div>
	);
}

function Bar({ value, color }: { value: number | null; color: string }) {
	return (
		<div className="w-full bg-slate-100 rounded-full h-2.5">
			<div className={`${color} h-2.5 rounded-full`} style={{ width: `${Math.max(2, value ?? 0)}%` }} />
		</div>
	);
}

function Badge({ category }: { category: PromptCategory }) {
	const cls = category === "strength"
		? "bg-emerald-50 text-emerald-700 border-emerald-200"
		: "bg-amber-50 text-amber-700 border-amber-200";
	return (
		<span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${cls}`}>
			{category === "strength" ? "Strength" : "Opportunity"}
		</span>
	);
}

function SummaryRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between items-center">
			<span className="text-xs text-slate-500">{label}</span>
			<span className="text-xs font-semibold">{value}</span>
		</div>
	);
}

function Finding({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex gap-3 items-start">
			<div className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-[7px] shrink-0" />
			<p className="text-sm text-slate-700 leading-relaxed">{children}</p>
		</div>
	);
}

function PageFooter({ branding }: { branding?: ClientConfig["branding"] }) {
	return (
		<div className="pt-4 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400">
			<Logo iconClassName="!size-3" textClassName="text-[10px] font-medium text-slate-400" />
			<span>{branding?.url || "Getcito.chat"}</span>
		</div>
	);
}
