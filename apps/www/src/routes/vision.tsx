import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "@workspace/ui/components/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { ogMeta, canonicalUrl, breadcrumbJsonLd } from "@/lib/seo";

const title = "Our Vision · Getcito";
const description =
	"AI visibility should be affordable, transparent, and built to last. Here's why we're building Getcito differently.";

export const Route = createFileRoute("/vision")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/vision" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/vision") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "Vision", path: "/vision" },
			]),
		],
	}),
	component: VisionPage,
});

function SectionEyebrow({ num, label }: { num: string; label: string }) {
	return (
		<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-blue-600 tabular-nums">
			{num} <span className="text-zinc-500">— {label}</span>
		</p>
	);
}

function VisionPage() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				{/* Hero */}
				<section className="relative overflow-hidden border-b border-zinc-200 bg-white py-16 lg:py-28">
					<div
						aria-hidden="true"
						className="pointer-events-none absolute inset-0 [background-image:linear-gradient(to_right,rgb(0_0_0/0.04)_1px,transparent_1px),linear-gradient(to_bottom,rgb(0_0_0/0.04)_1px,transparent_1px)] [background-size:48px_48px] [mask-image:linear-gradient(to_bottom,black,transparent_85%)]"
					/>
					<div className="relative mx-auto max-w-6xl px-4 md:px-6">
						<div className="max-w-3xl">
							<p className="mb-4 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
								/ OUR VISION
							</p>
							<h1 className="font-heading text-4xl text-balance text-zinc-950 md:text-5xl lg:text-6xl">
								AI visibility monitoring should be a commodity, not a luxury.
							</h1>
							<p className="mt-6 max-w-2xl text-lg text-balance text-zinc-600 md:text-xl">
								The emerging market for "AI search optimization" is full of
								inflated pricing, opaque methodologies, and venture-funded
								startups burning cash. We think there's a better way.
							</p>
						</div>
					</div>
				</section>

				{/* The Problem */}
				<section className="border-b border-zinc-200 bg-white py-12 lg:py-20">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<div className="max-w-3xl">
							<SectionEyebrow num="01" label="THE PROBLEM" />
							<h2 className="font-heading mt-3 text-3xl text-zinc-950 md:text-4xl">
								The market is broken
							</h2>
							<div className="mt-8 space-y-6 text-[1.0625rem] leading-relaxed text-zinc-600">
								<p>
									A wave of VC-funded startups has flooded the "AI Engine
									Optimization" space, charging premium prices for what amounts
									to running queries against LLM APIs and tracking the results.
									Many of these companies will fail — not because the problem
									isn't real, but because their cost structures require
									enterprise pricing for commodity work.
								</p>
								<p>
									There's also a real possibility that LLM providers themselves
									start offering brand visibility data directly. When that
									happens, many of these platforms lose their reason to exist.
									We're building with that future in mind — if providers open
									up, we'll shift to aggregating their data rather than
									collecting our own.
								</p>
								<p>
									Meanwhile, the AEO space is rife with misinformation.
									Consultants sell "optimization" services based on flawed
									assumptions about how LLMs work. Rankings are presented as
									deterministic when they're probabilistic. Correlation is sold
									as causation. We believe this hurts everyone.
								</p>
							</div>
						</div>
					</div>
				</section>

				{/* Our Approach */}
				<section className="border-b border-zinc-200 bg-zinc-50 py-12 lg:py-20">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<div className="max-w-3xl">
							<SectionEyebrow num="02" label="OUR APPROACH" />
							<h2 className="font-heading mt-3 text-3xl text-zinc-950 md:text-4xl">
								Small, sustainable, built to last
							</h2>
							<div className="mt-8 space-y-6 text-[1.0625rem] leading-relaxed text-zinc-600">
							<p>
								Getcito is bootstrapped. We don't have investors demanding
								hyper-growth or a board pushing us toward enterprise-only
								pricing. That means we need far less to be a success — and far
								less to stick around long-term.
							</p>
							<p>
								We believe AI visibility data should be cost-effective to access.
								The underlying operations — querying LLMs, parsing responses,
								tracking results over time — aren't expensive to run. The pricing
								should reflect that reality, not the fundraising ambitions of the
								company providing them.
							</p>
							<div className="-mx-4 rounded-md border border-zinc-200 bg-white px-4 py-6 md:-mx-8 md:px-8">
								<h3 className="mb-4 text-lg font-semibold text-zinc-950">
									How we fund Getcito
								</h3>
								<div className="grid gap-4 sm:grid-cols-3">
									<div className="space-y-1">
										<p className="text-sm font-bold text-zinc-950">
											Open Source
										</p>
										<p className="text-sm text-zinc-600">
											We make money from open source users via affiliate links
											for LLM web scrapers.
										</p>
									</div>
									<div className="space-y-1">
										<p className="text-sm font-bold text-zinc-950">
											White Label
										</p>
										<p className="text-sm text-zinc-600">
											Our clients pay us to embed AEO into their existing
											software product.
										</p>
									</div>
									<div className="space-y-1">
										<p className="text-sm font-bold text-zinc-950">
											Cloud Hosting
										</p>
										<p className="text-sm text-zinc-600">
											In the near future, we will offer a managed version for teams that don't want to
											self-host.
										</p>
									</div>
								</div>
							</div>
						</div>
					</div>
					</div>
				</section>

				{/* Transparency */}
				<section className="border-b border-zinc-200 bg-white py-12 lg:py-20">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<div className="max-w-3xl">
							<SectionEyebrow num="03" label="TRANSPARENCY" />
							<h2 className="font-heading mt-3 text-3xl text-zinc-950 md:text-4xl">
								Transparent by default
							</h2>
							<div className="mt-8 space-y-6 text-[1.0625rem] leading-relaxed text-zinc-600">
								<p>
									Too much of the AEO industry operates like a black box.
									Vendors show you scores and rankings without explaining how
									they're calculated, then charge you to improve numbers you
									can't independently verify.
								</p>
								<p>
									We take the opposite approach. Getcito is open source — you can
									read every line of code that generates your data. Our
									methodology is documented. When we don't know something, we
									say so. When a metric has limitations, we explain what they
									are.
								</p>
							</div>
						</div>
					</div>
				</section>

				{/* How We Think About It */}
				<section className="border-b border-zinc-200 bg-zinc-50 py-12 lg:py-20">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<div className="max-w-3xl">
							<SectionEyebrow num="04" label="OUR FOCUS" />
							<h2 className="font-heading mt-3 text-3xl text-zinc-950 md:text-4xl">
								Understanding how LLMs see the web
							</h2>
							<div className="mt-8 space-y-6 text-[1.0625rem] leading-relaxed text-zinc-600">
							<p>
								We're not in the business of "optimizing" your content for AI.
								We're focused on a more fundamental question: how do large
								language models use and interpret the web? How do they decide
								which brands to mention, which sources to cite, and what
								information to present?
							</p>
							<div className="mt-8 grid gap-6 sm:grid-cols-2">
								<div className="rounded-md border border-zinc-200 bg-white p-5">
									<h3 className="font-semibold text-zinc-950">Diagnose problems</h3>
									<p className="mt-2 text-sm text-zinc-600">
										Why isn't your brand appearing in AI responses? Is it a
										content gap, a citation issue, or something else entirely?
										Find out what's actually going on.
									</p>
								</div>
								<div className="rounded-md border border-zinc-200 bg-white p-5">
									<h3 className="font-semibold text-zinc-950">Find opportunities</h3>
									<p className="mt-2 text-sm text-zinc-600">
										Where are LLMs already talking about your space? What
										questions are being asked? Where are competitors showing up
										that you're not?
									</p>
								</div>
								<div className="rounded-md border border-zinc-200 bg-white p-5">
									<h3 className="font-semibold text-zinc-950">Track changes over time</h3>
									<p className="mt-2 text-sm text-zinc-600">
										LLM responses shift as models are updated and retrained.
										Monitor how your brand's presence evolves across providers
										and model versions.
									</p>
								</div>
								<div className="rounded-md border border-zinc-200 bg-white p-5">
									<h3 className="font-semibold text-zinc-950">Anti-Slop</h3>
									<p className="mt-2 text-sm text-zinc-600">
										We give you the data and context and help you grow your
										brand's AI presence naturally, without generating AI slop or
										astroturfing.
									</p>
								</div>
							</div>
						</div>
						</div>
					</div>
				</section>

				{/* CTA */}
				<section className="border-b border-zinc-200 bg-white py-16 lg:py-24">
					<div className="mx-auto max-w-6xl px-4 text-center md:px-6">
						<h2 className="font-heading text-3xl text-zinc-950 md:text-4xl">
							Sustainable AEO
						</h2>
						<p className="mx-auto mt-4 max-w-xl text-lg text-balance text-zinc-600">
							Getcito is open source, cost-effective, and built for the long haul.
							If that resonates, we'd love to have you.
						</p>
						<div className="mt-8 flex flex-wrap justify-center gap-3">
							<Button asChild size="sm">
								<Link to="/docs">
									Get Started
									<ArrowRight className="size-3.5" />
								</Link>
							</Button>
							<Button asChild variant="outline" size="sm">
								<a
									href="https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool"
									target="_blank"
									rel="noopener noreferrer"
								>
									Star on GitHub
								</a>
							</Button>
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
