/**
 * /api/v1/reports - External API endpoint for report generation
 * Protected by API key authentication.
 *
 * POST: Create a new report and queue generation.
 * GET: List reports with pagination.
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import { reports, type NewReport } from "@workspace/lib/db/schema";
import { desc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { sendReportJob } from "@/lib/job-scheduler";
import { ApiError, createApiHandler } from "@/lib/api/handler";

const createReportBody = z.object({
	brandName: z.string("brandName is required and must be a non-empty string").trim().min(1, "brandName is required and must be a non-empty string"),
	brandWebsite: z
		.string("brandWebsite is required and must be a non-empty string")
		.trim()
		.min(1, "brandWebsite is required and must be a non-empty string")
		.refine((website) => {
			try {
				new URL(website.startsWith("http") ? website : `https://${website}`);
				return true;
			} catch {
				return false;
			}
		}, "brandWebsite must be a valid URL"),
	manualPrompts: z.array(z.string()).optional(),
});

export const Route = createFileRoute("/api/v1/reports/")({
	server: {
		handlers: {
			POST: createApiHandler({
				body: createReportBody,
				status: 201,
				handle: async ({ body }) => {
					const filteredPrompts = (body.manualPrompts ?? []).map((p) => p.trim()).filter((p) => p.length > 0);
					const parsedManualPrompts = filteredPrompts.length > 0 ? filteredPrompts : undefined;

					const newReport: NewReport = {
						brandName: body.brandName,
						brandWebsite: body.brandWebsite,
						status: "pending",
					};

					const result = await db.insert(reports).values(newReport).returning();
					const createdReport = result[0];
					if (!createdReport) {
						throw new ApiError(500, "Internal Server Error", "Failed to create report");
					}

					const success = await sendReportJob(
						createdReport.id,
						createdReport.brandName,
						createdReport.brandWebsite,
						parsedManualPrompts,
					);

					if (!success) {
						await db
							.update(reports)
							.set({ status: "failed", updatedAt: new Date() })
							.where(eq(reports.id, createdReport.id));
						throw new ApiError(500, "Internal Server Error", "Failed to queue report generation");
					}

					return {
						reportId: createdReport.id,
						status: createdReport.status,
						brandName: createdReport.brandName,
						brandWebsite: createdReport.brandWebsite,
						createdAt: createdReport.createdAt,
					};
				},
			}),

			GET: createApiHandler({
				handle: async ({ request }) => {
					const { searchParams } = new URL(request.url);
					const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
					const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "20")));
					const offset = (page - 1) * limit;

					const [totalCountResult] = await db.select({ count: count() }).from(reports);
					const totalCount = totalCountResult?.count || 0;
					const totalPages = Math.ceil(totalCount / limit);

					const reportsList = await db
						.select({
							id: reports.id,
							brandName: reports.brandName,
							brandWebsite: reports.brandWebsite,
							status: reports.status,
							createdAt: reports.createdAt,
							completedAt: reports.completedAt,
						})
						.from(reports)
						.orderBy(desc(reports.createdAt))
						.limit(limit)
						.offset(offset);

					return {
						reports: reportsList,
						pagination: { page, limit, total: totalCount, totalPages },
					};
				},
			}),
		},
	},
});
