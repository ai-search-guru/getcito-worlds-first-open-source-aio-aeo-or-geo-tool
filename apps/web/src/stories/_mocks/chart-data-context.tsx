/**
 * Mock for @/contexts/chart-data-context — provides controllable chart data context for stories.
 *
 * CachedPromptChart reads all its data from this context instead of fetching directly.
 */
import { createContext, useContext, type ReactNode } from "react";

// Re-export the types that components import from the real module
export interface ProcessedChartData {
	chartData: Array<{ date: string; [key: string]: number | string | null }>;
	totalRuns: number;
	hasVisibilityData: boolean;
	lastBrandVisibility: number | null;
}

interface ChartDataContextValue {
	batchData: unknown[] | null;
	brand: any;
	competitors: any[];
	dateRange: string[];
	getChartDataForPrompt: (promptId: string) => ProcessedChartData | null;
	isLoading: boolean;
}

// Module-level mock state — stories set this before rendering
let _mockContextValue: ChartDataContextValue | null = null;

export function setMockChartDataContext(value: ChartDataContextValue | null) {
	_mockContextValue = value;
}

export function useOptionalChartDataContext() {
	return _mockContextValue;
}

export function useChartDataContext() {
	if (!_mockContextValue) {
		throw new Error("useChartDataContext must be used within a ChartDataProvider");
	}
	return _mockContextValue;
}

// No-op provider for stories (context is controlled via setMockChartDataContext)
export function ChartDataProvider({ children }: { children: ReactNode }) {
	return <>{children}</>;
}
