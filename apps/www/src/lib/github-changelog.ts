import { Redis } from "@upstash/redis";
import { createServerFn } from "@tanstack/react-start";

const redis = new Redis({
	url: process.env.UPSTASH_REDIS_REST_URL!,
	token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const CACHE_KEY = "gh:changelog:ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool";
const TTL_SECONDS = 60 * 60;
const ERROR_TTL_SECONDS = 60;

const REPO = "ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool";
const API_BASE = `https://api.github.com/repos/${REPO}`;

export interface ChangelogIssue {
	number: number;
	title: string;
	html_url: string;
	labels: { name: string; color: string }[];
	closed_at: string;
}

export interface ChangelogMonth {
	month: string;
	label: string;
	issues: ChangelogIssue[];
}

interface RawIssue {
	number: number;
	title: string;
	html_url: string;
	pull_request?: unknown;
	closed_at: string | null;
	created_at: string;
	state_reason?: string | null;
	labels: { name: string; color: string }[];
}

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

function groupByMonth(issues: ChangelogIssue[]): ChangelogMonth[] {
	const groups = new Map<string, ChangelogIssue[]>();

	for (const issue of issues) {
		const date = new Date(issue.closed_at);
		const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
		const list = groups.get(key) ?? [];
		list.push(issue);
		groups.set(key, list);
	}

	return Array.from(groups.entries())
		.sort(([a], [b]) => b.localeCompare(a))
		.map(([month, items]) => {
			const [year, m] = month.split("-");
			const date = new Date(Number(year), Number(m) - 1);
			return {
				month,
				label: date.toLocaleDateString("en-US", {
					month: "long",
					year: "numeric",
				}),
				issues: items,
			};
		});
}

export const getGitHubChangelog = createServerFn({ method: "GET" }).handler(
	async (): Promise<ChangelogMonth[]> => {
		try {
			const cached = await redis.get<ChangelogMonth[]>(CACHE_KEY);
			if (Array.isArray(cached)) return cached;

			const pages = await Promise.all([
				fetchJson<RawIssue[]>(
					`${API_BASE}/issues?state=closed&sort=updated&direction=desc&per_page=100&page=1`,
				),
				fetchJson<RawIssue[]>(
					`${API_BASE}/issues?state=closed&sort=updated&direction=desc&per_page=100&page=2`,
				),
			]);

			const issues: ChangelogIssue[] = pages
				.flat()
				.filter(
					(i) =>
						!i.pull_request &&
						i.closed_at &&
						i.state_reason !== "not_planned" &&
						i.state_reason !== "duplicate",
				)
				.map((i) => ({
					number: i.number,
					title: i.title,
					html_url: i.html_url,
					closed_at: i.closed_at as string,
					labels: i.labels.map((l) => ({ name: l.name, color: l.color })),
				}));

			const months = groupByMonth(issues);
			await redis.set(CACHE_KEY, months, { ex: TTL_SECONDS });
			return months;
		} catch {
			await redis.set(CACHE_KEY, [] as ChangelogMonth[], {
				ex: ERROR_TTL_SECONDS,
			});
			return [];
		}
	},
);
