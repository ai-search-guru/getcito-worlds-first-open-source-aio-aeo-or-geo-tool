import { Redis } from "@upstash/redis";
import { createServerFn } from "@tanstack/react-start";

const redis = new Redis({
	url: process.env.UPSTASH_REDIS_REST_URL!,
	token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CACHE_KEY = "gh:releases:ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool";
const TTL_SECONDS = 60 * 60;
const ERROR_TTL_SECONDS = 60;

export interface ReleaseEntry {
	id: number;
	tag_name: string;
	name: string | null;
	html_url: string;
	published_at: string;
	body: string | null;
	prerelease: boolean;
}

export const getGitHubReleases = createServerFn({ method: "GET" }).handler(
	async (): Promise<ReleaseEntry[]> => {
		try {
			const cached = await redis.get<ReleaseEntry[]>(CACHE_KEY);
			if (Array.isArray(cached)) return cached;

			const res = await fetch(
				"https://api.github.com/repos/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/releases?per_page=50",
				{
					headers: {
						"User-Agent": "getcito-www",
						Accept: "application/vnd.github+json",
					},
				},
			);

			if (!res.ok) {
				await redis.set(CACHE_KEY, [] as ReleaseEntry[], {
					ex: ERROR_TTL_SECONDS,
				});
				return [];
			}

			const raw = (await res.json()) as Array<{
				id: number;
				tag_name: string;
				name: string | null;
				html_url: string;
				published_at: string;
				body: string | null;
				prerelease: boolean;
				draft: boolean;
			}>;

			const releases: ReleaseEntry[] = raw
				.filter((r) => !r.draft)
				.map((r) => ({
					id: r.id,
					tag_name: r.tag_name,
					name: r.name,
					html_url: r.html_url,
					published_at: r.published_at,
					body: r.body,
					prerelease: r.prerelease,
				}));

			await redis.set(CACHE_KEY, releases, { ex: TTL_SECONDS });
			return releases;
		} catch {
			return [];
		}
	},
);
