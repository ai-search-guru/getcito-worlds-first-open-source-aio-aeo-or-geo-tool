import { Badge } from "@workspace/ui/components/badge";
import { Check, X, ExternalLink } from "lucide-react";
import {
	FEATURE_CATEGORIES,
	Getcito_FEATURES,
	CATEGORY_LABELS,
	type Competitor,
	type FeatureKey,
} from "@/lib/competitors";

function Cell({ on, highlight }: { on: boolean; highlight?: boolean }) {
	return (
		<td className={`px-4 py-3 text-center ${highlight ? "bg-blue-50" : ""}`}>
			{on ? (
				<Check className="mx-auto h-4 w-4 text-blue-600" />
			) : (
				<X className="mx-auto h-4 w-4 text-zinc-300" />
			)}
		</td>
	);
}

function ToolSummary({
	name,
	category,
	tagline,
	pricing,
	url,
	domain,
}: {
	name: string;
	category: string;
	tagline: string;
	pricing?: Competitor["pricing"];
	url?: string;
	domain?: string;
}) {
	return (
		<div>
			<h3 className="mb-1 text-lg font-semibold text-zinc-950">{name}</h3>
			<div className="mt-2 flex flex-wrap gap-2">
				<Badge variant="secondary">{category}</Badge>
				{pricing?.hasFree && <Badge variant="secondary">Free tier</Badge>}
				{pricing?.startingPrice && (
					<Badge variant="secondary">From {pricing.startingPrice}</Badge>
				)}
			</div>
			<p className="mt-3 text-sm text-zinc-600">{tagline}</p>
			{url && domain && (
				<a
					href={url}
					target="_blank"
					rel="noopener noreferrer nofollow"
					className="mt-2 inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-950"
				>
					Visit {domain}
					<ExternalLink className="h-3 w-3" />
				</a>
			)}
		</div>
	);
}

export function PairComparison({ a, b }: { a: Competitor; b: Competitor }) {
	return (
		<>
			{/* Quick summary: A, B, Getcito */}
			<section className="border-b border-zinc-200 bg-zinc-50 py-8">
				<div className="mx-auto grid max-w-6xl gap-8 px-4 md:grid-cols-3 md:px-6">
					<ToolSummary
						name={a.name}
						category={CATEGORY_LABELS[a.category]}
						tagline={a.tagline}
						pricing={a.pricing}
						url={a.url}
						domain={a.domain}
					/>
					<ToolSummary
						name={b.name}
						category={CATEGORY_LABELS[b.category]}
						tagline={b.tagline}
						pricing={b.pricing}
						url={b.url}
						domain={b.domain}
					/>
					<div>
						<h3 className="mb-1 text-lg font-semibold text-zinc-950">Getcito</h3>
						<div className="mt-2 flex flex-wrap gap-2">
							<Badge variant="secondary">Open Source</Badge>
							<Badge variant="secondary">Self-Hosted</Badge>
							<Badge variant="secondary">Free</Badge>
						</div>
						<p className="mt-3 text-sm text-zinc-600">
							Open-source AEO platform. Self-host for free and track AI
							visibility across every major answer engine with full transparency.
						</p>
					</div>
				</div>
			</section>

			{/* 3-way feature table */}
			<section className="border-b border-zinc-200 bg-white py-12">
				<div className="mx-auto max-w-6xl px-4 md:px-6">
					<h2 className="font-heading mb-8 text-2xl text-zinc-950">
						{a.name} vs {b.name} vs Getcito
					</h2>
					<div className="overflow-x-auto">
						<table className="w-full text-sm">
							<thead>
								<tr className="border-b border-zinc-200">
									<th className="py-3 pr-4 text-left font-semibold text-zinc-950">
										Feature
									</th>
									<th className="w-28 px-4 py-3 text-center font-semibold text-zinc-950">
										{a.name}
									</th>
									<th className="w-28 px-4 py-3 text-center font-semibold text-zinc-950">
										{b.name}
									</th>
									<th className="w-28 px-4 py-3 text-center font-semibold text-zinc-950">
										Getcito
									</th>
								</tr>
							</thead>
							<tbody>
								{Object.entries(FEATURE_CATEGORIES).flatMap(([catKey, cat]) => [
									<tr key={`cat-${catKey}`}>
										<td
											colSpan={4}
											className="bg-zinc-50 px-0 py-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500"
										>
											{cat.label}
										</td>
									</tr>,
									...Object.entries(cat.features).map(([featureKey, featureDef]) => {
										const k = featureKey as FeatureKey;
										const Getcito = Getcito_FEATURES[k] ?? false;
										return (
											<tr
												key={featureKey}
												className="border-b border-dashed border-zinc-200 last:border-solid"
											>
												<td className="py-3 pr-4 text-sm text-zinc-600">
													{featureDef.label}
												</td>
												<Cell on={a.features[k] ?? false} />
												<Cell on={b.features[k] ?? false} />
												<Cell on={Getcito} highlight={Getcito} />
											</tr>
										);
									}),
								])}
							</tbody>
						</table>
					</div>
				</div>
			</section>
		</>
	);
}
