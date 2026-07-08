/**
 * /api/v1/reports/:reportId - External API endpoint for report status/data
 * Protected by API key authentication.
 *
 * GET: Poll report status. When completed, returns per-prompt snapshot data
 *      (mentions with top-K competitors).
 *      Consumers are responsible for computing SoV and other derived metrics.
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import { reports } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { computeReportUnstableStats } from "@workspace/lib/report-metrics";
import { ApiError, createApiHandler } from "@/lib/api/handler";

export const Route = createFileRoute("/api/v1/reports/$reportId")({
	server: {
		handlers: {
			GET: createApiHandler({
				params: z.object({ reportId: z.guid("Invalid report ID format") }),
				handle: async ({ params, request }) => {
					const { reportId } = params;

					const result = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
					if (result.length === 0) {
						throw new ApiError(404, "Not Found", `Report with ID '${reportId}' not found`);
					}

					const report = result[0];

					// For non-completed reports, return status with progress
					if (report.status !== "completed" || !report.rawOutput) {
						return {
							reportId: report.id,
							status: report.status,
							progress: report.progress,
							brandName: report.brandName,
							brandWebsite: report.brandWebsite,
							createdAt: report.createdAt,
							completedAt: report.completedAt,
						};
					}

					const { searchParams } = new URL(request.url);

					// Top-K params applied to each prompt's snapshot
					const kMentionsParam = Number.parseInt(searchParams.get("kMentions") || "5", 10);
					const kMentions = Number.isNaN(kMentionsParam) ? 5 : Math.max(1, Math.min(50, kMentionsParam));

					// Parse raw output
					const rawOutput = report.rawOutput as {
						competitors: Array<{ name: string; domain: string }>;
						prompts: Array<{ value: string }>;
						promptRuns: Array<{
							promptValue: string;
							runs: Array<{
								model: string;
								brandMentioned: boolean;
								competitorsMentioned: string[];
							}>;
						}>;
					};

					// Build per-prompt snapshot data
					const allPromptSnapshots = rawOutput.promptRuns.map((pr) => {
						const totalRuns = pr.runs.length;
						let brandMentionsTotal = 0;
						let competitorMentionsTotal = 0;
						const competitorCounts: Record<string, number> = {};

						for (const run of pr.runs) {
							if (run.brandMentioned) brandMentionsTotal++;
							for (const comp of run.competitorsMentioned) {
								competitorCounts[comp] = (competitorCounts[comp] || 0) + 1;
								competitorMentionsTotal++;
							}
						}

						// Sort competitors by count descending, take top K
						const mentionsTopK = Object.entries(competitorCounts)
							.map(([entity, count]) => ({ entity, count }))
							.sort((a, b) => b.count - a.count)
							.slice(0, kMentions);

						return {
							promptValue: pr.promptValue,
							totalRuns,
							mentions: {
								mentionsTotal: brandMentionsTotal + competitorMentionsTotal,
								brandMentionsTotal,
								competitorMentionsTotal,
								mentionsTopK,
							},
						};
					});

					// Compute unstable derived stats
					const unstable = computeReportUnstableStats(rawOutput);

					return {
						reportId: report.id,
						status: report.status,
						brandName: report.brandName,
						brandWebsite: report.brandWebsite,
						createdAt: report.createdAt,
						completedAt: report.completedAt,
						prompts: allPromptSnapshots,
						unstable,
					};
				},
			}),
		},
	},
});
