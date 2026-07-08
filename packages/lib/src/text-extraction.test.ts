import { describe, expect, it } from "vitest";
import {
	extractCitations,
	extractCitationsFromDataforseoLlm,
	extractCitationsFromGoogle,
	extractCitationsFromOpenAI,
	extractCitationsFromOxylabs,
	extractTextContent,
	extractTextFromAnthropic,
	extractTextFromDataforseoLlm,
	extractTextFromGoogle,
	extractTextFromOpenAI,
} from "./text-extraction";

/** A minimal DataForSEO AI Optimization "LLM Responses" payload. */
function dfsLlmResponse(opts: { reasoning?: boolean; annotations?: { title?: string; url: string }[] }) {
	const items: any[] = [];
	if (opts.reasoning) {
		items.push({ type: "reasoning", sections: [{ type: "summary_text", text: "thinking..." }] });
	}
	items.push({
		type: "message",
		sections: [
			{
				type: "text",
				text: "The answer text.",
				annotations: opts.annotations ?? null,
			},
		],
	});
	return { tasks: [{ status_code: 20000, result: [{ model_name: "gpt-4o", items }] }] };
}

describe("text-extraction", () => {
	describe("extractTextFromOpenAI", () => {
		it("should extract text from Responses API format", () => {
			const rawOutput = {
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								text: "Hello, world!",
							},
						],
					},
				],
			};

			expect(extractTextFromOpenAI(rawOutput)).toBe("Hello, world!");
		});

		it("should extract and join multiple text blocks", () => {
			const rawOutput = {
				output: [
					{
						type: "message",
						content: [
							{ type: "output_text", text: "First part." },
							{ type: "output_text", text: "Second part." },
						],
					},
				],
			};

			expect(extractTextFromOpenAI(rawOutput)).toBe("First part.\nSecond part.");
		});

		it("should extract text from choices format (legacy)", () => {
			const rawOutput = {
				choices: [
					{
						message: {
							content: "Legacy format content",
						},
					},
				],
			};

			expect(extractTextFromOpenAI(rawOutput)).toBe("Legacy format content");
		});

		it("should extract from direct text property", () => {
			const rawOutput = {
				text: "Direct text property",
			};

			expect(extractTextFromOpenAI(rawOutput)).toBe("Direct text property");
		});

		it("should handle missing content gracefully", () => {
			expect(extractTextFromOpenAI({})).toBe("No text content found in OpenAI output.");
			expect(extractTextFromOpenAI(null)).toBe("No text content found in OpenAI output.");
			expect(extractTextFromOpenAI({ output: [] })).toBe("No text content found in OpenAI output.");
		});

		it("should filter non-message output types", () => {
			const rawOutput = {
				output: [
					{ type: "function_call", content: "not this" },
					{
						type: "message",
						content: [{ type: "output_text", text: "Actual text" }],
					},
				],
			};

			expect(extractTextFromOpenAI(rawOutput)).toBe("Actual text");
		});
	});

	describe("extractTextFromAnthropic", () => {
		it("should extract text from content array", () => {
			const rawOutput = {
				content: [{ type: "text", text: "Anthropic response" }],
			};

			expect(extractTextFromAnthropic(rawOutput)).toBe("Anthropic response");
		});

		it("should join multiple text blocks", () => {
			const rawOutput = {
				content: [
					{ type: "text", text: "First block" },
					{ type: "text", text: "Second block" },
				],
			};

			expect(extractTextFromAnthropic(rawOutput)).toBe("First block\nSecond block");
		});

		it("should filter non-text content types", () => {
			const rawOutput = {
				content: [
					{ type: "tool_use", text: "not this" },
					{ type: "text", text: "Only text" },
				],
			};

			expect(extractTextFromAnthropic(rawOutput)).toBe("Only text");
		});

		it("should handle missing content gracefully", () => {
			expect(extractTextFromAnthropic({})).toBe("No text content found in Anthropic output.");
			expect(extractTextFromAnthropic(null)).toBe("No text content found in Anthropic output.");
			expect(extractTextFromAnthropic({ content: "not an array" })).toBe("No text content found in Anthropic output.");
		});
	});

	describe("extractTextFromGoogle", () => {
		it("should extract AI overview markdown from DataForSEO format", () => {
			const rawOutput = {
				tasks: [
					{
						result: [
							{
								items: [
									{
										type: "ai_overview",
										markdown: "AI Overview content here",
									},
								],
							},
						],
					},
				],
			};

			expect(extractTextFromGoogle(rawOutput)).toBe("AI Overview content here");
		});

		it("should handle missing AI overview", () => {
			const rawOutput = {
				tasks: [
					{
						result: [
							{
								items: [{ type: "organic", title: "Not AI overview" }],
							},
						],
					},
				],
			};

			expect(extractTextFromGoogle(rawOutput)).toBe("No AI overview content found.");
		});

		it("should handle empty structure gracefully", () => {
			expect(extractTextFromGoogle({})).toBe("No AI overview content found.");
			expect(extractTextFromGoogle({ tasks: [] })).toBe("No AI overview content found.");
			expect(extractTextFromGoogle({ tasks: [{ result: [] }] })).toBe("No AI overview content found.");
		});
	});

	describe("extractTextFromDataforseoLlm", () => {
		it("extracts message section text and skips reasoning items", () => {
			const raw = dfsLlmResponse({ reasoning: true });
			expect(extractTextFromDataforseoLlm(raw)).toBe("The answer text.");
		});

		it("returns a fallback when no text is present", () => {
			expect(extractTextFromDataforseoLlm({ tasks: [{ result: [{ items: [] }] }] })).toBe(
				"No text content found in DataForSEO LLM output.",
			);
			expect(extractTextFromDataforseoLlm({})).toBe("No text content found in DataForSEO LLM output.");
		});

		it("is reachable through the dataforseo dispatch (shape auto-detect)", () => {
			const raw = dfsLlmResponse({});
			expect(extractTextFromGoogle(raw)).toBe("The answer text.");
			expect(extractTextContent(raw, "dataforseo")).toBe("The answer text.");
		});
	});

	describe("extractCitationsFromDataforseoLlm", () => {
		it("extracts annotations as citations", () => {
			const raw = dfsLlmResponse({
				annotations: [
					{ title: "Example", url: "https://www.example.com/a" },
					{ title: "Other", url: "https://other.org/b" },
				],
			});
			const citations = extractCitationsFromDataforseoLlm(raw);
			expect(citations).toEqual([
				{ url: "https://www.example.com/a", title: "Example", domain: "example.com", citationIndex: 0 },
				{ url: "https://other.org/b", title: "Other", domain: "other.org", citationIndex: 1 },
			]);
		});

		it("de-dupes repeated URLs and ignores non-http entries", () => {
			const raw = dfsLlmResponse({
				annotations: [{ url: "https://example.com/x" }, { url: "https://example.com/x" }, { url: "not-a-url" }],
			});
			const citations = extractCitationsFromDataforseoLlm(raw);
			expect(citations).toHaveLength(1);
			expect(citations[0].url).toBe("https://example.com/x");
		});

		it("returns [] when annotations are null (web search off)", () => {
			expect(extractCitationsFromDataforseoLlm(dfsLlmResponse({}))).toEqual([]);
			expect(extractCitationsFromDataforseoLlm({})).toEqual([]);
		});

		it("is reachable through the dataforseo dispatch (shape auto-detect)", () => {
			const raw = dfsLlmResponse({ annotations: [{ url: "https://example.com/x" }] });
			expect(extractCitationsFromGoogle(raw)).toHaveLength(1);
			expect(extractCitations(raw, "dataforseo")).toHaveLength(1);
		});
	});

	describe("extractTextContent", () => {
		it("should route by provider name", () => {
			const openaiOutput = {
				output: [{ type: "message", content: [{ type: "output_text", text: "OpenAI text" }] }],
			};
			const anthropicOutput = {
				content: [{ type: "text", text: "Anthropic text" }],
			};
			const googleOutput = {
				tasks: [{ result: [{ items: [{ type: "ai_overview", markdown: "Google text" }] }] }],
			};

			expect(extractTextContent(openaiOutput, "openai-api")).toBe("OpenAI text");
			expect(extractTextContent(anthropicOutput, "anthropic-api")).toBe("Anthropic text");
			expect(extractTextContent(googleOutput, "dataforseo")).toBe("Google text");
		});

		it("should route by legacy engine names for old data", () => {
			const openaiOutput = {
				output: [{ type: "message", content: [{ type: "output_text", text: "OpenAI text" }] }],
			};
			expect(extractTextContent(openaiOutput, "openai")).toBe("OpenAI text");
			expect(extractTextContent(openaiOutput, "chatgpt")).toBe("OpenAI text");
			expect(extractTextContent({ content: [{ type: "text", text: "Anthropic" }] }, "anthropic")).toBe("Anthropic");
			expect(extractTextContent({ content: [{ type: "text", text: "Anthropic" }] }, "claude")).toBe("Anthropic");
		});

		it("should attempt generic extraction for unknown providers", () => {
			expect(extractTextContent({ choices: [{ message: { content: "generic" } }] }, "unknown")).toBe("generic");
			expect(extractTextContent({ answer_markdown: "md content" }, "unknown")).toBe("md content");
		});
	});

	describe("extractCitationsFromOpenAI", () => {
		it("should extract citations from url_citation annotations", () => {
			const rawOutput = {
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								annotations: [
									{
										type: "url_citation",
										url: "https://example.com/article",
										title: "Example Article",
									},
								],
							},
						],
					},
				],
			};

			const citations = extractCitationsFromOpenAI(rawOutput);
			expect(citations).toHaveLength(1);
			expect(citations[0]).toEqual({
				url: "https://example.com/article",
				title: "Example Article",
				domain: "example.com",
				citationIndex: 0,
			});
		});

		it("should extract domain without www prefix", () => {
			const rawOutput = {
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								annotations: [
									{
										type: "url_citation",
										url: "https://www.example.com/page",
									},
								],
							},
						],
					},
				],
			};

			const citations = extractCitationsFromOpenAI(rawOutput);
			expect(citations[0].domain).toBe("example.com");
		});

		it("should handle missing title", () => {
			const rawOutput = {
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								annotations: [
									{
										type: "url_citation",
										url: "https://example.com/page",
									},
								],
							},
						],
					},
				],
			};

			const citations = extractCitationsFromOpenAI(rawOutput);
			expect(citations[0].title).toBeUndefined();
		});

		it("should skip invalid URLs", () => {
			const rawOutput = {
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								annotations: [
									{ type: "url_citation", url: "not-a-valid-url" },
									{ type: "url_citation", url: "https://valid.com" },
								],
							},
						],
					},
				],
			};

			const citations = extractCitationsFromOpenAI(rawOutput);
			expect(citations).toHaveLength(1);
			expect(citations[0].domain).toBe("valid.com");
		});

		it("should handle empty output gracefully", () => {
			expect(extractCitationsFromOpenAI({})).toEqual([]);
			expect(extractCitationsFromOpenAI(null)).toEqual([]);
		});
	});

	describe("extractCitationsFromGoogle", () => {
		it("should extract citations from AI overview references", () => {
			const rawOutput = {
				tasks: [
					{
						result: [
							{
								items: [
									{
										type: "ai_overview",
										references: [
											{
												url: "https://example.com/source",
												title: "Source Article",
											},
										],
									},
								],
							},
						],
					},
				],
			};

			const citations = extractCitationsFromGoogle(rawOutput);
			expect(citations).toHaveLength(1);
			expect(citations[0]).toEqual({
				url: "https://example.com/source",
				title: "Source Article",
				domain: "example.com",
				citationIndex: 0,
			});
		});

		it("should handle missing references gracefully", () => {
			const rawOutput = {
				tasks: [
					{
						result: [
							{
								items: [{ type: "ai_overview", markdown: "No refs" }],
							},
						],
					},
				],
			};

			expect(extractCitationsFromGoogle(rawOutput)).toEqual([]);
		});

		it("should handle empty output gracefully", () => {
			expect(extractCitationsFromGoogle({})).toEqual([]);
			expect(extractCitationsFromGoogle(null)).toEqual([]);
		});
	});

	describe("extractCitationsFromOxylabs", () => {
		it("should extract ChatGPT-style citations with a top-level url", () => {
			const rawOutput = {
				results: [
					{
						content: {
							citations: [
								{ url: "https://www.forbes.com/article", title: "Best Speakers" },
							],
						},
					},
				],
			};

			const citations = extractCitationsFromOxylabs(rawOutput);
			expect(citations).toHaveLength(1);
			expect(citations[0]).toEqual({
				url: "https://www.forbes.com/article",
				title: "Best Speakers",
				domain: "forbes.com",
				citationIndex: 0,
			});
		});

		it("should extract Google AI Mode citations from the nested urls array", () => {
			const rawOutput = {
				results: [
					{
						content: {
							citations: [
								{
									text: "The JBL Xtreme 5 is a newly released option.",
									urls: [
										"https://www.bgr.com/best-speakers",
										"https://www.soundguys.com/jbl-xtreme-5",
									],
								},
								{ text: "Other mentions.", urls: ["https://www.rtings.com/speaker"] },
							],
						},
					},
				],
			};

			const citations = extractCitationsFromOxylabs(rawOutput);
			expect(citations.map((c) => c.domain)).toEqual([
				"bgr.com",
				"soundguys.com",
				"rtings.com",
			]);
			expect(citations[0].citationIndex).toBe(0);
			expect(citations[2].citationIndex).toBe(2);
		});

		it("should extract Perplexity citations from additional_results.sources_results", () => {
			const rawOutput = {
				results: [
					{
						content: {
							additional_results: {
								sources_results: [
									{ url: "https://www.rtings.com/best", title: "Best Bluetooth Speakers" },
								],
							},
						},
					},
				],
			};

			const citations = extractCitationsFromOxylabs(rawOutput);
			expect(citations).toHaveLength(1);
			expect(citations[0].domain).toBe("rtings.com");
		});

		it("should dedupe URLs that repeat across citation entries", () => {
			const rawOutput = {
				results: [
					{
						content: {
							citations: [
								{ text: "a", urls: ["https://example.com/x"] },
								{ text: "b", urls: ["https://example.com/x", "https://other.com/y"] },
							],
						},
					},
				],
			};

			const citations = extractCitationsFromOxylabs(rawOutput);
			expect(citations.map((c) => c.url)).toEqual([
				"https://example.com/x",
				"https://other.com/y",
			]);
		});

		it("should skip invalid URLs and handle empty output gracefully", () => {
			expect(extractCitationsFromOxylabs({})).toEqual([]);
			expect(extractCitationsFromOxylabs(null)).toEqual([]);
			const rawOutput = {
				results: [{ content: { citations: [{ urls: ["not-a-url", "https://valid.com"] }] } }],
			};
			expect(extractCitationsFromOxylabs(rawOutput).map((c) => c.domain)).toEqual(["valid.com"]);
		});
	});

	describe("extractCitations", () => {
		it("should route to correct extractor based on model group", () => {
			const openaiOutput = {
				output: [
					{
						type: "message",
						content: [
							{
								type: "output_text",
								annotations: [{ type: "url_citation", url: "https://openai-source.com" }],
							},
						],
					},
				],
			};

			const citations = extractCitations(openaiOutput, "openai");
			expect(citations).toHaveLength(1);
			expect(citations[0].domain).toBe("openai-source.com");
		});

		it("should return empty array for anthropic (no citations support)", () => {
			expect(extractCitations({}, "anthropic")).toEqual([]);
		});

		it("should return empty array for unknown model group", () => {
			expect(extractCitations({}, "unknown")).toEqual([]);
		});
	});
});
