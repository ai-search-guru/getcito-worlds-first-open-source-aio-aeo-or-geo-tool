import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the LLM and excerpt modules so the test exercises only normalization.
vi.mock("./llm", () => ({
	resolveResearchTarget: vi.fn(() => ({
		provider: { id: "anthropic-api", isConfigured: () => true } as any,
		model: "claude-sonnet-4-6",
	})),
	runStructuredResearchPrompt: vi.fn(),
}));
vi.mock("../website-excerpt", () => ({
	getWebsiteExcerpt: vi.fn(async () => ""),
}));

import { runStructuredResearchPrompt } from "./llm";
import { analyzeBrand, analyzeCompetitors, analyzePrompts } from "./analyze";

afterEach(() => {
	vi.clearAllMocks();
});

describe("analyzeBrand", () => {
	it("normalizes brand fields, dedupes domains, and filters self-referential competitors", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: ["acme.co.uk", "ACME.COM", "acme.de"],
			// Aliases containing "Acme" are redundant under substring mention
			// matching; only "Globex Holdings" (a distinct parent) survives.
			aliases: ["Acme Inc", "acme inc", "Acme", "Globex Holdings"],
			competitors: [
				// Competitor alias "Globex Worldwide" contains the comp name → drop;
				// "GBX" stays because it doesn't contain "Globex".
				{ name: "Globex", domains: ["globex.com", "globex.de"], aliases: ["GBX", "Globex Worldwide"] },
				{ name: "Self Reference", domains: ["acme.com"], aliases: [] },
				{ name: "Bad Domain", domains: ["not a domain"], aliases: [] },
				{ name: "Globex Dup", domains: ["globex.com"], aliases: [] },
			],
			suggestedPrompts: [
				// Tags are now free-form / brand-tailored. Normalize step lowercases
				// + kebab-cases + dedupes + caps at 3 per prompt.
				{ prompt: "Best Widgets", tags: ["Industrial Supplies", "Manufacturing"] },
				{ prompt: "best widgets", tags: ["industrial-supplies"] }, // duplicate after lowercasing
				{ prompt: "acme alternative", tags: ["alternatives", "industrial supplies", "buying guide", "extra-tag"] },
			],
		});

		const result = await analyzeBrand({
			website: "https://www.acme.com",
			brandName: "Acme",
			maxCompetitors: 5,
			maxPrompts: 10,
		});

		expect(result.brandName).toBe("Acme");
		expect(result.website).toBe("acme.com");
		expect(result.additionalDomains).toEqual(["acme.co.uk", "acme.de"]);
		expect(result.aliases).toEqual(["Globex Holdings"]);

		expect(result.competitors).toHaveLength(1);
		expect(result.competitors[0]).toMatchObject({
			name: "Globex",
			domains: ["globex.com", "globex.de"],
			aliases: ["GBX"],
		});

		expect(result.suggestedPrompts).toEqual([
			{ prompt: "best widgets", tags: ["industrial-supplies", "manufacturing"] },
			{
				prompt: "acme alternative",
				// "industrial supplies" → "industrial-supplies", capped at 3 (extra-tag dropped)
				tags: ["alternatives", "industrial-supplies", "buying-guide"],
			},
		]);
	});

	it("falls back to inferred brand name when LLM omits it", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "",
			additionalDomains: [],
			aliases: [],
			competitors: [],
			suggestedPrompts: [],
		});

		const result = await analyzeBrand({ website: "nike.com" });
		expect(result.brandName).toBe("Nike");
	});

	it("respects maxCompetitors=0 / maxPrompts=0", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: [],
			aliases: [],
			competitors: [{ name: "Globex", domains: ["globex.com"], aliases: [] }],
			suggestedPrompts: [{ prompt: "best widgets", tags: ["best-of"] }],
		});

		const result = await analyzeBrand({
			website: "acme.com",
			maxCompetitors: 0,
			maxPrompts: 0,
		});
		expect(result.competitors).toEqual([]);
		expect(result.suggestedPrompts).toEqual([]);
	});

	it("caps competitors and prompts at the requested maxes", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce({
			brandName: "Acme",
			additionalDomains: [],
			aliases: [],
			competitors: Array.from({ length: 20 }, (_, i) => ({
				name: `Comp ${i}`,
				domains: [`comp${i}.com`],
				aliases: [],
			})),
			suggestedPrompts: Array.from({ length: 50 }, (_, i) => ({
				prompt: `prompt ${i}`,
				tags: ["best-of"],
			})),
		});

		const result = await analyzeBrand({
			website: "acme.com",
			maxCompetitors: 3,
			maxPrompts: 5,
		});
		expect(result.competitors).toHaveLength(3);
		expect(result.suggestedPrompts).toHaveLength(5);
	});
});

// A brand that targets Spanish/Mexico must not get English prompts or English
// descriptions — the provider system message alone doesn't hold, so the locale
// is also written into the prompt text.
describe("locale", () => {
	const EMPTY_SUGGESTION = {
		brandName: "Acme",
		additionalDomains: [],
		aliases: [],
		competitors: [],
		suggestedPrompts: [],
	};

	it("asks for the brand's language in the prompt and forwards the locale to the provider", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce(EMPTY_SUGGESTION);

		await analyzeBrand({
			website: "acme.com",
			brandName: "Acme",
			targetLanguage: "Spanish",
			targetMarket: "Mexico",
		});

		const [prompt, , options] = (runStructuredResearchPrompt as any).mock.calls[0];
		expect(prompt).toContain(
			"Write the shortDescription, productsAndServices, keywords, and every suggested prompt in Spanish",
		);
		expect(prompt).toContain("The brand's target market is Mexico");
		expect(options).toEqual({ targetLanguage: "Spanish", targetMarket: "Mexico" });
	});

	it("appends nothing when the brand set no locale", async () => {
		(runStructuredResearchPrompt as any).mockResolvedValueOnce(EMPTY_SUGGESTION);
		await analyzeBrand({ website: "acme.com", brandName: "Acme" });

		(runStructuredResearchPrompt as any).mockResolvedValueOnce(EMPTY_SUGGESTION);
		await analyzeBrand({
			website: "acme.com",
			brandName: "Acme",
			targetLanguage: "Spanish",
			targetMarket: "Mexico",
		});

		const [withoutLocale] = (runStructuredResearchPrompt as any).mock.calls[0];
		const [withLocale] = (runStructuredResearchPrompt as any).mock.calls[1];
		expect(withoutLocale).not.toMatch(/target language|target market/);
		// The locale is appended to the existing prompt, never a rewrite of it.
		expect(withLocale.startsWith(withoutLocale)).toBe(true);

		const [, , withoutLocaleOptions] = (runStructuredResearchPrompt as any).mock.calls[0];
		expect(withoutLocaleOptions).toEqual({ targetLanguage: undefined, targetMarket: undefined });
	});

	it("asks for prompts in the brand's language and competitor names untranslated", async () => {
		const raw = { competitors: [], suggestedPrompts: [] };
		(runStructuredResearchPrompt as any).mockResolvedValue(raw);

		await analyzePrompts({
			website: "acme.com",
			brandName: "Acme",
			targetLanguage: "Spanish",
			targetMarket: "Mexico",
		});
		await analyzeCompetitors({
			website: "acme.com",
			brandName: "Acme",
			targetLanguage: "Spanish",
			targetMarket: "Mexico",
		});

		const [promptsPrompt, , promptsOptions] = (runStructuredResearchPrompt as any).mock.calls[0];
		expect(promptsPrompt).toContain("Write each suggested prompt in Spanish");
		expect(promptsOptions).toEqual({ targetLanguage: "Spanish", targetMarket: "Mexico" });

		// Competitor names are proper nouns — market relevance, no language clause.
		const [competitorsPrompt] = (runStructuredResearchPrompt as any).mock.calls[1];
		expect(competitorsPrompt).toContain("The brand's target market is Mexico");
		expect(competitorsPrompt).not.toContain("in Spanish");
	});
});
