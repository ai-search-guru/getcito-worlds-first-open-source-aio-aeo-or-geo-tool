import { createFileRoute, notFound } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Faq } from "@/components/faq";
import { ToolGrid } from "@/components/tool-list";
import {
	DirectoryBackLink,
	DirectoryHero,
	DirectorySection,
	GetcitoCta,
} from "@/components/directory-shell";
import { ogMeta, canonicalUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";
import {
	getFeatureKeyBySlug,
	toolsWithFeature,
	getFeatureLabel,
	getFeatureVerdict,
	getFeatureFaqs,
	MIN_TOOLS_FOR_FEATURE_PAGE,
	type Competitor,
	type FeatureKey,
} from "@/lib/competitors";

export const Route = createFileRoute("/ai-visibility-tools/features/$slug")({
	head: ({ params }) => {
		const key = getFeatureKeyBySlug(params.slug);
		if (!key) return {};
		const tools = toolsWithFeature(key);
		if (tools.length < MIN_TOOLS_FOR_FEATURE_PAGE) return {};
		const label = getFeatureLabel(key);
		const title = `AI Visibility Tools with ${label} · Getcito`;
		const description = `See which AI visibility tools offer ${label.toLowerCase()} and how they compare, including the open-source option, Getcito.`;
		const path = `/ai-visibility-tools/features/${params.slug}`;
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
					{ name: label, path },
				]),
				faqJsonLd(getFeatureFaqs(key, tools)),
			],
		};
	},
	loader: ({ params }) => {
		const key = getFeatureKeyBySlug(params.slug);
		if (!key) throw notFound();
		const tools = toolsWithFeature(key);
		if (tools.length < MIN_TOOLS_FOR_FEATURE_PAGE) throw notFound();
		return { featureKey: key, tools };
	},
	component: FeaturePage,
});

function FeaturePage() {
	const { featureKey, tools } = Route.useLoaderData() as {
		featureKey: FeatureKey;
		tools: Competitor[];
	};
	const label = getFeatureLabel(featureKey);
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="Feature"
					title={`AI visibility tools with ${label}`}
					lead={getFeatureVerdict(featureKey, tools)}
				/>
				<DirectorySection title="Tools that offer this feature">
					<ToolGrid competitors={tools} />
				</DirectorySection>
				<Faq items={getFeatureFaqs(featureKey, tools)} eyebrow="/ FAQ" />
				<GetcitoCta />
			</main>
			<Footer />
		</div>
	);
}
