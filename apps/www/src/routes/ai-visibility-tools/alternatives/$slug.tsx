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
	getCompetitorBySlug,
	getComparisonSlug,
	isIndexed,
	getAlternatives,
	getAlternativesVerdict,
	getAlternativesFaqs,
	type Competitor,
} from "@/lib/competitors";

export const Route = createFileRoute("/ai-visibility-tools/alternatives/$slug")({
	head: ({ params }) => {
		const c = getCompetitorBySlug(params.slug);
		if (!c || !isIndexed(c)) return {};
		const title = `${c.name} Alternatives | Open-Source AI Visibility · Getcito`;
		const description = `The best ${c.name} alternatives for AI visibility tracking, including Getcito — the open-source, self-hosted option you can run for free.`;
		const path = `/ai-visibility-tools/alternatives/${params.slug}`;
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
					{ name: `${c.name} alternatives`, path },
				]),
				faqJsonLd(getAlternativesFaqs(c, getAlternatives(c))),
			],
		};
	},
	loader: ({ params }) => {
		const c = getCompetitorBySlug(params.slug);
		if (!c || !isIndexed(c)) throw notFound();
		return { competitor: c, alternatives: getAlternatives(c) };
	},
	component: AlternativesPage,
});

function AlternativesPage() {
	const { competitor, alternatives } = Route.useLoaderData() as {
		competitor: Competitor;
		alternatives: Competitor[];
	};
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="Alternatives"
					title={`${competitor.name} alternatives`}
					lead={getAlternativesVerdict(competitor)}
				/>

				<DirectoryGetcitoBanner
					pitch="Getcito tracks how ChatGPT, Claude, Perplexity, Gemini, and Google AI Overviews mention and cite your brand. It is open source, so you self-host it for free, keep your data in-house, and verify exactly how each metric is calculated. No per-seat pricing, no black-box scores, no lock-in."
					comparison={{
						slug: getComparisonSlug(competitor),
						name: competitor.name,
					}}
				/>

				<DirectorySection title={`Other ${competitor.name} alternatives`}>
					<ToolGrid competitors={alternatives} />
				</DirectorySection>

				<Faq
					items={getAlternativesFaqs(competitor, alternatives)}
					eyebrow="/ FAQ"
				/>
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
