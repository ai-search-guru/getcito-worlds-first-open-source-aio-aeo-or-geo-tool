import { Redis } from "@upstash/redis";
import { createServerFn } from "@tanstack/react-start";

const redis = new Redis({
	url: process.env.UPSTASH_REDIS_REST_URL!,
	token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export interface StatusEntry {
	ts: string;
	status: "pass" | "fail";
	latency: number;
	retries: number;
	textLength: number;
	rawOutputBytes: number;
	citations: number;
	webQueries: number;
	webSearch: boolean;
	error: string | null;
}

export interface TargetStatus {
	target: string;
	entries: StatusEntry[];
}

const TARGETS = [
	"chatgpt:olostep:online",
	"google-ai-mode:olostep:online",
	"google-ai-overview:olostep:online",
	"gemini:olostep:online",
	"copilot:olostep:online",
	"perplexity:olostep:online",
	"grok:olostep:online",
	"chatgpt:brightdata",
	"chatgpt:brightdata:online",
	"google-ai-mode:brightdata:online",
	"gemini:brightdata:online",
	"perplexity:brightdata:online",
	"grok:brightdata:online",
	"copilot:brightdata:online",
	"chatgpt:oxylabs",
	"chatgpt:oxylabs:online",
	"google-ai-mode:oxylabs:online",
	"perplexity:oxylabs:online",
	"google-ai-mode:dataforseo:online",
	"chatgpt:dataforseo:online",
	"perplexity:dataforseo:online",
	"gemini:dataforseo:online",
	"chatgpt:openai-api:gpt-5-mini",
	"chatgpt:openai-api:gpt-5-mini:online",
	"claude:anthropic-api:claude-sonnet-4-6",
	"claude:anthropic-api:claude-sonnet-4-6:online",
	"claude:openrouter:anthropic/claude-sonnet-4.6",
	"claude:openrouter:anthropic/claude-sonnet-4.6:online",
	"chatgpt:openrouter:openai/gpt-5-mini",
	"chatgpt:openrouter:openai/gpt-5-mini:online",
	"deepseek:openrouter:deepseek/deepseek-v3.2",
	"mistral:openrouter:mistralai/mistral-small-2603",
	"mistral:mistral-api:mistral-medium-latest",
	"mistral:mistral-api:mistral-medium-latest:online",
];

export const getStatusData = createServerFn({ method: "GET" }).handler(
	async () => {
		const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

		const results: TargetStatus[] = await Promise.all(
			TARGETS.map(async (target) => {
				const key = `provider-status:${target}`;
				const raw: string[] = await redis.zrange(key, sevenDaysAgo, "+inf", {
					byScore: true,
				});

				const entries: StatusEntry[] = raw.map((item) => {
					if (typeof item === "string") return JSON.parse(item);
					return item as unknown as StatusEntry;
				});

				return { target, entries };
			}),
		);

		return results;
	},
);
