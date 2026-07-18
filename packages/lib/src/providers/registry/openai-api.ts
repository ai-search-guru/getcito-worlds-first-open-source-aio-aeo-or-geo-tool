import { openai, createOpenAI } from "@ai-sdk/openai";
import { generateText, Output } from "ai";
import { extractTextFromOpenAI, extractCitationsFromOpenAI } from "../../text-extraction";
import type {
	Provider,
	ScrapeResult,
	ProviderOptions,
	StructuredResearchOptions,
	StructuredResearchResult,
} from "../types";

const DEFAULT_RESEARCH_MODEL = "gpt-4o-mini";

function sanitizeForJson(obj: unknown): unknown {
	return JSON.parse(JSON.stringify(obj));
}

function getOpenAIResponsesModel(model: string) {
	const provider = process.env.OPENAI_API_KEY
		? createOpenAI({ apiKey: process.env.OPENAI_API_KEY })
		: openai;
	return provider.responses(model);
}

async function runOpenAI(prompt: string, model: string, options?: ProviderOptions): Promise<ScrapeResult> {
	const tools: Record<string, any> = {};
	if (options?.webSearch) {
		tools.web_search = openai.tools.webSearch({
			searchContextSize: "low",
		}) as any;
	}

	const result = await generateText({
		model: openai.responses(model),
		prompt,
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
		return !!process.env.OPENAI_API_KEY;
	},

	async run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult> {
		const version = options?.version ?? DEFAULT_RESEARCH_MODEL;
		return runOpenAI(prompt, version, options);
	},

	async runStructuredResearch<T>({
		prompt,
		schema,
		webSearch = true,
	}: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>> {
		const result = await generateText({
			model: getOpenAIResponsesModel(DEFAULT_RESEARCH_MODEL),
			...(webSearch ? { tools: { web_search: openai.tools.webSearch({ searchContextSize: "medium" }) as any } } : {}),
			experimental_output: Output.object({ schema }),
			prompt,
		});
		return {
			object: result.experimental_output as T,
			modelVersion: DEFAULT_RESEARCH_MODEL,
		};
	},
};
