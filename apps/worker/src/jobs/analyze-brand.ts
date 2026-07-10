import type { Job } from "pg-boss";
import { analyzeBrand, type OnboardingSuggestion } from "@workspace/lib/onboarding";

export interface AnalyzeBrandData {
	/** Brand id (== org id) the analysis belongs to; the web app reads results back by brand. */
	brandId: string;
	website: string;
	brandName?: string;
	maxCompetitors?: number;
	maxPrompts?: number;
}

/**
 * Run brand analysis as a background job.
 *
 * The onboarding wizard used to call analyzeBrand() synchronously inside the
 * HTTP request. That call is an LLM + web-search round trip that routinely
 * takes ~1 minute, so it gets killed by reverse-proxy read timeouts (the user
 * sees a 504 even though the work finishes). Running it here lets the request
 * return immediately; the web app polls the job's `output` via getJobById.
 *
 * The queue is registered with batchSize: 1, so `jobs` always holds exactly
 * one job and the returned suggestion becomes that job's output.
 */
export async function analyzeBrandJob(jobs: Job<AnalyzeBrandData>[]): Promise<OnboardingSuggestion> {
	const [job] = jobs;
	if (!job) {
		throw new Error("analyze-brand handler received an empty batch");
	}

	const { website, brandName, maxCompetitors, maxPrompts } = job.data;
	return analyzeBrand({ website, brandName, maxCompetitors, maxPrompts });
}
