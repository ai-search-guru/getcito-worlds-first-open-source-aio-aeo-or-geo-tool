import { createFileRoute } from "@tanstack/react-router";

const PLAUSIBLE_SCRIPT_URL = "https://plausible.io/js/script.js";

/**
 * Response headers to forward from Plausible's upstream response.
 * Preserving ETag/Last-Modified enables conditional caching on repeat fetches.
 */
const UPSTREAM_HEADERS_TO_FORWARD = [
	"content-type",
	"etag",
	"last-modified",
] as const;

export const Route = createFileRoute("/api/plausible/js/script/")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const upstreamHeaders: Record<string, string> = {};

				// Forward the browser's User-Agent for transparent proxying
				const userAgent = request.headers.get("user-agent");
				if (userAgent) {
					upstreamHeaders["User-Agent"] = userAgent;
				}

				// Forward conditional request headers to enable 304 responses
				const ifNoneMatch = request.headers.get("if-none-match");
				if (ifNoneMatch) {
					upstreamHeaders["If-None-Match"] = ifNoneMatch;
				}
				const ifModifiedSince = request.headers.get("if-modified-since");
				if (ifModifiedSince) {
					upstreamHeaders["If-Modified-Since"] = ifModifiedSince;
				}

				const upstreamResponse = await fetch(PLAUSIBLE_SCRIPT_URL, {
					headers: upstreamHeaders,
				});

				if (!upstreamResponse.ok && upstreamResponse.status !== 304) {
					return new Response("Failed to load analytics script", {
						status: 502,
					});
				}

				const responseHeaders: Record<string, string> = {
					"Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
				};

				for (const name of UPSTREAM_HEADERS_TO_FORWARD) {
					const value = upstreamResponse.headers.get(name);
					if (value) {
						responseHeaders[name] = value;
					}
				}

				// For 304 Not Modified, return as-is without a body
				if (upstreamResponse.status === 304) {
					return new Response(null, {
						status: 304,
						headers: responseHeaders,
					});
				}

				const script = await upstreamResponse.text();

				return new Response(script, {
					headers: responseHeaders,
				});
			},
		},
	},
});
