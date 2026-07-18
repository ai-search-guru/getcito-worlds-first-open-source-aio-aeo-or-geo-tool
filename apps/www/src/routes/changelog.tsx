import { createFileRoute } from "@tanstack/react-router";
import { ArrowUpRight, GitCompare } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { ogMeta, canonicalUrl, breadcrumbJsonLd } from "@/lib/seo";
import { getGitHubReleases, type ReleaseEntry } from "@/lib/github-releases";
import {
	getGitHubChangelog,
	type ChangelogIssue,
} from "@/lib/github-changelog";
import { ReleaseMarkdown, extractCompareUrl } from "@/lib/release-markdown";

const title = "Changelog · Getcito";
const description =
	"See what's new in Getcito. Track recent releases, improvements, bug fixes, and completed features.";

export const Route = createFileRoute("/changelog")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/changelog" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/changelog") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "Changelog", path: "/changelog" },
			]),
		],
	}),
	loader: async () => {
		const [releases, months] = await Promise.all([
			getGitHubReleases(),
			getGitHubChangelog(),
		]);
		return { releases, months };
	},
	component: ChangelogPage,
});

function formatDate(iso: string) {
	return new Date(iso).toLocaleDateString("en-US", {
		month: "long",
		day: "numeric",
		year: "numeric",
	});
}

function ReleaseCard({ release }: { release: ReleaseEntry }) {
	const { cleaned, compareUrl } = extractCompareUrl(release.body);
	const trimmed = cleaned.trim();

	return (
		<article className="rounded-md border border-zinc-200 bg-white p-6 lg:p-8">
			<div className="flex flex-wrap items-baseline justify-between gap-3">
				<div className="flex flex-wrap items-baseline gap-3">
					<h3 className="text-2xl font-semibold tracking-tight text-zinc-950">
						{release.name || release.tag_name}
					</h3>
					{release.prerelease && (
						<span className="rounded-sm bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-amber-700">
							Pre-release
						</span>
					)}
				</div>
				{compareUrl ? (
					<a
						href={compareUrl}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-950"
					>
						<GitCompare className="size-3" />
						View Commits
						<ArrowUpRight className="size-3" />
					</a>
				) : (
					<a
						href={release.html_url}
						target="_blank"
						rel="noopener noreferrer"
						className="inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-950"
					>
						GitHub
						<ArrowUpRight className="size-3" />
					</a>
				)}
			</div>
			<p className="mt-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
				{formatDate(release.published_at)}
			</p>
			{trimmed && (
				<div className="mt-5">
					<ReleaseMarkdown body={trimmed} />
				</div>
			)}
		</article>
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

function IssueRow({ issue }: { issue: ChangelogIssue }) {
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
				<ArrowUpRight className="size-4 shrink-0 text-zinc-400 transition-colors group-hover:text-blue-700" />
			</a>
		</li>
	);
}

function ChangelogPage() {
	const { releases, months } = Route.useLoaderData();
	const hasReleases = releases.length > 0;
	const monthsWithIssues = months.filter((m) => m.issues.length > 0);

	return (
		<div className="min-h-screen">
			<Navbar />
			<main className="mx-auto max-w-6xl px-4 py-12 md:px-6 lg:py-20">
				<header className="mb-12 max-w-3xl">
					<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
						/ CHANGELOG
					</p>
					<h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-950 lg:text-5xl">
						Changelog
					</h1>
					<p className="mt-5 max-w-[58ch] text-pretty text-lg text-zinc-600">
						Latest releases, completed work, and improvements shipped to Getcito.
					</p>
					<div className="mt-6">
						<a
							href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool/releases"
							target="_blank"
							rel="noopener noreferrer"
							className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-950"
						>
							<svg viewBox="0 0 24 24" className="size-3.5 fill-current">
								<path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
							</svg>
							View Releases on GitHub
							<ArrowUpRight className="size-3" />
						</a>
					</div>
				</header>

				{hasReleases && (
					<section className="mb-16">
						<h2 className="mb-6 text-2xl font-semibold tracking-tight text-zinc-950">
							Releases
						</h2>
						<div className="space-y-6">
							{releases.map((release) => (
								<ReleaseCard key={release.id} release={release} />
							))}
						</div>
					</section>
				)}

				{monthsWithIssues.length > 0 && (
					<section>
						<h2 className="mb-6 text-2xl font-semibold tracking-tight text-zinc-950">
							Closed Issues
						</h2>
						<div className="space-y-10">
							{monthsWithIssues.map((group) => (
								<div key={group.month}>
									<h3 className="mb-3 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
										{group.label}
									</h3>
									<ul role="list" className="space-y-2">
										{group.issues.map((issue) => (
											<IssueRow key={issue.number} issue={issue} />
										))}
									</ul>
								</div>
							))}
						</div>
					</section>
				)}
			</main>
			<Footer />
		</div>
	);
}
