import { createFileRoute, notFound } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { CompetitorComparison } from "@/components/competitor-comparison";
import { Footer } from "@/components/footer";
import { ogMeta, canonicalUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";
import {
	competitors,
	getComparisonSlug,
	getComparisonFaqs,
	isLowDR,
	type Competitor,
} from "@/lib/competitors";

export const Route = createFileRoute("/ai-visibility-tools/$slug")({
	head: ({ params }) => {
		const competitor = competitors.find(
			(c) => getComparisonSlug(c) === params.slug,
		);
		if (!competitor) return {};
		const title = `Getcito vs ${competitor.name} | AI Visibility Tool Comparison · Getcito`;
		const description = `Compare Getcito and ${competitor.name} for AI visibility tracking. Feature-by-feature breakdown, pricing, and key differences.`;
		const path = `/ai-visibility-tools/${params.slug}`;
		const meta = [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path }),
		];
		if (isLowDR(competitor)) {
			meta.push({ name: "robots", content: "noindex, follow" });
		}
		return {
			meta,
			links: [{ rel: "canonical", href: canonicalUrl(path) }],
			scripts: [
				breadcrumbJsonLd([
					{ name: "Home", path: "/" },
					{ name: "AI Visibility Tool Directory", path: "/ai-visibility-tools" },
					{ name: `Getcito vs ${competitor.name}`, path },
				]),
				faqJsonLd(getComparisonFaqs(competitor)),
			],
		};
	},
	component: ComparisonPage,
	loader: ({ params }) => {
		const competitor = competitors.find(
			(c) => getComparisonSlug(c) === params.slug,
		);
		if (!competitor) throw notFound();
		return { competitor };
	},
});

function ComparisonPage() {
	const { competitor } = Route.useLoaderData() as { competitor: Competitor };
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<CompetitorComparison competitor={competitor} />
			</main>
			<Footer />
		</div>
	);
}
