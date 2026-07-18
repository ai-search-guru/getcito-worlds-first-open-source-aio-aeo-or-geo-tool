import { createFileRoute } from "@tanstack/react-router";
import { AiVisibilitySoftwareHub } from "@/components/ai-visibility-software-hub";
import { CompetitorDirectory } from "@/components/competitor-directory";
import { Faq } from "@/components/faq";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { competitors, getComparisonSlug, isLowDR } from "@/lib/competitors";
import { DIRECTORY_FAQS } from "@/lib/faqs";
import { breadcrumbJsonLd, canonicalUrl, faqJsonLd, itemListJsonLd, ogMeta } from "@/lib/seo";

const title = "AI Visibility Tool Directory | Compare AI Search Tools · Getcito";
const description =
	"AI visibility software tracks your brand across ChatGPT, Perplexity, and Gemini. Compare 100+ AI visibility and AEO tools, head-to-head with Getcito.";

// Indexed comparison pages (mirrors the sitemap filter), surfaced as ItemList
// structured data so AI engines can extract the full directory of tools.
const directoryItems = competitors
	.filter((c) => c.status !== "shutting-down" && c.category !== "other" && !isLowDR(c))
	.map((c) => ({
		name: c.name,
		path: `/ai-visibility-tools/${getComparisonSlug(c)}`,
	}));

export const Route = createFileRoute("/ai-visibility-tools/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({
				title,
				description,
				path: "/ai-visibility-tools",
			}),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/ai-visibility-tools") }],
		scripts: [
			faqJsonLd(DIRECTORY_FAQS),
			itemListJsonLd(directoryItems),
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "AI Visibility Tool Directory", path: "/ai-visibility-tools" },
			]),
		],
	}),
	component: AiVisibilitySoftwarePage,
});

const browseLinks = [
	{
		title: "Compare head-to-head",
		description:
			"Side-by-side breakdowns of the leading platforms, with Getcito in the mix.",
		href: "/ai-visibility-tools/compare",
	},
	{
		title: "Find alternatives",
		description: "The closest options to any tool you're evaluating.",
		href: "/ai-visibility-tools/alternatives",
	},
	{
		title: "Browse by feature",
		description:
			"Which tools offer citation analytics, white-label, sentiment, and more.",
		href: "/ai-visibility-tools/features",
	},
	{
		title: "Browse by category",
		description: "Trackers, content platforms, APIs, SEO suites, and open source.",
		href: "/ai-visibility-tools/category",
	},
];

function AiVisibilitySoftwarePage() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<CompetitorDirectory />
				<AiVisibilitySoftwareHub />
				<section className="border-b border-zinc-200 bg-zinc-50 py-12 lg:py-20">
					<div className="mx-auto max-w-6xl px-4 md:px-6">
						<h2 className="font-heading text-2xl text-zinc-950 md:text-3xl">
							Browse the directory
						</h2>
						<p className="mt-3 max-w-3xl text-zinc-600">
							Compare tools head-to-head, find alternatives to one you're
							evaluating, or filter the field by feature and category.
						</p>
						<div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
							{browseLinks.map((link) => (
								<a
									key={link.href}
									href={link.href}
									className="flex flex-col rounded-md border border-zinc-200 bg-white p-5 transition-colors hover:border-zinc-300"
								>
									<h3 className="font-semibold text-zinc-950">{link.title}</h3>
									<p className="mt-2 text-sm leading-relaxed text-zinc-600">
										{link.description}
									</p>
								</a>
							))}
						</div>
					</div>
				</section>
				<Faq items={DIRECTORY_FAQS} eyebrow="/ FAQ" />
			</main>
			<Footer />
		</div>
	);
}
