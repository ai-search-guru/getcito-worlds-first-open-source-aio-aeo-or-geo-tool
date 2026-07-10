import { afterEach, describe, expect, it, vi } from "vitest";

const dataforseoClient = vi.hoisted(() => ({
	chatgptLlmResponsesLive: vi.fn(),
	perplexityLlmResponsesLive: vi.fn(),
	geminiLlmResponsesLive: vi.fn(),
	googleAiModeLiveAdvanced: vi.fn(),
}));

vi.mock("dataforseo-client", () => ({
	AiOptimizationApi: class {
		chatGptLlmResponsesLive = dataforseoClient.chatgptLlmResponsesLive;
		perplexityLlmResponsesLive = dataforseoClient.perplexityLlmResponsesLive;
		geminiLlmResponsesLive = dataforseoClient.geminiLlmResponsesLive;
	},
	SerpApi: class {
		googleAiModeLiveAdvanced = dataforseoClient.googleAiModeLiveAdvanced;
	},
	SerpGoogleAiModeLiveAdvancedRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	AiOptimizationChatGptLlmResponsesLiveRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	AiOptimizationPerplexityLlmResponsesLiveRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
	AiOptimizationGeminiLlmResponsesLiveRequestInfo: class {
		constructor(args: Record<string, unknown>) {
			Object.assign(this, args);
		}
	},
}));

import { dataforseo } from "./dataforseo";

afterEach(() => {
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

describe("dataforseo provider", () => {
	it("rejects prompts longer than DataForSEO's 500 character limit before calling the API", async () => {
		await expect(dataforseo.run("chatgpt", "x".repeat(501), { webSearch: true })).rejects.toThrow(
			/DataForSEO prompts must be 500 characters or fewer/,
		);

		expect(dataforseoClient.chatgptLlmResponsesLive).not.toHaveBeenCalled();
	});

	it("does not send country localization for DataForSEO LLM Responses targets", async () => {
		dataforseoClient.chatgptLlmResponsesLive.mockResolvedValueOnce({
			tasks: [
				{
					status_code: 20000,
					status_message: "Ok.",
					result: [
						{
							model_name: "gpt-4o",
							fan_out_queries: ["current laptop reviews"],
							items: [
								{
									type: "message",
									sections: [
										{
											type: "text",
											text: "A current well-reviewed laptop is the Framework Laptop 13, based on recent reviews.",
											annotations: [{ url: "https://example.com/review", title: "Example review" }],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		// country isn't a ProviderOptions field (intentionally not exposed); force it
		// through to prove DataForSEO never forwards it as web_search_country_iso_code.
		const options = { webSearch: true, country: "GB" } as unknown as Parameters<typeof dataforseo.run>[2];
		await dataforseo.run("chatgpt", "What is a well-reviewed laptop this month?", options);

		const [payload] = dataforseoClient.chatgptLlmResponsesLive.mock.calls[0];
		expect(payload[0]).not.toHaveProperty("web_search_country_iso_code");
		expect(payload[0]).toMatchObject({
			user_prompt: "What is a well-reviewed laptop this month?",
			model_name: "gpt-5.5",
			web_search: true,
		});
	});

	it("resolves Gemini Vertex grounding-redirect citation URLs to the real source", async () => {
		const realUrl = "https://www.whathifi.com/best-buys/hi-fi/best-hi-fi-speakers";
		const redirectUrl = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/ABC123";

		dataforseoClient.geminiLlmResponsesLive.mockResolvedValueOnce({
			tasks: [
				{
					status_code: 20000,
					status_message: "Ok.",
					result: [
						{
							model_name: "gemini-2.5-flash",
							fan_out_queries: ["best speakers"],
							items: [
								{
									type: "message",
									sections: [
										{
											type: "text",
											text: "The What Hi-Fi roundup highlights several strong speakers released recently for review.",
											annotations: [{ url: redirectUrl, title: "whathifi.com" }],
										},
									],
								},
							],
						},
					],
				},
			],
		});

		// resolveGroundingRedirect uses global fetch with redirect:"manual" and reads
		// the Location header. The client call itself is mocked separately above.
		const fetchMock = vi.fn().mockResolvedValue({
			headers: { get: (k: string) => (k === "location" ? realUrl : null) },
		});
		vi.stubGlobal("fetch", fetchMock);

		const result = await dataforseo.run("gemini", "What are well-reviewed speakers?", { webSearch: true });

		expect(fetchMock).toHaveBeenCalledWith(redirectUrl, expect.objectContaining({ redirect: "manual" }));
		expect(result.citations).toHaveLength(1);
		expect(result.citations[0].url).toBe(realUrl);
		expect(result.citations[0].domain).toBe("whathifi.com");
		// The raw output is rewritten in place, so re-extraction stays consistent.
		const raw = result.rawOutput as {
			tasks: { result: { items: { sections: { annotations: { url: string }[] }[] }[] }[] }[];
		};
		const rawUrl = raw.tasks[0].result[0].items[0].sections[0].annotations[0].url;
		expect(rawUrl).toBe(realUrl);
	});
});
