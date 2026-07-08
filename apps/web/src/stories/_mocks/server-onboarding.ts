/**
 * Mock for @/server/onboarding — lets stories drive the wizard's analyze and
 * save calls without hitting the real server functions (which transitively
 * pull in DB + provider clients).
 *
 * Stories call `setMockOnboardingSuggestion()` to control what the analyze
 * step returns, and `setMockOnboardingDelay()` to simulate slow analyses.
 */
import type { OnboardingSuggestion } from "@workspace/lib/onboarding";

let _suggestion: OnboardingSuggestion | null = null;
let _delayMs = 0;
let _shouldThrow: string | null = null;

export function setMockOnboardingSuggestion(suggestion: OnboardingSuggestion | null) {
	_suggestion = suggestion;
}

export function setMockOnboardingDelay(ms: number) {
	_delayMs = ms;
}

export function setMockOnboardingError(message: string | null) {
	_shouldThrow = message;
}

let _readyAt = 0;
let _cancelled = false;

export const startAnalyzeBrandFn = async (_args: { data: unknown }) => {
	// Mirror the real async flow: enqueue returns immediately; the result
	// becomes available after the configured delay and is read by polling.
	_readyAt = Date.now() + _delayMs;
	_cancelled = false;
	return { ok: true as const };
};

export const getAnalyzeBrandStatusFn = async (_args: { data: unknown }) => {
	if (_cancelled) return { status: "pending" as const };
	if (_shouldThrow) return { status: "failed" as const, error: _shouldThrow };
	if (Date.now() < _readyAt) return { status: "pending" as const };
	if (!_suggestion) {
		throw new Error("setMockOnboardingSuggestion() not called");
	}
	return { status: "done" as const, suggestion: _suggestion };
};

export const cancelAnalyzeBrandFn = async (_args: { data: unknown }) => {
	_cancelled = true;
	return { ok: true as const };
};

export const updateOnboardedBrandFn = async (_args: { data: unknown }) => {
	if (_delayMs > 0) await new Promise((r) => setTimeout(r, Math.min(_delayMs, 800)));
	return {
		id: "mock-brand-id",
		name: "Mock",
		domains: ["mock.com"],
		aliases: [],
		enabled: true,
		onboarded: true,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
};

// Other re-exports from the real module so type-only imports resolve.
export type { OnboardingSuggestion } from "@workspace/lib/onboarding";
