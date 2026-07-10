import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import {
	DirectoryBackLink,
	DirectoryHero,
	DirectorySection,
	GetcitoCta,
} from "@/components/directory-shell";
import {
	ogMeta,
	canonicalUrl,
	breadcrumbJsonLd,
	itemListJsonLd,
} from "@/lib/seo";
import { comparePairs, comparePairSlug } from "@/lib/competitors";

const title = "Compare AI Visibility Tools Head-to-Head · Getcito";
const description =
	"Head-to-head comparisons of the leading AI visibility platforms — Profound, Peec AI, AirOps, Scrunch, OtterlyAI, and AthenaHQ — feature by feature, with Getcito as the open-source alternative.";

const items = comparePairs.map(([a, b]) => ({
	name: `${a.name} vs ${b.name}`,
	path: `/ai-visibility-tools/compare/${comparePairSlug(a, b)}`,
}));

export const Route = createFileRoute("/ai-visibility-tools/compare/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/ai-visibility-tools/compare" }),
		],
		links: [
			{ rel: "canonical", href: canonicalUrl("/ai-visibility-tools/compare") },
		],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "AI Visibility Tool Directory", path: "/ai-visibility-tools" },
				{ name: "Compare", path: "/ai-visibility-tools/compare" },
			]),
			itemListJsonLd(items),
		],
	}),
	component: CompareHub,
});

function CompareHub() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="Compare"
					title="AI visibility tools, head-to-head"
					lead="Weighing two of the funded AI visibility platforms against each other? These side-by-side breakdowns compare their tracking, analytics, and pricing, and show where an open-source tool like Getcito fits in."
				/>
				<DirectorySection title="Pick a matchup">
					<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{items.map((item) => (
							<li key={item.path}>
								<a
									href={item.path}
									className="block rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
								>
									{item.name}
								</a>
							</li>
						))}
					</ul>
				</DirectorySection>
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
