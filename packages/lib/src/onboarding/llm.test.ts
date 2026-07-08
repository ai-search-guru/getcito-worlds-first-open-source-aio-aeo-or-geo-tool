import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveResearchProvider } from "./llm";

const ENV_KEYS = [
	"ONBOARDING_LLM_TARGET",
	"ANTHROPIC_API_KEY",
	"OPENAI_API_KEY",
	"OPENROUTER_API_KEY",
	"OLOSTEP_API_KEY",
	"BRIGHTDATA_API_TOKEN",
	"OXYLABS_USERNAME",
	"OXYLABS_PASSWORD",
	"MISTRAL_API_KEY",
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
	for (const key of ENV_KEYS) {
		savedEnv[key] = process.env[key];
		delete process.env[key];
	}
});

afterEach(() => {
	for (const key of ENV_KEYS) {
		const v = savedEnv[key];
		if (v === undefined) delete process.env[key];
		else process.env[key] = v;
	}
});

describe("resolveResearchProvider", () => {
	it("uses the explicit env override when set", () => {
		process.env.ANTHROPIC_API_KEY = "x";
		const provider = resolveResearchProvider({
			ANTHROPIC_API_KEY: "x",
			ONBOARDING_LLM_TARGET: "claude:anthropic-api",
		});
		expect(provider.id).toBe("anthropic-api");
	});

	it("throws when ONBOARDING_LLM_TARGET points at an unconfigured provider", () => {
		expect(() =>
			resolveResearchProvider({
				ONBOARDING_LLM_TARGET: "chatgpt:openai-api:gpt-5-mini",
			}),
		).toThrow(/isn't configured/);
	});

	it("throws when ONBOARDING_LLM_TARGET points at a scraper", () => {
		process.env.OLOSTEP_API_KEY = "x";
		expect(() =>
			resolveResearchProvider({
				OLOSTEP_API_KEY: "x",
				ONBOARDING_LLM_TARGET: "gemini:olostep:online",
			}),
		).toThrow(/does not support structured research/);
	});

	it("prefers OpenAI direct first when configured", () => {
		// provider.isConfigured() reads from process.env, not the function's
		// env arg — set both so ONBOARDING_LLM_TARGET lookup and the
		// per-provider config probe see the same world.
		process.env.OPENAI_API_KEY = "a";
		process.env.OPENROUTER_API_KEY = "b";
		process.env.ANTHROPIC_API_KEY = "c";
		process.env.MISTRAL_API_KEY = "d";
		const provider = resolveResearchProvider();
		expect(provider.id).toBe("openai-api");
	});

	it("falls back to OpenRouter when OpenAI direct isn't configured", () => {
		process.env.OPENROUTER_API_KEY = "b";
		process.env.ANTHROPIC_API_KEY = "c";
		process.env.MISTRAL_API_KEY = "d";
		const provider = resolveResearchProvider();
		expect(provider.id).toBe("openrouter");
	});

	it("falls back to Anthropic when OpenAI / OpenRouter aren't configured", () => {
		process.env.ANTHROPIC_API_KEY = "c";
		process.env.MISTRAL_API_KEY = "d";
		const provider = resolveResearchProvider();
		expect(provider.id).toBe("anthropic-api");
	});

	it("falls back to Mistral when only Mistral is set", () => {
		process.env.MISTRAL_API_KEY = "x";
		const provider = resolveResearchProvider();
		expect(provider.id).toBe("mistral-api");
	});

	it("ignores scraper providers entirely", () => {
		process.env.OLOSTEP_API_KEY = "x";
		process.env.BRIGHTDATA_API_TOKEN = "y";
		expect(() => resolveResearchProvider({ OLOSTEP_API_KEY: "x", BRIGHTDATA_API_TOKEN: "y" })).toThrow(
			/at least one direct LLM API/,
		);
	});

	it("throws when no provider is configured", () => {
		expect(() => resolveResearchProvider({})).toThrow(/at least one direct LLM API/);
	});
});

