import { createFileRoute } from "@tanstack/react-router";
import { finishChatGptAuthorization } from "@/server/chatgpt-oauth";

export const Route = createFileRoute("/api/openai/chatgpt/callback")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				try {
					const location = await finishChatGptAuthorization(request);
					return new Response(null, {
						status: 302,
						headers: { Location: location, "Cache-Control": "no-store" },
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : "ChatGPT sign-in could not be completed.";
					return new Response(message, {
						status: 400,
						headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
					});
				}
			},
		},
	},
});
