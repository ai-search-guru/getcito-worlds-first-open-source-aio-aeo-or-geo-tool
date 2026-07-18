// Mirrors docs-page-layout.tsx: the heavy fumadocs-ui / browser-collection
// imports live here, NOT in the route file. routes/blog/$.tsx only
// references BlogPostLayout from inside the route's `component:`, which
// @tanstack/router-plugin auto-splits into its own chunk, keeping these deps
// out of the bundle that loads on other marketing pages.

import browserCollections from "collections/browser";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { ArrowLeft } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { Suspense } from "react";
import { AuthorByline } from "@/components/author-byline";
import { Footer } from "@/components/footer";
import { getMDXComponents } from "@/components/mdx";
import { Navbar } from "@/components/navbar";
import type { BlogPostFaqItem, BlogPostLoaderData } from "@/routes/blog/$";

function isGetcitoHref(href: string): boolean {
	if (href.startsWith("/") || href.startsWith("#")) return true;
	try {
		const { hostname } = new URL(href);
		return hostname === "Getcito.com" || hostname.endsWith(".Getcito.com");
	} catch {
		// mailto:, tel:, or other non-http(s) hrefs — not an outbound web link.
		return true;
	}
}

// Links inside post content: outbound links are nofollow and open in a new
// tab, so blog posts don't pass SEO equity to external sites (e.g. competitors
// we reference). Internal / Getcito-owned links stay followed; noopener keeps
// the referrer for analytics on owned domains.
function BlogLink({ href = "", ...props }: ComponentPropsWithoutRef<"a">) {
	if (isGetcitoHref(href)) {
		const rel = /^https?:\/\//.test(href) ? "noopener" : undefined;
		return <a {...props} href={href} rel={rel} />;
	}
	return <a {...props} href={href} target="_blank" rel="nofollow noopener noreferrer" />;
}

// getMDXComponents is a plain factory (no React hooks), so the components map
// is built once at module scope rather than per render.
const mdxComponents = getMDXComponents({ a: BlogLink });

export const clientLoader = browserCollections.blog.createClientLoader({
	component({ default: MDX }, _props: undefined) {
		return <MDX components={mdxComponents} />;
	},
});

// Rendered from frontmatter `faq` so the visible Q&A and the FAQPage JSON-LD
// (emitted in routes/blog/$.tsx) come from one source. Questions are h3s so
// they nest under the post's h2 outline and pick up prose styling.
function PostFaq({ items }: { items: BlogPostFaqItem[] }) {
	return (
		<section className="mt-14">
			<h2 id="faq">Frequently asked questions</h2>
			{items.map((item) => (
				<div key={item.question}>
					<h3>{item.question}</h3>
					<p>{item.answer}</p>
				</div>
			))}
		</section>
	);
}

export function BlogPostLayout({ data }: { data: BlogPostLoaderData }) {
	return (
		<RootProvider theme={{ defaultTheme: "light", forcedTheme: "light" }}>
			<div className="min-h-screen">
				<Navbar />
				<main className="mx-auto max-w-3xl px-4 py-12 md:px-6 lg:py-16">
					<a
						href="/blog"
						className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500 hover:text-zinc-950"
					>
						<ArrowLeft className="size-3" />
						Blog
					</a>
					<article className="prose mt-8 max-w-none">
						<h1 className="mb-3 text-balance">{data.title}</h1>
						{data.description && <p className="lead mt-0 text-zinc-600">{data.description}</p>}
						<div className="not-prose mb-10 mt-6 border-b border-zinc-200 pb-8">
							<AuthorByline author={data.author} date={data.date} />
						</div>
						<Suspense>{clientLoader.useContent(data.path)}</Suspense>
						{data.faq && data.faq.length > 0 && <PostFaq items={data.faq} />}
					</article>
				</main>
				<Footer />
			</div>
		</RootProvider>
	);
}
