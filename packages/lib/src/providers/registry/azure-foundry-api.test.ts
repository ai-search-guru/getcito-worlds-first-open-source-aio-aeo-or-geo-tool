import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { azureFoundryApi, liveSearchParameters } from "./azure-foundry-api";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

describe("isConfigured", () => {
	it("requires both the API key and base URL", () => {
		vi.stubEnv("AZURE_FOUNDRY_API_KEY", "key");
		vi.stubEnv("AZURE_FOUNDRY_BASE_URL", "");
		expect(azureFoundryApi.isConfigured()).toBe(false);

		vi.stubEnv("AZURE_FOUNDRY_API_KEY", "");
		vi.stubEnv("AZURE_FOUNDRY_BASE_URL", "https://example.services.ai.azure.com/models");
		expect(azureFoundryApi.isConfigured()).toBe(false);

		vi.stubEnv("AZURE_FOUNDRY_API_KEY", "key");
		expect(azureFoundryApi.isConfigured()).toBe(true);
	});
});

describe("liveSearchParameters", () => {
	it("scopes the web source to the brand's target market", () => {
		expect(liveSearchParameters({ webSearch: true, targetMarket: "India" })).toEqual({
			mode: "auto",
			return_citations: true,
			sources: [{ type: "web", country: "IN" }, { type: "x" }],
		});
	});

	it("keeps xAI's default sources when the brand has no target market", () => {
		expect(liveSearchParameters({ webSearch: true })).toEqual({
			mode: "auto",
			return_citations: true,
		});
	});

	it("keeps the defaults rather than guessing when the market isn't a known country", () => {
		expect(liveSearchParameters({ targetMarket: "Atlantis" })).toEqual({
			mode: "auto",
			return_citations: true,
		});
	});
});

describe("runStructuredResearch", () => {
	const runStructuredResearch = azureFoundryApi.runStructuredResearch;
	if (!runStructuredResearch) throw new Error("azure-foundry-api must implement runStructuredResearch");

	/** Point the provider at a stubbed Foundry endpoint and capture the request bodies. */
	function stubFoundry(requests: Array<{ body: { messages: unknown } }>) {
		vi.stubEnv("AZURE_FOUNDRY_API_KEY", "key");
		vi.stubEnv("AZURE_FOUNDRY_BASE_URL", "https://example.services.ai.azure.com/models");
		vi.stubGlobal("fetch", async (_input: RequestInfo | URL, init?: RequestInit) => {
			requests.push({ body: JSON.parse(String(init?.body)) });
			return new Response(
				JSON.stringify({ model: "gpt-4o-mini", choices: [{ message: { content: '{"ok":true}' } }] }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			);
		});
	}

	it("sends the brand's locale as a system turn ahead of the prompt", async () => {
		const requests: Array<{ body: { messages: unknown } }> = [];
		stubFoundry(requests);

		const result = await runStructuredResearch({
			prompt: "a prompt",
			schema: z.object({ ok: z.boolean() }),
			targetLanguage: "Spanish",
			targetMarket: "Mexico",
		});

		expect(result.object).toEqual({ ok: true });
		expect(requests[0]?.body.messages).toEqual([
			{
				role: "system",
				content: "Please provide your response in language: Spanish. Assume the user's location is: Mexico.",
			},
			{ role: "user", content: "a prompt" },
		]);
	});

	it("sends the prompt alone when the brand has no locale", async () => {
		const requests: Array<{ body: { messages: unknown } }> = [];
		stubFoundry(requests);

		await runStructuredResearch({
			prompt: "a prompt",
			schema: z.object({ ok: z.boolean() }),
		});

		expect(requests[0]?.body.messages).toEqual([{ role: "user", content: "a prompt" }]);
	});
});
