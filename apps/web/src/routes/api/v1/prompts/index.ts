/**
 * /api/v1/prompts - External API endpoint for prompt management
 * Protected by API key authentication.
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import { prompts, brands } from "@workspace/lib/db/schema";
import { eq, count, desc } from "drizzle-orm";
import { z } from "zod";
import { sanitizeUserTags, computeSystemTags } from "@workspace/lib/tag-utils";
import { createPromptJobScheduler } from "@/lib/job-scheduler";
import { ApiError, createApiHandler } from "@/lib/api/handler";

const createPromptBody = z.object({
	brandId: z.string().trim().min(1, "brandId is required"),
	value: z.string().trim().min(1, "value must be a non-empty string"),
	tags: z.array(z.string()).optional(),
});

export const Route = createFileRoute("/api/v1/prompts/")({
	server: {
		handlers: {
			GET: createApiHandler({
				handle: async ({ request }) => {
					const { searchParams } = new URL(request.url);
					const brandId = searchParams.get("brandId");
					const page = Math.max(1, parseInt(searchParams.get("page") || "1"));
					const limit = Math.max(1, parseInt(searchParams.get("limit") || "20"));
					const offset = (page - 1) * limit;

					const whereConditions = brandId ? eq(prompts.brandId, brandId) : undefined;

					const [totalCountResult] = await db.select({ count: count() }).from(prompts).where(whereConditions);
					const totalCount = totalCountResult?.count || 0;
					const totalPages = Math.ceil(totalCount / limit);

					const promptsList = await db
						.select({
							id: prompts.id,
							brandId: prompts.brandId,
							value: prompts.value,
							enabled: prompts.enabled,
							tags: prompts.tags,
							systemTags: prompts.systemTags,
							createdAt: prompts.createdAt,
							updatedAt: prompts.updatedAt,
						})
						.from(prompts)
						.where(whereConditions)
						.orderBy(desc(prompts.createdAt))
						.limit(limit)
						.offset(offset);

					return {
						prompts: promptsList,
						pagination: { page, limit, total: totalCount, totalPages },
					};
				},
			}),

			POST: createApiHandler({
				body: createPromptBody,
				status: 201,
				handle: async ({ body }) => {
					const { brandId, value, tags } = body;

					const brandInfo = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
					if (brandInfo.length === 0) {
						throw new ApiError(400, "Validation Error", `Brand with ID '${brandId}' not found`);
					}

					const brand = brandInfo[0];
					const userTags = tags ? sanitizeUserTags(tags) : [];
					const systemTags = computeSystemTags(value, brand.name, brand.website);

					const [newPrompt] = await db
						.insert(prompts)
						.values({ brandId, value, tags: userTags, systemTags, enabled: true })
						.returning();

					await createPromptJobScheduler(newPrompt.id);

					return newPrompt;
				},
			}),
		},
	},
});
