/**
 * Authentication middleware for TanStack Start
 *
 * Provides user session and deployment context to server functions.
 *
 * Access-control decisions are delegated to pure policy functions
 * in `@/lib/auth/policies` so they can be tested independently.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { getDeployment } from "@/lib/config/server";
import { auth } from "@/lib/auth/server";
import { isAdmin } from "@/lib/auth/helpers";
import { evaluateRequireAdmin } from "@/lib/auth/policies";

/**
 * Auth middleware - provides deployment context to all server functions.
 * Does NOT enforce authentication - that's done by `requireAuthMiddleware`.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
	const deployment = getDeployment();
	const headers = getRequestHeaders();
	const session = await auth.api.getSession({ headers });

	return next({
		context: {
			session,
			deployment,
		},
	});
});

/**
 * Middleware that requires authentication.
 * Throws an error if the user is not authenticated when auth is required.
 */
export const requireAuthMiddleware = createMiddleware({ type: "function" })
	.middleware([authMiddleware])
	.server(async ({ next, context }) => {
		if (!context.session) {
			throw new Error("Unauthorized: Authentication required");
		}

		return next();
	});

/**
 * Middleware that requires admin access.
 * Must be used after authMiddleware.
 */
export const requireAdminMiddleware = createMiddleware({ type: "function" })
	.middleware([authMiddleware])
	.server(async ({ next, context }) => {
		const session = context.session;
		if (!session) {
			throw new Error("Unauthorized: Authentication required");
		}

		const userIsAdmin = isAdmin(session);

		if (evaluateRequireAdmin(userIsAdmin) === "deny") {
			throw new Error("Forbidden: Admin access required");
		}

		return next();
	});

