/**
 * Stories for the brand-onboarding flow. Cover the meaningful UI states:
 *   - Setup (the BrandOnboarding form that captures the website URL — runs
 *     before the wizard).
 *   - Idle (the analyze button before the user clicks it).
 *   - Analyzing (the in-flight loader, simulated with a long mock delay).
 *   - Review (every section populated, prompts pre-tagged).
 *   - Analyze error (the wizard surfaces the message inline).
 *
 * The mocks live in src/stories/_mocks; the storybook alias in
 * .storybook/main.ts swaps `@/server/onboarding` and `@/server/brands` for
 * the mocks at bundle time.
 */
import { useEffect } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { within, userEvent, expect, waitFor } from "storybook/test";
import BrandOnboarding from "@/components/brand-onboarding";
import PromptWizard from "@/components/prompt-wizard";
import { setMockBrand } from "./_mocks/use-brands";
import {
	setMockOnboardingDelay,
	setMockOnboardingError,
	setMockOnboardingSuggestion,
} from "./_mocks/server-onboarding";
import type { OnboardingSuggestion } from "@workspace/lib/onboarding";

const RICH_SUGGESTION: OnboardingSuggestion = {
	brandName: "Acme",
	website: "acme.com",
	additionalDomains: ["acme.co.uk", "acme.de"],
	aliases: ["Acme Inc", "Acme Corporation"],
	competitors: [
		{ name: "Globex", domains: ["globex.com", "globex.de"], aliases: ["Globex Corp"] },
		{ name: "Initech", domains: ["initech.com"], aliases: ["Initech Industries"] },
		{ name: "Soylent", domains: ["soylent.com"], aliases: [] },
	],
	suggestedPrompts: [
		{ prompt: "best widgets", tags: ["best-of"] },
		{ prompt: "best widgets for small business", tags: ["best-of", "use-case"] },
		{ prompt: "widgets vs alternatives", tags: ["comparison"] },
		{ prompt: "where to buy widgets", tags: ["transactional"] },
		{ prompt: "acme alternative", tags: ["alternative", "branded"] },
		{ prompt: "acme review", tags: ["informational", "branded"] },
		{ prompt: "is acme worth it", tags: ["informational", "branded"] },
		{ prompt: "best industrial supplies for startups", tags: ["best-of", "persona"] },
		{ prompt: "globex vs acme", tags: ["comparison", "branded"] },
		{ prompt: "alternatives to globex", tags: ["alternative"] },
	],
};

const MOCK_BRAND = {
	id: "mock-brand-id",
	name: "Acme",
	website: "https://acme.com",
	prompts: [],
	competitors: [],
};

function useWizardSetup({
	brand,
	suggestion,
	delayMs = 0,
	error = null,
}: {
	brand: typeof MOCK_BRAND;
	suggestion: OnboardingSuggestion | null;
	delayMs?: number;
	error?: string | null;
}) {
	useEffect(() => {
		setMockBrand(brand);
		setMockOnboardingSuggestion(suggestion);
		setMockOnboardingDelay(delayMs);
		setMockOnboardingError(error);
		return () => {
			setMockOnboardingSuggestion(null);
			setMockOnboardingDelay(0);
			setMockOnboardingError(null);
		};
	}, [brand, suggestion, delayMs, error]);
}

export default {
	title: "Onboarding / Prompt wizard",
} satisfies Meta;

/**
 * Click the wizard's "Analyze brand" button after mount so the story lands on
 * the analyzing/review state. Stories that want to show the idle screen
 * simply omit this.
 */
function AutoAnalyze() {
	useEffect(() => {
		const id = window.setTimeout(() => {
			const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>("button"));
			const analyze = buttons.find((b) => /analyze brand/i.test(b.textContent ?? ""));
			analyze?.click();
		}, 0);
		return () => window.clearTimeout(id);
	}, []);
	return null;
}

/**
 * Step 1 — the website-capture form that runs before the wizard. The real
 * flow renders this when the auth-side brand exists but no DB row does;
 * once the user submits, createBrandFn writes the row and the route
 * re-renders into the wizard.
 */
export const Setup = () => (
	<BrandOnboarding brandId="mock-brand-id" brandName="Acme" />
);

/** Initial state — analyze button visible, no suggestion fetched yet. */
export const Idle = () => {
	useWizardSetup({ brand: MOCK_BRAND, suggestion: RICH_SUGGESTION });
	return <PromptWizard onComplete={() => {}} />;
};

/** In-flight — analyze is mocked to take 5s so the loader is visible. */
export const Analyzing = () => {
	useWizardSetup({ brand: MOCK_BRAND, suggestion: RICH_SUGGESTION, delayMs: 5_000 });
	return (
		<>
			<PromptWizard onComplete={() => {}} />
			<AutoAnalyze />
		</>
	);
};

/** Review with a fully-populated suggestion — every section editable. */
export const Review = () => {
	useWizardSetup({ brand: MOCK_BRAND, suggestion: RICH_SUGGESTION });
	return (
		<>
			<PromptWizard onComplete={() => {}} />
			<AutoAnalyze />
		</>
	);
};

/**
 * Analyze fails — the wizard surfaces a generic, user-safe message inline. The
 * real provider/stack detail stays server-side (captured by the worker's
 * Sentry wrapper) and is never forwarded to the browser.
 */
export const AnalyzeError = () => {
	useWizardSetup({
		brand: MOCK_BRAND,
		suggestion: RICH_SUGGESTION,
		error: "Brand analysis failed. Please try again.",
	});
	return (
		<>
			<PromptWizard onComplete={() => {}} />
			<AutoAnalyze />
		</>
	);
};

/**
 * Cancel mid-analysis. The analysis is mocked to take a long time so the
 * "Analyzing brand…" loader and its Cancel button are visible; the play
 * function clicks Analyze, then Cancel, and asserts the wizard returns to the
 * idle state (analyze button enabled again, cancel button gone).
 */
export const Cancel: StoryObj = {
	render: () => {
		useWizardSetup({ brand: MOCK_BRAND, suggestion: RICH_SUGGESTION, delayMs: 60_000 });
		return <PromptWizard onComplete={() => {}} />;
	},
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);

		await userEvent.click(await canvas.findByRole("button", { name: /analyze brand/i }));

		// Cancel only appears while analyzing.
		await userEvent.click(await canvas.findByRole("button", { name: /^cancel$/i }));

		// Back to idle: analyze is enabled again and the cancel button is gone.
		await waitFor(() => {
			expect(canvas.getByRole("button", { name: /analyze brand/i })).toBeEnabled();
		});
		expect(canvas.queryByRole("button", { name: /^cancel$/i })).toBeNull();
	},
};
