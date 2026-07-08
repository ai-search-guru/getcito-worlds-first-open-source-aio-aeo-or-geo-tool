import { Redis } from "@upstash/redis";
import { createServerFn } from "@tanstack/react-start";

const redis = new Redis({
	url: process.env.UPSTASH_REDIS_REST_URL!,
	token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CACHE_KEY = "gh:stars:ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool";
const TTL_SECONDS = 60 * 60;
const ERROR_TTL_SECONDS = 60;
const FALLBACK_STARS = 0;

export const getGitHubStars = createServerFn({ method: "GET" }).handler(
	async () => {
		try {
			const cached = await redis.get<number>(CACHE_KEY);
			if (typeof cached === "number") return cached;

			const res = await fetch(
				"https://api.github.com/repos/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool",
				{
					headers: {
						"User-Agent": "getcito-www",
						Accept: "application/vnd.github+json",
					},
				},
			);

			if (!res.ok) {
				await redis.set(CACHE_KEY, FALLBACK_STARS, { ex: ERROR_TTL_SECONDS });
				return FALLBACK_STARS;
			}

			const data = (await res.json()) as { stargazers_count?: number };
			const count = data.stargazers_count ?? FALLBACK_STARS;
			await redis.set(CACHE_KEY, count, { ex: TTL_SECONDS });
			return count;
		} catch {
			return FALLBACK_STARS;
		}
	},
);

export function formatStarCount(count: number): string {
	if (count < 1000) return String(count);
	const k = count / 1000;
	return k >= 10 ? `${Math.round(k)}k` : `${k.toFixed(1)}k`;
}
