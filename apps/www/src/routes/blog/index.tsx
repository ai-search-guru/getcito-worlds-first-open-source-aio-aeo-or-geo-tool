import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { ArrowUpRight } from "lucide-react";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { authorDisplayName, isAiAuthor } from "@/data/authors";
import { formatPostDate } from "@/lib/format";
import { breadcrumbJsonLd, canonicalUrl, ogMeta, SITE_NAME } from "@/lib/seo";

const title = "Blog · Getcito";
const description = "Learn how to optimize your brand's AI search visibility.";

interface PostMeta {
	url: string;
	title: string;
	description: string;
	date: string;
	author: string;
	tags: string[];
}

const listPosts = createServerFn({ method: "GET" }).handler(async (): Promise<PostMeta[]> => {
	const { blogSource } = await import("@/lib/blog");
	return blogSource
		.getPages()
		.map((page) => ({
			url: page.url,
			title: page.data.title,
			description: page.data.description ?? "",
			date: page.data.date,
			author: page.data.author,
			tags: page.data.tags ?? [],
		}))
		.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
});

export const Route = createFileRoute("/blog/")({
	head: () => ({
		meta: [
			{ title },
			{ name: "description", content: description },
			...ogMeta({ title, description, path: "/blog" }),
		],
		links: [
			{ rel: "canonical", href: canonicalUrl("/blog") },
			{
				rel: "alternate",
				type: "application/rss+xml",
				title: `${SITE_NAME} Blog`,
				href: canonicalUrl("/blog/rss.xml"),
			},
		],
		scripts: [
			breadcrumbJsonLd([
				{ name: "Home", path: "/" },
				{ name: "Blog", path: "/blog" },
			]),
		],
	}),
	loader: async () => ({ posts: await listPosts() }),
	component: ResourcesPage,
});

function ResourcesPage() {
	const { posts } = Route.useLoaderData();

	return (
		<div className="min-h-screen">
			<Navbar />
			<main className="mx-auto max-w-4xl px-4 py-12 md:px-6 lg:py-20">
				<header className="mb-12 max-w-3xl">
					<p className="font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">/ BLOG</p>
					<h1 className="mt-4 text-4xl font-semibold tracking-tight text-zinc-950 lg:text-5xl">Blog</h1>
					<p className="mt-5 max-w-[58ch] text-pretty text-lg text-zinc-600">{description}</p>
				</header>

				{posts.length === 0 ? (
					<p className="text-zinc-600">No posts yet — check back soon.</p>
				) : (
					<ul className="space-y-4">
						{posts.map((post) => (
							<li key={post.url}>
								<a
									href={post.url}
									className="group block rounded-md border border-zinc-200 bg-white p-6 transition-colors hover:bg-zinc-50 lg:p-8"
								>
									<div className="flex flex-wrap items-center gap-2 font-mono text-[11px] uppercase tracking-[0.18em] text-zinc-500">
										<time dateTime={post.date}>{formatPostDate(post.date)}</time>
										{!isAiAuthor(post.author) && (
											<>
												<span className="text-zinc-300">·</span>
												<span>{authorDisplayName(post.author)}</span>
											</>
										)}
									</div>
									<h2 className="mt-3 text-2xl font-semibold tracking-tight text-zinc-950 group-hover:text-blue-700">
										{post.title}
									</h2>
									{post.description && <p className="mt-2 text-pretty text-zinc-600">{post.description}</p>}
									<span className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-blue-600">
										Read more
										<ArrowUpRight className="size-3.5" />
									</span>
								</a>
							</li>
						))}
					</ul>
				)}
			</main>
			<Footer />
		</div>
	);
}
