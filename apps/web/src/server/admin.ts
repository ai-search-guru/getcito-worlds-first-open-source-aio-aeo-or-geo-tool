/**
 * Server functions for admin operations.
 * Replaces apps/web/src/app/api/admin/* API routes.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, isAdmin } from "@/lib/auth/helpers";
import { db } from "@workspace/lib/db/db";
import { brands, prompts, promptRuns, member, user } from "@workspace/lib/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import {
	getAdminRunsOverTime,
	getAdminBrandRunStats,
	getAdminActiveBrandsOverTime,
} from "@/lib/postgres-read";
import { analyzeBrand } from "@workspace/lib/onboarding";
import { getDefaultDelayHours } from "@workspace/lib/constants";
import { sendImmediatePromptJob } from "@/lib/job-scheduler";
import { Client } from "pg";
import { parseScrapeTargets } from "@workspace/lib/providers";

// ============================================================================
// Admin guard helper
// ============================================================================

async function requireAdmin() {
	const session = await requireAuthSession();
	if (!isAdmin(session)) throw new Error("Unauthorized: Admin access required");
	return session;
}

// ============================================================================
// Postgres client helper for pg-boss queries
// ============================================================================

async function withPgClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
	const connectionString = process.env.DATABASE_URL;
	if (!connectionString) {
		throw new Error("DATABASE_URL is required");
	}
	const client = new Client({ connectionString });
	await client.connect();
	try {
		return await fn(client);
	} finally {
		await client.end();
	}
}

// ============================================================================
// Admin Dashboard - Brand Stats
// ============================================================================

/**
 * Get admin dashboard statistics (all brands, run counts, time series charts).
 */
export const getAdminStatsFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireAdmin();

	const sevenDaysAgo = new Date();
	sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
	const thirtyDaysAgo = new Date();
	thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

	const [
		allBrands,
		brandsOverTime,
		promptsOverTime,
		runsOverTimeData,
		brandRunStats,
		activeBrandsData,
	] = await Promise.all([
		db.query.brands.findMany({ orderBy: desc(brands.createdAt) }),

		// Cumulative brand count over time (last 30 days)
		db
			.select({
				date: sql<string>`date_series::date`,
				count: sql<number>`COUNT(${brands.id})::int`,
			})
			.from(
				sql`generate_series(
					NOW()::date - INTERVAL '30 days',
					NOW()::date,
					INTERVAL '1 day'
				) AS date_series`,
			)
			.leftJoin(brands, sql`${brands.createdAt}::date <= date_series::date`)
			.groupBy(sql`date_series`)
			.orderBy(sql`date_series`),

		// Cumulative prompts count over time (enabled vs disabled)
		db
			.select({
				date: sql<string>`date_series::date`,
				enabled: sql<number>`COUNT(*) FILTER (WHERE ${prompts.enabled} = true)::int`,
				disabled: sql<number>`COUNT(*) FILTER (WHERE ${prompts.enabled} = false)::int`,
			})
			.from(
				sql`generate_series(
					NOW()::date - INTERVAL '30 days',
					NOW()::date,
					INTERVAL '1 day'
				) AS date_series`,
			)
			.leftJoin(prompts, sql`${prompts.createdAt}::date <= date_series::date`)
			.groupBy(sql`date_series`)
			.orderBy(sql`date_series`),

		getAdminRunsOverTime(),
		getAdminBrandRunStats(),
		getAdminActiveBrandsOverTime(),
	]);

	const brandRunStatsMap = new Map(brandRunStats.map((stat) => [stat.brand_id, stat]));

	const brandMembersQuery = await db
		.select({
			brandId: member.organizationId,
			email: user.email,
			name: user.name,
			role: member.role,
		})
		.from(member)
		.innerJoin(user, eq(member.userId, user.id));

	const brandCreators = new Map<string, { email: string; name: string }>();
	for (const m of brandMembersQuery) {
		if (!brandCreators.has(m.brandId) || m.role === "owner" || m.role === "admin") {
			brandCreators.set(m.brandId, { email: m.email, name: m.name });
		}
	}

	const brandStats = await Promise.all(
		allBrands.map(async (brand) => {
			const promptCounts = await db
				.select({
					total: sql<number>`count(*)::int`,
					active: sql<number>`count(*) filter (where enabled = true)::int`,
				})
				.from(prompts)
				.where(eq(prompts.brandId, brand.id));

			const recentPromptCounts = await db
				.select({
					added7Days: sql<number>`count(*) filter (where ${prompts.createdAt} >= ${sevenDaysAgo})::int`,
					removed7Days: sql<number>`count(*) filter (where ${prompts.updatedAt} >= ${sevenDaysAgo} and ${prompts.enabled} = false)::int`,
					added30Days: sql<number>`count(*) filter (where ${prompts.createdAt} >= ${thirtyDaysAgo})::int`,
					removed30Days: sql<number>`count(*) filter (where ${prompts.updatedAt} >= ${thirtyDaysAgo} and ${prompts.enabled} = false)::int`,
				})
				.from(prompts)
				.where(eq(prompts.brandId, brand.id));

			const runStats = brandRunStatsMap.get(brand.id);
			const creator = brandCreators.get(brand.id);

			return {
				...brand,
				creatorName: creator?.name || null,
				creatorEmail: creator?.email || null,
				totalPrompts: promptCounts[0]?.total || 0,
				activePrompts: promptCounts[0]?.active || 0,
				promptRuns7Days: runStats?.runs_7d || 0,
				promptRuns30Days: runStats?.runs_30d || 0,
				lastPromptRunAt: runStats?.last_run_at ? new Date(runStats.last_run_at) : null,
				promptsAddedLast7Days: recentPromptCounts[0]?.added7Days || 0,
				promptsRemovedLast7Days: recentPromptCounts[0]?.removed7Days || 0,
				promptsAddedLast30Days: recentPromptCounts[0]?.added30Days || 0,
				promptsRemovedLast30Days: recentPromptCounts[0]?.removed30Days || 0,
			};
		}),
	);

	return {
		brands: brandStats,
		brandsOverTime,
		activeBrandsOverTime: activeBrandsData.map((row) => ({
			date: row.date,
			count: row.count,
		})),
		promptsOverTime,
		runsOverTime: runsOverTimeData.map((row) => ({
			date: row.date,
			count: row.count,
		})),
	};
});

// ============================================================================
// Admin Dashboard - Delay Override
// ============================================================================

/**
 * Update delay override for a brand.
 */
export const updateDelayOverrideFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			delayOverrideHours: z.number().nullable(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();
		const result = await db
			.update(brands)
			.set({ delayOverrideHours: data.delayOverrideHours, updatedAt: new Date() })
			.where(eq(brands.id, data.brandId))
			.returning();
		if (!result[0]) throw new Error("Brand not found");
		return result[0];
	});

// ============================================================================
// Admin Tools - Analyze Brand
// ============================================================================

/**
 * Provider-agnostic brand analysis. Returns brand info, competitors, and
 * suggested prompts in a single LLM round-trip — same pipeline that the
 * onboarding wizard and `POST /api/v1/tools/analyze` use.
 */
export const adminAnalyzeBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			website: z.string().min(1),
			brandName: z.string().optional(),
			maxCompetitors: z.number().int().min(0).optional(),
			maxPrompts: z.number().int().min(0).optional(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();
		return analyzeBrand({
			website: data.website,
			brandName: data.brandName,
			maxCompetitors: data.maxCompetitors,
			maxPrompts: data.maxPrompts,
		});
	});

// ============================================================================
// Admin Workflows - Data Fetching
// ============================================================================

function parseJobData(data: unknown): { promptId?: string } {
	if (!data) return {};
	try {
		const parsed = typeof data === "string" ? JSON.parse(data) : data;
		if (typeof parsed === "object" && parsed !== null) {
			return {
				promptId:
					typeof (parsed as Record<string, unknown>).promptId === "string"
						? ((parsed as Record<string, unknown>).promptId as string)
						: undefined,
			};
		}
	} catch {
		// ignore parse failures
	}
	return {};
}

async function getQueueStats() {
	return withPgClient(async (client) => {
		const tableCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job')`,
		);

		if (!tableCheck.rows[0]?.exists) {
			return {
				name: "process-prompt",
				created: 0,
				active: 0,
				retry: 0,
				completed: 0,
				failed: 0,
				totalPending: 0,
			};
		}

		const result = await client.query(`
			SELECT
				COUNT(*) FILTER (WHERE state = 'created') AS created,
				COUNT(*) FILTER (WHERE state = 'active') AS active,
				COUNT(*) FILTER (WHERE state = 'retry') AS retry
			FROM pgboss.job
			WHERE name = 'process-prompt'
		`);

		const archiveCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'archive')`,
		);

		let completed = 0;
		let failed = 0;
		if (archiveCheck.rows[0]?.exists) {
			const archiveResult = await client.query(`
				SELECT
					COUNT(*) FILTER (WHERE state = 'completed') AS completed,
					COUNT(*) FILTER (WHERE state = 'failed') AS failed
				FROM pgboss.archive
				WHERE name = 'process-prompt'
			`);
			completed = Number(archiveResult.rows[0]?.completed || 0);
			failed = Number(archiveResult.rows[0]?.failed || 0);
		}

		const stats = {
			created: Number(result.rows[0]?.created || 0),
			active: Number(result.rows[0]?.active || 0),
			retry: Number(result.rows[0]?.retry || 0),
			completed,
			failed,
		};

		return {
			name: "process-prompt",
			...stats,
			totalPending: stats.created + stats.active + stats.retry,
		};
	});
}

async function getRecentJobs(limit = 50) {
	const jobs = await withPgClient(async (client) => {
		const [jobCheck, archiveCheck] = await Promise.all([
			client.query(
				`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job')`,
			),
			client.query(
				`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'archive')`,
			),
		]);

		const rows: any[] = [];

		if (jobCheck.rows[0]?.exists) {
			const result = await client.query(
				`SELECT id, name, data, state, output, retry_count, created_on, started_on, completed_on
				 FROM pgboss.job
				 WHERE name = 'process-prompt'
				   AND state IN ('completed', 'failed')
				 ORDER BY completed_on DESC NULLS LAST
				 LIMIT $1`,
				[limit],
			);
			rows.push(...result.rows);
		}

		if (archiveCheck.rows[0]?.exists) {
			const result = await client.query(
				`SELECT id, name, data, state, output, retry_count, created_on, started_on, completed_on
				 FROM pgboss.archive
				 WHERE name = 'process-prompt'
				 ORDER BY completed_on DESC NULLS LAST
				 LIMIT $1`,
				[limit],
			);
			rows.push(...result.rows);
		}

		return rows;
	});

	const deduped = new Map<string, (typeof jobs)[number]>();
	for (const row of jobs) {
		if (!deduped.has(row.id)) {
			deduped.set(row.id, row);
		}
	}

	const sorted = Array.from(deduped.values()).sort((a, b) => {
		const aTime = a.completed_on ? new Date(a.completed_on).getTime() : 0;
		const bTime = b.completed_on ? new Date(b.completed_on).getTime() : 0;
		return bTime - aTime;
	});

	return sorted.slice(0, limit).map((row) => {
		const data = parseJobData(row.data);
		let failedReason: string | null = null;

		if (row.state === "failed" && row.output) {
			try {
				const output = typeof row.output === "string" ? JSON.parse(row.output) : row.output;
				failedReason = output?.message || output?.error || "Unknown error";
			} catch {
				failedReason = "Unknown error";
			}
		}

		return {
			id: row.id,
			name: row.name,
			data,
			status: row.state === "completed" ? ("completed" as const) : ("failed" as const),
			failedReason,
			attemptsMade: row.retry_count || 0,
			timestamp: row.created_on ? new Date(row.created_on).getTime() : 0,
			processedOn: row.started_on ? new Date(row.started_on).getTime() : null,
			finishedOn: row.completed_on ? new Date(row.completed_on).getTime() : null,
		};
	});
}

function getNextRunFromCron(cron: string, now: Date): number | null {
	const hourlyMatch = cron.match(/^0 \*\/(\d+) \* \* \*$/);
	if (hourlyMatch) {
		const interval = Number(hourlyMatch[1]);
		if (!Number.isFinite(interval) || interval <= 0) return null;

		const nowMs = now.getTime();
		const nowUtc = new Date(nowMs);
		const year = nowUtc.getUTCFullYear();
		const month = nowUtc.getUTCMonth();
		const day = nowUtc.getUTCDate();
		const hour = nowUtc.getUTCHours();
		const minute = nowUtc.getUTCMinutes();
		const second = nowUtc.getUTCSeconds();
		const ms = nowUtc.getUTCMilliseconds();

		let nextHour = hour;
		if (minute > 0 || second > 0 || ms > 0) {
			nextHour += 1;
		}

		for (let i = 0; i <= 48; i += 1) {
			const h = nextHour + i;
			if (h % interval === 0) {
				const dayOffset = Math.floor(h / 24);
				const hourOfDay = h % 24;
				const baseMidnight = Date.UTC(year, month, day, 0, 0, 0, 0);
				const candidateMs = baseMidnight + dayOffset * 24 * 60 * 60 * 1000 + hourOfDay * 60 * 60 * 1000;
				if (candidateMs > nowMs) {
					return candidateMs;
				}
			}
		}

		return null;
	}

	const dailyMatch = cron.match(/^0 0 (?:\*\/(\d+)|\*) \* \*$/);
	if (dailyMatch) {
		const dayInterval = dailyMatch[1] ? Number(dailyMatch[1]) : 1;
		if (!Number.isFinite(dayInterval) || dayInterval <= 0) return null;

		const nowMs = now.getTime();
		const nowUtc = new Date(nowMs);

		for (let i = 0; i <= 31; i += 1) {
			const candidate = new Date(
				Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + i, 0, 0, 0, 0),
			);
			const dayOfMonth = candidate.getUTCDate();
			const matches = dayInterval === 1 || (dayOfMonth - 1) % dayInterval === 0;
			if (matches && candidate.getTime() > nowMs) {
				return candidate.getTime();
			}
		}

		return null;
	}

	return null;
}

async function getScheduleMap() {
	const schedules = await withPgClient(async (client) => {
		const tableCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'schedule')`,
		);

		if (!tableCheck.rows[0]?.exists) return [];

		const result = await client.query(`
			SELECT name, key, data, cron
			FROM pgboss.schedule
			WHERE name = 'process-prompt'
		`);
		return result.rows;
	});

	const map = new Map<string, { promptId: string; cadenceHours: number | null; nextRunAt: number | null }>();
	const now = new Date();

	for (const row of schedules) {
		const promptId = row.key;
		if (promptId) {
			let cadenceHours: number | null = null;
			let nextRunAt: number | null = null;
			if (row.cron) {
				const hourlyMatch = row.cron.match(/^0 \*\/(\d+) \* \* \*$/);
				if (hourlyMatch) {
					cadenceHours = Number(hourlyMatch[1]);
				} else {
					const dailyMatch = row.cron.match(/^0 0 (?:\*\/(\d+)|\*) \* \*$/);
					if (dailyMatch) {
						cadenceHours = dailyMatch[1] ? Number(dailyMatch[1]) * 24 : 24;
					}
				}
				nextRunAt = getNextRunFromCron(row.cron, now);
			}
			map.set(promptId, { promptId, cadenceHours, nextRunAt });
		}
	}

	return map;
}

async function getActiveJobMap() {
	const jobs = await withPgClient(async (client) => {
		const tableCheck = await client.query(
			`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'pgboss' AND table_name = 'job')`,
		);

		if (!tableCheck.rows[0]?.exists) return [];

		const result = await client.query(`
			SELECT id, data, state, created_on, started_on
			FROM pgboss.job
			WHERE name = 'process-prompt'
			  AND state IN ('created', 'active', 'retry')
			ORDER BY
				CASE state
					WHEN 'active' THEN 1
					WHEN 'retry' THEN 2
					WHEN 'created' THEN 3
					ELSE 4
				END,
				started_on DESC NULLS LAST,
				created_on DESC NULLS LAST
		`);
		return result.rows;
	});

	const map = new Map<string, { promptId: string; state: "created" | "active" | "retry" }>();

	for (const row of jobs) {
		const data = parseJobData(row.data);
		if (data.promptId) {
			if (!map.has(data.promptId)) {
				map.set(data.promptId, {
					promptId: data.promptId,
					state: row.state as "created" | "active" | "retry",
				});
			}
		}
	}

	return map;
}

/**
 * Get full workflow data: queue stats, recent jobs, brand schedule summaries.
 */
export const getWorkflowDataFn = createServerFn({ method: "GET" }).handler(async () => {
	await requireAdmin();

	const allBrands = await db.query.brands.findMany({ orderBy: desc(brands.createdAt) });
	const allPrompts = await db.query.prompts.findMany();

	const promptsByBrand: Record<string, typeof allPrompts> = {};
	for (const prompt of allPrompts) {
		if (!promptsByBrand[prompt.brandId]) {
			promptsByBrand[prompt.brandId] = [];
		}
		promptsByBrand[prompt.brandId].push(prompt);
	}

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

	const [recentJobs, scheduleMap, activeJobMap, queueStats] = await Promise.all([
		getRecentJobs(5000),
		getScheduleMap(),
		getActiveJobMap(),
		getQueueStats(),
	]);

	const failuresByPrompt = new Map<string, number>();
	for (const job of recentJobs) {
		if (job.status === "failed" && job.data?.promptId) {
			failuresByPrompt.set(job.data.promptId, (failuresByPrompt.get(job.data.promptId) || 0) + 1);
		}
	}

	const now = Date.now();
	const defaultDelayHours = getDefaultDelayHours();
	const defaultSchedulerInfo = { exists: false, nextRunAt: null as number | null, cadenceHours: null as number | null };

	const brandSummaries = allBrands.map((brand) => {
		const brandPrompts = promptsByBrand[brand.id] || [];
		const delayHours = brand.delayOverrideHours ?? defaultDelayHours;
		const runFrequencyMs = delayHours * 60 * 60 * 1000;

		let overduePrompts = 0;
		let onSchedulePrompts = 0;
		let scheduledCount = 0;

		const modelList = parseScrapeTargets(process.env.SCRAPE_TARGETS).map((t) => t.model);
		const promptStatuses = brandPrompts.map((prompt) => {
			const lastRuns = lastRunsMap[prompt.id] || {};
			const lastRunsByModel: Record<
				string,
				{ lastRunAt: Date | null; isOverdue: boolean; overdueByMs: number | null }
			> = {};

			let anyOverdue = false;

			for (const model of modelList) {
				const lastRunAt = lastRuns[model] || null;
				let isOverdue = false;
				let overdueByMs: number | null = null;

				if (prompt.enabled) {
					if (lastRunAt) {
						const timeSinceRun = now - new Date(lastRunAt).getTime();
						if (timeSinceRun > runFrequencyMs) {
							isOverdue = true;
							overdueByMs = timeSinceRun - runFrequencyMs;
							anyOverdue = true;
						}
					} else {
						isOverdue = true;
						anyOverdue = true;
					}
				}

				lastRunsByModel[model] = { lastRunAt, isOverdue, overdueByMs };
			}

			const scheduleInfo = scheduleMap.get(prompt.id);
			const schedulerInfo = scheduleInfo
				? { exists: true, nextRunAt: scheduleInfo.nextRunAt, cadenceHours: scheduleInfo.cadenceHours }
				: defaultSchedulerInfo;

			const activeJob = activeJobMap.get(prompt.id);
			if (prompt.enabled && activeJob) scheduledCount++;

			if (prompt.enabled) {
				if (anyOverdue) {
					overduePrompts++;
				} else {
					onSchedulePrompts++;
				}
			}

			const jobStatus: "active" | "created" | "retry" | "none" = activeJob?.state ?? "none";

			return {
				promptId: prompt.id,
				promptValue: prompt.value,
				brandId: brand.id,
				brandName: brand.name,
				enabled: prompt.enabled,
				runFrequencyMs,
				lastRunsByModel,
				schedulerInfo,
				recentFailures: failuresByPrompt.get(prompt.id) || 0,
				jobStatus,
			};
		});

		const enabledPrompts = brandPrompts.filter((p) => p.enabled).length;

		return {
			brandId: brand.id,
			brandName: brand.name,
			website: brand.website,
			enabled: brand.enabled,
			totalPrompts: brandPrompts.length,
			enabledPrompts,
			runFrequencyMs,
			overduePrompts,
			onSchedulePrompts,
			schedulerCoverage: { scheduled: scheduledCount, total: enabledPrompts },
			prompts: promptStatuses,
		};
	});

	const totalOverdue = brandSummaries.reduce((sum, b) => sum + b.overduePrompts, 0);
	const totalOnSchedule = brandSummaries.reduce((sum, b) => sum + b.onSchedulePrompts, 0);
	const totalEnabled = brandSummaries.reduce((sum, b) => sum + b.enabledPrompts, 0);
	const totalPrompts = brandSummaries.reduce((sum, b) => sum + b.totalPrompts, 0);

	return {
		summary: {
			totalBrands: allBrands.length,
			totalPrompts,
			totalEnabled,
			totalOverdue,
			totalOnSchedule,
			percentOnSchedule: totalEnabled > 0 ? Math.round((totalOnSchedule / totalEnabled) * 100) : 100,
		},
		queue: queueStats,
		recentJobs: recentJobs.sort((a, b) => b.timestamp - a.timestamp),
		brands: brandSummaries,
	};
});

// ============================================================================
// Admin Workflows - Retry Job
// ============================================================================

/**
 * Retry a prompt job (send immediate job for a prompt).
 */
export const retryJobFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			promptId: z.string().optional(),
			jobId: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		await requireAdmin();

		const targetPromptId = data.promptId;
		if (!targetPromptId) {
			throw new Error("promptId is required");
		}

		const prompt = await db.query.prompts.findFirst({
			where: eq(prompts.id, targetPromptId),
		});

		if (!prompt) throw new Error("Prompt not found");
		if (!prompt.enabled) throw new Error("Prompt is disabled");

		const success = await sendImmediatePromptJob(targetPromptId);
		if (!success) throw new Error("Failed to send job");

		return { success: true, message: `Triggered immediate job for prompt ${targetPromptId}` };
	});

// ============================================================================
// Admin Workflows - Job Logs
// ============================================================================

/**
 * Get logs for a specific job.
 */
export const getJobLogsFn = createServerFn({ method: "GET" })
	.validator(z.object({ jobId: z.string() }))
	.handler(async ({ data }) => {
		await requireAdmin();

		const job = await withPgClient(async (client) => {
			const schemaCheck = await client.query(
				`SELECT EXISTS (SELECT 1 FROM information_schema.schemata WHERE schema_name = 'pgboss')`,
			);

			if (!schemaCheck.rows[0]?.exists) return null;

			let result = await client.query(
				`SELECT id, name, data, state, output, retry_count, created_on, started_on, completed_on
				 FROM pgboss.job
				 WHERE id = $1`,
				[data.jobId],
			);

			if (result.rows.length === 0) {
				result = await client.query(
					`SELECT id, name, data, state, output, retry_count, created_on, started_on, completed_on
					 FROM pgboss.archive
					 WHERE id = $1`,
					[data.jobId],
				);
			}

			return result.rows[0] || null;
		});

		if (!job) throw new Error("Job not found");

		const logs: string[] = [];
		logs.push(`Job ID: ${job.id}`);
		logs.push(`Name: ${job.name}`);
		logs.push(`State: ${job.state}`);
		logs.push(`Retry count: ${job.retry_count || 0}`);

		if (job.created_on) logs.push(`Created: ${new Date(job.created_on).toISOString()}`);
		if (job.started_on) logs.push(`Started: ${new Date(job.started_on).toISOString()}`);
		if (job.completed_on) logs.push(`Completed: ${new Date(job.completed_on).toISOString()}`);

		if (job.data) {
			try {
				const d = typeof job.data === "string" ? JSON.parse(job.data) : job.data;
				logs.push(`Data: ${JSON.stringify(d, null, 2)}`);
			} catch {
				logs.push(`Data: ${String(job.data)}`);
			}
		}

		if (job.output) {
			try {
				const output = typeof job.output === "string" ? JSON.parse(job.output) : job.output;
				logs.push(job.state === "failed" ? `Error: ${JSON.stringify(output, null, 2)}` : `Output: ${JSON.stringify(output, null, 2)}`);
			} catch {
				logs.push(`Output: ${String(job.output)}`);
			}
		}

		return { jobId: data.jobId, logs, count: logs.length };
	});
