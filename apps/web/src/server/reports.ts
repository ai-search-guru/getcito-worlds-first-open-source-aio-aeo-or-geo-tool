/**
 * Server functions for report operations.
 * Replaces apps/web/src/app/api/reports/route.ts
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, hasReportAccess } from "@/lib/auth/helpers";
import { db } from "@workspace/lib/db/db";
import { reports, type NewReport } from "@workspace/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { sendReportJob } from "@/lib/job-scheduler";

async function requireReportAccess() {
	const session = await requireAuthSession();
	if (!hasReportAccess(session)) throw new Error("Access denied. Report generator access required.");
}

/**
 * Get all reports
 */
export const getReportsFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireReportAccess();

	return db
		.select({
			id: reports.id,
			brandName: reports.brandName,
			brandWebsite: reports.brandWebsite,
			status: reports.status,
			createdAt: reports.createdAt,
			completedAt: reports.completedAt,
			updatedAt: reports.updatedAt,
		})
		.from(reports)
		.orderBy(desc(reports.createdAt));
});

/**
 * Get a single report by ID (includes rawOutput for rendering)
 */
export const getReportByIdFn = createServerFn({ method: "GET" })
	.validator(z.object({ reportId: z.string() }))
	.handler(async ({ data }) => {
		await requireReportAccess();

		const result = await db.select().from(reports).where(eq(reports.id, data.reportId)).limit(1);
		if (result.length === 0) throw new Error("Report not found");
		const report = result[0];
		return { ...report, rawOutput: report.rawOutput as {} | null };
	});

/**
 * Create a new report and queue generation job
 */
export const createReportFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandName: z.string().min(1),
			brandWebsite: z.string().url(),
			manualPrompts: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		await requireReportAccess();

		// Parse manual prompts
		const parsedManualPrompts: string[] = [];
		if (data.manualPrompts?.trim()) {
			parsedManualPrompts.push(
				...data.manualPrompts
					.split("\n")
					.map((line) => line.trim())
					.filter((line) => line.length > 0),
			);
		}

		// Create report
		const newReport: NewReport = {
			brandName: data.brandName.trim(),
			brandWebsite: data.brandWebsite.trim(),
			status: "pending",
		};

		const result = await db.insert(reports).values(newReport).returning();
		const createdReport = result[0];
		if (!createdReport) throw new Error("Failed to create report");

		// Queue job
		try {
			const success = await sendReportJob(
				createdReport.id,
				createdReport.brandName,
				createdReport.brandWebsite,
				parsedManualPrompts.length > 0 ? parsedManualPrompts : undefined,
			);
			if (!success) throw new Error("Failed to send report job");
		} catch (error) {
			await db
				.update(reports)
				.set({ status: "failed", updatedAt: new Date() })
				.where(eq(reports.id, createdReport.id));
			throw new Error("Failed to queue report generation");
		}

		return { ...createdReport, rawOutput: createdReport.rawOutput as {} | null };
	});

/**
 * Delete a report
 */
export const deleteReportFn = createServerFn({ method: "POST" })
	.validator(z.object({ reportId: z.string() }))
	.handler(async ({ data }) => {
		await requireReportAccess();
		await db.delete(reports).where(eq(reports.id, data.reportId));
		return { success: true };
	});
