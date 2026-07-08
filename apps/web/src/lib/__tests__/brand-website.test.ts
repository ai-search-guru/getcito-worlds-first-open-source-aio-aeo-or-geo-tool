import { describe, it, expect } from "vitest";
import { validateWebsiteUrl } from "@/lib/brand-website";

describe("validateWebsiteUrl", () => {
	it("rejects empty input", () => {
		expect(validateWebsiteUrl("")).toEqual({ isValid: false, error: "Website URL is required" });
	});

	it("rejects whitespace-only input", () => {
		expect(validateWebsiteUrl("   ")).toEqual({ isValid: false, error: "Website URL is required" });
	});

	it("accepts a bare domain and prepends https", () => {
		expect(validateWebsiteUrl("example.com")).toEqual({
			isValid: true,
			formattedUrl: "https://example.com/",
		});
	});

	it("accepts a full https URL with no path", () => {
		expect(validateWebsiteUrl("https://example.com")).toEqual({
			isValid: true,
			formattedUrl: "https://example.com/",
		});
	});

	it("strips the path from a URL with a path", () => {
		expect(validateWebsiteUrl("https://example.com/products")).toEqual({
			isValid: true,
			formattedUrl: "https://example.com/",
		});
	});

	it("strips path, query, and hash", () => {
		expect(validateWebsiteUrl("https://example.com/products?ref=foo#section")).toEqual({
			isValid: true,
			formattedUrl: "https://example.com/",
		});
	});

	it("strips path from a bare domain input", () => {
		expect(validateWebsiteUrl("example.com/products")).toEqual({
			isValid: true,
			formattedUrl: "https://example.com/",
		});
	});

	it("preserves http protocol when explicitly provided", () => {
		expect(validateWebsiteUrl("http://example.com/path")).toEqual({
			isValid: true,
			formattedUrl: "http://example.com/",
		});
	});

	it("preserves subdomains", () => {
		expect(validateWebsiteUrl("https://blog.example.com/posts/1")).toEqual({
			isValid: true,
			formattedUrl: "https://blog.example.com/",
		});
	});

	it("rejects hostnames without a TLD", () => {
		const result = validateWebsiteUrl("foo");
		expect(result.isValid).toBe(false);
	});

	it("rejects input that doesn't parse as a URL", () => {
		const result = validateWebsiteUrl("not a url with spaces");
		expect(result.isValid).toBe(false);
	});
});
