/**
 * Server-only helpers for the async brand-analysis job.
 *
 * All pg-boss coupling for the onboarding analysis lives here so the server
 * functions in `@/server/onboarding` stay thin (and free of direct db
 * imports). The web app enqueues the work and then polls the job's result
 * *by brand* — the brand id is the org id, so callers prove access to the
 * brand and we never hand a job's output to someone outside that org.
 *
 * Reading the result goes straight at pg-boss's `pgboss.job` table rather than
 * `getJobById`, because the client polls by brand (not by an opaque job id it
 * has to round-trip). The columns used here (`name`, `data`, `state`,
 * `output`, `created_on`) are stable across the pinned pg-boss v12 line.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import type { OnboardingSuggestion } from "@workspace/lib/onboarding";
import { getBoss } from "@/lib/boss-client";
import { extractDomain } from "@/lib/domain-categories";

const ANALYZE_BRAND_QUEUE = "analyze-brand";

/**
 * Shown to the user when a job ends in a failed/cancelled state. The real
 * error (provider messages, stack traces) is already captured server-side by
 * the worker's Sentry wrapper; we never forward it to the browser.
 */
const GENERIC_FAILURE = "Brand analysis failed. Please try again.";

/** Discriminated status returned to the wizard while it polls. */
export type AnalyzeBrandStatus =
	| { status: "pending" }
	| { status: "done"; suggestion: OnboardingSuggestion }
	| { status: "failed"; error: string };

export interface AnalyzeBrandInput {
	/** Brand id (== org id) the analysis belongs to. Must be access-checked by the caller. */
	brandId: string;
	website: string;
	brandName?: string;
}

interface JobRow {
	id: string;
	state: string;
	data: { website?: string } | null;
	output: unknown;
}

/** The most recent analyze-brand job for a brand, regardless of state. */
async function latestJobForBrand(brandId: string): Promise<JobRow | undefined> {
	const result = await db.execute(sql`
		SELECT id, state, data, output
		FROM pgboss.job
		WHERE name = ${ANALYZE_BRAND_QUEUE} AND data->>'brandId' = ${brandId}
		ORDER BY created_on DESC
		LIMIT 1
	`);
	return result.rows[0] as unknown as JobRow | undefined;
}

const IN_FLIGHT_STATES = new Set(["created", "active", "retry"]);

/**
 * Enqueue a brand analysis, deduped by the brand + domain it runs for.
 *
 * If an analysis for this domain is already in flight we reuse it instead of
 * paying for a second run; once a job reaches a terminal state a fresh analysis
 * is allowed again (so "try again" works).
 *
 * We guard with an explicit in-flight check rather than pg-boss's `singletonKey`
 * because that would be a no-op here: `singleton_key` only enforces uniqueness
 * under a non-standard queue policy (short/singleton/stately) or with a
 * `singletonSeconds` window, and this queue uses the default `standard` policy
 * with no window. The check-then-send isn't atomic, but the analyze button is a
 * deliberate, low-frequency action (and disabled while running), so the worst
 * case — two near-simultaneous clicks racing past the check — is rare and
 * merely costs a duplicate run.
 */
export async function enqueueAnalyzeBrand(input: AnalyzeBrandInput): Promise<void> {
	const boss = await getBoss();
	const domain = extractDomain(input.website);

	const latest = await latestJobForBrand(input.brandId);
	if (latest && IN_FLIGHT_STATES.has(latest.state) && extractDomain(latest.data?.website ?? "") === domain) {
		return;
	}

	await boss.send(ANALYZE_BRAND_QUEUE, input);
}

/** Poll the status/result of the latest brand-analysis job for a brand. */
export async function getAnalyzeBrandStatus(brandId: string): Promise<AnalyzeBrandStatus> {
	const job = await latestJobForBrand(brandId);

	// No job yet — the enqueue may not be visible, or the worker hasn't picked
	// it up. Either way the client should keep polling.
	if (!job) {
		return { status: "pending" };
	}
	if (job.state === "completed") {
		return { status: "done", suggestion: job.output as OnboardingSuggestion };
	}
	if (job.state === "failed" || job.state === "cancelled") {
		console.error("[analyze-brand] job ended without a result", {
			brandId,
			jobId: job.id,
			state: job.state,
		});
		return { status: "failed", error: GENERIC_FAILURE };
	}
	return { status: "pending" };
}

/**
 * Best-effort cancel of an in-flight analysis for a brand. Used when the user
 * backs out of the wizard so the worker doesn't keep grinding on a result
 * nobody is waiting for.
 */
export async function cancelAnalyzeBrand(brandId: string): Promise<void> {
	const job = await latestJobForBrand(brandId);
	if (!job || !IN_FLIGHT_STATES.has(job.state)) {
		return;
	}
	const boss = await getBoss();
	try {
		await boss.cancel(ANALYZE_BRAND_QUEUE, job.id);
	} catch {
		// Job may have completed between the read and the cancel — nothing to do.
	}
}
