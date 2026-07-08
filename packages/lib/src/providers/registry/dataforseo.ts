import * as client from "dataforseo-client";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";
import { DATAFORSEO_LANGUAGES } from "../../languages";
import {
	extractCitationsFromDataforseoLlm,
	extractCitationsFromGoogle,
	extractTextFromDataforseoLlm,
	extractTextFromGoogle,
} from "../../text-extraction";
import type { ModelConfig, Provider, ProviderOptions, ScrapeResult } from "../types";

/**
 * Models served via the SERP Google AI Mode endpoint (SerpApi). These always
 * use web search and have a SERP-shaped response (items[].type "ai_overview").
 */
const SERP_MODELS = new Set(["google-ai-mode"]);

/**
 * Models served via the AI Optimization "LLM Responses" API
 * (chat_gpt / perplexity / gemini), mapping each Getcito model id to the
 * AiOptimizationApi live method plus a sensible default DataForSEO model_name.
 * The model_name can be overridden per target via the version slug, e.g.
 * `chatgpt:dataforseo:gpt-4.1:online`.
 */
const LLM_MODELS: Record<string, { defaultModelName: string; call: keyof typeof LLM_CALLS }> = {
	// gpt-5.5 is the model behind ChatGPT's current default ("GPT-5.5 Instant").
	// DataForSEO's `*-chat-latest` aliases lag the consumer product, so we pin a
	// concrete current model and bump it as ChatGPT advances.
	chatgpt: { defaultModelName: "gpt-5.5", call: "chatgpt" },
	perplexity: { defaultModelName: "sonar", call: "perplexity" },
	gemini: { defaultModelName: "gemini-2.5-flash", call: "gemini" },
};

const SUPPORTED_MODELS = new Set([...SERP_MODELS, ...Object.keys(LLM_MODELS)]);
const MAX_PROMPT_CHARS = 500;

interface DataForSeoLlmRequest {
	user_prompt: string;
	model_name: string;
	web_search: boolean;
	location_name?: string;
	language_name?: string;
}

function sanitizeForJson(obj: unknown): unknown {
	return JSON.parse(JSON.stringify(obj));
}

function authFetch(url: string | URL | Request, init?: RequestInit): Promise<Response> {
	const username = process.env.DATAFORSEO_LOGIN;
	const password = process.env.DATAFORSEO_PASSWORD;
	if (!username || !password) {
		throw new Error("DataForSEO requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD");
	}
	const token = btoa(`${username}:${password}`);
	return fetch(url, {
		...init,
		headers: { ...init?.headers, Authorization: `Basic ${token}`, "Content-Type": "application/json" },
	});
}

function createDfsSerpApi() {
	return new client.SerpApi("https://api.dataforseo.com", { fetch: authFetch });
}

function createDfsAiApi() {
	return new client.AiOptimizationApi("https://api.dataforseo.com", { fetch: authFetch });
}

function assertPromptLength(prompt: string) {
	const length = Array.from(prompt).length;
	if (length > MAX_PROMPT_CHARS) {
		throw new Error(`DataForSEO prompts must be ${MAX_PROMPT_CHARS} characters or fewer (${length} provided)`);
	}
}

/** Live LLM Responses call dispatch, keyed by Getcito model id. */
const LLM_CALLS = {
	chatgpt: (api: client.AiOptimizationApi, body: DataForSeoLlmRequest[]) =>
		api.chatGptLlmResponsesLive(body.map((b) => new client.AiOptimizationChatGptLlmResponsesLiveRequestInfo(b))),
	perplexity: (api: client.AiOptimizationApi, body: DataForSeoLlmRequest[]) =>
		api.perplexityLlmResponsesLive(body.map((b) => new client.AiOptimizationPerplexityLlmResponsesLiveRequestInfo(b))),
	gemini: (api: client.AiOptimizationApi, body: DataForSeoLlmRequest[]) =>
		api.geminiLlmResponsesLive(body.map((b) => new client.AiOptimizationGeminiLlmResponsesLiveRequestInfo(b))),
} as const;

async function runGoogleAiMode(prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
	assertPromptLength(prompt);
	const api = createDfsSerpApi();
	
	const requestConfig: any = {
		keyword: prompt,
		language_code: "en",
		depth: 10,
	};
	
	if (options?.targetMarket) {
		requestConfig.location_name = options.targetMarket;
	} else {
		requestConfig.location_code = 2840;
	}

	if (options?.targetLanguage) {
		const langCode = DATAFORSEO_LANGUAGES.find((l) => l.name === options.targetLanguage)?.code;
		if (langCode) {
			requestConfig.language_code = langCode;
		}
	}
	
	const requestInfo = new client.SerpGoogleAiModeLiveAdvancedRequestInfo(requestConfig);

	const response = await api.googleAiModeLiveAdvanced([requestInfo]);

	if (!response?.tasks?.length) {
		throw new Error(`DataForSEO API Error: No response or tasks.`);
	}

	const task = response.tasks[0];
	if (task.status_code !== 20000 || !task.result?.length) {
		throw new Error(`DataForSEO API Error: ${task.status_message}`);
	}

	const citations = extractCitationsFromGoogle(response);
	// Google AI Mode always searches, but DataForSEO doesn't expose the query
	// strings anywhere in its response. Mark "unavailable" when citations
	// prove a search, like the other providers; never echo the prompt (runs
	// before this change did).
	return {
		rawOutput: sanitizeForJson(response),
		webQueries: citations.length > 0 ? [WEB_QUERIES_UNAVAILABLE] : [],
		textContent: extractTextFromGoogle(response),
		citations,
		modelVersion: "dataforseo",
	};
}

/**
 * Gemini (via DataForSEO) returns each citation `url` as a Google Vertex AI
 * "grounding-api-redirect" link; the real source only appears as a bare domain
 * in the annotation `title`. There is no DataForSEO setting or field that
 * exposes the underlying URL (confirmed against their docs), so we resolve the
 * redirect to its destination. These links are short-lived, so we do it at
 * fetch time and rewrite the raw output in place — both the stored output and
 * the extracted citations then carry the real source URL/domain. ChatGPT and
 * Perplexity already return real URLs and are left untouched; resolution
 * failures fall back to the original redirect URL.
 */
const GROUNDING_REDIRECT_PREFIX = "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";

async function resolveGroundingRedirect(url: string): Promise<string> {
	try {
		const res = await fetch(url, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(8000) });
		const location = res.headers.get("location");
		return location?.startsWith("http") ? location : url;
	} catch {
		return url;
	}
}

async function resolveGroundingRedirects(raw: unknown): Promise<void> {
	type RawAnnotation = { url?: string };
	type RawLlmResponse = {
		tasks?: { result?: { items?: { sections?: { annotations?: RawAnnotation[] }[] }[] }[] }[];
	};
	const items = (raw as RawLlmResponse)?.tasks?.[0]?.result?.[0]?.items ?? [];
	const redirected: RawAnnotation[] = [];
	for (const item of items) {
		for (const section of item?.sections ?? []) {
			for (const ann of section?.annotations ?? []) {
				if (typeof ann?.url === "string" && ann.url.startsWith(GROUNDING_REDIRECT_PREFIX)) {
					redirected.push(ann);
				}
			}
		}
	}
	if (redirected.length === 0) return;
	const resolved = new Map<string, string>();
	await Promise.all(
		[...new Set(redirected.map((a) => a.url as string))].map(async (u) =>
			resolved.set(u, await resolveGroundingRedirect(u)),
		),
	);
	for (const ann of redirected) {
		ann.url = resolved.get(ann.url as string) ?? ann.url;
	}
}

async function runLlmResponse(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
	const spec = LLM_MODELS[model];
	const api = createDfsAiApi();
	const modelName = options?.version ?? spec.defaultModelName;
	const webSearch = options?.webSearch ?? false;

	const body: DataForSeoLlmRequest = {
		user_prompt: prompt,
		model_name: modelName,
		web_search: webSearch,
	};
	
	if (options?.targetMarket) {
		// Pass the target market string (e.g. "United Kingdom") directly.
		// DataForSEO's LLM Scraper endpoints (Google, ChatGPT, Gemini, etc.)
		// all support this via the location_name parameter.
		body.location_name = options.targetMarket;
	}

	if (options?.targetLanguage) {
		body.language_name = options.targetLanguage;
	}

	const response = await LLM_CALLS[spec.call](api, [body]);

	if (!response?.tasks?.length) {
		throw new Error(`DataForSEO API Error: No response or tasks.`);
	}

	const task = response.tasks[0];
	if (task.status_code !== 20000 || !task.result?.length) {
		throw new Error(`DataForSEO API Error: ${task.status_code} ${task.status_message}`);
	}

	const result = task.result[0];
	const raw = sanitizeForJson(response);
	// Replace Gemini's Vertex grounding-redirect citation URLs with the real
	// source URLs before extraction (no-op for ChatGPT/Perplexity).
	await resolveGroundingRedirects(raw);
	const citations = extractCitationsFromDataforseoLlm(raw);
	// DataForSEO exposes the LLM's expanded queries as fan_out_queries. Surface
	// them as webQueries when web search was on; otherwise fall back to the
	// "unavailable" marker when citations prove a search occurred.
	const fanOut: string[] = Array.isArray(result.fan_out_queries)
		? result.fan_out_queries.filter((q: unknown): q is string => typeof q === "string" && q.trim().length > 0)
		: [];

	return {
		rawOutput: raw,
		webQueries: webSearch ? (fanOut.length > 0 ? fanOut : citations.length > 0 ? [WEB_QUERIES_UNAVAILABLE] : []) : [],
		textContent: extractTextFromDataforseoLlm(raw),
		citations,
		modelVersion: result.model_name ?? modelName,
	};
}

export const dataforseo: Provider = {
	id: "dataforseo",
	name: "DataForSEO",

	isConfigured() {
		return !!process.env.DATAFORSEO_LOGIN && !!process.env.DATAFORSEO_PASSWORD;
	},

	validateTarget(config: ModelConfig) {
		if (!SUPPORTED_MODELS.has(config.model)) {
			return `DataForSEO only supports: ${[...SUPPORTED_MODELS].join(", ")}`;
		}
		// Google AI Mode is search-only. The LLM Responses engines model the
		// chatbot UX where web search is always on, so :online is required there
		// too (matches the BrightData provider for these engines).
		if (!config.webSearch) {
			return `${config.model}:dataforseo requires :online — this engine always uses web search`;
		}
		return null;
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		assertPromptLength(prompt);
		if (SERP_MODELS.has(model)) {
			return runGoogleAiMode(prompt, options);
		}
		if (LLM_MODELS[model]) {
			return runLlmResponse(model, prompt, options);
		}
		throw new Error(`DataForSEO: unsupported model "${model}". Supported: ${[...SUPPORTED_MODELS].join(", ")}`);
	},
};
