/**
 * /api/v1/brands/:brandId — single brand resource.
 *
 * GET     fetch one brand
 * PATCH   update brand-level fields (replace semantics on arrays)
 *
 * Protected by API key authentication.
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import {
	updateBrand,
	updateBrandBodySchema,
	apiUpdateInputToInternal,
	buildBrandResult,
	BrandNotFoundError,
	InvalidDomainsError,
} from "@/server/onboarding-core";
import { ApiError, createApiHandler } from "@/lib/api/handler";

export const Route = createFileRoute("/api/v1/brands/$brandId")({
	server: {
		handlers: {
			// No params schema: brand IDs are caller-chosen strings (e.g. "acme"),
			// not UUIDs like the competitor/prompt/report routes validate.
			GET: createApiHandler({
				handle: async ({ params }) => {
					const { brandId } = params;
					const row = await db.query.brands.findFirst({ where: eq(brands.id, brandId) });
					if (!row) {
						throw new ApiError(404, "Not Found", `Brand "${brandId}" not found.`);
					}
					return buildBrandResult(row);
				},
			}),

			PATCH: createApiHandler({
				body: updateBrandBodySchema.refine(
					(body) => Object.keys(body).length > 0,
					"At least one of brandName, domains, aliases, or enabled must be provided",
				),
				mapError: (err) => {
					if (err instanceof InvalidDomainsError) {
						return new ApiError(400, "Validation Error", err.message);
					}
					if (err instanceof BrandNotFoundError) {
						return new ApiError(404, "Not Found", err.message);
					}
				},
				handle: async ({ params, body }) => {
					const internal = apiUpdateInputToInternal(params.brandId, body);
					return await updateBrand(internal);
				},
			}),
		},
	},
});
