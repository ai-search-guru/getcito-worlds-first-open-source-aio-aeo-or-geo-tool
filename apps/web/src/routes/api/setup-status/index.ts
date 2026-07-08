/**
 * /api/setup-status - Lightweight health check for local instance setup
 *
 * Returns whether the DB is reachable and migrations have run.
 * Used by the error page to distinguish "still setting up" from real errors.
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";

export const Route = createFileRoute("/api/setup-status/")({
	server: {
		handlers: {
			GET: async () => {
				try {
					await db.query.brands.findFirst();
					return Response.json({ ready: true });
				} catch {
					return Response.json({ ready: false });
				}
			},
		},
	},
});
