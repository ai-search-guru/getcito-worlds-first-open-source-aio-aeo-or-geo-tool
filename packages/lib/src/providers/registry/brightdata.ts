import { bdclient } from "@brightdata/sdk";
import type { Provider, ScrapeResult, ProviderOptions, ModelConfig } from "../types";
import type { Citation } from "../../text-extraction";
import { WEB_QUERIES_UNAVAILABLE } from "../../constants";
import { DATAFORSEO_LOCATION_LANGUAGES } from "../../location-languages";
import { BRIGHTDATA_COUNTRIES } from "../../brightdata-locations";

const BD_DATASET_IDS: Record<string, string> = {
	chatgpt: "gd_m7aof0k82r803d5bjm",
	perplexity: "gd_m7dhdot1vw9a7gc1n",
	copilot: "gd_m7di5jy6s9geokz8w",
	gemini: "gd_mbz66arm2mf9cu856y",
	grok: "gd_m8ve0u141icu75ae74",
	"google-ai-mode": "gd_mcswdt6z2elth3zqr2",
	"google-ai-overview": "gd_mfz5x93lmsjjjylob",
};

const BD_BASE_URL: Record<string, string> = {
	chatgpt: "https://chatgpt.com/",
	"google-ai-mode": "https://google.com/aimode",
	"google-ai-overview": "https://www.google.com/",
	gemini: "https://gemini.google.com/",
	copilot: "https://copilot.microsoft.com/chats",
	perplexity: "https://www.perplexity.ai/",
	grok: "https://grok.com/",
};

function createClient(): bdclient {
	return new bdclient({ apiKey: process.env.BRIGHTDATA_API_TOKEN });
}

function getLanguageCode(languageName: string): string | undefined {
	for (const languages of Object.values(DATAFORSEO_LOCATION_LANGUAGES)) {
		const match = languages.find((l) => l.name === languageName);
		if (match) return match.code;
	}
	return undefined;
}

function getCountryCode(countryName: string): string | undefined {
	return BRIGHTDATA_COUNTRIES[countryName];
}

function normalizeAnswer(record: Record<string, any>): string {
	for (const key of ["aio_text", "answer_text_markdown", "answer_text", "answer", "response_raw", "response", "text", "content"]) {
		if (typeof record[key] === "string" && record[key].trim()) return record[key].trim();
	}
	// If this is a Google Search result without an AI overview, we don't want to return the raw JSON
	if (record.general?.search_engine === "google" || record.input?.url === "https://google.com/aimode") {
		return "No Google AI mode invoked.";
	}
	return JSON.stringify(record).slice(0, 2000);
}

function extractSources(record: Record<string, any>): Citation[] {
	const citations: Citation[] = [];
	const seen = new Set<string>();
	let idx = 0;

	for (const field of ["citations", "links_attached", "sources"]) {
		const arr = record[field];
		if (!Array.isArray(arr)) continue;
		for (const item of arr) {
			const url = typeof item === "string" ? item : item?.url;
			if (!url || typeof url !== "string" || !url.startsWith("http")) continue;
			if (seen.has(url)) continue;
			seen.add(url);
			try {
				const parsed = new URL(url);
				citations.push({
					url,
					title: item?.title ?? undefined,
					domain: parsed.hostname.replace(/^www\./, ""),
					citationIndex: idx++,
				});
			} catch (e) {
				console.warn(`BrightData: skipping invalid citation URL: ${url}`, e);
			}
		}
	}
	return citations;
}

function extractWebQueries(record: Record<string, any>): string[] {
	// web_search_query is a direct array of strings (e.g. grok)
	if (Array.isArray(record.web_search_query)) {
		return record.web_search_query.filter((q: any) => typeof q === "string" && q.trim());
	}
	// search_model_queries may be nested in metadata (e.g. chatgpt)
	const smq = record.metadata?.search_model_queries ?? record.search_model_queries;
	if (smq?.queries && Array.isArray(smq.queries)) {
		return smq.queries.filter((q: any) => typeof q === "string" && q.trim());
	}
	if (Array.isArray(smq)) {
		return smq.filter((q: any) => typeof q === "string" && q.trim());
	}
	return [];
}

export const brightdata: Provider = {
	id: "brightdata",
	name: "BrightData",

	isConfigured() {
		return !!process.env.BRIGHTDATA_API_TOKEN;
	},

	validateTarget(config: ModelConfig) {
		// Allow custom dataset IDs via version slug (e.g. chatgpt:brightdata:gd_abc123)
		if (!config.version && !BD_DATASET_IDS[config.model]) {
			return `BrightData does not support model "${config.model}". Supported: ${Object.keys(BD_DATASET_IDS).join(", ")}`;
		}
		// ChatGPT has a web search toggle; all other chatbots always search
		if (!config.webSearch && config.model !== "chatgpt") {
			return `${config.model}:brightdata requires :online — this chatbot always uses web search`;
		}
		return null;
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const datasetId = options?.version ?? BD_DATASET_IDS[model];
		if (!datasetId) {
			throw new Error(
				`BrightData: no dataset ID for model "${model}". ` +
				`Either use a known model (${Object.keys(BD_DATASET_IDS).join(", ")}) ` +
				`or pass a dataset ID as the version slug: ${model}:brightdata:gd_abc123`,
			);
		}

		const client = createClient();
		let snapshotId: string | undefined;
		let consumed = false;
		try {
			const triggerUrl = `https://api.brightdata.com/datasets/v3/trigger?dataset_id=${datasetId}&notify=false&include_errors=true&format=json`;
			
			const defaultMarket = options?.targetMarket ?? "US";
			const defaultLanguage = options?.targetLanguage ?? "en";

			let payloadData: any = {
				url: BD_BASE_URL[model] ?? "",
				prompt,
				index: 1,
				...(model === "chatgpt" ? { web_search: options?.webSearch ?? false } : {}),
				country: getCountryCode(defaultMarket) ?? defaultMarket,
				...(model === "google-ai-mode"
					? { hl: getLanguageCode(defaultLanguage) ?? "en" }
					: { additional_prompt: `Please provide your response in ${defaultLanguage}.` }),
			};

			if (model === "google-ai-overview") {
				payloadData = {
					url: "https://www.google.com/",
					keyword: prompt,
					language: options?.targetLanguage ? (getLanguageCode(options.targetLanguage) ?? "en") : "en",
					country: options?.targetMarket ? (getCountryCode(options.targetMarket) ?? "US") : "US",
					start_page: 1,
					end_page: 10,
					collapse_aio: false
				};
			}

			let triggerRes = await fetch(triggerUrl, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify([payloadData]),
			});

			if (triggerRes.status === 400) {
				const errorText = await triggerRes.text();
				if (errorText.includes('"country"')) {
					// The scraper doesn't support this specific country, retry without it
					delete payloadData.country;
					triggerRes = await fetch(triggerUrl, {
						method: "POST",
						headers: {
							Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}`,
							"Content-Type": "application/json",
						},
						body: JSON.stringify([payloadData]),
					});
				} else {
					throw new Error(`BrightData trigger failed (400): ${errorText}`);
				}
			}

			if (!triggerRes.ok) {
				throw new Error(`BrightData trigger failed (${triggerRes.status}): ${await triggerRes.text()}`);
			}

			({ snapshot_id: snapshotId } = (await triggerRes.json()) as { snapshot_id: string });
			await pollUntilReady(snapshotId);
			
			let payload;
			for (let i = 0; i < 5; i++) {
				try {
					payload = await client.scrape.snapshot.fetch(snapshotId, { format: "json" });
					break;
				} catch (err: any) {
					if (i === 4 || !err.message?.toLowerCase().includes("not ready")) throw err;
					await new Promise((resolve) => setTimeout(resolve, 3000));
				}
			}
			consumed = true;

			const record = (Array.isArray(payload) ? payload[0] : payload) ?? {};
			const answer = normalizeAnswer(record);

			const webQueries = extractWebQueries(record);
			const citations = extractSources(record);

			// Drop large HTML fields that aren't used for extraction.
			// Keeps all structured data (shopping, recommendations, citations, etc.)
			const { answer_html, response_raw, answer_section_html, ...trimmed } = record;
			const rawOutput = Array.isArray(payload) ? [trimmed] : trimmed;

			return {
				rawOutput,
				textContent: answer,
				// Only mark web queries as "unavailable" when web search was enabled
				// and citations exist but no query strings were exposed.
				// When web search is disabled, webQueries is always empty.
				webQueries: options?.webSearch
					? (webQueries.length > 0 ? webQueries : citations.length > 0 ? [WEB_QUERIES_UNAVAILABLE] : [])
					: [],
				citations,
				modelVersion: record?.model ?? undefined,
			};
		} finally {
			// A triggered snapshot we never consumed (timeout, terminal failure, an
			// unknown status we gave up on, or any thrown error) keeps running on
			// BrightData and counts against the per-dataset concurrency cap — which
			// eventually 429s even healthy triggers. Best-effort cancel so abandoned
			// jobs don't accumulate. (Worker SIGTERM mid-poll still leaks; those need
			// the periodic snapshot sweep.)
			if (snapshotId && !consumed) await cancelSnapshot(client, snapshotId);
			await client.close();
		}
	},
};

/** Terminal failure statuses from datasets/v3/progress. Anything else —
 *  running, building, "starting", queued, or a status BrightData adds later —
 *  is treated as "still working" so a degraded scraper or an unrecognized
 *  status string doesn't fail the run on the very first poll. */
const TERMINAL_FAILURE = new Set(["failed", "error", "cancelled"]);

async function pollUntilReady(snapshotId: string): Promise<void> {
	const maxAttempts = 60;
	const BASE_DELAY = 2000;
	const MAX_DELAY = 10000;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		const status = await getSnapshotStatus(snapshotId);
		if (status === "ready") return;
		if (TERMINAL_FAILURE.has(status)) {
			throw new Error(`BrightData snapshot ${snapshotId} ${status}`);
		}

		const delay = Math.min(BASE_DELAY * Math.pow(2, Math.floor(attempt / 5)), MAX_DELAY);
		await new Promise((resolve) => setTimeout(resolve, delay));
	}

	throw new Error(`BrightData snapshot ${snapshotId} timed out`);
}

/** Read snapshot status straight from datasets/v3/progress. We bypass the SDK's
 *  getStatus because its response schema is a strict enum
 *  (running|ready|failed|cancelled|error) that throws on any other value — and the
 *  live API also returns statuses like "starting", which would otherwise fail the
 *  run instantly instead of waiting. A transient HTTP/parse error is reported as a
 *  non-terminal status so we keep polling rather than abandon the snapshot. */
async function getSnapshotStatus(snapshotId: string): Promise<string> {
	try {
		const res = await fetch(`https://api.brightdata.com/datasets/v3/progress/${snapshotId}`, {
			headers: { Authorization: `Bearer ${process.env.BRIGHTDATA_API_TOKEN}` },
		});
		if (!res.ok) return "pending";
		const body = (await res.json()) as { status?: string };
		return body.status ?? "pending";
	} catch {
		return "pending";
	}
}

/** Best-effort cancel of a triggered snapshot we're abandoning, so it stops
 *  counting against BrightData's per-dataset running-jobs cap. Cancellation is
 *  cleanup, not part of the run's success path, so errors are swallowed. */
async function cancelSnapshot(client: bdclient, snapshotId: string): Promise<void> {
	try {
		await client.scrape.snapshot.cancel(snapshotId);
	} catch (e) {
		console.warn(`BrightData: failed to cancel snapshot ${snapshotId}`, e);
	}
}
