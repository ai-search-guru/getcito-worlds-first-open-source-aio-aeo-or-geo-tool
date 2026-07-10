import type { Provider, ScrapeResult, ProviderOptions, ModelConfig } from "../types";
import {
	extractTextFromOxylabs,
	extractCitationsFromOxylabs,
	type Citation,
} from "../../text-extraction";

// Oxylabs Web Scraper API sources for AI surfaces.
// ChatGPT and Perplexity use `prompt`; Google AI Mode uses `query` and requires `render: html`.
const OXYLABS_SOURCES: Record<
	string,
	{ source: string; field: "prompt" | "query"; render?: string }
> = {
	chatgpt: { source: "chatgpt", field: "prompt" },
	perplexity: { source: "perplexity", field: "prompt" },
	"google-ai-mode": { source: "google_ai_mode", field: "query", render: "html" },
};

const OXYLABS_REALTIME_URL = "https://realtime.oxylabs.io/v1/queries";

function basicAuthHeader(): string {
	const token = btoa(`${process.env.OXYLABS_USERNAME}:${process.env.OXYLABS_PASSWORD}`);
	return `Basic ${token}`;
}

function extractWebQueries(content: Record<string, any>): string[] {
	// Oxylabs exposes search queries under different keys depending on the source.
	for (const key of ["search_queries", "related_queries", "web_search_queries"]) {
		const arr = content[key];
		if (Array.isArray(arr)) {
			const queries = arr.filter((q: any) => typeof q === "string" && q.trim());
			if (queries.length > 0) return queries;
		}
	}
	return [];
}

export const oxylabs: Provider = {
	id: "oxylabs",
	name: "Oxylabs",

	isConfigured() {
		return !!process.env.OXYLABS_USERNAME && !!process.env.OXYLABS_PASSWORD;
	},

	validateTarget(config: ModelConfig) {
		if (!OXYLABS_SOURCES[config.model]) {
			return `Oxylabs does not support model "${config.model}". Supported: ${Object.keys(OXYLABS_SOURCES).join(", ")}`;
		}
		// ChatGPT has a web search toggle; Perplexity and Google AI Mode always search.
		if (!config.webSearch && config.model !== "chatgpt") {
			return `${config.model}:oxylabs requires :online — this chatbot always uses web search`;
		}
		return null;
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const sourceConfig = OXYLABS_SOURCES[model];
		if (!sourceConfig) {
			throw new Error(
				`Oxylabs: no source mapping for model "${model}". ` +
				`Supported: ${Object.keys(OXYLABS_SOURCES).join(", ")}`,
			);
		}

		const body: Record<string, any> = {
			source: sourceConfig.source,
			[sourceConfig.field]: prompt,
			parse: true,
		};
		if (sourceConfig.render) body.render = sourceConfig.render;
		// ChatGPT's `search` flag toggles in-product web search. Other sources
		// always search, so we don't send the flag for them.
		if (model === "chatgpt") body.search = options?.webSearch ?? false;

		const res = await fetch(OXYLABS_REALTIME_URL, {
			method: "POST",
			headers: {
				Authorization: basicAuthHeader(),
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		});

		if (!res.ok) {
			throw new Error(`Oxylabs realtime query failed (${res.status}): ${await res.text()}`);
		}

		const payload = (await res.json()) as {
			results?: Array<{ content?: Record<string, any> }>;
		};
		const content = payload.results?.[0]?.content ?? {};

		const textContent = extractTextFromOxylabs(payload);
		const citations: Citation[] = extractCitationsFromOxylabs(payload);
		const webQueries = extractWebQueries(content);

		return {
			rawOutput: payload,
			textContent,
			// When ChatGPT web search is disabled, no queries are expected.
			// Otherwise expose the queries Oxylabs surfaced, or mark "unavailable"
			// when citations prove a search happened but no queries were exposed.
			webQueries:
				model === "chatgpt" && !options?.webSearch
					? []
					: webQueries.length > 0
						? webQueries
						: citations.length > 0
							? ["unavailable"]
							: [],
			citations,
			modelVersion:
				typeof content.llm_model === "string"
					? content.llm_model
					: typeof content.model === "string"
						? content.model
						: undefined,
		};
	},
};
