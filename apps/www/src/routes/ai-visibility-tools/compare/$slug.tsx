import { createFileRoute, notFound } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Faq } from "@/components/faq";
import { PairComparison } from "@/components/pair-comparison";
import {
	DirectoryBackLink,
	DirectoryHero,
	GetcitoCta,
} from "@/components/directory-shell";
import { ogMeta, canonicalUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";
import {
	getComparePair,
	getPairVerdict,
	getPairFaqs,
	type Competitor,
} from "@/lib/competitors";

export const Route = createFileRoute("/ai-visibility-tools/compare/$slug")({
	head: ({ params }) => {
		const pair = getComparePair(params.slug);
		if (!pair) return {};
		const [a, b] = pair;
		const title = `${a.name} vs ${b.name} | AI Visibility Tool Comparison · Getcito`;
		const description = `Compare ${a.name} and ${b.name} for AI visibility tracking — feature by feature, with pricing and Getcito as the open-source alternative.`;
		const path = `/ai-visibility-tools/compare/${params.slug}`;
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
					{ name: `${a.name} vs ${b.name}`, path },
				]),
				faqJsonLd(getPairFaqs(a, b)),
			],
		};
	},
	loader: ({ params }) => {
		const pair = getComparePair(params.slug);
		if (!pair) throw notFound();
		return { a: pair[0], b: pair[1] };
	},
	component: PairPage,
});

function PairPage() {
	const { a, b } = Route.useLoaderData() as { a: Competitor; b: Competitor };
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="Comparison"
					title={`${a.name} vs ${b.name}`}
					lead={getPairVerdict(a, b)}
				/>
				<PairComparison a={a} b={b} />
				<Faq items={getPairFaqs(a, b)} eyebrow="/ FAQ" />
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
