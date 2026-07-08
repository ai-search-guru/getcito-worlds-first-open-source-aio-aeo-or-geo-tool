import { z } from "zod";
import type {
	Provider,
	ScrapeResult,
	ProviderOptions,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";
import type { Citation } from "../../text-extraction";

const MISTRAL_BASE_URL = "https://api.mistral.ai";
const DEFAULT_MODEL = "mistral-medium-latest";
// `mistral-large-latest` aliases to Mistral Large 3 (released Dec 2025).
// Tracked as `-latest` so the alias rolls forward when newer Large
// generations ship.
const DEFAULT_RESEARCH_MODEL = "mistral-large-latest";

async function mistralPost(path: string, body: object): Promise<any> {
	const res = await fetch(`${MISTRAL_BASE_URL}${path}`, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${process.env.MISTRAL_API_KEY}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify(body),
	});
	if (!res.ok) {
		throw new Error(`Mistral API error (${res.status}): ${await res.text()}`);
	}
	return res.json();
}

function parseConversationsResponse(data: any): { textContent: string; citations: Citation[]; webQueries: string[] } {
	const texts: string[] = [];
	const citations: Citation[] = [];
	const webQueries: string[] = [];
	const seen = new Set<string>();
	let idx = 0;

	for (const entry of data?.outputs ?? []) {
		// Tool-execution entries carry the search query as a JSON-encoded string
		// in `arguments`. Best-effort parse — webQueries is a reporting signal,
		// not load-bearing, so a malformed payload shouldn't blow up the response.
		if (entry?.type === "tool.execution" && entry?.name === "web_search" && typeof entry.arguments === "string") {
			try {
				const args = JSON.parse(entry.arguments);
				if (args?.query) webQueries.push(args.query);
			} catch {
				// ignore — keep going
			}
		}

		// Conversations API returns message content as either a plain string
		// (single-shot replies) or an array of typed chunks (when tools cite sources).
		if (typeof entry?.content === "string") {
			texts.push(entry.content);
			continue;
		}
		for (const chunk of Array.isArray(entry?.content) ? entry.content : []) {
			if (chunk?.type === "text" && typeof chunk.text === "string") {
				texts.push(chunk.text);
			} else if (chunk?.type === "tool_reference" && typeof chunk.url === "string" && !seen.has(chunk.url)) {
				seen.add(chunk.url);
				try {
					citations.push({
						url: chunk.url,
						title: chunk.title ?? undefined,
						domain: new URL(chunk.url).hostname.replace(/^www\./, ""),
						citationIndex: idx++,
					});
				} catch (e) {
					console.warn(`Mistral: skipping invalid citation URL: ${chunk.url}`, e);
				}
			}
		}
	}

	return { textContent: texts.join("\n"), citations, webQueries };
}

export const mistralApi: Provider = {
	id: "mistral-api",
	name: "Mistral API",

	isConfigured() {
		return !!process.env.MISTRAL_API_KEY;
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const version = options?.version ?? DEFAULT_MODEL;

		if (options?.webSearch) {
			const data = await mistralPost("/v1/conversations", {
				model: version,
				inputs: prompt,
				tools: [{ type: "web_search" }],
			});
			const parsed = parseConversationsResponse(data);
			return { ...parsed, rawOutput: data, modelVersion: data?.model ?? version };
		}

		const data = await mistralPost("/v1/chat/completions", {
			model: version,
			messages: [{ role: "user", content: prompt }],
		});
		return {
			rawOutput: data,
			textContent: data?.choices?.[0]?.message?.content ?? "",
			webQueries: [],
			citations: [],
			modelVersion: data?.model ?? version,
		};
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
		webSearch = true,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		const jsonSchema = z.toJSONSchema(schema as z.ZodType);
		if (!webSearch) {
			// Pure completion: plain chat endpoint with server-validated json_schema.
			const data = await mistralPost("/v1/chat/completions", {
				model: DEFAULT_RESEARCH_MODEL,
				messages: [{ role: "user", content: prompt }],
				response_format: {
					type: "json_schema",
					json_schema: { name: "research_output", strict: true, schema: jsonSchema },
				},
			});
			const content = data?.choices?.[0]?.message?.content ?? "";
			return {
				object: (schema as z.ZodType).parse(JSON.parse(content)) as T,
				modelVersion: data?.model ?? DEFAULT_RESEARCH_MODEL,
			};
		}
		// /v1/conversations forwards completion_args.response_format through to
		// the underlying chat completion, so we can have web_search AND
		// server-validated json_schema output in a single call.
		const data = await mistralPost("/v1/conversations", {
			model: DEFAULT_RESEARCH_MODEL,
			inputs: prompt,
			tools: [{ type: "web_search" }],
			completion_args: {
				response_format: {
					type: "json_schema",
					json_schema: { name: "research_output", strict: true, schema: jsonSchema },
				},
			},
		});
		const { textContent } = parseConversationsResponse(data);
		return {
			object: (schema as z.ZodType).parse(JSON.parse(textContent)) as T,
			modelVersion: data?.model ?? DEFAULT_RESEARCH_MODEL,
		};
	},
};
