import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { BlogPostLayout } from "@/components/blog-post-layout";
import { resolveAuthor } from "@/data/authors";
import {
	blogPostingJsonLd,
	breadcrumbJsonLd,
	canonicalUrl,
	definedTermSetJsonLd,
	faqJsonLd,
	howToJsonLd,
	itemListJsonLd,
	ogMeta,
	SITE_NAME,
} from "@/lib/seo";

export interface BlogPostFaqItem {
	question: string;
	answer: string;
}

export interface BlogPostLoaderData {
	slugs: string[];
	/** Collection-relative file path, passed to the browser client loader. */
	path: string;
	title: string;
	description: string;
	date: string;
	author: string;
	tags: string[];
	/** SEO <title> override; falls back to `${title} · Getcito` (see source.config.ts). */
	metaTitle?: string;
	/** Rendered at the foot of the post and emitted as FAQPage JSON-LD. */
	faq?: BlogPostFaqItem[];
	/** Emitted as ItemList JSON-LD on roundup posts. */
	itemList?: { name: string; url?: string; description?: string }[];
	/** Emitted as DefinedTermSet JSON-LD on the glossary. */
	definedTerms?: { term: string; definition: string; href?: string }[];
	/** Emitted as HowTo JSON-LD on step-by-step guides. */
	howTo?: { name?: string; description?: string; steps: { name: string; text: string }[] };
}

export const Route = createFileRoute("/blog/$")({
	component: Page,
	head: ({ loaderData }) => {
		const data = loaderData as BlogPostLoaderData | undefined;
		if (!data) return {};

		const { title, description, date, author, slugs, metaTitle, faq, itemList, definedTerms, howTo } = data;
		const pageTitle = metaTitle ?? `${title} · ${SITE_NAME}`;
		const pageDescription = description || `${title} — from the ${SITE_NAME} blog.`;
		const path = `/blog/${slugs.join("/")}`;
		const resolved = resolveAuthor(author);
		const authorName =
			resolved.kind === "team" ? resolved.author.name : resolved.kind === "unknown" ? resolved.name : undefined;

		return {
			meta: [
				{ title: pageTitle },
				{ name: "description", content: pageDescription },
				...ogMeta({
					title: pageTitle,
					description: pageDescription,
					path,
					type: "article",
				}),
			],
			links: [{ rel: "canonical", href: canonicalUrl(path) }],
			scripts: [
				blogPostingJsonLd({
					title,
					description: pageDescription,
					path,
					datePublished: date,
					authorName,
				}),
				breadcrumbJsonLd([
					{ name: "Home", path: "/" },
					{ name: "Blog", path: "/blog" },
					{ name: title, path },
				]),
				...(faq && faq.length > 0 ? [faqJsonLd(faq)] : []),
				...(itemList && itemList.length > 0 ? [itemListJsonLd(itemList)] : []),
				...(definedTerms && definedTerms.length > 0
					? [
							definedTermSetJsonLd({
								name: title,
								description: pageDescription,
								path,
								terms: definedTerms.map((t) => ({ term: t.term, definition: t.definition, url: t.href })),
							}),
						]
					: []),
				...(howTo
					? [howToJsonLd({ name: howTo.name ?? title, description: howTo.description, steps: howTo.steps })]
					: []),
			],
		};
	},
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		return await serverLoader({ data: slugs });
	},
});

export const serverLoader = createServerFn({ method: "GET" })
	.inputValidator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }): Promise<BlogPostLoaderData> => {
		// Lazy import keeps the server-only blog source out of the client bundle
		// (see the note in @/lib/blog and the same pattern in routes/docs/$.tsx).
		const { blogSource } = await import("@/lib/blog");
		const page = blogSource.getPage(slugs);
		if (!page) throw notFound();

		return {
			slugs,
			path: page.path,
			title: page.data.title,
			description: page.data.description ?? "",
			date: page.data.date,
			author: page.data.author,
			tags: page.data.tags ?? [],
			metaTitle: page.data.metaTitle,
			faq: page.data.faq,
			itemList: page.data.itemList,
			definedTerms: page.data.definedTerms,
			howTo: page.data.howTo,
		};
	});

function Page() {
	const loaderData = Route.useLoaderData() as BlogPostLoaderData;
	return <BlogPostLayout data={loaderData} />;
}
