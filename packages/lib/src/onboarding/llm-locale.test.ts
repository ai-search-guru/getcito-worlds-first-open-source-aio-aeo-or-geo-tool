/**
 * The structured-research entry points have to hand the brand's locale to the
 * provider. Without it every generated prompt/description/recommendation runs
 * in the model's default language, whatever the brand row says.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const runStructuredResearch = vi.fn(async () => ({ object: { ok: true }, modelVersion: "fake-model" }));

const fakeProvider = {
	id: "openai-api",
	name: "Fake provider",
	isConfigured: () => true,
	run: vi.fn(),
	runStructuredResearch,
};

// Only the provider lookup is stubbed — `resolveResearchProvider`'s selection
// logic still runs against the fake, and call tracking is bypassed so the test
// never touches the provider_calls table.
vi.mock("../providers", () => ({
	getProvider: () => fakeProvider,
	parseScrapeTargets: () => [],
	withProviderCallTracking: (_meta: unknown, fn: () => Promise<unknown>) => fn(),
}));

import { runStructuredCompletionPrompt, runStructuredResearchPrompt } from "./llm";

const schema = z.object({ ok: z.boolean() });

beforeEach(() => {
	delete process.env.ONBOARDING_LLM_TARGET;
});

afterEach(() => {
	runStructuredResearch.mockClear();
});

describe("structured research locale", () => {
	it("forwards the brand's language and market to the provider", async () => {
		const object = await runStructuredResearchPrompt("a prompt", schema, {
			targetLanguage: "Spanish",
			targetMarket: "Mexico",
		});

		expect(object).toEqual({ ok: true });
		expect(runStructuredResearch).toHaveBeenCalledWith(
			expect.objectContaining({
				prompt: "a prompt",
				targetLanguage: "Spanish",
				targetMarket: "Mexico",
			}),
		);
	});

	it("forwards the locale on the no-web-search completion path too, with the tool still off", async () => {
		await runStructuredCompletionPrompt("a prompt", schema, {
			targetLanguage: "Spanish",
			targetMarket: "Mexico",
		});

		expect(runStructuredResearch).toHaveBeenCalledWith(
			expect.objectContaining({
				webSearch: false,
				targetLanguage: "Spanish",
				targetMarket: "Mexico",
			}),
		);
	});

	it("sends no locale for a brand without one, so the provider keeps its default", async () => {
		await runStructuredResearchPrompt("a prompt", schema);

		expect(runStructuredResearch).toHaveBeenCalledWith(
			expect.objectContaining({ targetLanguage: undefined, targetMarket: undefined }),
		);
	});
});
