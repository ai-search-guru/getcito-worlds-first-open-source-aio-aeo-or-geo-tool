import {
	OverviewPageGraphic,
	VisibilityPageGraphic,
	CitationsPageGraphic,
	PromptSearchGraphic,
	CompetitorGraphic,
	PromptDetailGraphic,
	VisibilityTrendGraphic,
} from "./feature-graphics";

interface Feature {
	num: string;
	eyebrow: string;
	title: string;
	description: string;
	graphic: React.ReactNode;
}

const features: Feature[] = [
	{
		num: "01",
		eyebrow: "DASHBOARD",
		title: "Your AI visibility command center.",
		description:
			"See everything at a glance — current visibility, trends, citation category breakdowns, specific cited pages, and key metrics.",
		graphic: <OverviewPageGraphic />,
	},
	{
		num: "02",
		eyebrow: "VISIBILITY",
		title: "Track visibility across every prompt and model.",
		description:
			"Filter by AI model, time range, and tags. See per-prompt visibility scores with trend lines comparing your brand against competitors.",
		graphic: <VisibilityPageGraphic />,
	},
	{
		num: "03",
		eyebrow: "CITATIONS",
		title: "Understand where AI gets its information.",
		description:
			"See which domains and URLs AI models cite most, track new and dropped sources over time, and break down citations by category — brand, competitor, social, and more.",
		graphic: <CitationsPageGraphic />,
	},
	{
		num: "04",
		eyebrow: "PROMPTS",
		title: "Search, tag, and organize your prompts.",
		description:
			"Find any prompt instantly with full-text search and highlight matching. Tag prompts for easy filtering and track visibility scores per prompt.",
		graphic: <PromptSearchGraphic />,
	},
	{
		num: "05",
		eyebrow: "COMPETITION",
		title: "See how you stack up against the competition.",
		description:
			"Compare your brand's AI mention rate against competitors. Understand who dominates which prompts and identify gaps in your AI visibility.",
		graphic: <CompetitorGraphic />,
	},
	{
		num: "06",
		eyebrow: "DEEP DIVE",
		title: "Inspect every individual AI response.",
		description:
			"Drill into any prompt to see exactly what each AI model said, which brands were mentioned, what sources were cited, and how the response was constructed.",
		graphic: <PromptDetailGraphic />,
	},
	{
		num: "07",
		eyebrow: "TRENDS",
		title: "Track visibility trends over months.",
		description:
			"Watch how your brand's AI visibility changes over time compared to competitors. Spot the impact of content changes and market shifts.",
		graphic: <VisibilityTrendGraphic />,
	},
];

export function Features() {
	return (
		<section id="features" className="border-b border-zinc-200 bg-white">
			<div className="mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
				<div>
					<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
						/ FEATURES
					</p>
					<h2 className="mt-4 text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 md:text-5xl">
						All you need to grow AI visibility.
					</h2>
				</div>

				<div className="mt-16 space-y-16 lg:space-y-24">
					{features.map((f) => (
						<div
							key={f.num}
							className="grid gap-6 lg:grid-cols-12 lg:gap-12"
						>
							<div className="lg:col-span-5">
								<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
									<span className="text-blue-600 tabular-nums">{f.num}</span>
									<span className="mx-2 text-zinc-300">/</span>
									{f.eyebrow}
								</p>
								<h3 className="mt-5 max-w-[20ch] text-2xl font-semibold leading-[1.15] tracking-tight text-balance text-zinc-950 md:text-3xl">
									{f.title}
								</h3>
								<p className="mt-4 max-w-[52ch] text-pretty text-zinc-600 md:text-base/7">
									{f.description}
								</p>
							</div>
							<div className="lg:col-span-7">{f.graphic}</div>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
