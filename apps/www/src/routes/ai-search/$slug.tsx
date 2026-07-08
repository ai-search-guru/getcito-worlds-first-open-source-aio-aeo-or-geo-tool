import { createFileRoute, notFound, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Faq } from "@/components/faq";
import { GetcitoCta } from "@/components/directory-shell";
import {
	ogMeta,
	canonicalUrl,
	breadcrumbJsonLd,
	faqJsonLd,
	howToJsonLd,
} from "@/lib/seo";
import type { FaqItem } from "@/lib/faqs";
import {
	getAiSearchEngine,
	aiSearchEngines,
	type AiSearchEngine,
} from "@/data/ai-search-engines";

function engineFaqs(e: AiSearchEngine): FaqItem[] {
	return [
		{
			question: `How do I get my brand mentioned in ${e.name}?`,
			answer: `${e.short} In short: ${e.steps[0].text} ${e.steps[1].text}`,
		},
		{
			question: `Does Getcito track ${e.name}?`,
			answer: e.tracking,
		},
	];
}

export const Route = createFileRoute("/ai-search/$slug")({
	head: ({ params }) => {
		const e = getAiSearchEngine(params.slug);
		if (!e) return {};
		const title = `How to Appear in ${e.name} · Getcito`;
		const description = e.short;
		const path = `/ai-search/${e.slug}`;
		return {
			meta: [
				{ title },
				{ name: "description", content: description },
				...ogMeta({ title, description, path }),
			],
			links: [{ rel: "canonical", href: canonicalUrl(path) }],
			scripts: [
				breadcrumbJsonLd([
					{ name: "Home", path: "/" },
					{ name: "AI Search", path: "/ai-search" },
					{ name: e.name, path },
				]),
				howToJsonLd({
					name: `How to appear in ${e.name}`,
					description: e.short,
					steps: e.steps,
				}),
				faqJsonLd(engineFaqs(e)),
			],
		};
	},
	loader: ({ params }) => {
		const e = getAiSearchEngine(params.slug);
		if (!e) throw notFound();
		const related = (e.related ?? [])
			.map((slug) => aiSearchEngines.find((x) => x.slug === slug))
			.filter((x): x is AiSearchEngine => Boolean(x));
		return { engine: e, related };
	},
	component: EnginePage,
});

function EnginePage() {
	const { engine, related } = Route.useLoaderData() as {
		engine: AiSearchEngine;
		related: AiSearchEngine[];
	};
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<div className="mx-auto max-w-6xl px-4 pt-8 md:px-6">
					<a
						href="/ai-search"
						className="inline-flex items-center gap-1 text-sm text-zinc-500 transition-colors hover:text-zinc-950"
					>
						<ArrowLeft className="h-3 w-3" />
						AI search guides
					</a>
				</div>

				<article className="mx-auto max-w-6xl px-4 py-10 md:px-6">
					<div className="max-w-3xl">
					<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
						{engine.vendor}
					</p>
					<h1 className="font-heading mt-2 text-4xl text-balance text-zinc-950 md:text-5xl">
						How to appear in {engine.name}
					</h1>
					<div className="mt-6 space-y-5 text-lg leading-relaxed text-zinc-700">
						{engine.intro.map((p) => (
							<p key={p.slice(0, 32)}>{p}</p>
						))}
					</div>

					<h2 className="font-heading mt-12 text-2xl text-zinc-950">
						How to improve your odds
					</h2>
					<ol className="mt-6 space-y-5">
						{engine.steps.map((step, i) => (
							<li key={step.name} className="flex gap-4">
								<span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-600 font-mono text-xs text-white tabular-nums">
									{i + 1}
								</span>
								<div>
									<h3 className="font-semibold text-zinc-950">{step.name}</h3>
									<p className="mt-1 leading-relaxed text-zinc-600">
										{step.text}
									</p>
								</div>
							</li>
						))}
					</ol>

					<div className="mt-12 rounded-md border border-zinc-200 bg-zinc-50 p-6">
						<h2 className="font-heading text-xl text-zinc-950">
							Tracking your visibility in {engine.name}
						</h2>
						<p className="mt-2 leading-relaxed text-zinc-600">{engine.tracking}</p>
						<div className="mt-4">
							<Link
								to="/docs"
								className="inline-flex h-9 items-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700"
							>
								Start tracking with Getcito
							</Link>
						</div>
					</div>

					{related.length > 0 && (
						<div className="mt-10">
							<h2 className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
								Other engines
							</h2>
							<div className="mt-3 flex flex-wrap gap-2">
								{related.map((r) => (
									<a
										key={r.slug}
										href={`/ai-search/${r.slug}`}
										className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
									>
										{r.name}
									</a>
								))}
							</div>
						</div>
					)}
					</div>
				</article>

				<Faq items={engineFaqs(engine)} eyebrow="/ FAQ" />
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
