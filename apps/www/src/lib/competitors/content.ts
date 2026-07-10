import type { FaqItem } from "@/lib/faqs";
import type { Competitor, CompetitorCategory } from "./types";

// Prose-friendly category nouns (acronyms kept uppercase, descriptive words
// lowercased) so they read naturally mid-sentence — e.g. "an AI visibility
// tracking tool", "a traditional SEO tool".
export const CATEGORY_NOUN: Record<CompetitorCategory, string> = {
	tracking: "AI visibility tracking",
	content: "content generation",
	"api-developer": "developer API",
	ecommerce: "e-commerce",
	"seo-traditional": "traditional SEO",
	"open-source": "open-source",
	other: "AI visibility",
};

export function indefiniteArticle(phrase: string): "a" | "an" {
	return /^[aeiou]/i.test(phrase) ? "an" : "a";
}

export function isOpenSource(competitor: Competitor): boolean {
	return (
		(competitor.features.openSource ?? false) ||
		competitor.category === "open-source"
	);
}

/**
 * A 40–60 word lead "answer block" for a comparison page, written to be lifted
 * verbatim into an AI answer for "Getcito vs {competitor}" style queries. Branches
 * on whether the competitor is itself open source so the claim stays accurate.
 */
export function getComparisonVerdict(competitor: Competitor): string {
	const name = competitor.name;

	if (isOpenSource(competitor)) {
		return `Getcito and ${name} are both open-source AI visibility tools you can self-host and audit. Getcito's focus is transparent, independently verifiable tracking across ChatGPT, Claude, Perplexity, and Google AI Overviews — with white-label support for agencies and a documented methodology behind every number.`;
	}

	const noun = CATEGORY_NOUN[competitor.category];
	return `Getcito is an open-source, self-hostable alternative to ${name}, ${indefiniteArticle(noun)} ${noun} tool. Both measure how AI answer engines describe your brand, but Getcito ships every line of code, runs on your own infrastructure, and is free to self-host — so your data stays yours and each metric is independently verifiable.`;
}

/**
 * Per-competitor FAQ generated from the competitor dataset. The same items are
 * rendered visibly on the page and emitted as FAQPage JSON-LD, so the structured
 * data always matches what a reader (or an AI crawler) sees. Every answer is
 * derived from fields we actually store, so it stays truthful per competitor.
 */
export function getComparisonFaqs(competitor: Competitor): FaqItem[] {
	const name = competitor.name;
	const openSource = isOpenSource(competitor);
	const noun = CATEGORY_NOUN[competitor.category];
	const faqs: FaqItem[] = [];

	faqs.push({
		question: `What is the difference between Getcito and ${name}?`,
		answer: openSource
			? `Both Getcito and ${name} are open source, so you can self-host either one and inspect the code. Getcito focuses specifically on transparent, independently verifiable AI visibility tracking across every major answer engine, with white-label support for agencies and a fully documented methodology behind each number.`
			: `Getcito is an open-source, self-hostable AI visibility platform, while ${name} is a closed-source ${noun} tool. Both track how AI answer engines describe your brand, but Getcito gives you the full source code and runs on your own infrastructure, so you can verify every metric and keep your data in-house.`,
	});

	faqs.push({
		question: `Is Getcito a free, open-source alternative to ${name}?`,
		answer: `Yes. Getcito is a free, open-source alternative to ${name}. You can self-host the full platform at no cost, read every line of code, and track your AI visibility across ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews without per-seat or per-prompt fees.`,
	});

	faqs.push({
		question: `Is ${name} open source?`,
		answer: openSource
			? `Yes, ${name} is open source. Getcito is open source as well and is built specifically for self-hosted, independently verifiable AI visibility tracking, so you can audit exactly how each metric is calculated.`
			: `No, ${name} is a closed-source, hosted product, so you cannot inspect how its metrics are calculated. Getcito is fully open source — you can audit the code, self-host it on your own infrastructure, and avoid vendor lock-in.`,
	});

	faqs.push({
		question: `Can I self-host Getcito instead of ${name}?`,
		answer: `Yes. Getcito is designed to be self-hosted — deploy it on your own infrastructure in minutes with the CLI. You keep full ownership of your data and prompts, with no per-seat pricing and no third-party dashboard holding your visibility history.`,
	});

	return faqs;
}
