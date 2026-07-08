/**
 * Mock for @/server/prompts used in Storybook stories. Stubs every server
 * function from the real module so that components which import them can
 * bundle without pulling in pg / drizzle / db code.
 */

const noop = async (..._args: unknown[]) => undefined;

export const getPromptMetadataFn = noop;
export const getPromptsSummaryFn = noop;
export const getPromptStatsFn = noop;
export const getPromptRunsFn = noop;
export const updatePromptsFn = noop;
export const getPromptChartDataFn = noop;
export const getPromptWebQueryFn = noop;
