import { getDefaultDelayHours } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { brands, promptRuns, prompts } from "@workspace/lib/db/schema";
import { parseScrapeTargets } from "@workspace/lib/providers";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Job } from "pg-boss";
import boss from "../boss";

export interface ScheduleMaintenanceData {
	source?: string; // For logging - "scheduled" or "manual"
}

/**
 * Maintenance job that ensures all enabled prompts have scheduled jobs.
 * This is a self-healing mechanism that catches any prompts that fell through
 * the cracks (e.g., due to worker crashes, failed jobs, etc.).
 *
 * Runs every 6 hours via pg-boss schedule.
 */
export async function scheduleMaintenanceJob(jobs: Job<ScheduleMaintenanceData>[]): Promise<void> {
	for (const job of jobs) {
		const source = job.data?.source || "scheduled";
		console.log(`[schedule-maintenance] Starting maintenance check (source: ${source})`);

		try {
			await runMaintenanceCheck();
		} catch (error) {
			console.error("[schedule-maintenance] Maintenance check failed:", error);
			throw error; // Will trigger retry
		}
	}
}

async function runMaintenanceCheck(): Promise<void> {
	// Get all enabled brands
	const enabledBrands = await db.query.brands.findMany({
		where: eq(brands.enabled, true),
	});

	if (enabledBrands.length === 0) {
		console.log("[schedule-maintenance] No enabled brands found");
		return;
	}

	const brandIds = enabledBrands.map((b) => b.id);
	const defaultDelayHours = getDefaultDelayHours();
	const brandDelayMap: Record<string, number> = {};
	for (const brand of enabledBrands) {
		brandDelayMap[brand.id] = brand.delayOverrideHours ?? defaultDelayHours;
	}

	// Get all enabled prompts for enabled brands
	const enabledPrompts = await db.query.prompts.findMany({
		where: and(eq(prompts.enabled, true), inArray(prompts.brandId, brandIds)),
	});

	if (enabledPrompts.length === 0) {
		console.log("[schedule-maintenance] No enabled prompts found");
		return;
	}

	console.log(`[schedule-maintenance] Checking ${enabledPrompts.length} enabled prompts`);

	const allModels = parseScrapeTargets(process.env.SCRAPE_TARGETS);
	const modelNames = allModels.map((cfg) => cfg.model);

	// Get last runs per prompt per model (matches dashboard overdue logic)
	const lastRunsQuery = await db
		.select({
			promptId: promptRuns.promptId,
			model: promptRuns.model,
			lastRunAt: sql<Date>`MAX(${promptRuns.createdAt})`.as("last_run_at"),
		})
		.from(promptRuns)
		.groupBy(promptRuns.promptId, promptRuns.model);

	const lastRunsMap: Record<string, Record<string, Date>> = {};
	for (const run of lastRunsQuery) {
		if (!lastRunsMap[run.promptId]) {
			lastRunsMap[run.promptId] = {};
		}
		lastRunsMap[run.promptId][run.model] = run.lastRunAt;
	}

	// Get all pending jobs with their state info
	const pendingJobMap = await getPendingJobMap();

	const now = Date.now();
	const promptsToSchedule: { promptId: string; cadenceHours: number }[] = [];
	const jobsToExpedite: string[] = []; // Job IDs to expedite (move start_after to now)

	for (const prompt of enabledPrompts) {
		const pendingJob = pendingJobMap.get(prompt.id);

		// Skip if there's an active or retry job (already being worked on)
		if (pendingJob && (pendingJob.state === "active" || pendingJob.state === "retry")) {
			continue;
		}

		const cadenceHours = brandDelayMap[prompt.brandId] ?? defaultDelayHours;
		const runFrequencyMs = cadenceHours * 60 * 60 * 1000;
		const lastRuns = lastRunsMap[prompt.id] || {};

		// Strict Run Delay Logic:
		// We only care about the most recent time this prompt was run, regardless of which model.
		// If they add a new model to the config, we DO NOT expedite the run. We wait for the strict cadence.
		let isOverdue = false;
		const allRunTimes = Object.values(lastRuns).map((d) => new Date(d as Date).getTime());

		if (allRunTimes.length === 0) {
			// Never run before - definitely overdue
			isOverdue = true;
		} else {
			// Find the most recent time this prompt was run on ANY model
			const mostRecentRunMs = Math.max(...allRunTimes);
			const timeSinceMostRecentRun = now - mostRecentRunMs;
			
			// It's only overdue if the MOST RECENT run was longer ago than the cadence
			if (timeSinceMostRecentRun > runFrequencyMs) {
				isOverdue = true;
			}
		}

		if (!isOverdue) continue;

		if (pendingJob && pendingJob.state === "created") {
			// There's a future job scheduled - expedite it to run now
			jobsToExpedite.push(pendingJob.jobId);
		} else {
			// No pending job at all - create a new one
			promptsToSchedule.push({ promptId: prompt.id, cadenceHours });
		}
	}

	if (promptsToSchedule.length === 0 && jobsToExpedite.length === 0) {
		console.log("[schedule-maintenance] All prompts are on schedule or have pending jobs");
		return;
	}

	console.log(
		`[schedule-maintenance] Found ${promptsToSchedule.length} prompts needing new jobs, ${jobsToExpedite.length} jobs to expedite`,
	);

	// Expedite existing future jobs to run now by updating start_after
	if (jobsToExpedite.length > 0) {
		let expeditedCount = 0;
		for (const jobId of jobsToExpedite) {
			try {
				await db.execute(sql`
					UPDATE pgboss.job
					SET start_after = now()
					WHERE id = ${jobId}
					  AND state = 'created'
				`);
				expeditedCount++;
			} catch (error) {
				console.error(`[schedule-maintenance] Failed to expedite job ${jobId}:`, error);
			}
		}
		console.log(`[schedule-maintenance] Expedited ${expeditedCount} future jobs to run now`);
	}

	// Schedule new jobs for prompts with no pending job
	if (promptsToSchedule.length > 0) {
		const BATCH_SIZE = 50;
		let successCount = 0;
		let failCount = 0;

		for (let i = 0; i < promptsToSchedule.length; i += BATCH_SIZE) {
			const batch = promptsToSchedule.slice(i, i + BATCH_SIZE);
			const results = await Promise.allSettled(
				batch.map(({ promptId, cadenceHours }) =>
					boss.send(
						"process-prompt",
						{ promptId, cadenceHours },
						{
							singletonKey: `prompt-${promptId}`,
							singletonSeconds: 60 * 60, // 1 hour - prevent duplicates
							retryLimit: 3,
							retryDelay: 60,
							retryBackoff: true,
							expireInSeconds: 60 * 15,
						},
					),
				),
			);

			for (const result of results) {
				if (result.status === "fulfilled") {
					successCount++;
				} else {
					failCount++;
					console.error("[schedule-maintenance] Failed to schedule job:", result.reason);
				}
			}
		}

		console.log(
			`[schedule-maintenance] Scheduled ${successCount} new jobs${failCount > 0 ? ` (${failCount} failed)` : ""}`,
		);
	}
}

/**
 * Get pending jobs for each prompt, preferring the most active state.
 * Returns at most one job per prompt: active > retry > created.
 */
interface PendingJobInfo {
	jobId: string;
	state: "created" | "active" | "retry";
}

async function getPendingJobMap(): Promise<Map<string, PendingJobInfo>> {
	const result = await db.execute(sql`
		SELECT id, data->>'promptId' as prompt_id, state
		FROM pgboss.job
		WHERE name = 'process-prompt'
		  AND state IN ('created', 'active', 'retry')
		  AND data->>'promptId' IS NOT NULL
		ORDER BY
			CASE state
				WHEN 'active' THEN 1
				WHEN 'retry' THEN 2
				WHEN 'created' THEN 3
			END
	`);

	const map = new Map<string, PendingJobInfo>();
	for (const row of result.rows as { id: string; prompt_id: string; state: string }[]) {
		if (row.prompt_id && !map.has(row.prompt_id)) {
			map.set(row.prompt_id, {
				jobId: row.id,
				state: row.state as "created" | "active" | "retry",
			});
		}
	}

	return map;
}
