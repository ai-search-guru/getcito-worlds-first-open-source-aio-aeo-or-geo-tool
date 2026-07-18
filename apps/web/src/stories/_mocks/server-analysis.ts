/**
 * Mock for @/server/analysis used in Storybook stories. The real module imports
 * pg via the postgres read layer, which is not browser-safe.
 *
 * Stories set data via setMockShareOfVoice(); the real useShareOfVoice hook calls
 * this through react-query. (Opportunities now live in @/server/opportunities.)
 */

// biome-ignore lint/suspicious/noExplicitAny: loose mock shapes for stories
type Any = any;

export type ShareOfVoiceResponse = Any;

let _sov: Any = null;

export function setMockShareOfVoice(data: Any) {
	_sov = data;
}

export const getShareOfVoiceFn = async (..._args: unknown[]) => _sov;
