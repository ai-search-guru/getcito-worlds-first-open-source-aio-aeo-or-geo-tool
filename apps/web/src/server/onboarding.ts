/**
 * Server functions for the onboarding wizard + brand analysis.
 *
 * This file ONLY exports createServerFn server functions. No regular function
 * exports, no class exports, no db imports. TanStack Start replaces server
 * functions with lightweight RPC stubs on the client — but only if the module
 * doesn't drag in server-only dependencies (db, drizzle, pg) via other
 * exports. Keeping this file server-fn-only guarantees the client bundle
 * stays clean.
 *
 * Regular functions (createBrand, updateBrand, etc.) live in
 * ./onboarding-core.ts, imported only by API routes (server-only).
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { analyzeBrandInfo, analyzeCompetitors, analyzePrompts } from "@workspace/lib/onboarding";
import {
	cancelAnalyzeBrand,
	enqueueAnalyzeBrand,
	getAnalyzeBrandStatus,
	type AnalyzeBrandStatus,
} from "@/lib/analyze-brand-job";
import { saveWizardOnboarding, wizardOnboardingInputSchema } from "@/server/onboarding-core";

/**
 * Kick off brand analysis as a background job.
 *
 * Brand analysis is an LLM + web-search call that routinely runs ~1 minute,
 * which blows past reverse-proxy read timeouts when executed inline (the user
 * gets a 504 even though the work succeeds). The worker processes the job; the
 * client polls `getAnalyzeBrandStatusFn` (by brand) for the result.
 *
 * Scoped to the brand (== org): the caller must have access to the brand both
 * to start an analysis and to read it back, so a job's output never leaks
 * outside the org that requested it.
 */
export const startAnalyzeBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			website: z.string().min(1),
			brandName: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		await enqueueAnalyzeBrand(data);
		return { ok: true };
	});

/**
 * Poll the status/result of the latest brand-analysis job for a brand.
 *
 * POST (not GET) on purpose: the response changes on every poll, so we don't
 * want a browser/CDN/reverse-proxy caching an early `pending` and starving the
 * wizard of the eventual result.
 */
export const getAnalyzeBrandStatusFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }): Promise<AnalyzeBrandStatus> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return getAnalyzeBrandStatus(data.brandId);
	});

/** Cancel the in-flight brand-analysis job for a brand (e.g. user backs out). */
export const cancelAnalyzeBrandFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		await cancelAnalyzeBrand(data.brandId);
		return { ok: true };
	});

/**
 * Persist the wizard's reviewed onboarding result for a brand the user
 * already has access to.
 */
export const updateOnboardedBrandFn = createServerFn({ method: "POST" })
	.validator(wizardOnboardingInputSchema)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return saveWizardOnboarding(data);
	});

/**
 * Synchronously run Part 1 (Brand Info only) inline.
 * Since this only requests basic brand data from the LLM, it finishes in a
 * few seconds and doesn't need to be pushed to the pg-boss background worker.
 */
export const analyzeBrandInfoFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			website: z.string().min(1),
			brandName: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return analyzeBrandInfo({
			website: data.website,
			brandName: data.brandName,
		});
	});

/**
 * Synchronously run Part 2 (Competitors) inline.
 */
export const analyzeCompetitorsFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			website: z.string().min(1),
			brandName: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return analyzeCompetitors({
			website: data.website,
			brandName: data.brandName,
		});
	});

/**
 * Synchronously run Part 3 (Prompts) inline.
 */
export const analyzePromptsFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			website: z.string().min(1),
			brandName: z.string().min(1),
			competitorNames: z.array(z.string()).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return analyzePrompts({
			website: data.website,
			brandName: data.brandName,
			competitorNames: data.competitorNames,
		});
	});
