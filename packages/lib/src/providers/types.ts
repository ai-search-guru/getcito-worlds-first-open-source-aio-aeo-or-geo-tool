import type { ModelConfig } from "@workspace/config/scrape-targets";
import type { z } from "zod";
import type { Citation } from "../text-extraction";

// Canonical definition lives next to the SCRAPE_TARGETS parser in
// @workspace/config; re-exported here so provider code keeps importing it
// from "./types".
export type { ModelConfig };

export interface ScrapeResult {
	textContent: string;
	rawOutput: unknown;
	webQueries: string[];
	citations: Citation[];
	modelVersion?: string;
}

export interface ProviderOptions {
	webSearch?: boolean;
	version?: string;
	targetMarket?: string;
	targetLanguage?: string;
}

export interface StructuredResearchOptions<T> {
	prompt: string;
	schema: z.ZodType<T>;
	/**
	 * Whether the model may use its web-search tool. Defaults to true (the
	 * onboarding research path). Set false for a single completion over context
	 * supplied entirely in the prompt — no tools, no agent loop.
	 */
	webSearch?: boolean;
}

export interface StructuredResearchResult<T> {
	object: T;
	/** Resolved model id (after any `:online` suffixing etc.). */
	modelVersion?: string;
}

export interface Provider {
	id: string;
	name: string;
	isConfigured(): boolean;
	run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult>;
	/** Validate a target config. Returns an error message if invalid, null if valid.
	 *  Omit for providers that accept any model (runtime validation only). */
	validateTarget?(config: ModelConfig): string | null;

	/**
	 * Run a single research call that returns a Zod-validated structured value.
	 * Each direct API provider implements this using the most idiomatic combo.
	 * Scraper providers don't implement this, and at least one direct api
	 * provider is required.
	 */
	runStructuredResearch?<T>(options: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>>;
}

export interface TestResult {
	success: boolean;
	latencyMs: number;
	error?: string;
	sampleOutput?: string;
}
