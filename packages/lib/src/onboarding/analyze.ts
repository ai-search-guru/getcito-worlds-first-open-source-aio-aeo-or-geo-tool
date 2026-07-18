/**
 * Provider-agnostic brand analysis. One direct-API LLM call (with web search
 * where the provider supports it) returns:
 *   - canonical brand name
 *   - additional brand domains (regional ccTLDs, alt spellings)
 *   - aliases (abbreviations, parent company names)
 *   - direct competitors (with their own domains/aliases)
 *   - suggested AI tracking prompts (with default tags)
 *
 * The Zod schema is the source of truth — `generateObject` derives a JSON
 * schema from it and hands it to the model, so the prompt itself only needs
 * to communicate context + quality guidelines, not field-by-field shape.
 */
import { z } from "zod";
import { getWebsiteExcerpt } from "../website-excerpt";
import { runStructuredResearchPrompt, runStructuredCompletionPrompt } from "./llm";
import {
	cleanAndValidateDomain,
	cleanDomain,
	inferBrandNameFromDomain,
	uniqueLowercase,
	uniqueTrim,
} from "./utils";

// Tags are free-form and brand-tailored: the LLM invents a small vocabulary
// (≤5 distinct values) that's actually useful for filtering THIS brand's
// prompts. No tag values are hardcoded here — the LLM picks the entire
// vocabulary from the brand context.
const TAG_GUIDANCE =
	"Tags should be tailored to this specific brand and the prompt set you're producing. Aim for tags that describe WHAT a prompt is about (a product category, audience segment, sub-feature, competitor name) — not WHAT the user wants to do with the answer (compare, evaluate, buy). Goal-style intent tags tend to apply to most prompts in the set and don't discriminate. Prefer single-word tags; only use multi-word tags (lowercase, single hyphens between words) when no single word captures the concept. Each tag should describe ONE axis — don't fuse two ideas into a compound hyphenated label. Don't use 'branded' or 'unbranded' as tag values; the system computes that classification automatically from the prompt text. Pick a small shared vocabulary (no more than 5 distinct values across all prompts), and only attach a tag to a prompt if it actually discriminates that prompt from others — if the same tag would apply to most prompts, don't use it.";

const ALIAS_GUIDANCE =
	"Skip variants that contain the canonical name as a substring (e.g. don't add \"Asics America\" for \"Asics\" — substring matching catches it already). DO include genuinely distinct names like parent companies or sub-brands the company owns (e.g. \"Converse\" for Nike).";

const competitorSchema = z.object({
	name: z.string().describe("Company name"),
	domains: z
		.array(z.string())
		.describe(
			`All domains owned by this company — hostnames only, no protocol, no www, no path (e.g. "example.com"). Include the primary website plus any regional ccTLDs or alternate spellings the company also uses. At least one domain.`,
		),
	aliases: z.array(z.string()).describe(`Other names the company is commonly known by. ${ALIAS_GUIDANCE}`),
});

const promptSchema = z.object({
	prompt: z
		.string()
		.describe(
			'Short search-style fragment, lowercase, under ~12 words. NOT a full sentence — the kind of thing people actually type into ChatGPT.',
		),
	tags: z
		.array(z.string())
		.describe(`1-3 tags per prompt (ideally 1-2), drawn from the shared brand-tailored vocabulary. ${TAG_GUIDANCE}`),
});

function buildSchema(args: { maxCompetitors: number; maxPrompts: number }) {
	return z.object({
		brandName: z
			.string()
			.describe(
				"Canonical brand name in plaintext (preserve casing, but no markdown — no links, no formatting, just the bare name). The brandName must be searchable: it should literally appear inside the website hostname so that mention-detection works. For example, for nike.com use \"Nike\" (not \"Nike, Inc.\"). Don't include legal entity suffixes like \"Inc.\" or \"Ltd.\"",
			),
		shortDescription: z
			.string()
			.describe("A concise 2-3 sentence summary of what the company does"),
		productsAndServices: z
			.array(z.string())
			.describe("List of main products, services, features, or offerings"),
		keywords: z
			.array(z.string())
			.describe("4-5 relevant keywords or phrases representing core business"),
		additionalDomains: z
			.array(z.string())
			.describe(
				"Other public domains the brand owns (regional ccTLDs, alternate spellings, parent-company sites). Hostnames only. Do not include the primary website.",
			),
		aliases: z
			.array(z.string())
			.describe(
				`Other names users use for this brand (abbreviations, parent-company names, common misspellings). ${ALIAS_GUIDANCE}`,
			),
		competitors: z
			.array(competitorSchema)
			.describe(
				`Up to ${args.maxCompetitors} direct competitors that sell similar products to a similar audience. Empty if uncertain.`,
			),
		suggestedPrompts: z
			.array(promptSchema)
			.describe(
				`Up to ${args.maxPrompts} suggested AI tracking prompts. IMPORTANT: the MAJORITY must be UNBRANDED — generic category/persona queries that do NOT contain the brand name (e.g. "best [category]", "best [category] for [persona]", "[category] vs alternatives", "where to buy [category]"). Only 3-5 should be branded (contain the brand name, e.g. "[brand] alternative", "is [brand] worth it"). The goal is to test whether AI models mention the brand organically in response to unbranded queries. ${TAG_GUIDANCE}`,
			),
	});
}

type RawSuggestion = z.infer<ReturnType<typeof buildSchema>>;

export interface OnboardingCompetitor {
	name: string;
	domains: string[];
	aliases: string[];
}

export interface OnboardingPrompt {
	prompt: string;
	tags: string[];
}

export interface OnboardingSuggestion {
	brandName: string;
	shortDescription?: string;
	productsAndServices?: string[];
	keywords?: string[];
	website: string;
	additionalDomains: string[];
	aliases: string[];
	competitors: OnboardingCompetitor[];
	suggestedPrompts: OnboardingPrompt[];
}

export interface AnalyzeBrandOptions {
	website: string;
	brandName?: string;
	/** 0 disables competitor generation entirely. */
	maxCompetitors?: number;
	/** 0 disables prompt generation entirely. */
	maxPrompts?: number;
}

const DEFAULT_MAX_COMPETITORS = 10;
const DEFAULT_MAX_PROMPTS = 10;

/**
 * Resolved inputs for one analysis run: the prompt the LLM sees, the schema
 * its output is validated against, and the post-processing inputs the
 * normalizer needs. Built once and reused across providers in the
 * compare-onboarding script so every provider sees identical input.
 */
export interface AnalysisContext {
	website: string;
	brandNameHint: string;
	prompt: string;
	schema: ReturnType<typeof buildSchema>;
	maxCompetitors: number;
	maxPrompts: number;
}

export async function buildAnalysisContext(options: AnalyzeBrandOptions): Promise<AnalysisContext> {
	const {
		website,
		brandName: providedBrandName,
		maxCompetitors = DEFAULT_MAX_COMPETITORS,
		maxPrompts = DEFAULT_MAX_PROMPTS,
	} = options;

	const normalizedWebsite = cleanDomain(website);
	if (!normalizedWebsite) {
		throw new Error(`Could not parse website "${website}"`);
	}

	const brandNameHint = providedBrandName?.trim() || inferBrandNameFromDomain(normalizedWebsite);
	const websiteExcerpt = await safeGetExcerpt(normalizedWebsite);

	const prompt = buildPrompt({
		website: normalizedWebsite,
		brandNameHint,
		websiteExcerpt,
		includeCompetitors: maxCompetitors > 0,
		includePrompts: maxPrompts > 0,
	});

	return {
		website: normalizedWebsite,
		brandNameHint,
		prompt,
		schema: buildSchema({ maxCompetitors, maxPrompts }),
		maxCompetitors,
		maxPrompts,
	};
}

export function normalizeAnalysisResult(raw: RawSuggestion, ctx: AnalysisContext): OnboardingSuggestion {
	return normalize({
		raw,
		website: ctx.website,
		brandNameHint: ctx.brandNameHint,
		includeCompetitors: ctx.maxCompetitors > 0,
		includePrompts: ctx.maxPrompts > 0,
		maxCompetitors: ctx.maxCompetitors,
		maxPrompts: ctx.maxPrompts,
	});
}

export async function analyzeBrand(options: AnalyzeBrandOptions): Promise<OnboardingSuggestion> {
	const start = Date.now();
	console.log(`[onboarding] analyzeBrand start: ${options.website}`);
	const ctx = await buildAnalysisContext(options);
	
	// The user requested web search to be ON so it can find aliases and additional domains,
	// even though it will take ~15 seconds instead of 3 seconds.
	const raw = await runStructuredResearchPrompt(ctx.prompt, ctx.schema);
	
	const result = normalizeAnalysisResult(raw, ctx);
	console.log(
		`[onboarding] analyzeBrand done: ${options.website} in ${Date.now() - start}ms (brand="${result.brandName}", competitors=${result.competitors.length}, prompts=${result.suggestedPrompts.length})`,
	);
	return result;
}

/** Normalize an LLM-supplied tag to lowercase kebab-case. */
function toKebabCase(tag: string): string {
	return tag
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Drop aliases that contain the canonical name as a substring — mention
 * detection is case-insensitive substring matching, so any text matching
 * such an alias also matches the canonical name. Keeping them just bloats
 * the alias list. (See worker/src/jobs/process-prompt.ts: analyzeMentions.)
 */
function filterRedundantAliases(aliases: string[], canonicalName: string): string[] {
	const canonical = canonicalName.trim().toLowerCase();
	if (!canonical) return aliases;
	return aliases.filter((a) => !a.toLowerCase().includes(canonical));
}

async function safeGetExcerpt(website: string): Promise<string> {
	try {
		return await getWebsiteExcerpt(website);
	} catch (err) {
		console.warn(`[onboarding] website excerpt failed for ${website}:`, err);
		return "";
	}
}

function buildPrompt(args: {
	website: string;
	brandNameHint: string;
	websiteExcerpt: string;
	includeCompetitors: boolean;
	includePrompts: boolean;
}): string {
	const excerptBlock = args.websiteExcerpt
		? `\nText from ${args.website}:\n---\n${args.websiteExcerpt}\n---\n`
		: "\n";

	const skipNotes: string[] = [];
	if (!args.includeCompetitors) skipNotes.push("Return an empty array for competitors.");
	if (!args.includePrompts) skipNotes.push("Return an empty array for suggestedPrompts.");

	return `Analyze the brand at ${args.website}.

Likely brand name (from domain): ${args.brandNameHint}
${excerptBlock}
Use the provided website text and your extensive pre-trained knowledge to identify the brand details. 
You must do your best to fill out the shortDescription, productsAndServices, keywords, additionalDomains, and aliases based on what you know about the brand. For major brands, try to list all known domains and aliases.

You MUST return the structured JSON object. Refusing to produce JSON, or replying with prose explaining what you don't know, is a failure mode.${skipNotes.length > 0 ? `\n\n${skipNotes.join(" ")}` : ""}`;
}

function normalize(args: {
	raw: RawSuggestion;
	website: string;
	brandNameHint: string;
	includeCompetitors: boolean;
	includePrompts: boolean;
	maxCompetitors: number;
	maxPrompts: number;
}): OnboardingSuggestion {
	const { raw, website, brandNameHint, includeCompetitors, includePrompts, maxCompetitors, maxPrompts } = args;

	const brandName = (raw.brandName || brandNameHint).trim() || brandNameHint;

	const ownedDomains = new Set([website]);
	const additionalDomains = (raw.additionalDomains ?? [])
		.map((d) => cleanAndValidateDomain(d))
		.filter((d): d is string => d !== null && d !== website);
	for (const d of additionalDomains) ownedDomains.add(d);

	const dedupedAdditionalDomains = uniqueLowercase(additionalDomains);
	const aliases = filterRedundantAliases(uniqueTrim(raw.aliases ?? []), brandName);

	const competitors: OnboardingCompetitor[] = [];
	if (includeCompetitors) {
		const seenCompetitorDomains = new Set<string>();
		for (const c of raw.competitors ?? []) {
			if (competitors.length >= maxCompetitors) break;
			const cleaned = uniqueLowercase(
				(c.domains ?? [])
					.map((d) => cleanAndValidateDomain(d))
					.filter((d): d is string => d !== null && !ownedDomains.has(d)),
			);
			if (cleaned.length === 0) continue;
			// Dedupe at the competitor level: if any of this competitor's domains
			// already belong to a competitor we kept, skip the whole entry.
			if (cleaned.some((d) => seenCompetitorDomains.has(d))) continue;
			for (const d of cleaned) seenCompetitorDomains.add(d);

			const compName = c.name.trim();
			competitors.push({
				name: compName,
				domains: cleaned,
				aliases: filterRedundantAliases(uniqueTrim(c.aliases ?? []), compName),
			});
		}
	}

	const suggestedPrompts: OnboardingPrompt[] = [];
	if (includePrompts) {
		const seen = new Set<string>();
		for (const p of raw.suggestedPrompts ?? []) {
			if (suggestedPrompts.length >= maxPrompts) break;
			const value = p.prompt.trim().toLowerCase();
			if (!value || seen.has(value)) continue;
			seen.add(value);
			const tags = uniqueLowercase((p.tags ?? []).map(toKebabCase).filter(Boolean)).slice(0, 3);
			suggestedPrompts.push({ prompt: value, tags });
		}
	}

	return {
		brandName,
		shortDescription: raw.shortDescription,
		productsAndServices: raw.productsAndServices,
		keywords: raw.keywords,
		website,
		additionalDomains: dedupedAdditionalDomains,
		aliases,
		competitors,
		suggestedPrompts,
	};
}

// ---------------------------------------------------------------------------
// PART 1: Brand Info Only
// ---------------------------------------------------------------------------

function buildBrandInfoSchema() {
	return z.object({
		brandName: z
			.string()
			.describe(
				"Canonical brand name in plaintext (preserve casing, but no markdown — no links, no formatting, just the bare name). The brandName must be searchable: it should literally appear inside the website hostname so that mention-detection works. For example, for nike.com use \"Nike\" (not \"Nike, Inc.\"). Don't include legal entity suffixes like \"Inc.\" or \"Ltd.\"",
			),
		additionalDomains: z
			.array(z.string())
			.describe(
				"Other public domains the brand owns (regional ccTLDs, alternate spellings, parent-company sites). Hostnames only. Do not include the primary website. Empty if uncertain.",
			),
		aliases: z
			.array(z.string())
			.describe(
				`Other names users use for this brand (abbreviations, parent-company names, common misspellings). ${ALIAS_GUIDANCE} Empty if none are commonly used.`,
			),
	});
}

type RawBrandInfo = z.infer<ReturnType<typeof buildBrandInfoSchema>>;

export interface OnboardingBrandInfo {
	brandName: string;
	website: string;
	additionalDomains: string[];
	aliases: string[];
}

export async function analyzeBrandInfo(options: { website: string; brandName?: string }): Promise<OnboardingBrandInfo> {
	const start = Date.now();
	console.log(`[onboarding] analyzeBrandInfo start: ${options.website}`);

	const normalizedWebsite = cleanDomain(options.website);
	if (!normalizedWebsite) throw new Error(`Could not parse website "${options.website}"`);
	
	const brandNameHint = options.brandName?.trim() || inferBrandNameFromDomain(normalizedWebsite);
	const websiteExcerpt = await safeGetExcerpt(normalizedWebsite);

	const excerptBlock = websiteExcerpt ? `\nText from ${normalizedWebsite}:\n---\n${websiteExcerpt}\n---\n` : "\n";
	const prompt = `Analyze the brand at ${normalizedWebsite}.

Likely brand name (from domain): ${brandNameHint}
${excerptBlock}
Use web search to verify facts about the company's official name and other domains. Never invent information — return empty arrays when uncertain.

You MUST return the structured JSON object — even if you can find nothing about this brand. In that case set brandName to the likely name above and return empty arrays for every other field.`;

	const schema = buildBrandInfoSchema();
	const raw = await runStructuredResearchPrompt(prompt, schema);

	const brandName = (raw.brandName || brandNameHint).trim() || brandNameHint;

	const ownedDomains = new Set([normalizedWebsite]);
	const additionalDomains = (raw.additionalDomains ?? [])
		.map((d) => cleanAndValidateDomain(d))
		.filter((d): d is string => d !== null && d !== normalizedWebsite);
	for (const d of additionalDomains) ownedDomains.add(d);

	const dedupedAdditionalDomains = uniqueLowercase(additionalDomains);
	const aliases = filterRedundantAliases(uniqueTrim(raw.aliases ?? []), brandName);

	console.log(
		`[onboarding] analyzeBrandInfo done: ${options.website} in ${Date.now() - start}ms (brand="${brandName}")`,
	);

	return {
		brandName,
		website: normalizedWebsite,
		additionalDomains: dedupedAdditionalDomains,
		aliases,
	};
}

// ---------------------------------------------------------------------------
// PART 2: Competitors Only
// ---------------------------------------------------------------------------

function buildCompetitorsSchema(maxCompetitors: number) {
	return z.object({
		competitors: z
			.array(competitorSchema)
			.describe(
				`Up to ${maxCompetitors} direct competitors that sell similar products to a similar audience. Empty if uncertain.`,
			),
	});
}

export interface OnboardingCompetitorsInfo {
	competitors: OnboardingCompetitor[];
}

export async function analyzeCompetitors(options: { 
	website: string; 
	brandName: string;
	maxCompetitors?: number;
}): Promise<OnboardingCompetitorsInfo> {
	const start = Date.now();
	console.log(`[onboarding] analyzeCompetitors start: ${options.website}`);

	const maxCompetitors = options.maxCompetitors ?? DEFAULT_MAX_COMPETITORS;
	if (maxCompetitors <= 0) return { competitors: [] };

	const normalizedWebsite = cleanDomain(options.website);
	if (!normalizedWebsite) throw new Error(`Could not parse website "${options.website}"`);
	
	const websiteExcerpt = await safeGetExcerpt(normalizedWebsite);
	const excerptBlock = websiteExcerpt ? `\nText from ${normalizedWebsite}:\n---\n${websiteExcerpt}\n---\n` : "\n";
	
	const prompt = `Analyze the brand "${options.brandName}" at ${normalizedWebsite}.
${excerptBlock}
Identify direct competitors that sell similar products or services. Use web search to verify facts. Never invent information — return an empty array if uncertain.`;

	const schema = buildCompetitorsSchema(maxCompetitors);
	const raw = await runStructuredResearchPrompt(prompt, schema);

	const competitors: OnboardingCompetitor[] = [];
	const ownedDomains = new Set([normalizedWebsite]);
	const seenCompetitorDomains = new Set<string>();
	
	for (const c of raw.competitors ?? []) {
		if (competitors.length >= maxCompetitors) break;
		const cleaned = uniqueLowercase(
			(c.domains ?? [])
				.map((d) => cleanAndValidateDomain(d))
				.filter((d): d is string => d !== null && !ownedDomains.has(d)),
		);
		if (cleaned.length === 0) continue;
		if (cleaned.some((d) => seenCompetitorDomains.has(d))) continue;
		for (const d of cleaned) seenCompetitorDomains.add(d);

		const compName = c.name.trim();
		competitors.push({
			name: compName,
			domains: cleaned,
			aliases: filterRedundantAliases(uniqueTrim(c.aliases ?? []), compName),
		});
	}

	console.log(
		`[onboarding] analyzeCompetitors done: ${options.website} in ${Date.now() - start}ms (found ${competitors.length})`,
	);

	return { competitors };
}

// ---------------------------------------------------------------------------
// PART 3: Prompts Only
// ---------------------------------------------------------------------------

function buildPromptsSchema(maxPrompts: number) {
	return z.object({
		suggestedPrompts: z
			.array(promptSchema)
			.describe(
				`Up to ${maxPrompts} suggested AI tracking prompts. IMPORTANT: the MAJORITY must be UNBRANDED — generic category/persona queries that do NOT contain the brand name (e.g. "best [category]", "best [category] for [persona]", "[category] vs alternatives", "where to buy [category]"). Only 3-5 should be branded (contain the brand name, e.g. "[brand] alternative", "is [brand] worth it"). The goal is to test whether AI models mention the brand organically in response to unbranded queries. ${TAG_GUIDANCE}`,
			),
	});
}

export interface OnboardingPromptsInfo {
	suggestedPrompts: OnboardingPrompt[];
}

export async function analyzePrompts(options: { 
	website: string; 
	brandName: string;
	competitorNames?: string[];
	maxPrompts?: number;
}): Promise<OnboardingPromptsInfo> {
	const start = Date.now();
	console.log(`[onboarding] analyzePrompts start: ${options.website}`);

	const maxPrompts = options.maxPrompts ?? DEFAULT_MAX_PROMPTS;
	if (maxPrompts <= 0) return { suggestedPrompts: [] };

	const normalizedWebsite = cleanDomain(options.website);
	if (!normalizedWebsite) throw new Error(`Could not parse website "${options.website}"`);
	
	const websiteExcerpt = await safeGetExcerpt(normalizedWebsite);
	const excerptBlock = websiteExcerpt ? `\nText from ${normalizedWebsite}:\n---\n${websiteExcerpt}\n---\n` : "\n";
	
	const comps = options.competitorNames?.length ? `Known competitors: ${options.competitorNames.join(", ")}` : "";

	const prompt = `Analyze the brand "${options.brandName}" at ${normalizedWebsite}.
${excerptBlock}
${comps}

Identify a starter set of AI tracking prompts to monitor this brand's visibility in LLM outputs. Use web search to verify facts.`;

	const schema = buildPromptsSchema(maxPrompts);
	const raw = await runStructuredResearchPrompt(prompt, schema);

	const suggestedPrompts: OnboardingPrompt[] = [];
	const seen = new Set<string>();
	
	for (const p of raw.suggestedPrompts ?? []) {
		if (suggestedPrompts.length >= maxPrompts) break;
		const value = p.prompt.trim().toLowerCase();
		if (!value || seen.has(value)) continue;
		seen.add(value);
		const tags = uniqueLowercase((p.tags ?? []).map(toKebabCase).filter(Boolean)).slice(0, 3);
		suggestedPrompts.push({ prompt: value, tags });
	}

	console.log(
		`[onboarding] analyzePrompts done: ${options.website} in ${Date.now() - start}ms (found ${suggestedPrompts.length})`,
	);

	return { suggestedPrompts };
}
