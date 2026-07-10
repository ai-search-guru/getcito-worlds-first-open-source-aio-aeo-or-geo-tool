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
import {
	indexedCompetitors,
	indexableCategories,
	toolsInCategory,
	CATEGORY_LABELS,
} from "@/lib/competitors";

const title = "AI Visibility Tool Alternatives · Getcito";
const description =
	"Find open-source and self-hosted alternatives to the AI visibility tools you're evaluating. Each guide compares the closest options, with Getcito as the free, auditable pick.";

const items = indexedCompetitors.map((c) => ({
	name: `${c.name} alternatives`,
	path: `/ai-visibility-tools/alternatives/${c.slug}`,
}));

export const Route = createFileRoute("/ai-visibility-tools/alternatives/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({
				title,
				description,
				path: "/ai-visibility-tools/alternatives",
			}),
		],
		links: [
			{
				rel: "canonical",
				href: canonicalUrl("/ai-visibility-tools/alternatives"),
			},
		],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "AI Visibility Tool Directory", path: "/ai-visibility-tools" },
				{ name: "Alternatives", path: "/ai-visibility-tools/alternatives" },
			]),
			itemListJsonLd(items),
		],
	}),
	component: AlternativesHub,
});

function AlternativesHub() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="Alternatives"
					title="Alternatives to every AI visibility tool"
					lead="Shopping for a replacement, or just want to know your options? Pick a tool to see its closest alternatives, including the open-source, self-hosted option you can run for free."
				/>
				{indexableCategories.map((category) => (
					<DirectorySection key={category} title={CATEGORY_LABELS[category]}>
						<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{toolsInCategory(category).map((c) => (
								<li key={c.slug}>
									<a
										href={`/ai-visibility-tools/alternatives/${c.slug}`}
										className="block rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
									>
										{c.name} alternatives
									</a>
								</li>
							))}
						</ul>
					</DirectorySection>
				))}
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
