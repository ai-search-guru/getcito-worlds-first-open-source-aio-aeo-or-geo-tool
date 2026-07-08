import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import {
	ogMeta,
	canonicalUrl,
	breadcrumbJsonLd,
	itemListJsonLd,
} from "@/lib/seo";
import { aiSearchEngines } from "@/data/ai-search-engines";

const title = "How to Show Up in AI Search Engines · Getcito";
const description =
	"Practical guides to appearing in AI search: how ChatGPT, Perplexity, Google AI Overviews, Gemini, Claude, Copilot, and Grok choose what to cite, and how to become one of their sources.";

export const Route = createFileRoute("/ai-search/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/ai-search" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/ai-search") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "AI Search", path: "/ai-search" },
			]),
			itemListJsonLd(
				aiSearchEngines.map((e) => ({
					name: `How to appear in ${e.name}`,
					path: `/ai-search/${e.slug}`,
				})),
			),
		],
	}),
	component: AiSearchIndex,
});

function AiSearchIndex() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<section className="border-b border-zinc-200 bg-white py-12 lg:py-20">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
							/ AI Search
						</p>
						<h1 className="font-heading mt-2 text-4xl text-balance text-zinc-950 md:text-5xl">
							How to show up in AI search
						</h1>
						<p className="mt-4 max-w-3xl text-lg text-balance text-zinc-600">
							Each AI engine chooses its sources a little differently. These
							guides break down how the major ones decide what to cite, and the
							practical steps to become one of them.
						</p>
					</div>
				</section>

				<section className="bg-white py-10">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
							{aiSearchEngines.map((e) => (
								<a
									key={e.slug}
									href={`/ai-search/${e.slug}`}
									className="flex flex-col rounded-md border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300"
								>
									<div className="flex items-baseline justify-between gap-2">
										<h2 className="font-semibold text-zinc-950">{e.name}</h2>
										<span className="text-xs text-zinc-400">{e.vendor}</span>
									</div>
									<p className="mt-2 text-sm leading-relaxed text-zinc-600">
										{e.short}
									</p>
								</a>
							))}
						</div>
					</div>
				</section>
			</main>
			<Footer />
		</div>
	);
}
