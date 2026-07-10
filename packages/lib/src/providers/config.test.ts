import { describe, expect, it } from "vitest";
import { parseScrapeTargets, validateScrapeTargets } from "./config";
import { brightdata } from "./registry/brightdata";
import { oxylabs } from "./registry/oxylabs";
import { dataforseo } from "./registry/dataforseo";
import { olostep } from "./registry/olostep";
import type { ModelConfig } from "./types";

describe("parseScrapeTargets", () => {
	describe("basic parsing", () => {
		it("parses model:provider", () => {
			const result = parseScrapeTargets("chatgpt:olostep");
			expect(result).toEqual([{ model: "chatgpt", provider: "olostep", version: undefined, webSearch: false }]);
		});

		it("parses model:provider:online", () => {
			const result = parseScrapeTargets("chatgpt:olostep:online");
			expect(result).toEqual([{ model: "chatgpt", provider: "olostep", version: undefined, webSearch: true }]);
		});

		it("parses model:provider:version", () => {
			const result = parseScrapeTargets("chatgpt:openai-api:gpt-5-mini");
			expect(result).toEqual([{ model: "chatgpt", provider: "openai-api", version: "gpt-5-mini", webSearch: false }]);
		});

		it("parses model:provider:version:online", () => {
			const result = parseScrapeTargets("chatgpt:openai-api:gpt-5-mini:online");
			expect(result).toEqual([{ model: "chatgpt", provider: "openai-api", version: "gpt-5-mini", webSearch: true }]);
		});
	});

	it("parses multiple entries with mixed providers", () => {
		const result = parseScrapeTargets(
			"chatgpt:olostep:online,claude:openrouter:anthropic/claude-sonnet-4,google-ai-mode:dataforseo:online",
		);
		expect(result).toHaveLength(3);
		expect(result[0]).toEqual({ model: "chatgpt", provider: "olostep", version: undefined, webSearch: true });
		expect(result[1]).toEqual({
			model: "claude",
			provider: "openrouter",
			version: "anthropic/claude-sonnet-4",
			webSearch: false,
		});
		expect(result[2]).toEqual({ model: "google-ai-mode", provider: "dataforseo", version: undefined, webSearch: true });
	});

	it("handles OpenRouter version slugs with colons", () => {
		const result = parseScrapeTargets("chatgpt:openrouter:openai/gpt-5-mini:free:online");
		expect(result).toEqual([
			{ model: "chatgpt", provider: "openrouter", version: "openai/gpt-5-mini:free", webSearch: true },
		]);
	});

	describe("whitespace handling", () => {
		it("trims whitespace around entries", () => {
			const result = parseScrapeTargets(" chatgpt:olostep:online , google-ai-mode:olostep:online ");
			expect(result).toHaveLength(2);
			expect(result[0].model).toBe("chatgpt");
			expect(result[1].model).toBe("google-ai-mode");
		});
	});

	describe("error cases", () => {
		it("throws on empty string entries (trailing comma)", () => {
			expect(() => parseScrapeTargets("chatgpt:olostep,")).toThrow("empty entry");
		});

		it("throws on single-segment entries", () => {
			expect(() => parseScrapeTargets("chatgpt")).toThrow("need at least model:provider");
		});
	});

	describe("missing SCRAPE_TARGETS", () => {
		it("throws when SCRAPE_TARGETS is undefined", () => {
			expect(() => parseScrapeTargets(undefined)).toThrow("SCRAPE_TARGETS environment variable is required");
		});

		it("throws when SCRAPE_TARGETS is empty string", () => {
			expect(() => parseScrapeTargets("")).toThrow("SCRAPE_TARGETS environment variable is required");
		});
	});
});

describe("validateScrapeTargets", () => {
	const configuredProvider = { isConfigured: () => true };
	const unconfiguredProvider = { isConfigured: () => false };

	function makeGetProvider(providers: Record<string, { isConfigured(): boolean }>) {
		return (id: string) => providers[id];
	}

	it("passes when all providers are configured", () => {
		const configs = [
			{ model: "chatgpt", provider: "olostep", webSearch: true },
			{ model: "google-ai-mode", provider: "olostep", webSearch: true },
		];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ olostep: configuredProvider }))).not.toThrow();
	});

	it("throws on unknown provider", () => {
		const configs = [{ model: "chatgpt", provider: "nonexistent", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({}))).toThrow('unknown provider "nonexistent"');
	});

	it("throws when provider is not configured", () => {
		const configs = [{ model: "chatgpt", provider: "olostep", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ olostep: unconfiguredProvider }))).toThrow(
			"requires API key",
		);
	});

	it("throws when openai-api provider has no version", () => {
		const configs = [{ model: "chatgpt", provider: "openai-api", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "openai-api": configuredProvider }))).toThrow(
			"requires a version slug",
		);
	});

	it("throws when anthropic-api provider has no version", () => {
		const configs = [{ model: "claude", provider: "anthropic-api", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "anthropic-api": configuredProvider }))).toThrow(
			"requires a version slug",
		);
	});

	it("throws when openrouter provider has no version", () => {
		const configs = [{ model: "chatgpt", provider: "openrouter", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ openrouter: configuredProvider }))).toThrow(
			"requires a version slug",
		);
	});

	it("throws when mistral-api provider has no version", () => {
		const configs = [{ model: "mistral", provider: "mistral-api", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "mistral-api": configuredProvider }))).toThrow(
			"requires a version slug",
		);
	});

	it("passes when mistral-api provider has a version", () => {
		const configs = [{ model: "mistral", provider: "mistral-api", version: "mistral-medium-latest", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "mistral-api": configuredProvider }))).not.toThrow();
	});

	it("passes when openai-api provider has a version", () => {
		const configs = [{ model: "chatgpt", provider: "openai-api", version: "gpt-5-mini", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ "openai-api": configuredProvider }))).not.toThrow();
	});

	it("passes when anthropic-api provider has a version", () => {
		const configs = [{ model: "claude", provider: "anthropic-api", version: "claude-sonnet-4", webSearch: true }];
		expect(() =>
			validateScrapeTargets(configs, makeGetProvider({ "anthropic-api": configuredProvider })),
		).not.toThrow();
	});

	it("passes when openrouter provider has a version", () => {
		const configs = [{ model: "chatgpt", provider: "openrouter", version: "openai/gpt-5-mini", webSearch: true }];
		expect(() => validateScrapeTargets(configs, makeGetProvider({ openrouter: configuredProvider }))).not.toThrow();
	});

	it("does not require version for scraping providers", () => {
		const configs = [
			{ model: "chatgpt", provider: "olostep", webSearch: true },
			{ model: "chatgpt", provider: "brightdata", webSearch: true },
			{ model: "chatgpt", provider: "oxylabs", webSearch: true },
			{ model: "google-ai-mode", provider: "dataforseo", webSearch: true },
		];
		expect(() =>
			validateScrapeTargets(
				configs,
				makeGetProvider({
					olostep: configuredProvider,
					brightdata: configuredProvider,
					oxylabs: configuredProvider,
					dataforseo: configuredProvider,
				}),
			),
		).not.toThrow();
	});
});

describe("provider validateTarget", () => {
	function config(model: string, provider: string, webSearch: boolean, version?: string): ModelConfig {
		return { model, provider, version, webSearch };
	}

	describe("olostep", () => {
		it("accepts valid online targets", () => {
			for (const model of [
				"chatgpt",
				"google-ai-mode",
				"google-ai-overview",
				"gemini",
				"copilot",
				"perplexity",
				"grok",
			]) {
				expect(olostep.validateTarget!(config(model, "olostep", true))).toBeNull();
			}
		});

		it("rejects targets without :online", () => {
			expect(olostep.validateTarget!(config("chatgpt", "olostep", false))).toMatch(/requires :online/);
		});

		it("rejects unknown models", () => {
			expect(olostep.validateTarget!(config("unknown", "olostep", true))).toMatch(/does not support/);
		});
	});

	describe("brightdata", () => {
		it("accepts chatgpt with and without :online", () => {
			expect(brightdata.validateTarget!(config("chatgpt", "brightdata", true))).toBeNull();
			expect(brightdata.validateTarget!(config("chatgpt", "brightdata", false))).toBeNull();
		});

		it("accepts other models with :online", () => {
			for (const model of ["perplexity", "copilot", "gemini", "grok", "google-ai-mode"]) {
				expect(brightdata.validateTarget!(config(model, "brightdata", true))).toBeNull();
			}
		});

		it("rejects non-chatgpt models without :online", () => {
			expect(brightdata.validateTarget!(config("grok", "brightdata", false))).toMatch(/requires :online/);
			expect(brightdata.validateTarget!(config("perplexity", "brightdata", false))).toMatch(/requires :online/);
		});

		it("rejects unknown models", () => {
			expect(brightdata.validateTarget!(config("unknown", "brightdata", true))).toMatch(/does not support/);
		});

		it("accepts unknown models with custom dataset ID", () => {
			expect(brightdata.validateTarget!(config("unknown", "brightdata", true, "gd_custom123"))).toBeNull();
		});
	});

	describe("dataforseo", () => {
		it("accepts google-ai-mode:online", () => {
			expect(dataforseo.validateTarget!(config("google-ai-mode", "dataforseo", true))).toBeNull();
		});

		it("rejects without :online", () => {
			expect(dataforseo.validateTarget!(config("google-ai-mode", "dataforseo", false))).toMatch(/requires :online/);
		});

		it("rejects unsupported models", () => {
			expect(dataforseo.validateTarget!(config("copilot", "dataforseo", true))).toMatch(/only supports/);
		});

		it("accepts chatgpt/perplexity/gemini with :online", () => {
			for (const model of ["chatgpt", "perplexity", "gemini"]) {
				expect(dataforseo.validateTarget!(config(model, "dataforseo", true))).toBeNull();
			}
		});

		it("accepts an explicit model_name via the version slug", () => {
			expect(dataforseo.validateTarget!(config("chatgpt", "dataforseo", true, "gpt-4.1"))).toBeNull();
		});

		it("rejects chatgpt/perplexity/gemini without :online", () => {
			expect(dataforseo.validateTarget!(config("chatgpt", "dataforseo", false))).toMatch(/requires :online/);
		});
	});

	describe("oxylabs", () => {
		it("accepts chatgpt with and without :online", () => {
			expect(oxylabs.validateTarget!(config("chatgpt", "oxylabs", true))).toBeNull();
			expect(oxylabs.validateTarget!(config("chatgpt", "oxylabs", false))).toBeNull();
		});

		it("accepts perplexity and google-ai-mode with :online", () => {
			expect(oxylabs.validateTarget!(config("perplexity", "oxylabs", true))).toBeNull();
			expect(oxylabs.validateTarget!(config("google-ai-mode", "oxylabs", true))).toBeNull();
		});

		it("rejects perplexity / google-ai-mode without :online", () => {
			expect(oxylabs.validateTarget!(config("perplexity", "oxylabs", false))).toMatch(/requires :online/);
			expect(oxylabs.validateTarget!(config("google-ai-mode", "oxylabs", false))).toMatch(/requires :online/);
		});

		it("rejects unsupported models (e.g. copilot, gemini, grok)", () => {
			expect(oxylabs.validateTarget!(config("copilot", "oxylabs", true))).toMatch(/does not support/);
			expect(oxylabs.validateTarget!(config("gemini", "oxylabs", true))).toMatch(/does not support/);
			expect(oxylabs.validateTarget!(config("grok", "oxylabs", true))).toMatch(/does not support/);
		});
	});
});
