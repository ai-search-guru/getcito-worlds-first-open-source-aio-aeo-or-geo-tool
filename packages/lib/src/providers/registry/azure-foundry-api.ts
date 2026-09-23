import { z } from "zod";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";
import { extractCitationsFromChatCompletion } from "../../text-extraction";
import { createGate } from "../concurrency";
import { localeCountryCode, localeSystemMessages } from "../locale";
import type {
	Provider,
	ProviderOptions,
	ScrapeResult,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";

const DEFAULT_RESEARCH_MODEL = "gpt-4o-mini";

/**
 * Foundry online endpoints are provisioned per-deployment and rate-limit well
 * below the worker's fan-out, which showed up as a wall of 429s. Two in flight
 * plus the retry below keeps a Grok deployment inside its quota.
 */
const gate = createGate(2);

/** Deployment quota is per-minute, so a short wait is usually enough. */
const RATE_LIMIT_RETRY_DELAYS_MS = [5_000, 20_000, 45_000];

/**
 * Retry 429s rather than failing the run. Honors `Retry-After` when the
 * endpoint sends one, since Azure's own value beats a guess. Anything else,
 * including the final 429, is returned to the caller to handle.
 */
async function fetchWithRateLimitRetry(makeRequest: () => Promise<Response>): Promise<Response> {
	let res = await makeRequest();
	for (const fallbackDelay of RATE_LIMIT_RETRY_DELAYS_MS) {
		if (res.status !== 429) return res;
		const retryAfter = Number(res.headers.get("retry-after"));
		const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : fallbackDelay;
		console.warn(`[azure-foundry-api] rate limited (429), retrying in ${Math.round(delay / 1000)}s`);
		await new Promise((r) => setTimeout(r, delay));
		res = await makeRequest();
	}
	return res;
}

function chatCompletionsUrl(): string {
	const apiKey = process.env.AZURE_FOUNDRY_API_KEY;
	let baseUrl = process.env.AZURE_FOUNDRY_BASE_URL;

	if (!apiKey || !baseUrl) {
		throw new Error("Missing Azure Foundry configuration (AZURE_FOUNDRY_API_KEY / AZURE_FOUNDRY_BASE_URL)");
	}

	// Ensure the URL ends with /chat/completions
	if (!baseUrl.endsWith("/chat/completions")) {
		baseUrl = baseUrl.replace(/\/v1\/?$/, ""); // strip trailing /v1
		baseUrl = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
	}

	return baseUrl;
}

function foundryHeaders(): Record<string, string> {
	const apiKey = process.env.AZURE_FOUNDRY_API_KEY ?? "";
	return {
		Authorization: `Bearer ${apiKey}`,
		"api-key": apiKey, // Some Azure models use api-key instead of Bearer
		"Content-Type": "application/json",
	};
}

/**
 * xAI Live Search config for a run. Exported for tests.
 *
 * The system message tells the model to assume the brand's market; this makes
 * the *search itself* run there. xAI accepts a country only on the `web` and
 * `news` sources, so the default source set (web + x) has to be named
 * explicitly to attach it. With no target market we send no `sources` at all
 * and keep xAI's own defaults rather than guessing a country.
 */
export function liveSearchParameters(options?: ProviderOptions): Record<string, unknown> {
	const country = localeCountryCode(options);
	return {
		mode: "auto",
		return_citations: true,
		...(country ? { sources: [{ type: "web", country }, { type: "x" }] } : {}),
	};
}

export const azureFoundryApi: Provider = {
	id: "azure-foundry-api",
	name: "Azure AI Foundry",

	isConfigured() {
		return !!process.env.AZURE_FOUNDRY_API_KEY && !!process.env.AZURE_FOUNDRY_BASE_URL;
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const targetModel = options?.version ?? model;
		const url = chatCompletionsUrl();

		const makeRequest = (includeSearch: boolean) =>
			fetch(url, {
				method: "POST",
				headers: foundryHeaders(),
				body: JSON.stringify({
					model: targetModel,
					messages: [
						// The brand's target market/language — Foundry deployments are
						// plain chat completions, so a system turn is the only way to
						// steer locale.
						...localeSystemMessages(options),
						{ role: "user", content: prompt },
					],
					// xAI Grok "Live Search": only Grok honors search_parameters, and
					// only on deployments that expose it. Gated on `:online`.
					...(includeSearch && options?.webSearch ? { search_parameters: liveSearchParameters(options) } : {}),
				}),
			});

		const res = await gate(async () => {
			let res = await fetchWithRateLimitRetry(() => makeRequest(true));
			// Endpoints that don't support Live Search reject the unknown arg with a
			// 400 ("unrecognized_request_argument: search_parameters"). Retry once
			// without it so the run still returns an answer instead of failing.
			if (!res.ok && res.status === 400 && options?.webSearch) {
				const errText = await res.text();
				if (/search_parameters|unrecognized_request_argument/i.test(errText)) {
					console.warn(`[azure-foundry-api] search_parameters unsupported for ${targetModel}, retrying without it`);
					res = await fetchWithRateLimitRetry(() => makeRequest(false));
				} else {
					throw new Error(`Azure Foundry API error (400): ${errText}`);
				}
			}
			return res;
		});

		if (!res.ok) {
			throw new Error(`Azure Foundry API error (${res.status}): ${await res.text()}`);
		}

		const data: any = await res.json();
		const content = data?.choices?.[0]?.message?.content ?? "";

		// Foundry is OpenAI-compatible: citations arrive as message annotations
		// (OpenAI style) or a top-level `citations` array (Grok Live Search).
		// Empty for models with no web grounding.
		const citations = extractCitationsFromChatCompletion(data);

		return {
			rawOutput: data,
			textContent: content,
			// Neither annotations nor Live Search report the queries the model
			// actually ran, so — same rule as OpenRouter — record the sentinel only
			// when citations prove a search happened.
			webQueries: citations.length > 0 ? [WEB_QUERIES_UNAVAILABLE] : [],
			citations,
			modelVersion: data?.model ?? targetModel,
		};
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
		version,
		targetMarket,
		targetLanguage,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		// Foundry exposes OpenAI-compatible `response_format`, so structured
		// output is the same call `run` makes with a schema attached. Web search
		// is deliberately off: `search_parameters` is Grok-only and gets rejected
		// by the other deployments behind the same endpoint.
		const targetModel = version ?? DEFAULT_RESEARCH_MODEL;
		const jsonSchema = z.toJSONSchema(schema as z.ZodType);
		const locale = { targetMarket, targetLanguage };

		const res = await gate(() =>
			fetchWithRateLimitRetry(() =>
				fetch(chatCompletionsUrl(), {
					method: "POST",
					headers: foundryHeaders(),
					body: JSON.stringify({
						model: targetModel,
						// Same locale system turn `run` sends.
						messages: [...localeSystemMessages(locale), { role: "user", content: prompt }],
						response_format: {
							type: "json_schema",
							json_schema: { name: "research_output", strict: true, schema: jsonSchema },
						},
					}),
				}),
			),
		);

		if (!res.ok) {
			throw new Error(`Azure Foundry API error (${res.status}): ${await res.text()}`);
		}

		const data: any = await res.json();
		const content = data?.choices?.[0]?.message?.content;
		if (typeof content !== "string") {
			throw new Error(`Azure Foundry returned no JSON content (model=${targetModel})`);
		}

		return {
			object: (schema as z.ZodType).parse(JSON.parse(content)) as T,
			modelVersion: data?.model ?? targetModel,
		};
	},
};
