import { createFileRoute } from "@tanstack/react-router";
import { getAuthSession } from "@/lib/auth/helpers";
import { disconnectChatGptPlan, getChatGptPlanStatus } from "@workspace/lib/chatgpt-plan-auth";
import { requireLocalChatGptAuth } from "@/server/chatgpt-oauth";

export const Route = createFileRoute("/api/openai/chatgpt/status")({
	server: {
		handlers: {
			GET: async () => {
				try {
					requireLocalChatGptAuth();
					if (!(await getAuthSession())) return Response.json({ error: "Unauthorized" }, { status: 401 });
					return Response.json(await getChatGptPlanStatus(), { headers: { "Cache-Control": "no-store" } });
				} catch (error) {
					return Response.json({ error: error instanceof Error ? error.message : "Status unavailable" }, { status: 400 });
				}
			},
			POST: async ({ request }) => {
				try {
					requireLocalChatGptAuth();
					const session = await getAuthSession();
					if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });
					if (request.headers.get("origin") !== new URL(request.url).origin) {
						return Response.json({ error: "Origin check failed" }, { status: 403 });
					}
					const revoked = await disconnectChatGptPlan();
					return Response.json({ connected: false, revoked }, { headers: { "Cache-Control": "no-store" } });
				} catch (error) {
					return Response.json({ error: error instanceof Error ? error.message : "Disconnect failed" }, { status: 400 });
				}
			},
		},
	},
});
