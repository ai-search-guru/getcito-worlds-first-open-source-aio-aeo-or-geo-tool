/**
 * POST /api/v1/tools/analyze
 *
 * Run brand analysis without persisting anything. Returns suggested
 * additionalDomains, aliases, competitors, and prompts so the caller can
 * feed the result into POST /api/v1/brands themselves (or filter it first).
 *
 * Protected by API key authentication.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { analyzeBrand, cleanOnboardingDomain } from "@workspace/lib/onboarding";
import { createApiHandler } from "@/lib/api/handler";

const analyzeBody = z.object({
	// Mirrors the cleanDomain() check inside analyzeBrand so an unparseable
	// website is a 400 here instead of an opaque 500 from the analyzer.
	website: z
		.string("website is required")
		.trim()
		.min(1, "website is required")
		.refine((website) => cleanOnboardingDomain(website) !== "", "website must be a valid domain or URL"),
	brandName: z.string().trim().optional(),
	maxCompetitors: z.int("maxCompetitors must be a non-negative integer").min(0, "maxCompetitors must be a non-negative integer").optional(),
	maxPrompts: z.int("maxPrompts must be a non-negative integer").min(0, "maxPrompts must be a non-negative integer").optional(),
});

export const Route = createFileRoute("/api/v1/tools/analyze")({
	server: {
		handlers: {
			POST: createApiHandler({
				body: analyzeBody,
				handle: async ({ body }) => {
					return await analyzeBrand({
						website: body.website,
						brandName: body.brandName,
						maxCompetitors: body.maxCompetitors ?? 20,
						maxPrompts: body.maxPrompts,
					});
				},
			}),
		},
	},
});
