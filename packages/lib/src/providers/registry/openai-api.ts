import { openai, createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { z } from "zod";
import { extractTextFromOpenAI, extractCitationsFromOpenAI } from "../../text-extraction";
import type {
	Provider,
	ScrapeResult,
	ProviderOptions,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";
import { localeCountryCode, localeSystemPrompt } from "../locale";
import { getChatGptPlanAccessToken, getChatGptPlanStatus } from "../../chatgpt-plan-auth";

const DEFAULT_RESEARCH_MODEL = "gpt-4o-mini";
const DEFAULT_CHATGPT_PLAN_MODEL = "gpt-5.5";

function sanitizeForJson(obj: unknown): unknown {
	return JSON.parse(JSON.stringify(obj));
}

function getOpenAIResponsesModel(model: string) {
	const provider = process.env.OPENAI_API_KEY
		? createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
		: openai;
	return provider.responses(model);
}

/** ChatGPT-plan OAuth is supported through the Responses API in streaming mode. */
async function runWithChatGptPlan<T>(
	model: string,
	prompt: string,
	options: ProviderOptions | undefined,
	structuredSchema?: { jsonSchema: unknown; parse: (value: unknown) => T },
): Promise<{ response: any; textContent: string; object?: T }> {
	const accessToken = await getChatGptPlanAccessToken();
	const localeInstructions = localeSystemPrompt(options);
	const instructions = [
		localeInstructions,
		structuredSchema
			? `Return only a JSON object matching this JSON Schema. Do not use markdown fences.\n${JSON.stringify(structuredSchema.jsonSchema)}`
			: "",
	].filter(Boolean).join("\n\n");
	const body = {
		model,
		input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
		...(instructions ? { instructions } : {}),
		stream: true,
		store: false,
		...(options?.webSearch ? { tools: [{ type: "web_search" }], tool_choice: "auto" } : {}),
	};
	const result = await fetch("https://api.openai.com/v1/responses", {
		method: "POST",
		headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(5 * 60 * 1000),
	});
	if (!result.ok) {
		const detail = await result.text();
		throw new Error(`OpenAI ChatGPT-plan request failed (${result.status}): ${detail.slice(0, 1200)}`);
	}
	if (!result.body) throw new Error("OpenAI ChatGPT-plan response did not include a stream.");

	const reader = result.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let responseBody: any;
	let streamError: string | undefined;
	const streamedItems = new Map<number, any>();
	const streamedContent = new Map<
		string,
		{ outputIndex: number; contentIndex: number; text?: string; annotations: any[]; part?: any }
	>();
	while (true) {
		const { value, done } = await reader.read();
		buffer += decoder.decode(value, { stream: !done });
		const records = buffer.split(/\r?\n\r?\n/);
		buffer = records.pop() ?? "";
		for (const record of records) {
			const data = record.split(/\r?\n/).find((line) => line.startsWith("data: "))?.slice(6);
			if (!data || data === "[DONE]") continue;
			let event: any;
			try { event = JSON.parse(data); } catch { continue; }
			if (event.type === "response.completed") responseBody = event.response;
			if ((event.type === "response.output_item.added" || event.type === "response.output_item.done") &&
				Number.isInteger(event.output_index) && event.item) {
				streamedItems.set(event.output_index, event.item);
			}
			if ((event.type === "response.output_text.delta" || event.type === "response.output_text.done" ||
				event.type === "response.content_part.done" || event.type === "response.output_text.annotation.added") &&
				Number.isInteger(event.output_index) && Number.isInteger(event.content_index)) {
				const key = `${event.output_index}:${event.content_index}`;
				const content: {
					outputIndex: number;
					contentIndex: number;
					text?: string;
					annotations: any[];
					part?: any;
				} = streamedContent.get(key) ?? {
					outputIndex: event.output_index,
					contentIndex: event.content_index,
					annotations: [],
				};
				if (event.type === "response.output_text.delta") content.text = `${content.text ?? ""}${event.delta ?? ""}`;
				if (event.type === "response.output_text.done") content.text = event.text ?? content.text;
				if (event.type === "response.content_part.done") content.part = event.part;
				if (event.type === "response.output_text.annotation.added" && event.annotation) content.annotations.push(event.annotation);
				streamedContent.set(key, content);
			}
			if (event.type === "response.failed" || event.type === "error") {
				streamError = event.response?.error?.message ?? event.error?.message ?? "The response stream failed.";
			}
		}
		if (done) break;
	}
	if (streamError) throw new Error(`OpenAI ChatGPT-plan request failed: ${streamError}`);
	if (!responseBody) throw new Error("OpenAI ChatGPT-plan stream ended before a completed response event.");
	// Some ChatGPT-plan Responses streams complete with output: [] even though
	// they emitted the actual answer as semantic SSE events. Rebuild those items
	// from the stream so prompt runs retain their answer text and web citations.
	if (!Array.isArray(responseBody.output) || responseBody.output.length === 0) {
		for (const content of streamedContent.values()) {
			let item = streamedItems.get(content.outputIndex);
			if (!item) {
				item = { type: "message", role: "assistant", status: "completed", content: [] };
				streamedItems.set(content.outputIndex, item);
			}
			if (!Array.isArray(item.content)) item.content = [];
			const part = content.part ?? item.content[content.contentIndex] ?? { type: "output_text", text: "", annotations: [] };
			if (content.text !== undefined) part.text = content.text;
			if (content.annotations.length > 0) {
				const annotations = Array.isArray(part.annotations) ? part.annotations : [];
				const seen = new Set(annotations.map((annotation: any) => JSON.stringify([
					annotation.type,
					annotation.url,
					annotation.start_index,
					annotation.end_index,
				])));
				part.annotations = [
					...annotations,
					...content.annotations.filter((annotation) => {
						const key = JSON.stringify([annotation.type, annotation.url, annotation.start_index, annotation.end_index]);
						if (seen.has(key)) return false;
						seen.add(key);
						return true;
					}),
				];
			}
			item.content[content.contentIndex] = part;
		}
		responseBody.output = [...streamedItems.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
	}
	if (responseBody.output.length === 0 && streamedItems.size === 0) {
		throw new Error("OpenAI ChatGPT-plan stream completed without output items.");
	}
	const textContent = extractTextFromOpenAI(responseBody);
	if (textContent === "No text content found in OpenAI output.") {
		throw new Error("OpenAI ChatGPT-plan stream completed without any text content.");
	}
	return {
		response: responseBody,
		textContent,
		...(structuredSchema ? { object: structuredSchema.parse(JSON.parse(textContent)) } : {}),
	};
}

async function runOpenAI(prompt: string, model: string, options?: ProviderOptions): Promise<ScrapeResult> {
	if (!process.env.OPENAI_API_KEY || (await getChatGptPlanStatus()).connected) {
		const { response } = await runWithChatGptPlan(model, prompt, options);
		const webQueries = (response.output ?? [])
			.filter((item: any) => item.type === "web_search_call" && item.action?.query)
			.map((item: any) => item.action.query);
		return {
			rawOutput: sanitizeForJson(response),
			webQueries,
			textContent: extractTextFromOpenAI(response),
			citations: extractCitationsFromOpenAI(response),
			modelVersion: model,
		};
	}
	const tools: Record<string, any> = {};
	if (options?.webSearch) {
		// Without `userLocation` the web_search tool geolocates the *caller's* IP,
		// so a worker hosted in India returns city-level Indian results for every
		// brand regardless of the target market.
		const country = localeCountryCode(options);
		tools.web_search = openai.tools.webSearch({
			searchContextSize: "low",
			...(country ? { userLocation: { type: "approximate" as const, country } } : {}),
		}) as any;
	}

	const system = localeSystemPrompt(options);

	const result = await generateText({
		model: openai.responses(model),
		prompt,
		...(system ? { system } : {}),
		toolChoice: Object.keys(tools).length > 0 ? "auto" : "none",
		...(Object.keys(tools).length > 0 ? { tools } : {}),
	});

	const responseBody = result.response?.body as any;

	const webQueries: string[] = [];
	if (responseBody?.output) {
		for (const outputItem of responseBody.output) {
			if (outputItem.type === "web_search_call" && outputItem.action?.query) {
				webQueries.push(outputItem.action.query);
			}
		}
	}

	return {
		rawOutput: sanitizeForJson(responseBody),
		webQueries,
		textContent: extractTextFromOpenAI(responseBody),
		citations: extractCitationsFromOpenAI(responseBody),
		modelVersion: model,
	};
}

export const openaiApi: Provider = {
	id: "openai-api",
	name: "OpenAI API",

	isConfigured() {
		return !!process.env.OPENAI_API_KEY || process.env.DEPLOYMENT_MODE === "local";
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
	const version = options?.version ?? (process.env.OPENAI_API_KEY ? DEFAULT_RESEARCH_MODEL : DEFAULT_CHATGPT_PLAN_MODEL);
		return runOpenAI(prompt, version, options);
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
		version,
		webSearch = true,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		const targetModel = version ?? (process.env.OPENAI_API_KEY ? DEFAULT_RESEARCH_MODEL : DEFAULT_CHATGPT_PLAN_MODEL);
		if (!process.env.OPENAI_API_KEY || (await getChatGptPlanStatus()).connected) {
			const result = await runWithChatGptPlan(targetModel, prompt, { webSearch }, {
				jsonSchema: z.toJSONSchema(schema as z.ZodType),
				parse: (value) => schema.parse(value),
			});
			return { object: result.object as T, modelVersion: targetModel };
		}
		const result = await generateText({
			model: getOpenAIResponsesModel(targetModel),
			...(webSearch ? { tools: { web_search: openai.tools.webSearch({ searchContextSize: "medium" }) as any } } : {}),
			experimental_output: Output.object({ schema }),
			prompt,
		});
		return {
			object: result.experimental_output as T,
			modelVersion: targetModel,
		};
	},
};
