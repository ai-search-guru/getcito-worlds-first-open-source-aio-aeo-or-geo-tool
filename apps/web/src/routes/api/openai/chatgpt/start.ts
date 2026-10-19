import { createFileRoute } from "@tanstack/react-router";
import { createChatGptAuthorization } from "@/server/chatgpt-oauth";

export const Route = createFileRoute("/api/openai/chatgpt/start")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				try {
					const brandId = new URL(request.url).searchParams.get("brand");
					if (!brandId) return Response.json({ error: "A brand is required." }, { status: 400 });
					const location = await createChatGptAuthorization(request, brandId);
					return new Response(null, {
						status: 302,
						headers: { Location: location, "Cache-Control": "no-store" },
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : "Could not start ChatGPT sign-in.";
					const status = message.includes("access") ? 403 : message.includes("Sign in") ? 401 : 400;
					return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
				}
			},
		},
	},
});
