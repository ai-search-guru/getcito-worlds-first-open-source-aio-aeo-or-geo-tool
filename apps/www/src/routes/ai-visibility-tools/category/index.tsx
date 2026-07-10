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
	indexableCategories,
	toolsInCategory,
	CATEGORY_SLUGS,
	CATEGORY_HEADINGS,
} from "@/lib/competitors";

const title = "AI Visibility Tools by Category · Getcito";
const description =
	"Browse AI visibility tools by category: dedicated trackers, content platforms, developer APIs, SEO suites, e-commerce, and open source.";

const items = indexableCategories.map((category) => ({
	name: CATEGORY_HEADINGS[category],
	path: `/ai-visibility-tools/category/${CATEGORY_SLUGS[category]}`,
}));

export const Route = createFileRoute("/ai-visibility-tools/category/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/ai-visibility-tools/category" }),
		],
		links: [
			{ rel: "canonical", href: canonicalUrl("/ai-visibility-tools/category") },
		],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "AI Visibility Tool Directory", path: "/ai-visibility-tools" },
				{ name: "Categories", path: "/ai-visibility-tools/category" },
			]),
			itemListJsonLd(items),
		],
	}),
	component: CategoryHub,
});

function CategoryHub() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="By category"
					title="Browse AI visibility tools by category"
					lead="The market splits into a few distinct groups. Pick the type of tool you're after to compare the options in that category side by side."
				/>
				<DirectorySection>
					<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
						{indexableCategories.map((category) => (
							<li key={category}>
								<a
									href={`/ai-visibility-tools/category/${CATEGORY_SLUGS[category]}`}
									className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
								>
									<span>{CATEGORY_HEADINGS[category]}</span>
									<span className="font-mono text-[11px] text-zinc-400">
										{toolsInCategory(category).length}
									</span>
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
