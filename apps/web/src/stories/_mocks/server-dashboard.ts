/**
 * Mock for @/server/dashboard used in Storybook stories. The real module
 * imports pg via @workspace/lib/db, which is not browser-safe.
 *
 * Stories set the summary via setMockDashboardSummary(); getDashboardSummaryFn
 * (called by the real useDashboardSummary hook through react-query) returns it.
 */

export type VisibilityTimeSeriesPoint = {
	date: string;
	overall: number | null;
	nonBranded: number | null;
	branded: number | null;
};

export type CitationTimeSeriesPoint = { date: string; [key: string]: number | string | null };

// biome-ignore lint/suspicious/noExplicitAny: loose mock shape for stories
export type DashboardSummaryResponse = any;

let _summary: DashboardSummaryResponse = null;

export function setMockDashboardSummary(summary: DashboardSummaryResponse) {
	_summary = summary;
}

export const getDashboardSummaryFn = async (..._args: unknown[]) => _summary;
