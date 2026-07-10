import { db } from "@workspace/lib/db/db";
import { prompts, brands } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { getDefaultDelayHours } from "@workspace/lib/constants";
import { getBoss } from "@/lib/boss-client";

/**
 * Convert cadence hours to milliseconds.
 */
export function hoursToMs(hours: number): number {
	return hours * 60 * 60 * 1000;
}

/**
 * Gets the cadence (delay between runs) for a prompt based on its brand's delay override or the default
 */
export async function getPromptCadenceHours(promptId: string): Promise<number> {
	const defaultDelayHours = getDefaultDelayHours();
	try {
		// Get the prompt to find its brand
		const prompt = await db.query.prompts.findFirst({
			where: eq(prompts.id, promptId),
		});

		if (!prompt) {
			console.warn(`Prompt ${promptId} not found, using default cadence`);
			return defaultDelayHours;
		}

		// Get the brand to check for delay override
		const brand = await db.query.brands.findFirst({
			where: eq(brands.id, prompt.brandId),
		});

		if (!brand) {
			console.warn(`Brand ${prompt.brandId} not found, using default cadence`);
			return defaultDelayHours;
		}

		// Use override if set, otherwise use default
		if (brand.delayOverrideHours !== null) {
			console.log(`Using custom cadence for brand ${brand.name}: ${brand.delayOverrideHours}h`);
			return brand.delayOverrideHours;
		}

		return defaultDelayHours;
	} catch (error) {
		console.error(`Error fetching cadence for prompt ${promptId}:`, error);
		return defaultDelayHours;
	}
}

/**
 * Creates a scheduled job for a prompt to run after a delay.
 * Uses interval-based scheduling with startAfter instead of cron patterns.
 * The job will self-reschedule after completion via the worker.
 */
type SchedulerOptions = {
	sendImmediate?: boolean;
};

export async function createPromptJobScheduler(
	promptId: string,
	options: SchedulerOptions = {},
): Promise<boolean> {
	try {
		const boss = await getBoss();
		const cadenceHours = await getPromptCadenceHours(promptId);
		const sendImmediate = options.sendImmediate ?? true;

		// Remove any old cron-based schedule (migration cleanup)
		try {
			await boss.unschedule("process-prompt", promptId);
		} catch {
			// Ignore errors - schedule may not exist
		}

		if (sendImmediate) {
			// Send an immediate job
			await boss.send(
				"process-prompt",
				{ promptId, cadenceHours },
				{
					singletonKey: `prompt-${promptId}`,
					singletonSeconds: 60 * 60, // 1 hour - prevent duplicate jobs
					retryLimit: 3,
					retryDelay: 60,
					retryBackoff: true,
					expireInSeconds: 60 * 15, // 15 minute timeout
				},
			);
		} else {
			// Schedule the next run based on cadence
			const startAfterSeconds = cadenceHours * 60 * 60;
			await boss.send(
				"process-prompt",
				{ promptId, cadenceHours },
				{
					singletonKey: `prompt-${promptId}`,
					singletonSeconds: startAfterSeconds, // Prevent duplicates for the cadence period
					startAfter: startAfterSeconds,
					retryLimit: 3,
					retryDelay: 60,
					retryBackoff: true,
					expireInSeconds: 60 * 15,
				},
			);
		}

		console.log(`Created job for prompt ${promptId} with ${cadenceHours}h cadence`);
		return true;
	} catch (error) {
		console.error(`Failed to create job for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Removes any scheduled jobs for a prompt.
 */
export async function removePromptJobScheduler(promptId: string): Promise<boolean> {
	try {
		const boss = await getBoss();

		// Remove old cron-based schedule if exists
		try {
			await boss.unschedule("process-prompt", promptId);
		} catch {
			// Ignore - may not exist
		}

		// Cancel any pending jobs for this prompt
		// Note: pg-boss doesn't have a direct way to cancel by data, 
		// but the singletonKey prevents duplicates
		console.log(`Removed schedule for prompt ${promptId}`);
		return true;
	} catch (error) {
		console.error(`Failed to remove job scheduler for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Creates schedules for multiple prompts.
 * Returns an array of results indicating success/failure for each prompt.
 */
export async function createMultiplePromptJobSchedulers(
	promptIds: string[],
	options: SchedulerOptions = {},
): Promise<boolean[]> {
	const results = await Promise.allSettled(
		promptIds.map((promptId) => createPromptJobScheduler(promptId, options)),
	);

	return results.map((result) => (result.status === "fulfilled" ? result.value : false));
}

/**
 * Removes schedules for multiple prompts.
 * Returns an array of results indicating success/failure for each prompt.
 */
export async function removeMultiplePromptJobSchedulers(promptIds: string[]): Promise<boolean[]> {
	const results = await Promise.allSettled(promptIds.map((promptId) => removePromptJobScheduler(promptId)));

	return results.map((result) => (result.status === "fulfilled" ? result.value : false));
}

/**
 * Recreates a schedule for a prompt (removes and creates).
 * Useful when cadence has changed or job needs to be reset.
 */
export async function recreatePromptJobScheduler(
	promptId: string,
	options: SchedulerOptions = {},
): Promise<boolean> {
	try {
		// Remove existing schedule if any (ignore errors if it doesn't exist)
		await removePromptJobScheduler(promptId);
		// Create new schedule
		return await createPromptJobScheduler(promptId, options);
	} catch (error) {
		console.error(`Failed to recreate job scheduler for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Sends an immediate job to process a prompt (outside of the schedule).
 * Useful for manual retries from the admin UI.
 */
export async function sendImmediatePromptJob(promptId: string): Promise<boolean> {
	try {
		const boss = await getBoss();
		const cadenceHours = await getPromptCadenceHours(promptId);

		await boss.send(
			"process-prompt",
			{ promptId, cadenceHours },
			{
				retryLimit: 3,
				retryDelay: 60,
				retryBackoff: true,
				expireInSeconds: 60 * 15,
			},
		);

		console.log(`Sent immediate job for prompt ${promptId}`);
		return true;
	} catch (error) {
		console.error(`Failed to send immediate job for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Schedules the next run for a prompt after a delay.
 * Called by the worker after successful job completion.
 */
export async function scheduleNextPromptRun(promptId: string, cadenceHours: number): Promise<boolean> {
	try {
		const boss = await getBoss();
		const startAfterSeconds = cadenceHours * 60 * 60;

		await boss.send(
			"process-prompt",
			{ promptId, cadenceHours },
			{
				singletonKey: `prompt-${promptId}`,
				singletonSeconds: startAfterSeconds, // Prevent duplicates for the cadence period
				startAfter: startAfterSeconds,
				retryLimit: 3,
				retryDelay: 60,
				retryBackoff: true,
				expireInSeconds: 60 * 15,
			},
		);

		console.log(`Scheduled next run for prompt ${promptId} in ${cadenceHours}h`);
		return true;
	} catch (error) {
		console.error(`Failed to schedule next run for prompt ${promptId}:`, error);
		return false;
	}
}

/**
 * Sends a report generation job.
 */
export async function sendReportJob(
	reportId: string,
	brandName: string,
	brandWebsite: string,
	manualPrompts?: string[],
): Promise<boolean> {
	try {
		const boss = await getBoss();

		await boss.send(
			"generate-report",
			{ reportId, brandName, brandWebsite, manualPrompts },
			{
				retryLimit: 3,
				retryDelay: 60,
				retryBackoff: true,
				expireInSeconds: 60 * 60, // 1 hour timeout for reports
			},
		);

		console.log(`Sent report job for report ${reportId}`);
		return true;
	} catch (error) {
		console.error(`Failed to send report job for report ${reportId}:`, error);
		return false;
	}
}
