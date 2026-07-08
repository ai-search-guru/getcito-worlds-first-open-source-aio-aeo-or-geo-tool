import { createFileRoute } from "@tanstack/react-router";

const PLAUSIBLE_EVENT_URL = "https://plausible.io/api/event";

const FORWARDED_HEADERS = [
	"user-agent",
	"content-type",
	"referer",
	"x-forwarded-for",
	"x-forwarded-proto",
	"x-real-ip",
] as const;

function buildForwardedHeaders(request: Request): Record<string, string> {
	const headers: Record<string, string> = {};

	for (const name of FORWARDED_HEADERS) {
		const value = request.headers.get(name);
		if (value) {
			headers[name] = value;
		}
	}

	return headers;
}

export const Route = createFileRoute("/api/plausible/event/")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const body = await request.text();

				const upstreamResponse = await fetch(PLAUSIBLE_EVENT_URL, {
					method: "POST",
					headers: buildForwardedHeaders(request),
					body,
				});

				return new Response(upstreamResponse.body, {
					status: upstreamResponse.status,
					headers: {
						"Content-Type":
							upstreamResponse.headers.get("content-type") ?? "text/plain",
					},
				});
			},
		},
	},
});
