import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Features } from "@/components/features";
import { CTA } from "@/components/cta";
import { Footer } from "@/components/footer";
import { ogMeta, canonicalUrl, breadcrumbJsonLd } from "@/lib/seo";

const title = "Features — AI Visibility & Citation Tracking · Getcito";
const description =
	"AI visibility tracking, citation analysis, competitor intelligence, and more. Everything you need to monitor your brand in AI search.";

export const Route = createFileRoute("/features")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/features" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/features") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "Features", path: "/features" },
			]),
		],
	}),
	component: FeaturesPage,
});

function FeaturesPage() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<Features />
				<CTA />
			</main>
			<Footer />
		</div>
	);
}
