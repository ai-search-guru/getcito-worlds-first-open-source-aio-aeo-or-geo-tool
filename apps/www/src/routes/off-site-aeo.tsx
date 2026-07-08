import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import {
	OffSiteHero,
	OffSiteValue,
	OffSiteProcess,
	OffSitePricing,
	OffSiteCTA,
} from "@/components/off-site-aeo";
import { Footer } from "@/components/footer";
import { Faq } from "@/components/faq";
import { OFFSITE_FAQS } from "@/lib/faqs";
import { ogMeta, canonicalUrl, breadcrumbJsonLd, faqJsonLd } from "@/lib/seo";

const title = "Off-Site AEO — Get Cited by AI on High-Authority Sites · Getcito";
const description =
	"Managed off-site AEO: we place human-edited guest articles on high-authority (DR20–60+) sites so AI answer engines cite your brand. Targeted to your gaps, refreshed monthly, with a report. Great backlinks, too.";

export const Route = createFileRoute("/off-site-aeo")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/off-site-aeo" }),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/off-site-aeo") }],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "Off-Site AEO", path: "/off-site-aeo" },
			]),
			faqJsonLd(OFFSITE_FAQS),
		],
	}),
	component: OffSiteAeoPage,
});

function OffSiteAeoPage() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<OffSiteHero />
				<OffSiteValue />
				<OffSiteProcess />
				<OffSitePricing />
				<Faq items={OFFSITE_FAQS} eyebrow="/ FAQ" />
				<OffSiteCTA />
			</main>
			<Footer />
		</div>
	);
}
