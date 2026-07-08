import { Link } from "@tanstack/react-router";
import {
	ArrowRight,
	ArrowUpRight,
	CalendarClock,
	Check,
	PenLine,
	Quote,
	Target,
} from "lucide-react";
import { externalRel } from "@/lib/external-link";

// Cal.com booking page. The selected plan is prefilled into the booking
// question with identifier "plan" so each call arrives pre-qualified.
// See https://cal.com/help/bookings/prefill-fields#pre-fill-fields-questions
const CAL_BASE = "https://cal.com/jrhizor/getcito-aeo";

function calLink(plan: string): string {
	return plan ? `${CAL_BASE}?plan=${encodeURIComponent(plan)}` : CAL_BASE;
}

function BookButton({
	plan,
	children,
	variant = "primary",
	className = "",
}: {
	plan: string;
	children: React.ReactNode;
	variant?: "primary" | "ghost";
	className?: string;
}) {
	const href = calLink(plan);
	const base =
		"inline-flex h-8 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium leading-none";
	const styles =
		variant === "primary"
			? "bg-blue-600 text-white ring-1 ring-blue-600 hover:bg-blue-700"
			: "bg-white text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300";
	return (
		<a
			href={href}
			target="_blank"
			rel={externalRel(href)}
			className={`${base} ${styles} ${className}`}
		>
			{children}
		</a>
	);
}

/* ---------------------------------------------------------------- Hero --- */

export function OffSiteHero() {
	return (
		<section className="relative border-b border-zinc-200 bg-white">
			<div
				aria-hidden="true"
				className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(0_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
			/>
			<div className="relative mx-auto max-w-6xl px-4 pb-16 pt-16 md:px-6 lg:pb-24 lg:pt-24">
				<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
					/ OFF-SITE AEO
				</p>
				<h1 className="mt-6 max-w-[20ch] text-5xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 sm:text-6xl">
					Get cited by AI on the sites it already trusts.
				</h1>
				<p className="mt-6 max-w-[60ch] text-pretty text-base text-zinc-600 md:text-lg">
					We publish humanized guest articles (listicles, guides, and
					comparisons) on high-authority sites that AI answer engines read and
					cite. Every placement targets a specific prompt where you're invisible
					today.
				</p>
				<div className="mt-8 flex flex-wrap items-center gap-2">
					<BookButton plan="">
						Book a call
						<ArrowRight className="size-3.5" />
					</BookButton>
					<a
						href="#plans"
						className="inline-flex h-8 items-center gap-1.5 rounded-md bg-white px-3 text-sm font-medium leading-none text-zinc-900 ring-1 ring-zinc-200 hover:bg-zinc-50 hover:ring-zinc-300"
					>
						See plans
					</a>
				</div>
			</div>
		</section>
	);
}

/* --------------------------------------------------------------- Value --- */

interface ValuePoint {
	icon: React.ReactNode;
	title: string;
	body: string;
}

const valuePoints: ValuePoint[] = [
	{
		icon: <Quote className="size-4" strokeWidth={2.5} />,
		title: "What is off-site AEO?",
		body: "Answer engines build replies from the whole web, not just your homepage. They weight sources by authority and corroboration. When several independent, trusted sites describe you the same way, a model is far more confident citing you.",
	},
	{
		icon: <Target className="size-4" strokeWidth={2.5} />,
		title: "Targeted, not spray-and-pray",
		body: "We don't publish random posts. We start from your AI-visibility data and find the prompts you're missing, the competitors cited instead of you, and the sources those models already trust. Then we plan each placement to close a specific gap or reinforce your brand's authority.",
	},
	{
		icon: <PenLine className="size-4" strokeWidth={2.5} />,
		title: "Drafted with AI, and humanized",
		body: "After we come up with a plan, we create drafts of the guest posts using the best AI models. Then, we humanize the articles so they land under a 25% AI-detection score on both ZeroGPT and Pangram. This human touch-up improves the resiliency of your posts.",
	},
	{
		icon: <CalendarClock className="size-4" strokeWidth={2.5} />,
		title: "Fresh sources, every month",
		body: "AI answers lean on recent data. While a one-time burst fades, a steady publishing every month keeps data about your brand and industry current and authoritative. It's a more natural backlink pattern for classic SEO, too.",
	},
];

export function OffSiteValue() {
	return (
		<section className="border-b border-zinc-200 bg-white">
			<div className="mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
				<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
					/ WHY IT WORKS
				</p>
				<h2 className="mt-4 max-w-[24ch] text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 md:text-5xl">
					Many high-authority data points, built purposefully.
				</h2>
				<p className="mt-5 max-w-[60ch] text-pretty text-zinc-600 md:text-lg">
					We give AI answer engines a steady supply of trustworthy sources that
					mention you in the right context. The dofollow backlinks on high-DR
					domains are a welcome bonus for your traditional SEO.
				</p>

				<div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 md:grid-cols-2">
					{valuePoints.map((p) => (
						<div key={p.title} className="bg-white p-6 lg:p-8">
							<span className="inline-flex size-8 items-center justify-center rounded-md bg-blue-50 text-blue-600">
								{p.icon}
							</span>
							<h3 className="mt-4 text-lg font-semibold tracking-tight text-zinc-950">
								{p.title}
							</h3>
							<p className="mt-2 max-w-[52ch] text-pretty text-sm leading-relaxed text-zinc-600">
								{p.body}
							</p>
						</div>
					))}
				</div>

				<div className="mt-8 rounded-lg border border-zinc-200 bg-zinc-50 p-6 lg:p-8">
					<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
						/ WHO RUNS THIS
					</p>
					<p className="mt-3 max-w-[68ch] text-pretty text-zinc-700 md:text-lg">
						Getcito is run by{" "}
						<a
							href="https://www.linkedin.com/in/jrhizor"
							target="_blank"
							rel={externalRel("https://www.linkedin.com/in/jrhizor")}
							className="font-medium text-blue-600 underline-offset-4 hover:underline"
						>
							Jared Rhizor
						</a>
						, who's spent the last year finding the levers that move the needle
						on AI citations by building AEO tooling for top e-commerce and B2B
						SaaS brands.
					</p>
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------- Process --- */

const steps = [
	{
		num: "01",
		title: "Free Consultation",
		body: "We review how AI talks about you today, find the prompts and competitors you're losing, and agree on what to target.",
	},
	{
		num: "02",
		title: "Live within 30 days",
		body: "We plan, write, humanize, and place that month's posts on high-authority sites, showing you which post maps to which prompt.",
	},
	{
		num: "03",
		title: "Autopilot",
		body: "We keep publishing on a steady cadence, adjusting targets as your visibility moves, keeping data fresh for AI models.",
	},
];

export function OffSiteProcess() {
	return (
		<section className="border-b border-zinc-200 bg-white">
			<div className="mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
				<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
					/ HOW IT WORKS
				</p>
				<h2 className="mt-4 max-w-[24ch] text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 md:text-5xl">
					One call, quality posts. Live within 30 days.
				</h2>

				<div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 md:grid-cols-3">
					{steps.map((s) => (
						<div key={s.num} className="bg-white p-6 lg:p-8">
							<span className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600 tabular-nums">
								{s.num}
							</span>
							<h3 className="mt-4 text-xl font-semibold tracking-tight text-zinc-950">
								{s.title}
							</h3>
							<p className="mt-2 max-w-[40ch] text-pretty text-sm leading-relaxed text-zinc-600">
								{s.body}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------- Pricing --- */

interface PlanBucket {
	dr: string;
	count: number;
}

interface OffSitePlan {
	id: string;
	tag: string;
	name: string;
	desc: string;
	price: string;
	posts: number;
	buckets: PlanBucket[];
	features: string[];
	highlighted?: boolean;
}

const plans: OffSitePlan[] = [
	{
		id: "starter",
		tag: "01",
		name: "Starter",
		desc: "A focused entry point into off-site AEO.",
		price: "$1,950",
		posts: 4,
		buckets: [
			{ dr: "DR20+", count: 2 },
			{ dr: "DR30+", count: 1 },
			{ dr: "DR40+", count: 1 },
		],
		features: ["Monthly placement report", "Humanized text", "Dofollow links"],
	},
	{
		id: "growth",
		tag: "02",
		name: "Growth",
		desc: "More reach across higher-authority sites.",
		price: "$4,950",
		posts: 8,
		highlighted: true,
		buckets: [
			{ dr: "DR20+", count: 3 },
			{ dr: "DR30+", count: 2 },
			{ dr: "DR40+", count: 2 },
			{ dr: "DR50+", count: 1 },
		],
		features: [
			"Monthly placement report",
			"Humanized text",
			"Dofollow links",
			"Priority support",
		],
	},
	{
		id: "authority",
		tag: "03",
		name: "Authority",
		desc: "Maximum data points, topped with a flagship.",
		price: "$9,950",
		posts: 14,
		buckets: [
			{ dr: "DR20+", count: 4 },
			{ dr: "DR30+", count: 4 },
			{ dr: "DR40+", count: 3 },
			{ dr: "DR50+", count: 2 },
			{ dr: "DR60+", count: 1 },
		],
		features: [
			"Monthly placement report",
			"Humanized text",
			"Dofollow links",
			"Priority support",
			"Shared Slack channel",
		],
	},
];

function PlanCard({ plan }: { plan: OffSitePlan }) {
	return (
		<div className="relative flex flex-col justify-between bg-white p-6 lg:p-8">
			{plan.highlighted && (
				<span className="absolute right-6 top-6 rounded-full bg-blue-600 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-white lg:right-8 lg:top-8">
					Popular
				</span>
			)}
			<div>
				<span className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600 tabular-nums">
					{plan.tag}
				</span>
				<h3 className="mt-5 text-2xl font-semibold tracking-tight text-zinc-950">
					{plan.name}
				</h3>
				<p className="mt-2 max-w-[36ch] text-pretty text-sm text-zinc-600">
					{plan.desc}
				</p>
				<div className="mt-6 flex items-baseline gap-2 border-y border-zinc-200 py-4">
					<span className="text-4xl font-semibold tracking-tight text-zinc-950 tabular-nums">
						{plan.price}
					</span>
					<span className="font-mono text-[11px] uppercase tracking-[0.15em] text-zinc-500">
						/ month
					</span>
				</div>

				<p className="mt-6 text-sm font-medium text-zinc-950">
					{plan.posts} placements / month
				</p>
				{/* Fixed height so the DR breakdown lines up across all plans. */}
				<ul role="list" className="mt-3 min-h-[8rem] space-y-1.5">
					{plan.buckets.map((b) => (
						<li
							key={b.dr}
							className="flex items-center gap-2 text-sm text-zinc-700"
						>
							<span className="inline-flex min-w-7 justify-center rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-zinc-600">
								{b.count}×
							</span>
							<span className="tabular-nums">{b.dr} site</span>
						</li>
					))}
				</ul>

				<ul role="list" className="mt-6 space-y-2.5 text-sm text-zinc-700">
					{plan.features.map((f) => (
						<li key={f} className="flex items-start gap-2">
							<Check
								className="mt-0.5 size-3.5 shrink-0 text-blue-600"
								strokeWidth={3}
							/>
							<span>{f}</span>
						</li>
					))}
				</ul>
			</div>
			<div className="mt-8">
				<BookButton plan={plan.name} className="w-full">
					Book a call
					<ArrowRight className="size-3.5" />
				</BookButton>
			</div>
		</div>
	);
}

export function OffSitePricing() {
	return (
		<section id="plans" className="border-b border-zinc-200 bg-white scroll-mt-16">
			<div className="mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
				<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
					/ PLANS
				</p>
				<h2 className="mt-4 max-w-[26ch] text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 md:text-5xl">
					Pick your level. We handle the rest.
				</h2>
				<p className="mt-5 max-w-[56ch] text-pretty text-zinc-600">
					Every plan is a managed monthly subscription: planning, writing,
					humanization, placement, and reporting included. All plans are
					non-refundable.
				</p>

				<div className="mt-12 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-zinc-200 bg-zinc-200 md:grid-cols-3">
					{plans.map((plan) => (
						<PlanCard key={plan.id} plan={plan} />
					))}
				</div>

				<div className="mt-6 flex flex-col gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-6 sm:flex-row sm:items-center sm:justify-between lg:p-8">
					<div>
						<h3 className="text-lg font-semibold tracking-tight text-zinc-950">
							Custom &amp; Agency
						</h3>
						<p className="mt-1 max-w-[60ch] text-pretty text-sm text-zinc-600">
							Need more reach, white-labeling, or agency support? Reach out to
							discuss.
						</p>
					</div>
					<BookButton plan="Custom" variant="ghost" className="shrink-0">
						Talk to us
						<ArrowUpRight className="size-3.5" />
					</BookButton>
				</div>
			</div>
		</section>
	);
}

/* ----------------------------------------------------------- Closing CTA --- */

export function OffSiteCTA() {
	return (
		<section className="border-b border-zinc-200 bg-white">
			<div className="mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
				<h2 className="max-w-[20ch] text-4xl font-semibold leading-[1.05] tracking-tight text-balance text-zinc-950 md:text-5xl">
					Ready to get cited by AI?
				</h2>
				<p className="mt-5 max-w-[52ch] text-pretty text-zinc-600 md:text-lg">
					Book a call and we'll map your AEO gaps and plan your posts.
				</p>
				<div className="mt-7">
					<BookButton plan="">
						Book a call
						<ArrowRight className="size-3.5" />
					</BookButton>
				</div>
			</div>
		</section>
	);
}

/* --------------------------------------------------- Home-page promo band --- */

export function OffSiteAeoPromo() {
	return (
		<section className="border-b border-zinc-200 bg-zinc-50">
			<div className="mx-auto max-w-6xl px-4 py-16 md:px-6 lg:py-24">
				<div className="grid items-center gap-10 lg:grid-cols-12">
					<div className="lg:col-span-7">
						<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							/ OFF-SITE AEO
						</p>
						<h2 className="mt-4 max-w-[22ch] text-3xl font-semibold leading-[1.1] tracking-tight text-balance text-zinc-950 md:text-4xl">
							Want us to do your off-site AEO for you?
						</h2>
						<p className="mt-5 max-w-[56ch] text-pretty text-zinc-600 md:text-lg">
							Beyond tracking, we publish humanized guest posts on high-authority
							sites so AI answer engines can cite you.
						</p>
						<div className="mt-7 flex flex-wrap items-center gap-2">
							<Link
								to="/off-site-aeo"
								className="inline-flex h-8 items-center gap-1.5 rounded-md bg-blue-600 px-3 text-sm font-medium leading-none text-white ring-1 ring-blue-600 hover:bg-blue-700"
							>
								Explore Off-Site AEO
								<ArrowRight className="size-3.5" />
							</Link>
						</div>
					</div>
					<div className="lg:col-span-5">
						<dl className="overflow-hidden rounded-lg border border-zinc-200 bg-white divide-y divide-zinc-200">
							{[
								{ name: "Starter", price: "$1,950", posts: "4 placements / mo" },
								{ name: "Growth", price: "$4,950", posts: "8 placements / mo" },
								{
									name: "Authority",
									price: "$9,950",
									posts: "14 placements / mo",
								},
							].map((t) => (
								<div
									key={t.name}
									className="flex items-center justify-between gap-4 px-5 py-4"
								>
									<div>
										<dt className="text-sm font-semibold text-zinc-950">
											{t.name}
										</dt>
										<dd className="text-xs text-zinc-500">{t.posts}</dd>
									</div>
									<span className="font-mono text-sm tabular-nums text-zinc-950">
										{t.price}
										<span className="text-zinc-400">/mo</span>
									</span>
								</div>
							))}
						</dl>
					</div>
				</div>
			</div>
		</section>
	);
}
