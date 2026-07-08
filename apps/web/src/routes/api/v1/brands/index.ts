/**
 * /api/v1/brands — brand collection.
 *
 * GET    list brands (paginated)
 * POST   create a brand
 *
 * Protected by API key authentication.
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { count, desc } from "drizzle-orm";
import {
	createBrand,
	createBrandInputSchema,
	apiCreateInputToInternal,
	buildBrandResult,
	BrandConflictError,
	InvalidDomainsError,
} from "@/server/onboarding-core";
import { ApiError, createApiHandler } from "@/lib/api/handler";

export const Route = createFileRoute("/api/v1/brands/")({
	server: {
		handlers: {
			GET: createApiHandler({
				handle: async ({ request }) => {
					const { searchParams } = new URL(request.url);
					const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
					const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "20")));
					const offset = (page - 1) * limit;

					const [totalCountResult] = await db.select({ count: count() }).from(brands);
					const totalCount = totalCountResult?.count || 0;
					const totalPages = Math.ceil(totalCount / limit);

					const rows = await db
						.select()
						.from(brands)
						.orderBy(desc(brands.createdAt))
						.limit(limit)
						.offset(offset);

					return {
						brands: rows.map(buildBrandResult),
						pagination: { page, limit, total: totalCount, totalPages },
					};
				},
			}),

			POST: createApiHandler({
				body: createBrandInputSchema,
				status: 201,
				mapError: (err) => {
					if (err instanceof InvalidDomainsError) {
						return new ApiError(400, "Validation Error", err.message);
					}
					if (err instanceof BrandConflictError) {
						return new ApiError(409, "Conflict", err.message);
					}
				},
				handle: async ({ body }) => {
					const internal = apiCreateInputToInternal(body);
					return await createBrand(internal);
				},
			}),
		},
	},
});
