import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import Anthropic from "@anthropic-ai/sdk";
import { generateText, Output } from "ai";
import type { Citation } from "../../text-extraction";
import { extractTextFromAnthropic } from "../../text-extraction";
import { localeCountryCode, localeSystemPrompt } from "../locale";
import type {
	Provider,
	ProviderOptions,
	ScrapeResult,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";

const DEFAULT_RESEARCH_MODEL = "claude-sonnet-4-6";

function getAnthropicLanguageModel(model: string) {
	return process.env.ANTHROPIC_API_KEY
		? createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })(model)
		: anthropic(model);
}

function sanitizeForJson(obj: unknown): unknown {
	return JSON.parse(JSON.stringify(obj));
}

function getClient(): Anthropic {
	return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

/** Set once the workspace rejects web_search, so the rest of the run doesn't
 *  pay a doomed 400 on every single call. Time-boxed rather than permanent: a
 *  single rejection used to cost every later run in the process its citations,
 *  and enabling the tool in the Console then needed a worker restart to matter. */
const WEB_SEARCH_RETRY_AFTER_MS = 10 * 60 * 1000;
let webSearchDisabledUntil = 0;

/** Ceiling on web searches per run. Each search is billed, so this trades cost
 *  for fan-out breadth; 5 is enough for a comparison-style prompt. */
const MAX_WEB_SEARCHES = 5;

async function runAnthropic(prompt: string, model: string, options?: ProviderOptions): Promise<ScrapeResult> {
	const client = getClient();
	const tools: Anthropic.Messages.ToolUnion[] = [];
	if (options?.webSearch && Date.now() >= webSearchDisabledUntil) {
		// Same reason as openai-api: without user_location the tool searches from
		// the caller's IP, not the brand's target market.
		const country = localeCountryCode(options);
		tools.push({
			type: "web_search_20250305",
			name: "web_search",
			// The query fan-out we report is literally the set of searches the model
			// chose to run, so a cap of 1 makes fan-out impossible by construction.
			// This is an upper bound, not a target — Claude stops when it has enough.
			max_uses: MAX_WEB_SEARCHES,
			...(country ? { user_location: { type: "approximate" as const, country } } : {}),
		});
	}

	// A run with the tool suppressed answers from training data: no citations, no
	// query fan-out, stale brand lists. That is indistinguishable from a working
	// run in the stored output, so say it out loud.
	if (options?.webSearch && tools.length === 0) {
		console.warn(`[anthropic-api] web_search suppressed for ${model} — this run will have no citations or fan-out`);
	}

	const system = localeSystemPrompt(options);

	const makeRequest = (includeTools: boolean) =>
		client.messages.create({
			model,
			max_tokens: 4000,
			messages: [{ role: "user", content: prompt }],
			...(system ? { system } : {}),
			...(includeTools && tools.length > 0 ? { tools } : {}),
		});

	let response: Anthropic.Messages.Message;
	try {
		response = await makeRequest(true);
	} catch (err) {
		// Not every Anthropic workspace has the web_search tool enabled — it 400s
		// with "web_search not supported in your workspace". Degrade to a no-tool
		// request so the run still yields (visibility) data instead of failing.
		const msg = err instanceof Error ? err.message : String(err);
		if (tools.length > 0 && /web_search/i.test(msg)) {
			if (/not supported in your workspace/i.test(msg)) {
				webSearchDisabledUntil = Date.now() + WEB_SEARCH_RETRY_AFTER_MS;
				console.warn(
					`[anthropic-api] web_search is disabled for this workspace — Claude runs will have no citations for the next ${WEB_SEARCH_RETRY_AFTER_MS / 60_000} minutes`,
				);
			}
			console.warn(`[anthropic-api] web_search unavailable, retrying without it: ${msg}`);
			response = await makeRequest(false);
		} else {
			throw err;
		}
	}

	// Check for web search errors like max_uses_exceeded and retry once
	for (const block of response.content) {
		const b = block as any;
		if (b.type === "web_search_tool_result" && b.content?.type === "web_search_tool_result_error") {
			console.warn(`[anthropic-api] web search error: ${b.content.error_code}, retrying in 10s...`);
			await new Promise((r) => setTimeout(r, 10_000));
			response = await makeRequest(true);
			break;
		}
	}

	const textContent = extractTextFromAnthropic(response);

	const webQueries = response.content
		.filter((block) => block.type === "server_tool_use" && (block as any).name === "web_search")
		.map((block) => (block as any).input?.query)
		.filter(Boolean);

	// The other half of the empty-fan-out diagnosis: the tool went out and Claude
	// simply decided the prompt needed no search. Nothing to fix in code when this
	// fires — it means the prompt reads as answerable from memory.
	if (tools.length > 0 && webQueries.length === 0) {
		console.warn(`[anthropic-api] ${model} ran no web searches despite the tool being offered`);
	}

	const citations = extractAnthropicCitations(response.content);

	// Strip full page text from web search results to reduce storage.
	// Only url/title are used for citation extraction.
	const trimmedContent = response.content.map((block: any) => {
		if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) return block;
		return {
			...block,
			content: block.content.map((r: any) =>
				r.type === "web_search_result" ? { type: r.type, url: r.url, title: r.title } : r,
			),
		};
	});

	return {
		rawOutput: sanitizeForJson({ ...response, content: trimmedContent }),
		webQueries,
		textContent,
		citations,
		modelVersion: model,
	};
}

function extractAnthropicCitations(content: Anthropic.Messages.ContentBlock[]): Citation[] {
	const seen = new Set<string>();
	const citations: Citation[] = [];
	let idx = 0;

	for (const block of content) {
		// Citations from text blocks
		if (block.type === "text") {
			for (const cit of Array.isArray((block as any).citations) ? (block as any).citations : []) {
				if (cit.type === "web_search_result_location" && cit.url) {
					if (seen.has(cit.url)) continue;
					seen.add(cit.url);
					try {
						const parsed = new URL(cit.url);
						citations.push({
							url: cit.url,
							title: cit.title ?? undefined,
							domain: parsed.hostname.replace(/^www\./, ""),
							citationIndex: idx++,
						});
					} catch (e) {
						console.warn(`Anthropic: skipping invalid citation URL: ${cit.url}`, e);
					}
				}
			}
		}
		// Citations from web search results
		if (block.type === "web_search_tool_result") {
			for (const result of Array.isArray((block as any).content) ? (block as any).content : []) {
				if (result.type === "web_search_result" && result.url) {
					if (seen.has(result.url)) continue;
					seen.add(result.url);
					try {
						const parsed = new URL(result.url);
						citations.push({
							url: result.url,
							title: result.title ?? undefined,
							domain: parsed.hostname.replace(/^www\./, ""),
							citationIndex: idx++,
						});
					} catch (e) {
						console.warn(`Anthropic: skipping invalid search result URL: ${result.url}`, e);
					}
				}
			}
		}
	}

	return citations;
}

export const anthropicApi: Provider = {
	id: "anthropic-api",
	name: "Anthropic API",

	isConfigured() {
		return !!process.env.ANTHROPIC_API_KEY;
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const version = options?.version ?? DEFAULT_RESEARCH_MODEL;
		return runAnthropic(prompt, version, options);
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
		version,
		webSearch = true,
		targetMarket,
		targetLanguage,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		const targetModel = version ?? DEFAULT_RESEARCH_MODEL;
		const locale = { targetMarket, targetLanguage };
		const system = localeSystemPrompt(locale);
		const country = localeCountryCode(locale);
		const result = await generateText({
			model: getAnthropicLanguageModel(targetModel),
			...(webSearch
				? {
						tools: {
							web_search: anthropic.tools.webSearch_20250305({
								maxUses: 5,
								// Same reason as run(): without user_location the tool searches
								// from the caller's IP, not the brand's target market.
								...(country ? { userLocation: { type: "approximate" as const, country } } : {}),
							}),
						},
					}
				: {}),
			...(system ? { system } : {}),
			experimental_output: Output.object({ schema }),
			prompt,
		});
		return {
			object: result.experimental_output as T,
			modelVersion: targetModel,
		};
	},
};
