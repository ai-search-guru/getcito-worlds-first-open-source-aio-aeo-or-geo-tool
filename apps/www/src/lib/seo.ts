import { getMarketingOgImage } from "./og";

export const SITE_URL = "https://www.Getcitohq.com";
export const SITE_NAME = "Getcito";
export const SITE_DESCRIPTION = "Open source AI visibility tracking and optimization.";
export const SITE_LOGO_URL = `${SITE_URL}/brand/icons/getcito-icon-512.png`;

export function canonicalUrl(path: string): string {
	return `${SITE_URL}${path}`;
}

export function ogMeta({
	title,
	description,
	path,
	image,
	type = "website",
}: {
	title: string;
	description: string;
	path: string;
	image?: string;
	type?: "website" | "article";
}) {
	const url = canonicalUrl(path);
	const resolvedImage = image ?? getMarketingOgImage({ title, description });
	const absoluteImage = resolvedImage.startsWith("http") ? resolvedImage : canonicalUrl(resolvedImage);

	return [
		{ property: "og:title", content: title },
		{ property: "og:description", content: description },
		{ property: "og:url", content: url },
		{ property: "og:site_name", content: SITE_NAME },
		{ property: "og:type", content: type },
		{ property: "og:locale", content: "en_US" },
		{ property: "og:image", content: absoluteImage },
		{ property: "og:image:width", content: "1200" },
		{ property: "og:image:height", content: "630" },
		{ property: "og:image:alt", content: title },
		{ name: "twitter:card", content: "summary_large_image" },
		{ name: "twitter:title", content: title },
		{ name: "twitter:description", content: description },
		{ name: "twitter:image", content: absoluteImage },
	];
}

export function jsonLd(data: Record<string, unknown>): {
	type: string;
	children: string;
} {
	return {
		type: "application/ld+json",
		children: JSON.stringify({ "@context": "https://schema.org", ...data }),
	};
}

export function websiteJsonLd() {
	return jsonLd({
		"@type": "WebSite",
		name: SITE_NAME,
		url: SITE_URL,
		description: SITE_DESCRIPTION,
	});
}

export function organizationJsonLd() {
	return jsonLd({
		"@type": "Organization",
		name: SITE_NAME,
		url: SITE_URL,
		logo: SITE_LOGO_URL,
		sameAs: [
			"https://github.com/ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool",
			"https://x.com/tryGetcito",
			"https://www.linkedin.com/company/Getcitohq",
			"https://discord.gg/s24nubCtKz",
		],
		parentOrganization: {
			"@type": "Organization",
			name: "Blue Whale Software, LLC",
			url: "https://bluewhale.dev",
		},
	});
}

export function softwareApplicationJsonLd() {
	return jsonLd({
		"@type": "SoftwareApplication",
		name: SITE_NAME,
		description: SITE_DESCRIPTION,
		applicationCategory: "BusinessApplication",
		operatingSystem: "Any",
		offers: {
			"@type": "Offer",
			price: "0",
			priceCurrency: "USD",
		},
		url: SITE_URL,
	});
}

export function articleJsonLd({ title, description, path }: { title: string; description: string; path: string }) {
	return jsonLd({
		"@type": "TechArticle",
		headline: title,
		description,
		url: canonicalUrl(path),
		publisher: {
			"@type": "Organization",
			name: SITE_NAME,
			url: SITE_URL,
		},
	});
}

export function blogPostingJsonLd({
	title,
	description,
	path,
	datePublished,
	authorName,
}: {
	title: string;
	description: string;
	path: string;
	datePublished: string;
	/** A real person's name. Omit for AI-generated posts — the org is credited. */
	authorName?: string;
}) {
	return jsonLd({
		"@type": "BlogPosting",
		headline: title,
		description,
		url: canonicalUrl(path),
		datePublished,
		author: authorName
			? { "@type": "Person", name: authorName }
			: { "@type": "Organization", name: SITE_NAME, url: SITE_URL },
		publisher: {
			"@type": "Organization",
			name: SITE_NAME,
			url: SITE_URL,
			logo: { "@type": "ImageObject", url: SITE_LOGO_URL },
		},
	});
}

export function breadcrumbJsonLd(items: { name: string; path: string }[]) {
	return jsonLd({
		"@type": "BreadcrumbList",
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			item: canonicalUrl(item.path),
		})),
	});
}

/**
 * FAQPage schema — the question/answer pairs an answer engine is most likely to
 * lift verbatim. Pair it with a visibly rendered FAQ (the <Faq> component, or
 * the blog FAQ block) so the markup and the content stay in sync.
 */
export function faqJsonLd(items: { question: string; answer: string }[]) {
	return jsonLd({
		"@type": "FAQPage",
		mainEntity: items.map((item) => ({
			"@type": "Question",
			name: item.question,
			acceptedAnswer: {
				"@type": "Answer",
				text: item.answer,
			},
		})),
	});
}

/**
 * ItemList schema for roundup/listicle and directory pages. Provide `path` for a
 * site-relative item (canonicalized here) or `url` for an absolute one (e.g. an
 * external vendor); `description` is optional.
 */
export function itemListJsonLd(items: { name: string; path?: string; url?: string; description?: string }[]) {
	return jsonLd({
		"@type": "ItemList",
		itemListElement: items.map((item, index) => ({
			"@type": "ListItem",
			position: index + 1,
			name: item.name,
			...(item.path
				? { url: canonicalUrl(item.path) }
				: item.url
					? { url: item.url.startsWith("http") ? item.url : canonicalUrl(item.url) }
					: {}),
			...(item.description ? { description: item.description } : {}),
		})),
	});
}

/**
 * DefinedTermSet schema for the glossary. Each term is a DefinedTerm; `url` is
 * an optional "see also" target (canonicalized when site-relative).
 */
export function definedTermSetJsonLd({
	name,
	description,
	path,
	terms,
}: {
	name: string;
	description?: string;
	path?: string;
	terms: { term: string; definition: string; url?: string }[];
}) {
	return jsonLd({
		"@type": "DefinedTermSet",
		name,
		...(description ? { description } : {}),
		...(path ? { url: canonicalUrl(path) } : {}),
		hasDefinedTerm: terms.map((t) => ({
			"@type": "DefinedTerm",
			name: t.term,
			description: t.definition,
			...(t.url ? { url: t.url.startsWith("http") ? t.url : canonicalUrl(t.url) } : {}),
		})),
	});
}

/** HowTo schema for step-by-step guides (e.g. tracking a brand in AI search). */
export function howToJsonLd({
	name,
	description,
	steps,
}: {
	name: string;
	description?: string;
	steps: { name: string; text: string }[];
}) {
	return jsonLd({
		"@type": "HowTo",
		name,
		...(description ? { description } : {}),
		step: steps.map((step, index) => ({
			"@type": "HowToStep",
			position: index + 1,
			name: step.name,
			text: step.text,
		})),
	});
}
