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
	FEATURE_CATEGORIES,
	FEATURE_SLUGS,
	getFeatureLabel,
	indexableFeatureKeys,
	toolsWithFeature,
	type FeatureKey,
} from "@/lib/competitors";

const title = "AI Visibility Tools by Feature · Getcito";
const description =
	"Browse AI visibility tools by capability: multi-LLM tracking, citation analytics, sentiment, white-label, and more. See which tools offer each feature.";

const indexableKeys = new Set(indexableFeatureKeys());

// Group the indexable features under their feature-matrix sections, keeping the
// matrix order. Sections with no indexable feature are dropped.
const featureGroups = Object.values(FEATURE_CATEGORIES)
	.map((section) => ({
		label: section.label,
		keys: (Object.keys(section.features) as FeatureKey[]).filter((key) =>
			indexableKeys.has(key),
		),
	}))
	.filter((group) => group.keys.length > 0);

const items = indexableFeatureKeys().map((key) => ({
	name: getFeatureLabel(key),
	path: `/ai-visibility-tools/features/${FEATURE_SLUGS[key]}`,
}));

export const Route = createFileRoute("/ai-visibility-tools/features/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/ai-visibility-tools/features" }),
		],
		links: [
			{ rel: "canonical", href: canonicalUrl("/ai-visibility-tools/features") },
		],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "AI Visibility Tool Directory", path: "/ai-visibility-tools" },
				{ name: "Features", path: "/ai-visibility-tools/features" },
			]),
			itemListJsonLd(items),
		],
	}),
	component: FeatureHub,
});

function FeatureHub() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<DirectoryBackLink />
				<DirectoryHero
					eyebrow="By feature"
					title="Browse AI visibility tools by feature"
					lead="Filter the field by capability. Pick a feature to see which AI visibility tools offer it and how they compare, including the open-source option you can self-host."
				/>
				{featureGroups.map((group) => (
					<DirectorySection key={group.label} title={group.label}>
						<ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
							{group.keys.map((key) => (
								<li key={key}>
									<a
										href={`/ai-visibility-tools/features/${FEATURE_SLUGS[key]}`}
										className="flex items-center justify-between rounded-md border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:text-zinc-950"
									>
										<span>{getFeatureLabel(key)}</span>
										<span className="font-mono text-[11px] text-zinc-400">
											{toolsWithFeature(key).length}
										</span>
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
