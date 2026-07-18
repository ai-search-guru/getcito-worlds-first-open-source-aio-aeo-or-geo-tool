import type { Job } from "pg-boss";
import { db } from "@workspace/lib/db/db";
import { brands, citations, competitors, promptRuns, prompts, type Brand, type Competitor } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { RUNS_PER_PROMPT, getDefaultDelayHours } from "@workspace/lib/constants";
import {
	getProvider,
	parseScrapeTargets,
	selectTargetsForBrand,
	type ModelConfig,
	type Provider,
} from "@workspace/lib/providers";
import type { Citation } from "@workspace/lib/text-extraction";
import boss from "../boss";
import { trackWorkerEvent } from "../telemetry";

export interface ProcessPromptData {
	promptId: string;
	cadenceHours?: number; // Hours until next run (for self-rescheduling)
}

interface PromptContext {
	prompt: typeof prompts.$inferSelect;
	brand: Brand;
	competitors: Competitor[];
}

/**
 * Schedule the next run for a prompt after the specified cadence.
 */
async function scheduleNextRun(promptId: string, cadenceHours: number): Promise<void> {
	const startAfterSeconds = cadenceHours * 60 * 60;

	try {
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
	} catch (error) {
		console.error(`Failed to schedule next run for prompt ${promptId}:`, error);
		// Don't throw - we don't want to fail the job just because rescheduling failed
	}
}

/**
 * Get the cadence hours for a prompt based on its brand's delay override.
 */
async function getCadenceHours(promptId: string): Promise<number> {
	const defaultDelayHours = getDefaultDelayHours();
	const prompt = await db.query.prompts.findFirst({
		where: eq(prompts.id, promptId),
	});

	if (!prompt) return defaultDelayHours;

	const brand = await db.query.brands.findFirst({
		where: eq(brands.id, prompt.brandId),
	});

	if (!brand) return defaultDelayHours;

	return brand.delayOverrideHours ?? defaultDelayHours;
}

async function getPromptContext(promptId: string): Promise<PromptContext | null> {
	const prompt = await db.query.prompts.findFirst({
		where: eq(prompts.id, promptId),
	});

	if (!prompt) {
		console.error(`Prompt not found: ${promptId}`);
		return null;
	}

	const brand = await db.query.brands.findFirst({
		where: eq(brands.id, prompt.brandId),
	});

	if (!brand) {
		console.error(`Brand not found: ${prompt.brandId}`);
		return null;
	}

	const brandCompetitors = await db.query.competitors.findMany({
		where: eq(competitors.brandId, prompt.brandId),
	});

	return {
		prompt,
		brand,
		competitors: brandCompetitors,
	};
}

function extractDomainFromUrl(urlOrDomain: string): string {
	try {
		const url = new URL(urlOrDomain.startsWith("http") ? urlOrDomain : `https://${urlOrDomain}`);
		return url.hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return urlOrDomain.replace(/^www\./, "").toLowerCase();
	}
}

function analyzeMentions(
	content: string,
	brand: Brand,
	competitorsList: Competitor[],
): {
	brandMentioned: boolean;
	competitorsMentioned: string[];
} {
	const contentLower = content.toLowerCase();

	const brandNames = [brand.name, ...(brand.aliases || [])].map((n) => n.toLowerCase());
	const brandDomains = [
		extractDomainFromUrl(brand.website),
		...(brand.additionalDomains || []).map(extractDomainFromUrl),
	];
	const brandMentioned =
		brandNames.some((n) => contentLower.includes(n)) ||
		brandDomains.some((d) => contentLower.includes(d));

	const competitorsMentioned = competitorsList
		.filter((competitor) => {
			const names = [competitor.name, ...(competitor.aliases || [])].map((n) => n.toLowerCase());
			const nameMatch = names.some((n) => contentLower.includes(n));
			const domainMatch = (competitor.domains || []).some((d) =>
				contentLower.includes(extractDomainFromUrl(d)),
			);
			return nameMatch || domainMatch;
		})
		.map((competitor) => competitor.name);

	return { brandMentioned, competitorsMentioned };
}

async function savePromptRun(
	promptId: string,
	brandId: string,
	model: string,
	provider: string | null,
	version: string,
	webSearchEnabled: boolean,
	rawOutput: unknown,
	webQueries: string[],
	brandMentioned: boolean,
	competitorsMentioned: string[],
): Promise<{ id: string; createdAt: Date }> {
	const [result] = await db
		.insert(promptRuns)
		.values({
			promptId,
			brandId,
			model,
			provider,
			version,
			webSearchEnabled,
			rawOutput,
			webQueries,
			brandMentioned,
			competitorsMentioned,
		})
		.returning({ id: promptRuns.id, createdAt: promptRuns.createdAt });

	return result;
}

async function saveCitations(
	promptRunId: string,
	promptId: string,
	brandId: string,
	model: string,
	extracted: Citation[],
	createdAt: Date,
): Promise<void> {
	if (extracted.length === 0) return;

	await db.insert(citations).values(
		extracted.map((c) => ({
			promptRunId,
			promptId,
			brandId,
			model,
			url: c.url,
			domain: c.domain,
			title: c.title || null,
			citationIndex: c.citationIndex,
			createdAt,
		})),
	);
}


async function runModelIteration({
	promptId,
	promptValue,
	brand,
	competitorsList,
	config,
	providerImpl,
	runIndex,
}: {
	promptId: string;
	promptValue: string;
	brand: Brand;
	competitorsList: Competitor[];
	config: ModelConfig;
	providerImpl: Provider;
	runIndex: number;
}): Promise<void> {
	const logPrefix = `[${config.model}_${runIndex}]`;

	const result = await providerImpl.run(config.model, promptValue, {
		webSearch: config.webSearch,
		version: config.version,
		targetMarket: brand.targetMarket ?? undefined,
		targetLanguage: brand.targetLanguage ?? undefined,
	});

	// `webQueries` is stored exactly as the provider reported it — engines do
	// sometimes genuinely search the prompt verbatim, and that's real data. The
	// fan-out page excludes verbatim repeats at read time as a display rule;
	// providers whose query field is fabricated (DataForSEO) write the
	// `unavailable` sentinel in their own extractor instead.
	const { rawOutput, textContent, webQueries, citations: extractedCitations, modelVersion } = result;
	console.log(`${logPrefix} AI call completed, textContent length: ${textContent?.length ?? "null"}`);

	const safeTextContent = typeof textContent === "string" ? textContent : "";

	const { brandMentioned, competitorsMentioned } = analyzeMentions(safeTextContent, brand, competitorsList);

	const recordedVersion = modelVersion ?? config.version ?? config.provider;

	const { id: promptRunId, createdAt } = await savePromptRun(
		promptId,
		brand.id,
		config.model,
		config.provider,
		recordedVersion,
		config.webSearch,
		rawOutput,
		webQueries,
		brandMentioned,
		competitorsMentioned,
	);
	console.log(`${logPrefix} Saved prompt run ${promptRunId}`);

	await saveCitations(promptRunId, promptId, brand.id, config.model, extractedCitations, createdAt);
}

/**
 * Process a prompt - runs AI models and saves results.
 * This is a pg-boss job handler, called when a scheduled job fires.
 * After successful completion, schedules the next run.
 */
export async function processPromptJob(jobs: Job<ProcessPromptData>[]): Promise<void> {
	const scrapeConfigs = parseScrapeTargets(process.env.SCRAPE_TARGETS);

	// pg-boss v12 passes an array of jobs - process each one
	for (const job of jobs) {
		const { promptId, cadenceHours: providedCadence } = job.data;
		console.log(`Processing prompt ${promptId}`);

		// Get cadence hours - use provided value or look it up
		const cadenceHours = providedCadence ?? (await getCadenceHours(promptId));

		// Get prompt context
		const context = await getPromptContext(promptId);
		if (!context) {
			console.log(`Prompt ${promptId} not found, skipping (no reschedule)`);
			continue; // Job completes successfully - prompt was deleted, don't reschedule
		}

		const { prompt, brand, competitors: competitorsList } = context;

		// Check if prompt and brand are enabled
		if (!prompt.enabled || !brand.enabled) {
			console.log(`Prompt ${promptId} or brand ${brand.id} is disabled, skipping but rescheduling`);
			// Still reschedule - the prompt might be enabled later
			await scheduleNextRun(promptId, cadenceHours);
			continue;
		}

		const selectedConfigs = selectTargetsForBrand(scrapeConfigs, brand.enabledModels);
		if (selectedConfigs.length === 0) {
			console.log(`Prompt ${promptId} for brand ${brand.id} has no targets (brand.enabledModels=[])`);
		}

		console.log(`Processing prompt "${prompt.value}" for brand "${brand.name}"`);

		// Run all model iterations in parallel
		const runPromises: Promise<void>[] = [];

		for (const config of selectedConfigs) {
			const providerImpl = getProvider(config.provider);
			for (let i = 0; i < RUNS_PER_PROMPT; i++) {
				runPromises.push(
					runModelIteration({
						promptId,
						promptValue: prompt.value,
						brand,
						competitorsList,
						config,
						providerImpl,
						runIndex: i + 1,
					}),
				);
			}
		}

		const results = await Promise.allSettled(runPromises);
		const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

		if (failures.length > 0) {
			const errorMessages = failures
				.map((f, i) => `Run ${i + 1}: ${f.reason instanceof Error ? f.reason.message : String(f.reason)}`)
				.join("; ");

			// Log failures but don't throw if some succeeded
			console.error(`Prompt ${promptId} had ${failures.length}/${runPromises.length} failed runs: ${errorMessages}`);

			// If ALL runs failed, throw to trigger retry
			if (failures.length === runPromises.length) {
				throw new Error(`All runs failed for prompt ${promptId}: ${errorMessages}`);
			}
		}

		const successCount = runPromises.length - failures.length;
		console.log(`Completed prompt ${promptId}: ${successCount}/${runPromises.length} successful runs`);

		trackWorkerEvent("prompt_processed", {
			brand_id: brand.id,
			models: [...new Set(selectedConfigs.map((c) => c.model))],
			providers: [...new Set(selectedConfigs.map((c) => c.provider))],
			total_runs: runPromises.length,
			successful_runs: successCount,
			failed_runs: failures.length,
		});

		// Schedule the next run
		await scheduleNextRun(promptId, cadenceHours);
	}
}
