import { createFileRoute } from "@tanstack/react-router";
import spec from "@workspace/api-spec";

export const Route = createFileRoute("/api/openapi.json")({
	server: {
		handlers: {
			GET: async () =>
				new Response(JSON.stringify(spec), {
					headers: { "Content-Type": "application/json" },
				}),
		},
	},
});
