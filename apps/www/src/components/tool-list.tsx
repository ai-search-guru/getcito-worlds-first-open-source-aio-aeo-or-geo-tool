import { Link } from "@tanstack/react-router";
import { Badge } from "@workspace/ui/components/badge";
import { ArrowRight, ExternalLink } from "lucide-react";
import {
	CATEGORY_LABELS,
	getComparisonSlug,
	getPopularityGrade,
	type Competitor,
} from "@/lib/competitors";

function ToolCard({ competitor }: { competitor: Competitor }) {
	const grade = getPopularityGrade(competitor);
	return (
		<div className="flex flex-col rounded-md border border-zinc-200 bg-white p-5">
			<div className="flex items-start justify-between gap-3">
				<h3 className="font-semibold text-zinc-950">{competitor.name}</h3>
				{grade !== "N/A" && (
					<span className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-400">
						{grade}
					</span>
				)}
			</div>
			<div className="mt-2 flex flex-wrap gap-1.5">
				<Badge variant="secondary">{CATEGORY_LABELS[competitor.category]}</Badge>
				{competitor.pricing?.hasFree && <Badge variant="secondary">Free tier</Badge>}
				{competitor.pricing?.startingPrice && (
					<Badge variant="secondary">From {competitor.pricing.startingPrice}</Badge>
				)}
			</div>
			<p className="mt-3 flex-1 text-sm leading-relaxed text-zinc-600">
				{competitor.tagline}
			</p>
			<div className="mt-4 flex items-center justify-between">
				<Link
					to="/ai-visibility-tools/$slug"
					params={{ slug: getComparisonSlug(competitor) }}
					className="inline-flex items-center gap-1 text-sm font-medium text-blue-700 hover:text-blue-900"
				>
					Compare with Getcito
					<ArrowRight className="h-3.5 w-3.5" />
				</Link>
				<a
					href={competitor.url}
					target="_blank"
					rel="noopener noreferrer nofollow"
					className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-950"
					aria-label={`Visit ${competitor.name}`}
				>
					Visit
					<ExternalLink className="h-3 w-3" />
				</a>
			</div>
		</div>
	);
}

export function ToolGrid({ competitors }: { competitors: Competitor[] }) {
	return (
		<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{competitors.map((c) => (
				<ToolCard key={c.slug} competitor={c} />
			))}
		</div>
	);
}
