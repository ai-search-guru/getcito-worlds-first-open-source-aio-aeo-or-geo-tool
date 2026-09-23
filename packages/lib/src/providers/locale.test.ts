import { describe, expect, it } from "vitest";
import { localeCountryCode, localePromptInstruction, localeSystemMessages, localeSystemPrompt } from "./locale";

describe("localeSystemPrompt", () => {
	it("returns undefined when the brand set no market or language", () => {
		expect(localeSystemPrompt()).toBeUndefined();
		expect(localeSystemPrompt({})).toBeUndefined();
		expect(localeSystemPrompt({ webSearch: true })).toBeUndefined();
	});

	it("mentions only the fields that are set", () => {
		expect(localeSystemPrompt({ targetLanguage: "German" })).toBe("Please provide your response in language: German.");
		expect(localeSystemPrompt({ targetMarket: "Germany" })).toBe("Assume the user's location is: Germany.");
	});

	it("combines both when the brand set both", () => {
		expect(localeSystemPrompt({ targetMarket: "Germany", targetLanguage: "German" })).toBe(
			"Please provide your response in language: German. Assume the user's location is: Germany.",
		);
	});
});

describe("localeSystemMessages", () => {
	it("is empty when there is no locale, so no system turn is sent", () => {
		expect(localeSystemMessages({})).toEqual([]);
	});

	it("is a single system message when there is one", () => {
		expect(localeSystemMessages({ targetMarket: "India" })).toEqual([
			{ role: "system", content: "Assume the user's location is: India." },
		]);
	});
});

describe("localeCountryCode", () => {
	it("maps every market the UI offers to an uppercase ISO-2 code", () => {
		expect(localeCountryCode({ targetMarket: "India" })).toBe("IN");
		expect(localeCountryCode({ targetMarket: "United Kingdom" })).toBe("GB");
	});

	it("is undefined for an unset or unknown market, so the tool keeps its default", () => {
		expect(localeCountryCode({})).toBeUndefined();
		expect(localeCountryCode({ targetMarket: "Atlantis" })).toBeUndefined();
	});
});

describe("localePromptInstruction", () => {
	it("is undefined when the brand set no locale, so the prompt is unchanged", () => {
		expect(localePromptInstruction()).toBeUndefined();
		expect(localePromptInstruction({})).toBeUndefined();
		expect(localePromptInstruction({ webSearch: true }, "each suggested prompt")).toBeUndefined();
	});

	it("names the language inside the prompt, for the fields it applies to", () => {
		expect(localePromptInstruction({ targetLanguage: "Spanish" }, "each suggested prompt")).toBe(
			"Write each suggested prompt in Spanish — the brand's target language. Do not translate brand names, domains, or aliases.",
		);
	});

	it("omits the language clause for a schema that holds only proper nouns", () => {
		expect(localePromptInstruction({ targetLanguage: "Spanish" })).toBeUndefined();
	});

	it("keeps the market hint even with nothing to translate", () => {
		expect(localePromptInstruction({ targetMarket: "Mexico" })).toBe(
			"The brand's target market is Mexico — prefer results relevant to that audience.",
		);
	});

	it("combines both when the brand set both", () => {
		expect(localePromptInstruction({ targetMarket: "Mexico", targetLanguage: "Spanish" }, "the summary")).toBe(
			"Write the summary in Spanish — the brand's target language. Do not translate brand names, domains, or aliases. The brand's target market is Mexico — prefer results relevant to that audience.",
		);
	});
});
