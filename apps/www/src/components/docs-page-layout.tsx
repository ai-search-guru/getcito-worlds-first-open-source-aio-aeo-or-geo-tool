// All fumadocs-ui / docs UI imports live here, NOT in routes/docs/$.tsx.
// $.tsx and index.tsx only reference DocsPageLayout from inside the route's
// `component:`, which @tanstack/router-plugin auto-splits into its own chunk.
// The static imports below get hoisted into that chunk, so the heavy
// fumadocs-ui + shiki + orama deps stay out of the main bundle that loads
// on the marketing pages.
import { Suspense } from "react";
import browserCollections from "collections/browser";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { RootProvider } from "fumadocs-ui/provider/tanstack";
import { useMDXComponents } from "@/components/mdx";
import { ClientAPIPage } from "@/components/api-page";
import type { ClientApiPageProps } from "fumadocs-openapi/ui/create-client";
import { Feedback } from "@workspace/docs/components/feedback/client";
import type {
	PageFeedback,
	ActionResponse,
} from "@workspace/docs/components/feedback/schema";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { DocsSidebar } from "@workspace/docs/components/docs-sidebar";
import { DocsToc } from "@workspace/docs/components/docs-toc";
import type { LoaderData } from "@/routes/docs/$";

const REPO = "ai-search-guru/getcito-worlds-first-open-source-aio-aeo-or-geo-tool";
const BRANCH = "main";

// /docs/foo → /docs/foo.md  (/docs index → /docs.md). The same markdown the
// .md/.mdx routes and the Accept-header negotiation serve (see server.ts).
function docsMarkdownPath(slugs: string[]): string {
	return slugs.length ? `/docs/${slugs.join("/")}.md` : "/docs.md";
}

async function onFeedback(feedback: PageFeedback): Promise<ActionResponse> {
	const { trackEvent } = await import("@/lib/posthog");
	trackEvent("docs_page_feedback", {
		opinion: feedback.opinion,
		message: feedback.message || undefined,
		url: feedback.url,
	});
	return { success: true };
}

export const clientLoader = browserCollections.docs.createClientLoader({
	component({ toc, frontmatter, default: MDX }, _props: undefined) {
		return (
			<div className="flex gap-10">
				<article className="prose min-w-0 max-w-none flex-1">
					<h1>{frontmatter.title}</h1>
					{frontmatter.description && (
						<p className="lead text-muted-foreground">
							{frontmatter.description}
						</p>
					)}
					<MDX components={useMDXComponents()} />
					<div className="not-prose">
						<Feedback onSendAction={onFeedback} />
					</div>
				</article>

				{toc.length > 0 && (
					<aside className="hidden w-48 shrink-0 lg:block">
						<div className="sticky top-20">
							<DocsToc toc={toc} />
						</div>
					</aside>
				)}
			</div>
		);
	},
});

function DocsPageActions({
	filePath,
	mdUrl,
}: {
	filePath: string;
	mdUrl: string;
}) {
	const editUrl = `https://github.com/${REPO}/edit/${BRANCH}/${filePath}`;
	const issueUrl = `https://github.com/${REPO}/issues/new?labels=docs&title=Docs+issue:+`;
	const discordUrl = "https://discord.gg/s24nubCtKz";

	return (
		<div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-4 text-sm text-muted-foreground">
			<a
				href={editUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
			>
				<svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M12 20h9" /><path d="M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.855z" />
				</svg>
				Edit this page
			</a>
			<span className="text-border">·</span>
			<a
				href={mdUrl}
				target="_blank"
				rel="noopener"
				className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
			>
				<svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z" /><path d="M14 2v5h5" /><path d="M9 13h6" /><path d="M9 17h6" />
				</svg>
				View as Markdown
			</a>
			<span className="text-border">·</span>
			<a
				href={issueUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
			>
				<svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
					<circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
				</svg>
				Report an issue
			</a>
			<span className="text-border">·</span>
			<a
				href={discordUrl}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex items-center gap-1.5 transition-colors hover:text-foreground"
			>
				<svg className="size-3.5" viewBox="0 0 24 24" fill="currentColor">
					<path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.095 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
				</svg>
				Join our Discord
			</a>
		</div>
	);
}

function OpenApiContent({
	title,
	description,
	apiProps,
}: {
	title: string;
	description: string;
	apiProps: ClientApiPageProps;
}) {
	return (
		<article className="prose min-w-0 max-w-none flex-1">
			<h1>{title}</h1>
			{description && (
				<p className="lead text-muted-foreground">{description}</p>
			)}
			<div className="not-prose">
				<ClientAPIPage {...apiProps} />
			</div>
		</article>
	);
}

export function DocsPageLayout({ loaderData }: { loaderData: LoaderData }) {
	const data = useFumadocsLoader(loaderData);

	return (
		<RootProvider theme={{ defaultTheme: "light", forcedTheme: "light" }}>
			<div className="min-h-screen">
				<Navbar />
				<div className="mx-auto max-w-6xl px-4 py-8 md:px-6 lg:px-8">
					<div className="flex gap-10">
						<aside className="hidden w-56 shrink-0 md:block">
							<div className="sticky top-20">
								<DocsSidebar tree={data.pageTree} />
							</div>
						</aside>

						<main className="min-w-0 flex-1">
							{data.type === "openapi" ? (
								<OpenApiContent
									title={data.title}
									description={data.description}
									apiProps={data.apiProps}
								/>
							) : (
								<>
									<Suspense>{clientLoader.useContent(data.path)}</Suspense>
									<DocsPageActions
										filePath={data.filePath}
										mdUrl={docsMarkdownPath(data.slugs)}
									/>
								</>
							)}
						</main>
					</div>
				</div>
				<Footer />
			</div>
		</RootProvider>
	);
}
