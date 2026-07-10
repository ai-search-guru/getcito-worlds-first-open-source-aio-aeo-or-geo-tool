/**
 * Deployment mode middleware for TanStack Start
 *
 * Enforces deployment-level access policies:
 * - Read-only mode enforcement (demo mode)
 * - Admin access control
 * - API key authentication for public API routes
 *
 * Access-control decisions are delegated to pure policy functions
 * in `@/lib/auth/policies` so they can be tested independently.
 */
import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getDeployment } from "@/lib/config/server";
import openApiSpec from "@workspace/api-spec";
import {
	evaluateDeploymentPolicy,
	evaluateReadOnly,
	evaluateApiKeyAuth,
	getAdminApiKeys,
} from "@/lib/auth/policies";

/**
 * Global request middleware - provides deployment config context
 * and enforces read-only mode for API routes.
 */
export const deploymentMiddleware = createMiddleware().server(async ({ next }) => {
	const deployment = getDeployment();
	const request = getRequest();
	const url = new URL(request.url);

	const result = evaluateDeploymentPolicy(
		deployment.features,
		{
			pathname: url.pathname,
			method: request.method,
			authorizationHeader: request.headers.get("Authorization"),
		},
		{ adminApiKeys: getAdminApiKeys() },
	);

	switch (result.action) {
		case "block":
			throw new Response(
				JSON.stringify({ error: result.error, message: result.message }),
				{ status: result.status, headers: { "Content-Type": "application/json" } },
			);
		case "redirect":
			throw Response.redirect(new URL(result.url, request.url), 302);
		case "serve-openapi":
			throw Response.json(openApiSpec, {
				headers: { "Content-Type": "application/json" },
			});
	}

	return next({
		context: {
			deploymentConfig: deployment,
		},
	});
});

/**
 * Read-only enforcement middleware for server functions.
 * Blocks write operations when in demo/read-only mode.
 */
export const readOnlyMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
	const deployment = getDeployment();
	const request = getRequest();
	const url = new URL(request.url);

	if (evaluateReadOnly(deployment.features.readOnly) === "deny") {
		const result = evaluateDeploymentPolicy(deployment.features, {
			pathname: url.pathname,
			method: request.method,
		});

		if (result.action === "block" && result.error === "Demo Mode") {
			throw new Error(result.message);
		}
	}

	return next();
});

/**
 * API key authentication middleware for public API routes (/api/v1/*).
 * Validates Bearer token against ADMIN_API_KEYS environment variable.
 */
export const apiKeyMiddleware = createMiddleware().server(async ({ next }) => {
	const request = getRequest();
	const authHeader = request.headers.get("Authorization");

	const result = evaluateApiKeyAuth(authHeader, getAdminApiKeys());

	if (result !== "allow") {
		throw new Response(
			JSON.stringify({ error: result.error, message: result.message }),
			{ status: 401, headers: { "Content-Type": "application/json" } },
		);
	}

	return next();
});
