import Anthropic from "@anthropic-ai/sdk";
import { anthropic, createAnthropic } from "@ai-sdk/anthropic";
import { generateText, Output } from "ai";
import { extractTextFromAnthropic } from "../../text-extraction";
import type {
	Provider,
	ScrapeResult,
	ProviderOptions,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";
import type { Citation } from "../../text-extraction";

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

async function runAnthropic(prompt: string, model: string, options?: ProviderOptions): Promise<ScrapeResult> {
	const client = getClient();
	const tools: Anthropic.Messages.ToolUnion[] = [];
	if (options?.webSearch) {
		tools.push({
			type: "web_search_20250305",
			name: "web_search",
			max_uses: 1,
		});
	}

	const makeRequest = () => client.messages.create({
		model,
		max_tokens: 4000,
		messages: [{ role: "user", content: prompt }],
		...(tools.length > 0 ? { tools } : {}),
	});

	let response = await makeRequest();

	// Check for web search errors like max_uses_exceeded and retry once
	for (const block of response.content) {
		const b = block as any;
		if (b.type === "web_search_tool_result" && b.content?.type === "web_search_tool_result_error") {
			console.warn(`[anthropic-api] web search error: ${b.content.error_code}, retrying in 10s...`);
			await new Promise((r) => setTimeout(r, 10_000));
			response = await makeRequest();
			break;
		}
	}

	const textContent = extractTextFromAnthropic(response);

	const webQueries = response.content
		.filter((block) => block.type === "server_tool_use" && (block as any).name === "web_search")
		.map((block) => (block as any).input?.query)
		.filter(Boolean);

	const citations = extractAnthropicCitations(response.content);

	// Strip full page text from web search results to reduce storage.
	// Only url/title are used for citation extraction.
	const trimmedContent = response.content.map((block: any) => {
		if (block.type !== "web_search_tool_result" || !Array.isArray(block.content)) return block;
		return {
			...block,
			content: block.content.map((r: any) =>
				r.type === "web_search_result"
					? { type: r.type, url: r.url, title: r.title }
					: r,
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
					} catch (e) { console.warn(`Anthropic: skipping invalid citation URL: ${cit.url}`, e); }
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
					} catch (e) { console.warn(`Anthropic: skipping invalid search result URL: ${result.url}`, e); }
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
		webSearch = true,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		const result = await generateText({
			model: getAnthropicLanguageModel(DEFAULT_RESEARCH_MODEL),
			...(webSearch ? { tools: { web_search: anthropic.tools.webSearch_20250305({ maxUses: 5 }) } } : {}),
			experimental_output: Output.object({ schema }),
			prompt,
		});
		return {
			object: result.experimental_output as T,
			modelVersion: DEFAULT_RESEARCH_MODEL,
		};
	},
};

