import { createFileRoute } from "@tanstack/react-router";
import { Navbar } from "@/components/navbar";
import { Hero } from "@/components/hero";
import { Features } from "@/components/features";
import { Stats } from "@/components/stats";
import { Community } from "@/components/community";
import { Pricing } from "@/components/pricing";
import { OffSiteAeoPromo } from "@/components/off-site-aeo";
import { CTA } from "@/components/cta";
import { Footer } from "@/components/footer";
import { Faq } from "@/components/faq";
import { HOME_FAQS } from "@/lib/faqs";
import {
	SITE_NAME,
	SITE_DESCRIPTION,
	ogMeta,
	softwareApplicationJsonLd,
	faqJsonLd,
	canonicalUrl,
} from "@/lib/seo";

export const Route = createFileRoute("/")({
	head: () => ({
		meta: [
			{ title: `${SITE_NAME} · Open Source AI Visibility` },
			{ name: "description", content: SITE_DESCRIPTION },
			...ogMeta({
				title: `${SITE_NAME} · Open Source AI Visibility`,
				description: SITE_DESCRIPTION,
				path: "/",
			}),
		],
		links: [{ rel: "canonical", href: canonicalUrl("/") }],
		scripts: [softwareApplicationJsonLd(), faqJsonLd(HOME_FAQS)],
	}),
	component: HomePage,
});

function HomePage() {
	return (
		<div className="min-h-screen">
			<Navbar />
			<main>
				<Hero />
				<Stats />
				<Features />
				<Community />
				<Pricing />
				<OffSiteAeoPromo />
				<Faq items={HOME_FAQS} eyebrow="/ FAQ" />
				<CTA />
			</main>
			<Footer />
		</div>
	);
}
