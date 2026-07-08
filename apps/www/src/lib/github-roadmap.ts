import { Redis } from "@upstash/redis";
import { createServerFn } from "@tanstack/react-start";

const redis = new Redis({
	url: process.env.UPSTASH_REDIS_REST_URL!,
	token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CACHE_KEY = "gh:roadmap:ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool";
const TTL_SECONDS = 60 * 60;
const ERROR_TTL_SECONDS = 60;

const REPO = "ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool";
const API_BASE = `https://api.github.com/repos/${REPO}`;

export interface RoadmapIssue {
	number: number;
	title: string;
	html_url: string;
	labels: { name: string; color: string }[];
	created_at: string;
	reactions: number;
	comments: number;
	engagement: number;
	area: string;
}

export interface RoadmapData {
	issues: RoadmapIssue[];
	totalCount: number;
}

interface RawIssue {
	number: number;
	title: string;
	html_url: string;
	pull_request?: unknown;
	created_at: string;
	comments: number;
	reactions?: { total_count: number };
	labels: { name: string; color: string }[];
}

const AREA_LABELS: Record<string, string> = {
	"area/core": "Core Platform",
	"area/oss": "Open Source",
	"area/extensions": "Extensions",
	"area/admin": "Admin",
	"area/whitelabel": "White Label",
	"area/cloud": "Cloud",
};

const headers: Record<string, string> = {
	Accept: "application/vnd.github+json",
	"User-Agent": "getcito-www",
};
if (process.env.GITHUB_TOKEN) {
	headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
}

async function fetchJson<T>(url: string): Promise<T> {
	const res = await fetch(url, { headers });
	if (!res.ok) {
		throw new Error(`GitHub API ${res.status}: ${url}`);
	}
	return (await res.json()) as T;
}

export const getGitHubRoadmap = createServerFn({ method: "GET" }).handler(
	async (): Promise<RoadmapData> => {
		try {
			const cached = await redis.get<RoadmapData>(CACHE_KEY);
			if (cached && Array.isArray(cached.issues)) return cached;

			const pages = await Promise.all([
				fetchJson<RawIssue[]>(
					`${API_BASE}/issues?state=open&sort=created&direction=desc&per_page=100&page=1`,
				),
				fetchJson<RawIssue[]>(
					`${API_BASE}/issues?state=open&sort=created&direction=desc&per_page=100&page=2`,
				),
			]);

			const issues: RoadmapIssue[] = pages
				.flat()
				.filter((i) => !i.pull_request)
				.map((i) => {
					const reactions = i.reactions?.total_count ?? 0;
					const comments = i.comments ?? 0;
					const areaLabel = i.labels.find((l) => l.name.startsWith("area/"));
					const area =
						(areaLabel && AREA_LABELS[areaLabel.name]) ??
						areaLabel?.name ??
						"Other";
					return {
						number: i.number,
						title: i.title,
						html_url: i.html_url,
						labels: i.labels.map((l) => ({ name: l.name, color: l.color })),
						created_at: i.created_at,
						reactions,
						comments,
						engagement: reactions + comments,
						area,
					};
				});

			const data: RoadmapData = { issues, totalCount: issues.length };
			await redis.set(CACHE_KEY, data, { ex: TTL_SECONDS });
			return data;
		} catch {
			const empty: RoadmapData = { issues: [], totalCount: 0 };
			await redis.set(CACHE_KEY, empty, { ex: ERROR_TTL_SECONDS });
			return empty;
		}
	},
);
