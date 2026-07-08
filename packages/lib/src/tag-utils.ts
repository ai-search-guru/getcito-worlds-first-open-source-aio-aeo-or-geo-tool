import { SYSTEM_TAGS } from "./db/schema";

/**
 * All possible system tag values
 */
export const SYSTEM_TAG_VALUES = Object.values(SYSTEM_TAGS);

/**
 * Check if a tag is a system tag
 */
export function isSystemTag(tag: string): boolean {
	return SYSTEM_TAG_VALUES.includes(tag.toLowerCase() as any);
}

/**
 * Result type for effective branded status
 */
export type EffectiveBrandedStatus = {
	/** The effective branded status after considering overrides */
	isBranded: boolean;
	/** Whether the user has overridden the system-computed status */
	isOverridden: boolean;
	/** The original system-computed status */
	systemIsBranded: boolean;
};

/**
 * Determine the effective branded status for a prompt, considering user tag overrides.
 * 
 * Rules:
 * - If user tags contain "branded" (and not "unbranded"), treat as branded
 * - If user tags contain "unbranded" (and not "branded"), treat as unbranded
 * - If user tags contain both "branded" and "unbranded", use the system tag
 * - If user tags contain neither, use the system tag
 * 
 * All comparisons are case-insensitive.
 */
export function getEffectiveBrandedStatus(
	systemTags: string[],
	userTags: string[],
): EffectiveBrandedStatus {
	const systemTagsLower = systemTags.map((t) => t.toLowerCase());
	const userTagsLower = userTags.map((t) => t.toLowerCase());

	// Determine system branded status
	const systemIsBranded = systemTagsLower.includes(SYSTEM_TAGS.BRANDED);

	// Check for user override tags (case-insensitive)
	const hasBrandedUserTag = userTagsLower.includes(SYSTEM_TAGS.BRANDED);
	const hasUnbrandedUserTag = userTagsLower.includes(SYSTEM_TAGS.UNBRANDED);

	// Determine if there's an override
	// Override only happens if exactly one of branded/unbranded is present in user tags
	if (hasBrandedUserTag && !hasUnbrandedUserTag) {
		// User explicitly marked as branded
		return {
			isBranded: true,
			isOverridden: !systemIsBranded, // Only overridden if system said unbranded
			systemIsBranded,
		};
	}
	if (hasUnbrandedUserTag && !hasBrandedUserTag) {
		// User explicitly marked as unbranded
		return {
			isBranded: false,
			isOverridden: systemIsBranded, // Only overridden if system said branded
			systemIsBranded,
		};
	}

	// No override (neither or both user tags present) - use system
	return {
		isBranded: systemIsBranded,
		isOverridden: false,
		systemIsBranded,
	};
}

/**
 * Check if a prompt text is "branded" (contains the brand name or domain)
 */
export function isPromptBranded(promptValue: string, brandName: string, brandWebsite: string): boolean {
	const promptLower = promptValue.toLowerCase();
	const brandNameLower = brandName.toLowerCase();

	try {
		const url = new URL(brandWebsite.startsWith("http") ? brandWebsite : `https://${brandWebsite}`);
		const domain = url.hostname.replace(/^www\./, "").toLowerCase();
		const domainWithoutTld = domain.split(".")[0];

		return promptLower.includes(brandNameLower) || promptLower.includes(domain) || promptLower.includes(domainWithoutTld);
	} catch {
		return promptLower.includes(brandNameLower);
	}
}

/**
 * Compute system tags for a prompt based on its content
 */
export function computeSystemTags(promptValue: string, brandName: string, brandWebsite: string): string[] {
	const isBranded = isPromptBranded(promptValue, brandName, brandWebsite);
	return [isBranded ? SYSTEM_TAGS.BRANDED : SYSTEM_TAGS.UNBRANDED];
}

/**
 * Normalize a tag (lowercase, trimmed)
 */
export function normalizeTag(tag: string): string {
	return tag.toLowerCase().trim();
}

/**
 * Sanitize user tags - normalize and dedupe.
 * Note: "branded" and "unbranded" are allowed as user tags to override system-computed values.
 */
export function sanitizeUserTags(tags: string[]): string[] {
	return tags
		.map(normalizeTag)
		.filter((tag) => tag.length > 0)
		.filter((tag, index, self) => self.indexOf(tag) === index); // dedupe
}
