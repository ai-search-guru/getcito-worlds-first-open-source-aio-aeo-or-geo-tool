import { createFileRoute, notFound } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Faq } from "@/components/faq";
import { ToolGrid } from "@/components/tool-list";
import {
	DirectoryBackLink,
	DirectoryGetcitoBanner,
	DirectoryHero,
	DirectorySection,
	GetcitoCta,
} from "@/components/directory-shell";
import { ogMeta, canonicalUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";
import {
	getCategoryBySlug,
	getCategoryGetcitoPitch,
	getComparisonSlug,
	toolsInCategory,
	getCategoryVerdict,
	getCategoryFaqs,
	CATEGORY_HEADINGS,
	type Competitor,
	type CompetitorCategory,
} from "@/lib/competitors";

export const Route = createFileRoute("/ai-visibility-tools/category/$slug")({
	head: ({ params }) => {
		const category = getCategoryBySlug(params.slug);
		if (!category) return {};
		const tools = toolsInCategory(category);
		if (tools.length < 2) return {};
		const heading = CATEGORY_HEADINGS[category];
		const title = `${heading.charAt(0).toUpperCase()}${heading.slice(1)} · Getcito`;
		const description = `A comparison of ${heading} for tracking your brand in AI search, including Getcito — the open-source, self-hosted option.`;
		const path = `/ai-visibility-tools/category/${params.slug}`;
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
					{ name: "AI Visibility Tool Directory", path: "/ai-visibility-tools" },
					{ name: heading, path },
				]),
				faqJsonLd(getCategoryFaqs(category, tools)),
			],
		};
	},
	loader: ({ params }) => {
		const category = getCategoryBySlug(params.slug);
		if (!category) throw notFound();
		const tools = toolsInCategory(category);
		if (tools.length < 2) throw notFound();
		return { category, tools };
	},
	component: CategoryPage,
});

function CategoryPage() {
	const { category, tools } = Route.useLoaderData() as {
		category: CompetitorCategory;
		tools: Competitor[];
	};
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="Category"
					title={CATEGORY_HEADINGS[category]}
					lead={getCategoryVerdict(category, tools)}
				/>
				<DirectoryGetcitoBanner
					pitch={getCategoryGetcitoPitch(category)}
					comparison={{
						slug: getComparisonSlug(tools[0]),
						name: tools[0].name,
					}}
				/>
				<DirectorySection title="Tools in this category">
					<ToolGrid competitors={tools} />
				</DirectorySection>
				<Faq items={getCategoryFaqs(category, tools)} eyebrow="/ FAQ" />
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
