/**
 * Stories for <CachedPromptChart /> — grouped into two composite pages:
 *  1. Failure States — no visibility, no data, first-eval, loading, etc.
 *  2. Success States — lookback windows with varying visibility levels,
 *     search highlight, and long prompt name edge cases
 */
import type { Meta } from "@storybook/react";
import { CachedPromptChart, type CachedPromptChartProps } from "@/components/cached-prompt-chart";
import { setMockChartDataContext, type ProcessedChartData } from "./_mocks/chart-data-context";
import { setMockClientConfig, type ClientConfig } from "./_mocks/config-client";
import { setMockRouteContext, MockRouteContextProvider } from "./_mocks/tanstack-router";
import { setMockBrand } from "./_mocks/use-brands";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const CHART_COLORS = [
	"#2563eb",
	"#efb118",
	"#3ca951",
	"#ff725c",
	"#a463f2",
	"#ff8ab7",
	"#38b2ac",
	"#9c6b4e",
];

const defaultClientConfig: ClientConfig = {
	mode: "local",
	features: {
		readOnly: false,
		showOptimizeButton: false,
		supportsMultiOrg: true,
		canCreateBrands: true,
	},
	branding: {
		name: "Getcito",
		parentName: "",
		optimizationUrlTemplate: "",
		chartColors: CHART_COLORS,
	},
	analytics: {},
};

const mockBrand = {
	id: "brand-1",
	name: "Acme Corp",
	website: "https://acme.com",
	enabled: true,
	onboarded: true,
	createdAt: new Date().toISOString(),
	updatedAt: new Date().toISOString(),
};

const mockCompetitors = [
	{ id: "comp-1", name: "Competitor Alpha", domain: "alpha.com", brandId: "brand-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
	{ id: "comp-2", name: "Competitor Beta", domain: "beta.com", brandId: "brand-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
	{ id: "comp-3", name: "Competitor Gamma", domain: "gamma.com", brandId: "brand-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
];

/** Deterministic chart data for N days */
function generateChartData(days: number) {
	const data: Array<{ date: string; [key: string]: number | string | null }> = [];
	const now = new Date();
	let seed = 42;
	const random = () => {
		seed = (seed * 16807) % 2147483647;
		return (seed - 1) / 2147483646;
	};
	for (let i = days - 1; i >= 0; i--) {
		const date = new Date(now);
		date.setDate(date.getDate() - i);
		data.push({
			date: date.toISOString().split("T")[0],
			"brand-1": Math.round(random() * 40 + 45),
			"comp-1": Math.round(random() * 30 + 25),
			"comp-2": Math.round(random() * 25 + 15),
			"comp-3": Math.round(random() * 20 + 5),
		});
	}
	return data;
}

function successChartData(days: number, visibility: number): ProcessedChartData {
	return {
		chartData: generateChartData(days),
		totalRuns: days * 4,
		hasVisibilityData: true,
		lastBrandVisibility: visibility,
	};
}

/** Set up all module-level mocks */
function setupMocks() {
	setMockClientConfig(defaultClientConfig);
	setMockRouteContext({ clientConfig: defaultClientConfig });
	setMockBrand(mockBrand);
}

/** Configure the chart data context mock */
function setupContext(opts: {
	chartData?: ProcessedChartData | null;
	isLoading?: boolean;
}) {
	setMockChartDataContext({
		brand: mockBrand,
		competitors: mockCompetitors,
		isLoading: opts.isLoading ?? false,
		getChartDataForPrompt: () => opts.chartData ?? null,
		batchData: null,
		dateRange: [],
	});
}

const baseProps = {
	promptName: "What is the best project management tool for remote teams?",
	promptId: "prompt-1",
	brandId: "brand-1",
	lookback: "1m" as const,
	selectedModel: "all" as const,
	availableModels: ["chatgpt", "claude", "google-ai-mode"] as ("chatgpt" | "claude" | "google-ai-mode")[],
	hasEverBeenEvaluated: true,
};

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

function Section({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<div className="space-y-2">
			<h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</h3>
			{children}
		</div>
	);
}

function PageFrame({ children }: { children: React.ReactNode }) {
	return (
		<MockRouteContextProvider value={{ clientConfig: defaultClientConfig }}>
			<div className="max-w-2xl mx-auto p-6 space-y-8">{children}</div>
		</MockRouteContextProvider>
	);
}

// ---------------------------------------------------------------------------
// Helper to render a single chart with mocked context data
// ---------------------------------------------------------------------------

interface ChartConfig {
	contextData: {
		chartData?: ProcessedChartData | null;
		isLoading?: boolean;
	};
	props?: Partial<CachedPromptChartProps>;
}

function Chart({ contextData, props }: ChartConfig) {
	setupContext(contextData);
	return <CachedPromptChart {...baseProps} {...props} />;
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

export default {
	title: "Prompt Chart",
} satisfies Meta;

/**
 * All non-happy-path states: no visibility, no data, first eval, loading.
 */
export const FailureStates = () => {
	setupMocks();
	return (
		<PageFrame>
			<Section label="No visibility data (runs exist, no brand mentions)">
				<Chart
					contextData={{
						chartData: {
							chartData: generateChartData(30).map((d) => ({
								...d,
								"brand-1": null,
								"comp-1": null,
								"comp-2": null,
								"comp-3": null,
							})),
							totalRuns: 30,
							hasVisibilityData: false,
							lastBrandVisibility: null,
						},
					}}
				/>
			</Section>

			<Section label="No data in selected time range">
				<Chart
					contextData={{
						chartData: {
							chartData: [],
							totalRuns: 0,
							hasVisibilityData: false,
							lastBrandVisibility: null,
						},
					}}
					props={{ lookback: "1w", hasEverBeenEvaluated: true }}
				/>
			</Section>

			<Section label="First evaluation (never run)">
				<Chart
					contextData={{
						chartData: {
							chartData: [],
							totalRuns: 0,
							hasVisibilityData: false,
							lastBrandVisibility: null,
						},
					}}
					props={{ hasEverBeenEvaluated: false }}
				/>
			</Section>

			<Section label="Loading">
				<Chart contextData={{ isLoading: true }} />
			</Section>
		</PageFrame>
	);
};

/**
 * Successful charts at different lookback windows, each with a different
 * visibility level so you can compare badge thresholds and axis density
 * in a single view. Includes search highlight and long prompt name edge cases.
 */
export const SuccessStates = () => {
	setupMocks();
	return (
		<PageFrame>
			<Section label="1 week — high visibility (>75%) green badge">
				<Chart
					contextData={{ chartData: successChartData(7, 80) }}
					props={{ lookback: "1w" }}
				/>
			</Section>

			<Section label="1 month — medium visibility (45–75%) amber badge">
				<Chart
					contextData={{ chartData: successChartData(30, 60) }}
					props={{ lookback: "1m" }}
				/>
			</Section>

			<Section label="3 months — low visibility (<45%) red badge">
				<Chart
					contextData={{ chartData: successChartData(90, 20) }}
					props={{ lookback: "3m" }}
				/>
			</Section>

			<Section label="With search highlight">
				<Chart
					contextData={{ chartData: successChartData(30, 80) }}
					props={{ searchHighlight: "remote teams" }}
				/>
			</Section>

			<Section label="Long prompt name — overflow handling">
				<Chart
					contextData={{ chartData: successChartData(30, 55) }}
					props={{
						promptName:
							"What are the top 10 enterprise project management solutions for large distributed teams working across multiple time zones with different compliance requirements?",
					}}
				/>
			</Section>
		</PageFrame>
	);
};
