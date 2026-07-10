import { describe, it, expect } from "vitest";
import { getAvailableModels, ALL_MODELS_VALUE } from "@/lib/model-filter";

describe("getAvailableModels", () => {
	it("returns an empty list for an empty input", () => {
		expect(getAvailableModels([])).toEqual([]);
	});

	it("returns just the model when only one is configured (no 'all' sentinel)", () => {
		expect(getAvailableModels(["chatgpt"])).toEqual(["chatgpt"]);
	});

	it("prepends 'all' when multiple models are configured", () => {
		expect(getAvailableModels(["chatgpt", "claude"])).toEqual([ALL_MODELS_VALUE, "chatgpt", "claude"]);
	});

	it("preserves the caller's ordering of concrete models", () => {
		expect(getAvailableModels(["perplexity", "grok", "gemini"])).toEqual([
			ALL_MODELS_VALUE,
			"perplexity",
			"grok",
			"gemini",
		]);
	});

	it("works for arbitrary deployment-configured model ids, not just the ones Getcito knows about", () => {
		expect(getAvailableModels(["my-custom-model", "another-model"])).toEqual([
			ALL_MODELS_VALUE,
			"my-custom-model",
			"another-model",
		]);
	});
});
