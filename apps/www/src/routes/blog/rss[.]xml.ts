import { createFileRoute } from "@tanstack/react-router";
import { canonicalUrl, SITE_DESCRIPTION, SITE_NAME } from "@/lib/seo";

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export const Route = createFileRoute("/blog/rss.xml")({
	server: {
		handlers: {
			GET: async () => {
				const { blogSource } = await import("@/lib/blog");
				const posts = blogSource
					.getPages()
					.map((page) => ({
						url: canonicalUrl(page.url),
						title: page.data.title,
						description: page.data.description ?? "",
						date: page.data.date,
					}))
					.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

				const feedUrl = canonicalUrl("/blog/rss.xml");
				const items = posts
					.map(
						(post) => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${post.url}</link>
      <guid isPermaLink="true">${post.url}</guid>
      <pubDate>${new Date(`${post.date}T00:00:00Z`).toUTCString()}</pubDate>${
				post.description ? `\n      <description>${escapeXml(post.description)}</description>` : ""
			}
    </item>`,
					)
					.join("\n");

				const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(`${SITE_NAME} Blog`)}</title>
    <link>${canonicalUrl("/blog")}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <atom:link href="${feedUrl}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

				return new Response(rss, {
					headers: { "Content-Type": "application/xml" },
				});
			},
		},
	},
});
