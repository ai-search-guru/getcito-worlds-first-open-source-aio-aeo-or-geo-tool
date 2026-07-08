import Olostep from "olostep";
import type { Provider, ScrapeResult, ProviderOptions, ModelConfig } from "../types";
import type { Citation } from "../../text-extraction";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";

const OLOSTEP_PARSERS: Record<string, { parserId: string; urlTemplate: (q: string) => string; credits: number }> = {
	chatgpt: {
		parserId: "@olostep/chatgpt-results",
		urlTemplate: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}`,
		credits: 5,
	},
	"google-ai-mode": {
		parserId: "@olostep/google-aimode-results",
		urlTemplate: (q) => `https://google.com/aimode?q=${encodeURIComponent(q)}`,
		credits: 3,
	},
	"google-ai-overview": {
		parserId: "@olostep/google-ai-overview-results",
		urlTemplate: (q) => `https://www.google.com/search?q=${encodeURIComponent(q)}`,
		credits: 3,
	},
	gemini: {
		parserId: "@olostep/gemini-results",
		urlTemplate: (q) => `https://gemini.google.com/?q=${encodeURIComponent(q)}`,
		credits: 3,
	},
	copilot: {
		parserId: "@olostep/microsoft-copilot-results",
		urlTemplate: (q) => `https://copilot.microsoft.com/chats?q=${encodeURIComponent(q)}`,
		credits: 3,
	},
	perplexity: {
		parserId: "@olostep/perplexity-results",
		urlTemplate: (q) => `https://www.perplexity.ai/?q=${encodeURIComponent(q)}`,
		credits: 3,
	},
	grok: {
		parserId: "@olostep/grok-results",
		urlTemplate: (q) => `https://grok.com/?q=${encodeURIComponent(q)}`,
		credits: 3,
	},
};

let _client: Olostep | null = null;
function getClient(): Olostep {
	if (!_client) {
		_client = new Olostep({ apiKey: process.env.OLOSTEP_API_KEY, retry: { maxRetries: 3, initialDelayMs: 2000 } });
	}
	return _client;
}

function extractTextFromOlostep(data: any): string {
	if (data?.result?.markdown_content) return data.result.markdown_content;
	if (data?.answer_markdown) return data.answer_markdown;
	if (data?.result?.text_content) return data.result.text_content;
	if (typeof data?.answer === "string") return data.answer;
	return "No text content found in Olostep response.";
}

function extractCitationsFromOlostep(data: any): Citation[] {
	const citations: Citation[] = [];
	const sources = data?.sources ?? data?.citations ?? data?.result?.links_on_page ?? data?.inline_references ?? [];
	let idx = 0;
	for (const source of Array.isArray(sources) ? sources : []) {
		const url = typeof source === "string" ? source : source?.url;
		if (!url || typeof url !== "string") continue;
		try {
			const parsed = new URL(url);
			citations.push({
				url,
				title: source?.title ?? source?.label ?? undefined,
				domain: parsed.hostname.replace(/^www\./, ""),
				citationIndex: idx++,
			});
		} catch (e) {
			console.warn(`Olostep: skipping invalid citation URL: ${url}`, e);
		}
	}
	return citations;
}

function extractWebQueries(data: any): string[] {
	const queries: string[] = [];

	// Batch API returns a flat string array at data.search_queries
	const flat = data?.search_queries;
	if (Array.isArray(flat)) {
		for (const q of flat) {
			if (typeof q === "string" && q.trim()) queries.push(q);
		}
	}

	// Scrape API nests queries under network_search_calls or search_model_queries
	if (queries.length === 0) {
		const searchCalls = data?.network_search_calls?.search_queries ?? data?.search_model_queries ?? [];
		for (const call of Array.isArray(searchCalls) ? searchCalls : []) {
			// May be a string (flat array) or an object with .query
			if (typeof call === "string" && call.trim()) queries.push(call);
			else if (call?.query) queries.push(call.query);
		}
	}

	return queries;
}

export const olostep: Provider = {
	id: "olostep",
	name: "Olostep",

	isConfigured() {
		return !!process.env.OLOSTEP_API_KEY;
	},

	validateTarget(config: ModelConfig) {
		if (!OLOSTEP_PARSERS[config.model]) {
			return `Olostep does not support model "${config.model}". Supported: ${Object.keys(OLOSTEP_PARSERS).join(", ")}`;
		}
		if (!config.webSearch) {
			return `${config.model}:olostep requires :online — these chatbots always use web search`;
		}
		return null;
	},

	async run(model: string, prompt: string, _options?: ProviderOptions): Promise<ScrapeResult> {
		const parserConfig = OLOSTEP_PARSERS[model];
		if (!parserConfig) throw new Error(`Olostep does not support model "${model}"`);

		const client = getClient();
		const url = parserConfig.urlTemplate(prompt);

		// Use batch API — the /scrapes endpoint doesn't support all parsers
		const batch = await client.batches.create(
			[{ url, customId: "1" }],
			{ parser: { id: parserConfig.parserId } },
		);

		await batch.waitTillDone({ checkEveryNSecs: 5, timeoutSeconds: 1200 });

		let retrieveId: string | undefined;
		for await (const item of batch.items()) {
			retrieveId = item.retrieve_id;
			break; // single item batch
		}

		if (!retrieveId) throw new Error("Olostep batch completed but no items returned");

		// Use client.retrieve (GET) instead of item.retrieve (POST) — the
		// SDK's BatchItem.retrieve uses POST which the API rejects with 403.
		const retrieved = await client.retrieve(retrieveId, ["json" as any]);

		const jsonContent = retrieved.json_content;
		const parsed =
			typeof jsonContent === "string" ? JSON.parse(jsonContent) : (jsonContent ?? retrieved);

		const webQueries = extractWebQueries(parsed);
		const citations = extractCitationsFromOlostep(parsed);

		return {
			// Store the parsed content directly instead of the full retrieved
			// wrapper (which double-encodes json_content as a string).
			rawOutput: parsed,
			textContent: extractTextFromOlostep(parsed),
			// Mark as "unavailable" only when citations prove a search happened
			// but the API didn't expose the query strings
			webQueries: webQueries.length > 0 ? webQueries : citations.length > 0 ? [WEB_QUERIES_UNAVAILABLE] : [],
			citations,
			modelVersion: parsed?.model ?? undefined,
		};
	},
};
