/**
 * Mock for @/server/opportunities used in Storybook. The real module builds a digest
 * from the DB and makes an LLM call, neither of which is browser-safe; stories
 * set the response via setMockOpportunities().
 */

// biome-ignore lint/suspicious/noExplicitAny: loose mock shapes for stories
type Any = any;

export type OpportunitiesReport = Any;
export type OpportunitiesResponse = Any;

let _report: Any = null;

export function setMockOpportunities(data: Any) {
	_report = data;
}

export const getOpportunitiesFn = async (..._args: unknown[]) => _report;
