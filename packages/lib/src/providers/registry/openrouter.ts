import { z } from "zod";
import type {
	Provider,
	ScrapeResult,
	ProviderOptions,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";
import type { Citation } from "../../text-extraction";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_API_URL = `${OPENROUTER_BASE_URL}/chat/completions`;
// Default to GPT-5 Mini via OpenRouter — supports OpenRouter's *native*
// web-search plugin (vs the Exa fallback) and produced the best brand-info
// recall + cheapest cost in our compare-onboarding runs. Other families that
// support native search per the docs: Anthropic, Perplexity, xAI.
const DEFAULT_RESEARCH_MODEL = "openai/gpt-5-mini";

function openrouterHeaders(): Record<string, string> {
	return {
		Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
		"Content-Type": "application/json",
		"HTTP-Referer": process.env.APP_URL ?? "https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool",
		"X-Title": "Getcito AEO",
	};
}

function extractTextFromOpenRouterResponse(data: any): string {
	if (data?.choices?.[0]?.message?.content) return data.choices[0].message.content;
	if (data?.output) {
		const msgs = Array.isArray(data.output) ? data.output.filter((i: any) => i.type === "message") : [];
		const texts: string[] = [];
		for (const msg of msgs) {
			for (const c of msg.content ?? []) {
				if (c.type === "output_text" && c.text) texts.push(c.text);
			}
		}
		if (texts.length) return texts.join("\n");
	}
	return "No text content found in OpenRouter response.";
}

function extractCitationsFromOpenRouterResponse(data: any): Citation[] {
	const citations: Citation[] = [];
	let idx = 0;
	const seen = new Set<string>();
	const annotations = data?.choices?.[0]?.message?.annotations ?? [];
	for (const ann of annotations) {
		if (ann?.type !== "url_citation") continue;
		// OpenRouter nests citation data under url_citation, but also support flat layout
		const cite = ann.url_citation ?? ann;
		const url = cite.url;
		if (!url || typeof url !== "string" || !url.startsWith("http")) continue;
		if (seen.has(url)) continue;
		seen.add(url);
		try {
			const parsed = new URL(url);
			citations.push({
				url,
				title: cite.title ?? undefined,
				domain: parsed.hostname.replace(/^www\./, ""),
				citationIndex: idx++,
			});
		} catch (e) {
			console.warn(`OpenRouter: skipping invalid citation URL: ${url}`, e);
		}
	}
	return citations;
}

export const openrouter: Provider = {
	id: "openrouter",
	name: "OpenRouter",

	isConfigured() {
		return !!process.env.OPENROUTER_API_KEY;
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
		webSearch = true,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		// Raw fetch (no AI SDK) so we can attach the OpenRouter `plugins` field
		// — the AI SDK's OpenAI-compat path doesn't pass it through.
		const jsonSchema = z.toJSONSchema(schema as z.ZodType);
		const body: Record<string, unknown> = {
			model: DEFAULT_RESEARCH_MODEL,
			messages: [{ role: "user", content: prompt }],
			response_format: {
				type: "json_schema",
				json_schema: { name: "research_output", strict: true, schema: jsonSchema },
			},
		};
		// `engine: "native"` runs the underlying provider's real web-search tool
		// (e.g. Anthropic's web_search_20250305) instead of the Exa fallback.
		if (webSearch) body.plugins = [{ id: "web", engine: "native" }];
		const res = await fetch(OPENROUTER_API_URL, {
			method: "POST",
			headers: openrouterHeaders(),
			body: JSON.stringify(body),
		});
		if (!res.ok) {
			throw new Error(`OpenRouter API error (${res.status}): ${await res.text()}`);
		}
		const data: any = await res.json();
		const content = data?.choices?.[0]?.message?.content;
		if (typeof content !== "string") {
			throw new Error(`OpenRouter returned no JSON content (model=${DEFAULT_RESEARCH_MODEL})`);
		}
		const parsed = (schema as z.ZodType).parse(JSON.parse(content));
		return {
			object: parsed as T,
			// Report the alias we sent, not OpenRouter's resolved version
			// (e.g. "openai/gpt-5-mini" vs "openai/gpt-5-mini-2025-08-07") —
			// matches what openai-api and anthropic-api do.
			modelVersion: DEFAULT_RESEARCH_MODEL,
		};
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		let modelSlug = options?.version;
		if (!modelSlug) {
			throw new Error(
				`OpenRouter requires a version slug in SCRAPE_TARGETS. ` +
				`Example: ${model}:openrouter:openai/gpt-5-mini:online`,
			);
		}

		if (options?.webSearch && !modelSlug.includes(":online")) {
			modelSlug = `${modelSlug}:online`;
		}

		// Use raw fetch instead of SDK — the SDK's ChatAssistantMessage Zod schema
		// strips annotations from responses, which contain web search citations.
		// The SDK's Responses API (client.responses.send()) does preserve annotations
		// via ResponseOutputText, but it's currently in beta. Consider switching to
		// the Responses API + SDK when it's stable.
		const res = await fetch(OPENROUTER_API_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
				"Content-Type": "application/json",
				"HTTP-Referer": process.env.APP_URL ?? "https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool",
				"X-Title": "Getcito AEO",
			},
			body: JSON.stringify({
				model: modelSlug,
				messages: [{ role: "user", content: prompt }],
			}),
		});

		if (!res.ok) {
			throw new Error(`OpenRouter API error (${res.status}): ${await res.text()}`);
		}

		const data: any = await res.json();

		const citations = extractCitationsFromOpenRouterResponse(data);
		// OpenRouter doesn't expose what search queries the model made internally.
		// Only mark as "unavailable" when citations prove a web search happened.
		const webQueries = citations.length > 0 ? [WEB_QUERIES_UNAVAILABLE] : [];

		return {
			rawOutput: data,
			textContent: extractTextFromOpenRouterResponse(data),
			webQueries,
			citations,
			modelVersion: data?.model ?? modelSlug.replace(":online", ""),
		};
	},
};
