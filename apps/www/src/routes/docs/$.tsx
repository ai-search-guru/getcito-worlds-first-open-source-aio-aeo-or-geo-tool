import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getPageImage } from "@/lib/og";
import {
	SITE_NAME,
	ogMeta,
	canonicalUrl,
	articleJsonLd,
	breadcrumbJsonLd,
} from "@/lib/seo";
import { DocsPageLayout } from "@/components/docs-page-layout";
import type { ClientApiPageProps } from "fumadocs-openapi/ui/create-client";
import type { SerializedPageTree } from "fumadocs-core/source/client";

const DOCS_DIR = "packages/docs/content/docs";

interface DocsLoaderData {
	type: "docs";
	slugs: string[];
	path: string;
	title: string;
	description: string;
	filePath: string;
	pageTree: SerializedPageTree;
}

interface OpenApiLoaderData {
	type: "openapi";
	slugs: string[];
	title: string;
	description: string;
	pageTree: SerializedPageTree;
	apiProps: ClientApiPageProps;
}

type LoaderData = DocsLoaderData | OpenApiLoaderData;

export type { DocsLoaderData, OpenApiLoaderData, LoaderData };

export const Route = createFileRoute("/docs/$")({
	component: Page,
	head: ({ loaderData }) => {
		const data = loaderData as LoaderData | undefined;
		if (!data) return {};

		const { title, description, slugs } = data;
		const pageTitle = `${title} · ${SITE_NAME} Docs`;
		const pageDescription = description || `${title} documentation for ${SITE_NAME}.`;
		const path = `/docs/${slugs.join("/")}`;
		const image = getPageImage(slugs).url;

		return {
			meta: [
				{ title: pageTitle },
				{ name: "description", content: pageDescription },
				...ogMeta({
					title: pageTitle,
					description: pageDescription,
					path,
					image,
					type: "article",
				}),
			],
			links: [{ rel: "canonical", href: canonicalUrl(path) }],
			scripts: [
				articleJsonLd({ title, description: pageDescription, path }),
				breadcrumbJsonLd([
					{ name: "Home", path: "/" },
					{ name: "Docs", path: "/docs" },
					{ name: title, path },
				]),
			],
		};
	},
	loader: async ({ params }) => {
		const slugs = params._splat?.split("/") ?? [];
		return (await serverLoader({ data: slugs })) as LoaderData;
	},
});

export const serverLoader = createServerFn({
	method: "GET",
})
	.inputValidator((slugs: string[]) => slugs)
	.handler(async ({ data: slugs }): Promise<LoaderData> => {
		// Lazy import keeps fumadocs-core/source + fumadocs-openapi (and their
		// transitive deps) out of the client bundle. The handler body is stripped
		// from the client by createServerFn but the static import at the top of
		// the file would still pull source.ts in via its top-level await.
		const { source } = await import("@/lib/source");
		const page = source.getPage(slugs);
		if (!page) throw notFound();

		const pageTree = await source.serializePageTree(source.getPageTree());

		if (page.type === "openapi") {
			return {
				type: "openapi",
				slugs,
				title: page.data.title ?? "",
				description: page.data.description ?? "",
				pageTree,
				apiProps: await page.data.getClientAPIPageProps(),
			};
		}

		const { existsSync } = await import("node:fs");
		const { resolve } = await import("node:path");
		const slugPath = slugs.join("/");
		const docsRoot = resolve(`../../${DOCS_DIR}`);
		const indexPath = resolve(docsRoot, `${slugPath}/index.mdx`);
		const filePath = existsSync(indexPath)
			? `${DOCS_DIR}/${slugPath}/index.mdx`
			: `${DOCS_DIR}/${slugPath}.mdx`;

		return {
			type: "docs",
			slugs,
			path: page.path,
			title: page.data.title,
			description: page.data.description ?? "",
			filePath,
			pageTree,
		};
	});

function Page() {
	const loaderData = Route.useLoaderData() as LoaderData;
	return <DocsPageLayout loaderData={loaderData} />;
}
