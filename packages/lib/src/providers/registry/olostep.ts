import Olostep from "olostep";
import { z } from "zod";
import type {
	ModelConfig,
	Provider,
	ProviderOptions,
	ScrapeResult,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";
import type { Citation } from "../../text-extraction";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";
import { BRIGHTDATA_COUNTRIES } from "../../brightdata-locations";
import { createGate } from "../concurrency";
import { DATAFORSEO_LOCATION_LANGUAGES } from "../../location-languages";

function getLanguageCode(languageName: string): string | undefined {
	for (const languages of Object.values(DATAFORSEO_LOCATION_LANGUAGES)) {
		const match = languages.find((l) => l.name === languageName);
		if (match) return match.code;
	}
	return undefined;
}

const OLOSTEP_PARSERS: Record<string, { parserId: string; urlTemplate: (q: string, lang?: string) => string; credits: number }> = {
	chatgpt: {
		parserId: "@olostep/chatgpt-results",
		// `hints=search` is the URL OpenAI hands out for using ChatGPT as a browser
		// search engine. Without it the plain `?q=` chat leaves searching to the
		// model's discretion, and it frequently answers from memory — which the
		// parser reports as `web_searched: false` with no queries and no
		// citations, i.e. a run that costs 5 credits and measures nothing.
		urlTemplate: (q) => `https://chatgpt.com/?q=${encodeURIComponent(q)}&hints=search`,
		credits: 5,
	},
	"google-ai-mode": {
		parserId: "@olostep/google-aimode-results",
		urlTemplate: (q, lang) => `https://google.com/aimode?q=${encodeURIComponent(q)}${lang ? `&hl=${lang}` : ''}`,
		credits: 3,
	},
	"google-ai-overview": {
		parserId: "@olostep/google-ai-overview-results",
		urlTemplate: (q, lang) => `https://www.google.com/search?q=${encodeURIComponent(q)}${lang ? `&hl=${lang}` : ''}`,
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

/**
 * Sized to cover the worker's whole fan-out rather than to ration Olostep.
 *
 * The account's plan allows 500 concurrent requests; the worker runs at most
 * `localConcurrency` prompts at once (10, see apps/worker/src/handlers.ts), each
 * sweeping the Olostep models in SCRAPE_TARGETS, so the fan-out to cover is
 * around 60 per worker process. A gate narrower than that does not protect
 * anything — it just serialises one prompt's sweep into waves.
 *
 * That matters because a failed scrape is not reported as failed: Olostep
 * leaves the batch `in_progress` until its own ~1320s timeout, then returns
 * `completed` with `completed_urls: 0`. Under a narrow gate one such batch
 * blocks every other model behind it for 22 minutes, which is how a prompt that
 * normally takes minutes ends up taking over an hour.
 *
 * The limit is per process, not per account: `createGate` keeps its counter in
 * module scope, so running N worker processes allows N times this many in
 * flight. Keep that product under the plan's 500 when scaling out.
 */
const gate = createGate(64);

/**
 * Ceiling on a single batch. This covers Olostep's own queue time as well as
 * the scrape, so it is not a measure of how slow one page is.
 *
 * Set deliberately high so that a slow engine yields data instead of an error.
 * The cost of that is throughput, not correctness: a genuinely stuck batch now
 * holds one of the six gate slots for the full half hour rather than failing
 * fast and freeing it, so a run of hung scrapes shows up as a stalled queue
 * rather than as timeouts on the usage page.
 *
 * Coupled to the `process-prompt` queue's `expireInSeconds` (apps/worker):
 * worst case a job's scrapes sit behind two other jobs' at the gate, so the
 * queue must allow roughly three times this before it kills the job as stalled.
 */
const BATCH_TIMEOUT_SECONDS = 1800;

/** Backstop for `waitTillDone` overrunning its own timeout, which it has. */
const BATCH_HARD_TIMEOUT_MS = (BATCH_TIMEOUT_SECONDS + 20) * 1000;

/**
 * Pull the HTTP status and response body out of an Olostep SDK error.
 *
 * The SDK wraps transport failures in `OlostepAPIConnectionError` and copies
 * only the cause's message, so a rejected request surfaces as "The Olostep API
 * reported a temporary issue; retry later." — no status, no body, and
 * indistinguishable from a network blip. The real response is one level down,
 * on the cause's own `details`.
 */
function describeOlostepError(error: unknown): string {
	type WithDetails = { details?: { cause?: unknown; response?: { status?: number; body?: unknown } } };
	const cause = (error as WithDetails)?.details?.cause;
	const response = (cause as WithDetails)?.details?.response ?? (error as WithDetails)?.details?.response;
	if (!response) return "";
	let body: string;
	try {
		body = typeof response.body === "string" ? response.body : JSON.stringify(response.body);
	} catch {
		body = String(response.body);
	}
	return ` [HTTP ${response.status ?? "?"}: ${body?.slice(0, 500) ?? "no body"}]`;
}

let _client: Olostep | null = null;
function getClient(): Olostep {
	if (!_client) {
		_client = new Olostep({ apiKey: process.env.OLOSTEP_API_KEY, retry: { maxRetries: 3, initialDelayMs: 2000 } });
	}
	return _client;
}

function extractTextFromOlostep(data: any, model: string): string {
	if (data?.result?.markdown_content) return data.result.markdown_content;
	if (data?.answer_markdown) return data.answer_markdown;
	if (data?.result?.text_content) return data.result.text_content;
	if (typeof data?.answer === "string") return data.answer;
	if (data?.result?.ai_overview) return data.result.ai_overview;
	if (data?.ai_overview) return data.ai_overview;

	if (model === "google-ai-mode" || model === "google-ai-overview") {
		return "No Google AI mode invoked.";
	}
	return "No text content found in Olostep response.";
}

/**
 * Containers that hold an answer's sources, most authoritative first. Picked by
 * first *non-empty* rather than first present: parsers emit `sources: []`
 * alongside a populated `inline_references` or `links_attached`, and a `??`
 * chain stops at the empty array and reports zero citations for an answer that
 * plainly cites its sources.
 */
export function pickSources(data: any): any[] {
	const candidates = [
		data?.sources,
		data?.citations,
		data?.result?.links_on_page,
		data?.inline_references,
		data?.links_attached,
	];
	return candidates.find((c) => Array.isArray(c) && c.length > 0) ?? [];
}

function extractCitationsFromOlostep(data: any): Citation[] {
	const citations: Citation[] = [];
	const sources = pickSources(data);
	let idx = 0;
	for (const source of Array.isArray(sources) ? sources : []) {
		const url = typeof source === "string" ? source : source?.url;
		if (!url || typeof url !== "string") continue;
		try {
			// Some search engines return relative URLs like "/goto?url=..." 
			// Providing a base URL prevents new URL() from throwing ERR_INVALID_URL
			const parsed = new URL(url, "https://google.com");
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

/**
 * Keys that hold the queries an engine actually issued. Deliberately excludes
 * `related_queries` and friends: those are "people also search for" suggestions
 * rendered on the page, not searches the engine ran, and counting them would
 * inflate the fan-out report with queries nobody made.
 */
const QUERY_KEYS = ["search_queries", "search_model_queries", "web_search_queries", "queries"];

/** Entries are plain strings in some parsers and `{ query }` objects in others. */
function toQueries(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((entry) => (typeof entry === "string" ? entry : ((entry as { query?: unknown } | null)?.query ?? null)))
		.filter((q): q is string => typeof q === "string" && q.trim().length > 0);
}

/**
 * Every Olostep parser names the fan-out differently and nests it at a different
 * depth, so probe the known containers rather than growing a branch per model.
 */
export function extractWebQueries(data: any): string[] {
	const containers = [data, data?.network_search_calls, data?.result, data?.metadata];
	for (const container of containers) {
		if (!container) continue;
		for (const key of QUERY_KEYS) {
			const queries = toQueries(container[key]);
			if (queries.length > 0) return queries;
		}
	}
	return [];
}

/**
 * Prompt budget for structured research. The prompt travels in the chat URL's
 * query string, and onboarding prompts embed up to 200 lines of scraped website
 * text — far more than a URL can carry. Trim rather than let the batch fail.
 *
 * ponytail: flat character cap; raise it if Olostep proves it takes longer URLs.
 */
const MAX_RESEARCH_PROMPT_CHARS = 3000;

/**
 * Pull the JSON object out of a chat answer. Consumer chat UIs wrap JSON in
 * markdown fences and often add a sentence before or after it, so take the
 * fenced block when there is one and fall back to the outermost braces.
 * Exported for tests.
 */
export function extractJsonObject(text: string): unknown {
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
	const candidate = fenced?.[1] ?? text;
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start === -1 || end <= start) {
		throw new Error("No JSON object found in response");
	}
	return JSON.parse(candidate.slice(start, end + 1));
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
		return null;
	},

	async run(model: string, prompt: string, _options?: ProviderOptions): Promise<ScrapeResult> {
		const parserConfig = OLOSTEP_PARSERS[model];
		if (!parserConfig) throw new Error(`Olostep does not support model "${model}"`);

		// `targetLanguage` holds a display name ("English"), never an ISO code, so
		// the old `!== "en"` test matched every brand and appended a redundant
		// "respond in English" line to English prompts. Compare the resolved code.
		const targetLanguage = _options?.targetLanguage;
		const langCode = targetLanguage ? getLanguageCode(targetLanguage) : undefined;
		const finalPrompt =
			targetLanguage && langCode !== "en" && model !== "google-ai-mode" && model !== "google-ai-overview"
				? `${prompt}\nPlease provide your response in ${targetLanguage}.`
				: prompt;

		const client = getClient();
		const url = parserConfig.urlTemplate(finalPrompt, langCode);

		const country = _options?.targetMarket ? BRIGHTDATA_COUNTRIES[_options.targetMarket] : undefined;

		// The gate spans creation through retrieval, not just creation: the wait is
		// the scarce resource, so holding a slot only while enqueuing would bound
		// nothing.
		const retrieved = await gate(async () => {
			// Use batch API — the /scrapes endpoint doesn't support all parsers
			const batch = await client.batches.create([{ url, customId: "1" }], {
				parser: { id: parserConfig.parserId },
				...(country && { country }),
			}).catch((error: unknown) => {
				// Name the parser: a status that only one parser gets back is a
				// parser problem, not the outage the SDK's message implies.
				throw new Error(
					`Olostep rejected batch for ${model} (parser ${parserConfig.parserId}): ${
						error instanceof Error ? error.message : String(error)
					}${describeOlostepError(error)}`,
					{ cause: error },
				);
			});

			await Promise.race([
				batch.waitTillDone({ checkEveryNSecs: 5, timeoutSeconds: BATCH_TIMEOUT_SECONDS }),
				new Promise((_, reject) => setTimeout(() => reject(new Error(`Olostep batch waitTillDone hard timeout for ${model}`)), BATCH_HARD_TIMEOUT_MS))
			]);

			// The item listing can lag the batch's own status, so an immediate read
			// after waitTillDone occasionally yields nothing for a batch that did
			// finish. Re-read a couple of times before giving up.
			let retrieveId: string | undefined;
			for (const delayMs of [0, 3_000, 10_000]) {
				if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
				for await (const item of batch.items()) {
					retrieveId = item.retrieve_id;
					break; // single item batch
				}
				if (retrieveId) break;
			}

			if (!retrieveId) {
				// Dump the whole info payload rather than two fields: the previous
				// message reported "Status: completed, Error: undefined", which does
				// not say whether the item failed to scrape or was filtered out of
				// the listing by the API's default status filter.
				const batchStatus = await client.batches.info(batch.id);
				throw new Error(
					`Olostep batch for ${model} completed but no items returned after 3 reads. Batch info: ${JSON.stringify(batchStatus)}`,
				);
			}

			// Use client.retrieve (GET) instead of item.retrieve (POST) — the
			// SDK's BatchItem.retrieve uses POST which the API rejects with 403.
			return client.retrieve(retrieveId, ["json" as any]);
		});

		const jsonContent = retrieved.json_content;
		const parsed =
			typeof jsonContent === "string" ? JSON.parse(jsonContent) : (jsonContent ?? retrieved);

		const webQueries = extractWebQueries(parsed);
		const citations = extractCitationsFromOlostep(parsed);

		// Each Olostep parser names its fields differently, so a miss here is
		// indistinguishable from "the engine ran no searches". Print the payload's
		// top-level keys whenever no queries came back, so the right key can be
		// added to QUERY_KEYS — or the absence confirmed as structural. Zero
		// citations too means the parser found nothing at all, which is a
		// different problem (page didn't render, parser drifted) worth seeing.
		if (webQueries.length === 0) {
			// ChatGPT's parser reports whether a search ran at all, which is the
			// difference between "the engine didn't search" and "it searched but
			// hid the queries" — the two readings of this warning.
			const searched = typeof parsed?.web_searched === "boolean" ? ` web_searched=${parsed.web_searched}` : "";
			console.warn(
				`[olostep] no search queries for ${model} (citations=${citations.length})${searched}; payload keys: ${Object.keys(parsed ?? {}).join(", ")}`,
			);
		}

		return {
			// Store the parsed content directly instead of the full retrieved
			// wrapper (which double-encodes json_content as a string).
			rawOutput: parsed,
			textContent: extractTextFromOlostep(parsed, model),
			// Mark as "unavailable" only when citations prove a search happened
			// but the API didn't expose the query strings
			webQueries: webQueries.length > 0 ? webQueries : citations.length > 0 ? [WEB_QUERIES_UNAVAILABLE] : [],
			citations,
			modelVersion: parsed?.model ?? undefined,
		};
	},

	/**
	 * Structured research through a scraped chat UI. There is no structured-output
	 * mode here like the direct APIs have, so the schema goes into the prompt and
	 * the reply is parsed back out. Web search is always on — that is what the
	 * chat product does — so the `webSearch` option is ignored.
	 *
	 * One retry on unparseable output; each attempt is a fresh scrape (5 credits,
	 * up to 300s), so a second failure throws rather than looping.
	 */
	async runStructuredResearch<T>({
		prompt,
		schema,
		version,
		targetMarket,
		targetLanguage,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		const model = version && OLOSTEP_PARSERS[version] ? version : "chatgpt";
		const jsonSchema = z.toJSONSchema(schema as z.ZodType);
		const trimmed =
			prompt.length > MAX_RESEARCH_PROMPT_CHARS
				? `${prompt.slice(0, MAX_RESEARCH_PROMPT_CHARS)}\n[truncated]`
				: prompt;
		const instruction = `${trimmed}\n\nReply with ONLY a single JSON object matching this JSON Schema. No prose, no markdown fences.\n${JSON.stringify(jsonSchema)}`;

		let lastError: unknown;
		for (let attempt = 0; attempt < 2; attempt++) {
			const result = await olostep.run(
				model,
				attempt === 0
					? instruction
					: `${instruction}\n\nA previous attempt returned text that was not valid JSON. Output the JSON object and nothing else.`,
				// Olostep localizes in `run` (response language + scrape country),
				// so the structured path has to forward the brand's locale too.
				{ targetMarket, targetLanguage },
			);
			try {
				return {
					object: schema.parse(extractJsonObject(result.textContent)),
					modelVersion: result.modelVersion ?? `olostep:${model}`,
				};
			} catch (err) {
				lastError = err;
				console.warn(`[olostep] structured research attempt ${attempt + 1} did not yield valid JSON:`, err);
			}
		}
		throw new Error(
			`Olostep structured research failed to return valid JSON (model=${model}): ${lastError instanceof Error ? lastError.message : String(lastError)}`,
		);
	},
};
