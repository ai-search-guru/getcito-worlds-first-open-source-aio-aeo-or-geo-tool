/**
 * Mock for @/server/citations used in Storybook stories. The real module
 * imports pg via @workspace/lib/db, which is not browser-safe.
 */

export const getCitationsFn = async (..._args: unknown[]) => undefined;
