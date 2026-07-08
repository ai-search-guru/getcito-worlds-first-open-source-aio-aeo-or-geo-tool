import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, ThumbsUp, MessageCircle } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { ogMeta, canonicalUrl, breadcrumbJsonLd } from "@/lib/seo";
import {
	getGitHubRoadmap,
	type RoadmapIssue as GitHubRoadmapIssue,
} from "@/lib/github-roadmap";
import upcomingData from "@/data/upcoming-features.json";

const title = "Roadmap · Getcito";
const description =
	"See what's coming next for Getcito. React or comment on GitHub issues to help prioritize.";

const PROJECT_BOARD_URL = "https://github.com/orgs/Getcitohq/projects/3/views/1";
const ISSUES_URL = "https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/issues";

interface UpcomingHighlight {
	title: string;
	description: string;
	tag: string;
	issue?: number;
	url: string;
}

const upcomingHighlights = (upcomingData as { highlights: UpcomingHighlight[] })
	.highlights;

export const Route = createFileRoute("/roadmap")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/roadmap" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/roadmap") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "Roadmap", path: "/roadmap" },
			]),
		],
	}),
	loader: async () => {
		const roadmap = await getGitHubRoadmap();
		const issues = roadmap.issues;
		const hasReactions = issues.some((i) => i.reactions > 0);
		const sorted = [...issues].sort((a, b) => {
			if (hasReactions) {
				if (b.reactions !== a.reactions) return b.reactions - a.reactions;
				if (b.comments !== a.comments) return b.comments - a.comments;
			}
			return (
				new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
			);
		});
		return {
			popularIssues: sorted.slice(0, 7),
			upcoming: upcomingHighlights,
		};
	},
	component: RoadmapPage,
});

function GitHubGlyph({ className = "" }: { className?: string }) {
	return (
		<svg viewBox="0 0 24 24" className={`fill-current ${className}`}>
			<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
		</svg>
	);
}

function HighlightCard({ highlight }: { highlight: UpcomingHighlight }) {
	return (
		<a
			href={highlight.url}
			target="_blank"
			rel="noopener noreferrer"
			className="group flex h-full flex-col gap-3 rounded-md border border-zinc-200 bg-white p-5 transition-colors hover:border-blue-300 hover:bg-blue-50/30"
		>
			<h3 className="text-lg font-semibold leading-snug tracking-tight text-zinc-950 group-hover:text-blue-700">
				{highlight.title}
			</h3>
			<p className="text-sm text-pretty text-zinc-600">
				{highlight.description}
			</p>
			<div className="mt-auto flex items-center justify-between pt-1">
				{highlight.issue ? (
					<span className="font-mono text-[11px] tabular-nums text-zinc-500">
						#{highlight.issue}
					</span>
				) : (
					<span />
				)}
				<ArrowUpRight className="size-4 text-zinc-400 transition-colors group-hover:text-blue-600" />
			</div>
		</a>
	);
}

function LabelBadge({ name, color }: { name: string; color: string }) {
	return (
		<span
			className="inline-flex items-center rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em]"
			style={{
				borderColor: `#${color}40`,
				backgroundColor: `#${color}15`,
				color: `#${color}`,
			}}
		>
			{name.replace("area/", "")}
		</span>
	);
}

function IssueRow({ issue }: { issue: GitHubRoadmapIssue }) {
	return (
		<li>
			<a
				href={issue.html_url}
				target="_blank"
				rel="noopener noreferrer"
				className="group flex items-center gap-3 rounded-md border border-zinc-200 bg-white px-4 py-3 transition-colors hover:bg-zinc-50"
			>
				<div className="min-w-0 flex-1">
					<span className="text-sm font-medium text-zinc-900 group-hover:text-blue-700">
						{issue.title}
					</span>
					<div className="mt-1 flex flex-wrap items-center gap-1.5">
						<span className="font-mono text-[11px] tabular-nums text-zinc-500">
							#{issue.number}
						</span>
						{issue.labels.map((label) => (
							<LabelBadge
								key={label.name}
								name={label.name}
								color={label.color}
							/>
						))}
					</div>
				</div>
				{(issue.reactions > 0 || issue.comments > 0) && (
					<div className="flex shrink-0 items-center gap-3 font-mono text-[11px] tabular-nums text-zinc-500">
						{issue.reactions > 0 && (
							<span className="flex items-center gap-1">
								<ThumbsUp className="size-3" />
								{issue.reactions}
							</span>
						)}
						{issue.comments > 0 && (
							<span className="flex items-center gap-1">
								<MessageCircle className="size-3" />
								{issue.comments}
							</span>
						)}
					</div>
				)}
				<ArrowUpRight className="size-4 shrink-0 text-zinc-400 transition-colors group-hover:text-blue-700" />
			</a>
		</li>
	);
}

function RoadmapPage() {
	const { popularIssues, upcoming } = Route.useLoaderData();

	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				{/* Header */}
				<section className="border-b border-zinc-200 bg-white">
					<div className="mx-auto max-w-6xl px-4 py-12 md:px-6 lg:py-20">
						<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							/ ROADMAP
						</p>
						<h1 className="mt-4 max-w-[16ch] text-4xl font-semibold tracking-tight text-zinc-950 lg:text-5xl">
							What's coming next.
						</h1>
						<p className="mt-5 max-w-[58ch] text-pretty text-lg text-zinc-600">
							We build Getcito in the open. Vote on what matters by reacting on
							GitHub.
						</p>
						<div className="mt-7 flex flex-wrap items-center gap-2">
							<a
								href={PROJECT_BOARD_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium leading-none text-white ring-1 ring-blue-600 hover:bg-blue-700"
							>
								<GitHubGlyph className="size-3.5" />
								View Roadmap on GitHub
								<ArrowUpRight className="size-3.5" />
							</a>
							<a
								href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/issues/new"
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300"
							>
								Request a feature
								<ArrowUpRight className="size-3.5" />
							</a>
						</div>
					</div>
				</section>

				{/* Highlights */}
				{upcoming.length > 0 && (
					<section className="border-b border-zinc-200 bg-zinc-50/40">
						<div className="mx-auto max-w-6xl px-4 py-12 md:px-6 lg:py-16">
							<div className="mb-8">
								<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600">
									/ ON DECK
								</p>
								<h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
									Upcoming Features
								</h2>
							</div>
							<ul
								role="list"
								className="grid grid-cols-1 items-stretch gap-4 sm:grid-cols-2 lg:grid-cols-4"
							>
								{upcoming.map((h) => (
									<li key={h.title} className="flex">
										<HighlightCard highlight={h} />
									</li>
								))}
							</ul>
						</div>
					</section>
				)}

				{/* Popular issues */}
				<section className="bg-white">
					<div className="mx-auto max-w-6xl px-4 py-12 md:px-6 lg:py-16">
						<div className="mb-6">
							<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
								/ ISSUES
							</p>
							<h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">
								Trending and Recent Issues
							</h2>
						</div>
						<ul role="list" className="space-y-2">
							{popularIssues.map((issue) => (
								<IssueRow key={issue.number} issue={issue} />
							))}
						</ul>
						<div className="mt-8 flex flex-wrap items-center justify-between gap-4 rounded-md border border-dashed border-zinc-300 bg-zinc-50 p-5">
							<div>
								<p className="text-sm font-medium text-zinc-950">
									Want to see everything?
								</p>
								<p className="mt-1 text-sm text-zinc-600">
									Browse all open issues on GitHub — react and comment to help us
									prioritize.
								</p>
							</div>
							<a
								href={ISSUES_URL}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300"
							>
								<GitHubGlyph className="size-3.5" />
								All issues on GitHub
								<ArrowUpRight className="size-3.5" />
							</a>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
