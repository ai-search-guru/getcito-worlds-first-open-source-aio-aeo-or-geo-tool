import type { FaqItem } from "@/lib/faqs";
import { competitors, getComparisonSlug, getPopularityRank } from "./data";
import { CATEGORY_NOUN, indefiniteArticle, isOpenSource } from "./content";
import {
	Getcito_FEATURES,
	FEATURE_CATEGORIES,
	CATEGORY_LABELS,
	getFeatureLabel,
	getFeatureDescription,
	isLowDR,
	type Competitor,
	type CompetitorCategory,
	type FeatureKey,
} from "./types";

// ---------------------------------------------------------------------------
// Selection helpers
// ---------------------------------------------------------------------------

/**
 * The indexed, market-relevant set. Mirrors the filter used by the sitemap and
 * the directory index so the programmatic sub-pages never surface a tool we've
 * decided not to index (shutting down, off-topic, or no real market presence).
 */
export function isIndexed(c: Competitor): boolean {
	return (
		c.status !== "shutting-down" && c.category !== "other" && !isLowDR(c)
	);
}

export const indexedCompetitors: Competitor[] = competitors.filter(isIndexed);

const byPopularity = (a: Competitor, b: Competitor) =>
	getPopularityRank(a) - getPopularityRank(b);

/**
 * Up to `limit` alternatives to `competitor`: same category first (sorted by
 * popularity), then the most prominent trackers from other categories to fill
 * the list out. Excludes the tool itself and anything we don't index.
 */
export function getAlternatives(competitor: Competitor, limit = 6): Competitor[] {
	const sameCategory = indexedCompetitors
		.filter((c) => c.slug !== competitor.slug && c.category === competitor.category)
		.sort(byPopularity);
	if (sameCategory.length >= limit) return sameCategory.slice(0, limit);

	const backfill = indexedCompetitors
		.filter((c) => c.slug !== competitor.slug && c.category !== competitor.category)
		.sort(byPopularity);
	return [...sameCategory, ...backfill].slice(0, limit);
}

// --- Competitor-vs-competitor pairs (allowlisted to six funded leaders) ------

const COMPARE_SLUGS = [
	"profound",
	"peec-ai",
	"airops",
	"scrunch",
	"otterly-ai",
	"athenahq",
] as const;

export const comparePairCompetitors: Competitor[] = COMPARE_SLUGS.map((slug) =>
	competitors.find((c) => c.slug === slug),
).filter((c): c is Competitor => Boolean(c));

/** Every unordered pair of the allowlisted tools, more-popular tool first. */
export const comparePairs: [Competitor, Competitor][] = (() => {
	const sorted = [...comparePairCompetitors].sort(byPopularity);
	const pairs: [Competitor, Competitor][] = [];
	for (let i = 0; i < sorted.length; i++) {
		for (let j = i + 1; j < sorted.length; j++) {
			pairs.push([sorted[i], sorted[j]]);
		}
	}
	return pairs;
})();

export function comparePairSlug(a: Competitor, b: Competitor): string {
	return `${a.slug}-vs-${b.slug}`;
}

const pairBySlug = new Map<string, [Competitor, Competitor]>(
	comparePairs.map((pair) => [comparePairSlug(pair[0], pair[1]), pair]),
);

export function getComparePair(slug: string): [Competitor, Competitor] | undefined {
	return pairBySlug.get(slug);
}

// --- Feature slices ----------------------------------------------------------

/** Clean URL slugs for each feature key. */
export const FEATURE_SLUGS: Record<FeatureKey, string> = {
	multiLlmTracking: "multi-llm-tracking",
	visibilityScore: "visibility-score",
	citationAnalytics: "citation-analytics",
	competitorBenchmarking: "competitor-benchmarking",
	brandMentionTracking: "brand-mention-tracking",
	promptVolumeEstimates: "prompt-volume-estimates",
	sentimentAnalysis: "sentiment-analysis",
	crawlerAnalytics: "ai-crawler-analytics",
	geographicTracking: "geographic-tracking",
	socialMediaTracking: "social-media-tracking",
	shoppingTracking: "shopping-tracking",
	multiLanguage: "multi-language",
	actionRecommendations: "action-recommendations",
	contentGapAnalysis: "content-gap-analysis",
	siteAudits: "site-audits",
	keywordResearch: "ai-keyword-research",
	emailAlerts: "email-alerts",
	dataExportApi: "data-export-api",
	biConnectors: "bi-connectors",
	whiteLabelAgency: "white-label",
	openSource: "open-source",
	contentGeneration: "content-generation",
};

const featureKeyBySlug = new Map<string, FeatureKey>(
	(Object.entries(FEATURE_SLUGS) as [FeatureKey, string][]).map(([key, slug]) => [
		slug,
		key,
	]),
);

export function getFeatureKeyBySlug(slug: string): FeatureKey | undefined {
	return featureKeyBySlug.get(slug);
}

/** Indexed tools that have a given feature, most popular first. */
export function toolsWithFeature(key: FeatureKey): Competitor[] {
	return indexedCompetitors
		.filter((c) => c.features[key] === true)
		.sort(byPopularity);
}

/**
 * Feature slices worth publishing. We skip a slice when too few indexed tools
 * have the feature — a near-empty "tools with X" page is thin by definition.
 */
export const MIN_TOOLS_FOR_FEATURE_PAGE = 4;

export function indexableFeatureKeys(): FeatureKey[] {
	return (Object.keys(FEATURE_SLUGS) as FeatureKey[]).filter(
		(key) => toolsWithFeature(key).length >= MIN_TOOLS_FOR_FEATURE_PAGE,
	);
}

// --- Category slices ---------------------------------------------------------

export const CATEGORY_SLUGS: Partial<Record<CompetitorCategory, string>> = {
	tracking: "tracking",
	content: "content-generation",
	"api-developer": "api",
	ecommerce: "ecommerce",
	"seo-traditional": "seo",
	"open-source": "open-source",
};

/** Reader-friendly H1/title phrasing per category (better than the bare label). */
export const CATEGORY_HEADINGS: Record<CompetitorCategory, string> = {
	tracking: "AI visibility tracking tools",
	content: "AI content optimization tools",
	"api-developer": "AI visibility APIs for developers",
	ecommerce: "AI visibility tools for e-commerce",
	"seo-traditional": "SEO platforms with AI search tracking",
	"open-source": "Open-source AI visibility tools",
	other: "AI visibility tools",
};

const categoryBySlug = new Map<string, CompetitorCategory>(
	(Object.entries(CATEGORY_SLUGS) as [CompetitorCategory, string][]).map(
		([cat, slug]) => [slug, cat],
	),
);

export function getCategoryBySlug(slug: string): CompetitorCategory | undefined {
	return categoryBySlug.get(slug);
}

export function toolsInCategory(category: CompetitorCategory): Competitor[] {
	return indexedCompetitors
		.filter((c) => c.category === category)
		.sort(byPopularity);
}

export const indexableCategories = (
	Object.keys(CATEGORY_SLUGS) as CompetitorCategory[]
).filter((cat) => toolsInCategory(cat).length >= 2);

/**
 * Every open-source tool we track, most popular first. Unlike the other slices
 * this intentionally includes low-DR projects: the open-source space is small
 * and early, and a page about it should show the real (if niche) options rather
 * than hide them behind the usual market-presence gate. Shut-down tools are
 * still excluded.
 */
export function openSourceTools(): Competitor[] {
	return competitors
		.filter((c) => c.status !== "shutting-down" && isOpenSource(c))
		.sort(byPopularity);
}

// ---------------------------------------------------------------------------
// Prose helpers (kept humanizer-clean: no em dashes, varied rhythm, only
// claims that come from fields we actually store)
// ---------------------------------------------------------------------------

function formatList(names: string[], max = 3, more = true): string {
	const shown = names.slice(0, max);
	const extra = names.length - shown.length;
	let joined: string;
	if (shown.length <= 1) joined = shown[0] ?? "";
	else if (shown.length === 2) joined = `${shown[0]} and ${shown[1]}`;
	else joined = `${shown.slice(0, -1).join(", ")}, and ${shown[shown.length - 1]}`;
	if (more && extra > 0) return `${joined}, plus ${extra} more`;
	return joined;
}

function featuresOf(c: Competitor): Set<FeatureKey> {
	const set = new Set<FeatureKey>();
	for (const key of Object.keys(FEATURE_SLUGS) as FeatureKey[]) {
		if (c.features[key]) set.add(key);
	}
	return set;
}

/** Labels a has that b lacks. */
function featureGap(a: Competitor, b: Competitor): string[] {
	const bs = featuresOf(b);
	return [...featuresOf(a)]
		.filter((k) => !bs.has(k))
		.map((k) => getFeatureLabel(k));
}

const CATEGORY_BLURB: Record<CompetitorCategory, string> = {
	tracking:
		"Tracking how AI engines mention and cite your brand is the whole product here, not a feature bolted onto something larger.",
	content:
		"These lead with content. They generate or rewrite pages for AI consumption, and most layer visibility tracking on top.",
	"api-developer":
		"These are API-first. You pull AI search and citation data into your own product or dashboards instead of logging into theirs.",
	ecommerce:
		"These focus on products: whether AI shopping answers and buying-guide queries surface your catalog.",
	"seo-traditional":
		"These are established SEO platforms that added AI search tracking to an existing rank-tracking suite.",
	"open-source":
		"These are open source. You can read the code, self-host, and check how each number is produced.",
	other: "These tools sit adjacent to AI visibility tracking.",
};

// --- Alternatives ------------------------------------------------------------

export function getAlternativesVerdict(c: Competitor): string {
	const noun = CATEGORY_NOUN[c.category];
	const article = indefiniteArticle(noun);
	const open = isOpenSource(c);
	if (open) {
		return `${c.name} is ${article} open-source ${noun} tool, so you can already self-host and read the code. If you also want transparent, independently verifiable tracking across ChatGPT, Claude, Perplexity, and Google AI Overviews, with white-label support for agencies, Getcito is the closest open-source alternative.`;
	}
	return `${c.name} is ${article} ${noun} tool, and like most of the field it is closed-source and hosted. The strongest alternative depends on the engines you track and your budget, but if you want to own your data, Getcito is the open-source option: self-host it for free and audit exactly how every metric is built.`;
}

export function getAlternativesFaqs(c: Competitor, alts: Competitor[]): FaqItem[] {
	const names = alts.map((a) => a.name);
	const open = isOpenSource(c);
	return [
		{
			question: `What are the best alternatives to ${c.name}?`,
			answer: `The closest alternatives to ${c.name} are other ${CATEGORY_LABELS[c.category].toLowerCase()} tools such as ${formatList(names)}. Getcito is the open-source pick: you self-host it for free and track how every major AI answer engine mentions and cites your brand.`,
		},
		{
			question: `Is there a free alternative to ${c.name}?`,
			answer: `Yes. Getcito is free and open source to self-host. There is no license fee and no per-seat pricing, so you only pay for your own infrastructure and the AI provider keys you choose to use.`,
		},
		{
			question: `Is there an open-source alternative to ${c.name}?`,
			answer: open
				? `${c.name} is itself open source, and so is Getcito. Getcito is built specifically for self-hosted, independently verifiable AI visibility tracking, so you can audit how each metric is calculated and run it on your own infrastructure.`
				: `Yes. Getcito is an open-source, self-hostable AI visibility platform. You can read every line of code, run it on your own infrastructure, and verify each metric, which a closed product like ${c.name} cannot offer.`,
		},
		{
			question: `Why switch from ${c.name} to Getcito?`,
			answer: `The main reasons are ownership and transparency. With Getcito you keep your prompts and visibility history in-house, avoid vendor lock-in, and can see exactly how scores are computed. The self-hosted core is free, with a managed cloud option on the way.`,
		},
	];
}

// --- Competitor-vs-competitor pairs ------------------------------------------

export function getPairVerdict(a: Competitor, b: Competitor): string {
	const sameCat = a.category === b.category;
	const clause = sameCat
		? `${CATEGORY_NOUN[a.category]} tools`
		: "AI visibility tools";
	return `${a.name} and ${b.name} are both ${clause} that measure how AI answer engines describe your brand. ${a.name} is pitched as "${a.tagline}". ${b.name} leans on "${b.tagline}". Both are closed and hosted, so neither lets you see how its scores are built. Getcito tracks the same engines as an open-source tool you run yourself, which makes it the third option worth weighing here.`;
}

export function getPairFaqs(a: Competitor, b: Competitor): FaqItem[] {
	const aGap = featureGap(a, b);
	const bGap = featureGap(b, a);

	const overlap =
		a.category === b.category
			? `${a.name} and ${b.name} are both ${CATEGORY_NOUN[a.category]} tools, so they overlap on the core job of measuring how AI answer engines mention and cite your brand.`
			: `${a.name} is ${indefiniteArticle(CATEGORY_NOUN[a.category])} ${CATEGORY_NOUN[a.category]} tool, while ${b.name} is ${indefiniteArticle(CATEGORY_NOUN[b.category])} ${CATEGORY_NOUN[b.category]} tool, so they come at AI visibility from different angles.`;

	// Name a couple of distinguishing capabilities per side, drawn from the
	// feature matrix. No pricing: we don't track reliable current prices.
	const featureBits: string[] = [];
	if (aGap.length)
		featureBits.push(`${a.name} stands out for ${formatList(aGap, 2, false)}`);
	if (bGap.length) featureBits.push(`${b.name} adds ${formatList(bGap, 2, false)}`);
	const featureSentence = featureBits.length
		? ` On features, ${featureBits.join(", while ")}.`
		: "";

	return [
		{
			question: `What is the difference between ${a.name} and ${b.name}?`,
			answer: `${overlap}${featureSentence} Both are closed-source and hosted.`,
		},
		{
			question: `Is ${a.name} or ${b.name} better for AI visibility tracking?`,
			answer: `Neither is simply better; it depends on your priorities. Both track how AI engines mention and cite your brand across the major models, so the decision comes down to which feature set and workflow suit your team. Since both are proprietary and hosted, it is also worth trying an open-source option like Getcito, which you can self-host and audit before committing.`,
		},
		{
			question: `Is there an open-source alternative to ${a.name} and ${b.name}?`,
			answer: `Yes. Getcito is an open-source AI visibility platform you can self-host for free. It tracks mentions, citations, and competitor share across ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews, and every metric is auditable in the code.`,
		},
	];
}

// --- Feature slices ----------------------------------------------------------

export function getFeatureVerdict(key: FeatureKey, tools: Competitor[]): string {
	const label = getFeatureLabel(key).toLowerCase();
	const desc = getFeatureDescription(key);
	const names = tools.map((t) => t.name);
	const GetcitoHas = Getcito_FEATURES[key] === true;
	const GetcitoLine = GetcitoHas
		? `Getcito includes it too, as an open-source tool you can self-host for free.`
		: `Getcito concentrates on core, verifiable tracking and does not include this, so if it is essential the tools below are the better fit.`;
	return `${tools.length} of the AI visibility tools we track offer ${label}, including ${formatList(names)}. ${desc}. ${GetcitoLine}`;
}

export function getFeatureFaqs(key: FeatureKey, tools: Competitor[]): FaqItem[] {
	const label = getFeatureLabel(key);
	const names = tools.map((t) => t.name);
	const GetcitoHas = Getcito_FEATURES[key] === true;
	return [
		{
			question: `Which AI visibility tools offer ${label.toLowerCase()}?`,
			answer: `${formatList(names, 5)} all offer ${label.toLowerCase()}. The full feature matrix on this page shows how each one compares.`,
		},
		{
			question: `What is ${label.toLowerCase()} in AI visibility tools?`,
			answer: `${getFeatureDescription(key)}. It is one of the capabilities buyers weigh when choosing an AI visibility or answer engine optimization tool.`,
		},
		{
			question: `Does Getcito support ${label.toLowerCase()}?`,
			answer: GetcitoHas
				? `Yes. Getcito supports ${label.toLowerCase()}, and because it is open source you can verify exactly how it works and self-host it for free.`
				: `Not currently. Getcito focuses on transparent, independently verifiable tracking of mentions, citations, and competitor share. If ${label.toLowerCase()} is a hard requirement, the tools listed here cover it.`,
		},
	];
}

// --- Category slices ---------------------------------------------------------

export function getCategoryVerdict(
	category: CompetitorCategory,
	tools: Competitor[],
): string {
	const names = tools.map((t) => t.name);
	return `The ${CATEGORY_LABELS[category].toLowerCase()} category covers ${tools.length} of the tools we track, including ${formatList(names)}. ${CATEGORY_BLURB[category]} Getcito is the open-source option in this space: self-host it for free and audit how every number is built.`;
}

export function getCategoryFaqs(
	category: CompetitorCategory,
	tools: Competitor[],
): FaqItem[] {
	const names = tools.map((t) => t.name);
	const label = CATEGORY_LABELS[category].toLowerCase();
	return [
		{
			question: `What are the best ${label} tools for AI visibility?`,
			answer: `Tools in the ${label} category include ${formatList(names, 5)}. This page compares them feature by feature so you can match one to your needs.`,
		},
		{
			question: `Is there an open-source ${label} tool?`,
			answer: `Getcito is an open-source AI visibility platform you can self-host for free. It tracks how ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews mention and cite your brand, with every metric open to inspection.`,
		},
	];
}

/**
 * Category-tailored pitch for the "Getcito: the open-source alternative" banner.
 * Each one frames Getcito against what that category actually leads with, so the
 * CTA reads as specific to the page rather than a generic blurb.
 */
const CATEGORY_Getcito_PITCH: Record<CompetitorCategory, string> = {
	tracking:
		"Getcito does the same core job as the tools on this page: it measures how AI engines mention and cite your brand. The difference is that it is open source. You can self-host it for free, keep your prompts and history on your own infrastructure, and check exactly how each score is built instead of trusting a number from a closed dashboard.",
	content:
		"Most tools in this category lead with content generation. Getcito takes a narrower path and focuses on transparent tracking, so you can measure how AI engines mention and cite your brand before you decide what to publish. It is open source and self-hosted, with no per-seat fees and no scores you cannot inspect.",
	"api-developer":
		"The tools here are API-first. Getcito gives you the data and the code: self-host the whole platform, read how every metric is produced, and pull mentions and citations into your own dashboards without paying per call or depending on a pipeline you cannot see.",
	ecommerce:
		"Getcito tracks how ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews describe your brand across the major engines. It is the open-source choice in this space, so you run it yourself for free and verify every number rather than trusting a hosted score.",
	"seo-traditional":
		"The platforms in this category bolted AI search tracking onto an existing SEO suite. Getcito was built for the AI layer from the start, and it is open source, so you can self-host it for free and confirm how each visibility metric is calculated instead of taking a bundled feature on faith.",
	"open-source":
		"Like the other projects here, Getcito is open source, so you can read the code and run it yourself. It is built specifically for verifiable AI visibility tracking across ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews, and it adds white-label support for agencies with no per-seat pricing.",
	other:
		"Getcito is the open-source AI visibility platform in this directory. Self-host it for free, keep your data in-house, and verify how it tracks the way AI engines mention and cite your brand.",
};

export function getCategoryGetcitoPitch(category: CompetitorCategory): string {
	return CATEGORY_Getcito_PITCH[category];
}
