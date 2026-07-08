import { describe, it, expect } from "vitest";
import {
	isSystemTag,
	isPromptBranded,
	computeSystemTags,
	normalizeTag,
	sanitizeUserTags,
	getEffectiveBrandedStatus,
} from "./tag-utils";
import { SYSTEM_TAGS } from "./db/schema";

describe("tag-utils", () => {
	describe("isSystemTag", () => {
		it("should return true for branded system tag", () => {
			expect(isSystemTag("branded")).toBe(true);
			expect(isSystemTag("BRANDED")).toBe(true);
			expect(isSystemTag("Branded")).toBe(true);
		});

		it("should return true for unbranded system tag", () => {
			expect(isSystemTag("unbranded")).toBe(true);
			expect(isSystemTag("UNBRANDED")).toBe(true);
		});

		it("should return false for non-system tags", () => {
			expect(isSystemTag("custom")).toBe(false);
			expect(isSystemTag("my-tag")).toBe(false);
			expect(isSystemTag("")).toBe(false);
		});
	});

	describe("isPromptBranded", () => {
		const brandName = "Acme Corp";
		const brandWebsite = "https://www.acmecorp.com";

		it("should return true when prompt contains brand name", () => {
			expect(isPromptBranded("best Acme Corp products", brandName, brandWebsite)).toBe(true);
			expect(isPromptBranded("acme corp alternatives", brandName, brandWebsite)).toBe(true);
		});

		it("should return true when prompt contains domain", () => {
			expect(isPromptBranded("products from acmecorp.com", brandName, brandWebsite)).toBe(true);
		});

		it("should return true when prompt contains domain without TLD", () => {
			expect(isPromptBranded("best acmecorp products", brandName, brandWebsite)).toBe(true);
		});

		it("should return false when prompt does not contain brand", () => {
			expect(isPromptBranded("best shoes for running", brandName, brandWebsite)).toBe(false);
			expect(isPromptBranded("where to buy sneakers", brandName, brandWebsite)).toBe(false);
		});

		it("should handle websites without protocol", () => {
			expect(isPromptBranded("acmecorp products", brandName, "acmecorp.com")).toBe(true);
		});

		it("should handle websites with www prefix", () => {
			expect(isPromptBranded("acmecorp products", brandName, "www.acmecorp.com")).toBe(true);
		});

		it("should handle invalid URLs gracefully", () => {
			// Should still match brand name even with invalid URL
			expect(isPromptBranded("Acme Corp products", brandName, "not-a-valid-url")).toBe(true);
			expect(isPromptBranded("random products", brandName, "not-a-valid-url")).toBe(false);
		});
	});

	describe("computeSystemTags", () => {
		it("should return branded tag when prompt contains brand", () => {
			const tags = computeSystemTags("best Acme products", "Acme", "https://acme.com");
			expect(tags).toContain(SYSTEM_TAGS.BRANDED);
			expect(tags).not.toContain(SYSTEM_TAGS.UNBRANDED);
		});

		it("should return unbranded tag when prompt does not contain brand", () => {
			const tags = computeSystemTags("best running shoes", "Acme", "https://acme.com");
			expect(tags).toContain(SYSTEM_TAGS.UNBRANDED);
			expect(tags).not.toContain(SYSTEM_TAGS.BRANDED);
		});

		it("should return exactly one tag", () => {
			const brandedTags = computeSystemTags("acme products", "Acme", "https://acme.com");
			const unbrandedTags = computeSystemTags("generic products", "Acme", "https://acme.com");
			
			expect(brandedTags).toHaveLength(1);
			expect(unbrandedTags).toHaveLength(1);
		});
	});

	describe("normalizeTag", () => {
		it("should lowercase tags", () => {
			expect(normalizeTag("UPPERCASE")).toBe("uppercase");
			expect(normalizeTag("MixedCase")).toBe("mixedcase");
		});

		it("should trim whitespace", () => {
			expect(normalizeTag("  tag  ")).toBe("tag");
			expect(normalizeTag("\ttab\t")).toBe("tab");
		});

		it("should handle empty string", () => {
			expect(normalizeTag("")).toBe("");
			expect(normalizeTag("   ")).toBe("");
		});
	});

	describe("sanitizeUserTags", () => {
		it("should normalize and dedupe tags", () => {
			const result = sanitizeUserTags(["Tag", "TAG", "tag"]);
			expect(result).toEqual(["tag"]);
		});

		it("should filter out empty tags", () => {
			const result = sanitizeUserTags(["valid", "", "  ", "another"]);
			expect(result).toEqual(["valid", "another"]);
		});

		it("should allow branded and unbranded as user tags (for overrides)", () => {
			const result = sanitizeUserTags(["custom", "branded", "unbranded", "my-tag"]);
			expect(result).toEqual(["custom", "branded", "unbranded", "my-tag"]);
		});

		it("should normalize case for branded/unbranded tags", () => {
			const result = sanitizeUserTags(["BRANDED", "Unbranded", "valid"]);
			expect(result).toEqual(["branded", "unbranded", "valid"]);
		});

		it("should preserve order of first occurrences", () => {
			const result = sanitizeUserTags(["first", "second", "FIRST", "third"]);
			expect(result).toEqual(["first", "second", "third"]);
		});

		it("should handle empty array", () => {
			expect(sanitizeUserTags([])).toEqual([]);
		});
	});

	describe("getEffectiveBrandedStatus", () => {
		it("should use system tag when no user override", () => {
			const brandedResult = getEffectiveBrandedStatus([SYSTEM_TAGS.BRANDED], ["custom"]);
			expect(brandedResult.isBranded).toBe(true);
			expect(brandedResult.isOverridden).toBe(false);
			expect(brandedResult.systemIsBranded).toBe(true);

			const unbrandedResult = getEffectiveBrandedStatus([SYSTEM_TAGS.UNBRANDED], ["custom"]);
			expect(unbrandedResult.isBranded).toBe(false);
			expect(unbrandedResult.isOverridden).toBe(false);
			expect(unbrandedResult.systemIsBranded).toBe(false);
		});

		it("should override to branded when user has branded tag", () => {
			const result = getEffectiveBrandedStatus([SYSTEM_TAGS.UNBRANDED], ["branded"]);
			expect(result.isBranded).toBe(true);
			expect(result.isOverridden).toBe(true);
			expect(result.systemIsBranded).toBe(false);
		});

		it("should override to unbranded when user has unbranded tag", () => {
			const result = getEffectiveBrandedStatus([SYSTEM_TAGS.BRANDED], ["unbranded"]);
			expect(result.isBranded).toBe(false);
			expect(result.isOverridden).toBe(true);
			expect(result.systemIsBranded).toBe(true);
		});

		it("should use system tag when user has both branded and unbranded tags", () => {
			const brandedResult = getEffectiveBrandedStatus([SYSTEM_TAGS.BRANDED], ["branded", "unbranded"]);
			expect(brandedResult.isBranded).toBe(true);
			expect(brandedResult.isOverridden).toBe(false);
			expect(brandedResult.systemIsBranded).toBe(true);

			const unbrandedResult = getEffectiveBrandedStatus([SYSTEM_TAGS.UNBRANDED], ["branded", "unbranded"]);
			expect(unbrandedResult.isBranded).toBe(false);
			expect(unbrandedResult.isOverridden).toBe(false);
			expect(unbrandedResult.systemIsBranded).toBe(false);
		});

		it("should be case insensitive for user override tags", () => {
			const result1 = getEffectiveBrandedStatus([SYSTEM_TAGS.UNBRANDED], ["BRANDED"]);
			expect(result1.isBranded).toBe(true);
			expect(result1.isOverridden).toBe(true);

			const result2 = getEffectiveBrandedStatus([SYSTEM_TAGS.BRANDED], ["UnBrAnDeD"]);
			expect(result2.isBranded).toBe(false);
			expect(result2.isOverridden).toBe(true);
		});

		it("should not be marked as overridden if user tag matches system tag", () => {
			const brandedResult = getEffectiveBrandedStatus([SYSTEM_TAGS.BRANDED], ["branded"]);
			expect(brandedResult.isBranded).toBe(true);
			expect(brandedResult.isOverridden).toBe(false); // Not an override, same as system

			const unbrandedResult = getEffectiveBrandedStatus([SYSTEM_TAGS.UNBRANDED], ["unbranded"]);
			expect(unbrandedResult.isBranded).toBe(false);
			expect(unbrandedResult.isOverridden).toBe(false); // Not an override, same as system
		});

		it("should handle empty arrays", () => {
			const result = getEffectiveBrandedStatus([], []);
			expect(result.isBranded).toBe(false);
			expect(result.isOverridden).toBe(false);
			expect(result.systemIsBranded).toBe(false);
		});
	});

	describe("end-to-end branded status with overrides", () => {
		// Test the full flow: computeSystemTags -> getEffectiveBrandedStatus
		// Using Nike as the brand for concrete examples
		const brandName = "Nike";
		const brandWebsite = "https://nike.com";

		const getEffectiveStatus = (promptValue: string, userTags: string[]) => {
			const systemTags = computeSystemTags(promptValue, brandName, brandWebsite);
			return getEffectiveBrandedStatus(systemTags, userTags);
		};

		it("nike something, [] -> branded (system branded, no override)", () => {
			const result = getEffectiveStatus("nike something", []);
			expect(result.isBranded).toBe(true);
			expect(result.isOverridden).toBe(false);
		});

		it("something, [] -> unbranded (system unbranded, no override)", () => {
			const result = getEffectiveStatus("something", []);
			expect(result.isBranded).toBe(false);
			expect(result.isOverridden).toBe(false);
		});

		it("nike something 2, ['unbranded'] -> unbranded (system branded, user override to unbranded)", () => {
			const result = getEffectiveStatus("nike something 2", ["unbranded"]);
			expect(result.isBranded).toBe(false);
			expect(result.isOverridden).toBe(true);
			expect(result.systemIsBranded).toBe(true);
		});

		it("n something 3, ['branded'] -> branded (system unbranded, user override to branded)", () => {
			const result = getEffectiveStatus("n something 3", ["branded"]);
			expect(result.isBranded).toBe(true);
			expect(result.isOverridden).toBe(true);
			expect(result.systemIsBranded).toBe(false);
		});

		it("nike something 4, ['branded', 'unbranded'] -> branded (system branded, both tags cancel out)", () => {
			const result = getEffectiveStatus("nike something 4", ["branded", "unbranded"]);
			expect(result.isBranded).toBe(true);
			expect(result.isOverridden).toBe(false);
			expect(result.systemIsBranded).toBe(true);
		});

		it("n something 5, ['branded', 'unbranded'] -> unbranded (system unbranded, both tags cancel out)", () => {
			const result = getEffectiveStatus("n something 5", ["branded", "unbranded"]);
			expect(result.isBranded).toBe(false);
			expect(result.isOverridden).toBe(false);
			expect(result.systemIsBranded).toBe(false);
		});
	});
});
