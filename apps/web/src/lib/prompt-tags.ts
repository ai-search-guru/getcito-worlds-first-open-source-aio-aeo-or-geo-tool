/**
 * Shared prompt-tag helpers. Tag/search → prompt-id resolution lives in
 * `resolveFilteredPrompts` (server/prompt-resolution.ts); this just exposes the
 * effective branded check used to exclude branded prompts from Opportunities.
 */
import { getEffectiveBrandedStatus } from "@workspace/lib/tag-utils";

export interface TaggablePrompt {
	tags: string[] | null;
	systemTags: string[] | null;
}

/** True when a prompt is effectively branded (system tag or user override). */
export function isBrandedPrompt(p: TaggablePrompt): boolean {
	return getEffectiveBrandedStatus(p.systemTags || [], p.tags || []).isBranded;
}
