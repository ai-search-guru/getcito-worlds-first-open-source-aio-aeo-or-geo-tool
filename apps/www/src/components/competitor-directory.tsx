import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import { Check, X } from "lucide-react";
import {
	sortedCompetitors,
	FEATURE_CATEGORIES,
	Getcito_FEATURES,
	CATEGORY_LABELS,
	getFeatureLabel,
	getComparisonSlug,
	getPopularityGrade,
	type Competitor,
	type CompetitorCategory,
	type FeatureKey,
} from "@/lib/competitors";

function FeatureIcon({ has }: { has: boolean }) {
	return has ? (
		<Check className="mx-auto h-4 w-4 text-blue-600" />
	) : (
		<X className="mx-auto h-4 w-4 text-zinc-300" />
	);
}

const visibleCompetitors = sortedCompetitors.filter(
	(c) => c.status !== "shutting-down" && c.category !== "other",
);

export function CompetitorDirectory() {
	const [selectedCategory, setSelectedCategory] =
		useState<CompetitorCategory | "all">("all");

	const filteredCompetitors = visibleCompetitors.filter(
		(c) => selectedCategory === "all" || c.category === selectedCategory,
	);

	const categories = [
		...new Set(visibleCompetitors.map((c) => c.category)),
	];

	return (
		<>
			{/* Hero */}
			<section className="relative overflow-hidden border-b border-zinc-200 bg-white py-16 lg:py-28">
				<div
					aria-hidden="true"
					className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(0_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
				/>
				<div className="relative mx-auto max-w-6xl px-4 md:px-6">
					<p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
						/ RESOURCES
					</p>
					<h1 className="font-heading text-4xl text-balance text-zinc-950 md:text-5xl lg:text-6xl">
						AI Visibility Tool Directory
					</h1>
					<p className="mt-6 max-w-3xl text-lg text-balance text-zinc-600 md:text-xl">
						Every AI visibility and Answer Engine Optimization tool in
						one place. Compare features, pricing, and find the right
						platform for your team.
					</p>
				</div>
			</section>

			{/* Category Filters */}
			<section className="border-b border-zinc-200 bg-white pb-6 pt-6">
				<div className="mx-auto max-w-6xl px-4 md:px-6">
					<div className="flex flex-wrap gap-2">
						<button
							type="button"
							onClick={() => setSelectedCategory("all")}
							className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
								selectedCategory === "all"
									? "bg-zinc-950 text-white"
									: "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
							}`}
						>
							All
						</button>
						{categories.map((cat) => (
							<button
								type="button"
								key={cat}
								onClick={() => setSelectedCategory(cat)}
								className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
									selectedCategory === cat
										? "bg-zinc-950 text-white"
										: "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
								}`}
							>
								{CATEGORY_LABELS[cat]}
							</button>
						))}
					</div>
				</div>
			</section>

			{/* Feature Matrix */}
			<section className="border-b border-zinc-200 bg-white py-12 lg:py-16">
				<div className="mx-auto max-w-6xl px-4 md:px-6">
					<h2 className="mb-8 text-lg font-semibold text-zinc-950">
						{filteredCompetitors.length} tools
					</h2>
					<FeatureMatrix competitors={filteredCompetitors} />
				</div>
			</section>

			{/* Getcito CTA */}
			<section className="border-b border-zinc-200 bg-white py-16 lg:py-24">
				<div className="mx-auto max-w-3xl px-4 text-center md:px-6">
					<h2 className="font-heading text-3xl text-zinc-950 md:text-4xl">
						Why teams choose Getcito
					</h2>
					<p className="mx-auto mt-4 max-w-xl text-lg text-balance text-zinc-600">
						Open source, self-hosted, and transparent. Track AI
						visibility without vendor lock-in or inflated pricing.
					</p>
					<div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
						<Button asChild size="sm">
							<Link to="/docs">Read the Docs</Link>
						</Button>
						<Button asChild variant="outline" size="sm">
							<a
								href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool"
								target="_blank"
								rel="noopener noreferrer"
							>
								View on GitHub
							</a>
						</Button>
					</div>
				</div>
			</section>
		</>
	);
}

function CompetitorHeader({
	competitor,
}: {
	competitor: Competitor;
}) {
	return (
		<Link
			to="/ai-visibility-tools/$slug"
			params={{ slug: getComparisonSlug(competitor) }}
			className="block text-[11px] leading-tight text-zinc-500 hover:text-zinc-950 hover:underline"
		>
			{competitor.name}
		</Link>
	);
}

function FeatureMatrix({ competitors: items }: { competitors: Competitor[] }) {
	const stickyCell =
		"sticky left-0 z-10 bg-white shadow-[2px_0_4px_-2px_rgba(0,0,0,0.08)]";

	return (
		<div className="overflow-x-auto">
			<table className="w-full min-w-[800px] text-sm">
				<thead>
					<tr className="border-b border-zinc-200">
						<th
							className={`${stickyCell} py-3 pr-4 text-left font-semibold text-zinc-950`}
						>
							Feature
						</th>
						<th className="border-x border-zinc-200 bg-blue-50 px-2 py-3 text-center font-semibold text-zinc-950">
							Getcito
						</th>
						{items.map((c) => (
							<th
								key={c.slug}
								className="px-2 py-3 text-center font-normal"
							>
								<CompetitorHeader competitor={c} />
							</th>
						))}
					</tr>
				</thead>
				<tbody>
					{Object.entries(FEATURE_CATEGORIES).flatMap(([catKey, cat]) => [
						<tr key={`cat-${catKey}`}>
							<td
								className={`${stickyCell} bg-zinc-50! py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500`}
							>
								{cat.label}
							</td>
							<td
								colSpan={1 + items.length}
								className="bg-zinc-50 px-0 py-2"
							/>
						</tr>,
						...Object.keys(cat.features).map((featureKey) => (
							<tr
								key={featureKey}
								className="border-b border-dashed border-zinc-200 last:border-solid"
							>
								<td
									className={`${stickyCell} py-2 pr-4 text-xs text-zinc-600`}
								>
									{getFeatureLabel(featureKey as FeatureKey)}
								</td>
								<td className="border-x border-zinc-200 bg-blue-50 px-2 py-2">
									<FeatureIcon
										has={
											Getcito_FEATURES[featureKey as FeatureKey] ??
											false
										}
									/>
								</td>
								{items.map((c) => (
									<td key={c.slug} className="px-2 py-2">
										<FeatureIcon
											has={
												c.features[featureKey as FeatureKey] ??
												false
											}
										/>
									</td>
								))}
							</tr>
						)),
					])}
					<tr className="border-t-2 border-zinc-200">
						<td
							className={`${stickyCell} py-2 pr-4 text-xs font-semibold text-zinc-950`}
						>
							Popularity
						</td>
						<td className="border-x border-zinc-200 bg-blue-50 px-2 py-2 text-center text-xs text-blue-600">
							♥︎
						</td>
						{items.map((c) => (
							<td
								key={c.slug}
								className="px-2 py-2 text-center text-xs tabular-nums text-zinc-600"
							>
								{getPopularityGrade(c)}
							</td>
						))}
					</tr>
				</tbody>
			</table>
		</div>
	);
}
