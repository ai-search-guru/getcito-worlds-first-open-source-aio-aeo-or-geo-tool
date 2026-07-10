import handler, { createServerEntry } from "@tanstack/react-start/server-entry";
import { isMarkdownPreferred, rewritePath } from "fumadocs-core/negotiation";

const SECURITY_HEADERS: Record<string, string> = {
	"Content-Security-Policy": [
		"default-src 'self'",
		"script-src 'self' 'unsafe-inline' https://var.Getcitohq.com",
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: https:",
		"font-src 'self' data:",
		"connect-src 'self' https://var.Getcitohq.com https://*.mux.com https://*.litix.io",
		"media-src 'self' blob: https://*.mux.com",
		"worker-src 'self' blob:",
		// YouTube embeds in blog posts (privacy-enhanced youtube-nocookie host).
		"frame-src 'self' https://www.youtube-nocookie.com https://www.youtube.com",
		"object-src 'none'",
		"frame-ancestors 'none'",
		"base-uri 'self'",
		"form-action 'self'",
	].join("; "),
	"X-Frame-Options": "DENY",
	"X-Content-Type-Options": "nosniff",
	"Referrer-Policy": "strict-origin-when-cross-origin",
	"Permissions-Policy":
		"camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
};

function addSecurityHeaders(response: Response): Response {
	for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
		response.headers.set(key, value);
	}
	return response;
}

// Serve the raw markdown for a docs page from the existing /llms.mdx/docs/*
// route. Three things resolve to the same markdown, all via an internal rewrite
// (the URL the client sees never changes — no redirect):
//   • /docs/foo.md  and  /docs/foo.mdx  — explicit suffix, always markdown
//   • /docs/foo  with `Accept: text/markdown` — content negotiation for agents
// Pages are resolved by slug, so the `.md` suffix works even though every
// source file is `.mdx`. See https://fumadocs.dev/docs/integrations/llms#accept
const { rewrite: stripMdSuffix } = rewritePath(
	"/docs{/*path}.md",
	"/llms.mdx/docs{/*path}",
);
const { rewrite: stripMdxSuffix } = rewritePath(
	"/docs{/*path}.mdx",
	"/llms.mdx/docs{/*path}",
);
const { rewrite: toMarkdownRoute } = rewritePath(
	"/docs{/*path}",
	"/llms.mdx/docs{/*path}",
);

export default createServerEntry({
	async fetch(request) {
		const url = new URL(request.url);
		const path = url.pathname;

		// An explicit .md / .mdx suffix always serves markdown, ignoring Accept.
		let target = stripMdSuffix(path) || stripMdxSuffix(path);

		// A bare docs page negotiates HTML vs. markdown on the Accept header.
		const negotiable =
			!target && (path === "/docs" || path.startsWith("/docs/"));
		if (negotiable && isMarkdownPreferred(request)) {
			target = toMarkdownRoute(path);
		}

		let req = request;
		if (target) {
			url.pathname = target;
			req = new Request(url, request);
		}

		const response = await handler.fetch(req);
		// A bare docs URL can resolve to either HTML or markdown depending on
		// the Accept header, so shared caches must key on it.
		if (negotiable) response.headers.set("Vary", "Accept");
		return addSecurityHeaders(response);
	},
});
