/**
 * TanStack Start global configuration.
 *
 * Registers global middleware that runs on every request/server function.
 *
 * Start only auto-installs its CSRF middleware for server functions when an app
 * has no `start.ts`. Because we define one, we register `createCsrfMiddleware`
 * ourselves — without it, server functions fall back to SameSite cookies alone.
 * The `serverFn` filter scopes the same-origin check to server functions; route
 * handlers are untouched (/api/auth/* has better-auth's own Origin check,
 * /api/v1/* uses Bearer auth).
 */
import { sentryGlobalFunctionMiddleware, sentryGlobalRequestMiddleware } from "@sentry/tanstackstart-react";
import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { deploymentMiddleware, readOnlyMiddleware } from "@/middleware/deployment";
import { authMiddleware } from "@/middleware/auth";

const csrfMiddleware = createCsrfMiddleware({
	filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
	// csrf first so forged cross-site requests are rejected before any other work runs
	requestMiddleware: [csrfMiddleware, sentryGlobalRequestMiddleware, deploymentMiddleware],
	functionMiddleware: [sentryGlobalFunctionMiddleware, authMiddleware, readOnlyMiddleware],
}));
