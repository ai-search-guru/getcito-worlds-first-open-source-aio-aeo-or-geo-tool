import { describe, expect, it } from "vitest";
import {
	cleanAndValidateDomain,
	cleanDomain,
	inferBrandNameFromDomain,
	uniqueLowercase,
	uniqueTrim,
} from "./utils";

describe("cleanDomain", () => {
	it("strips protocol, www, and path", () => {
		expect(cleanDomain("https://www.example.com/path")).toBe("example.com");
		expect(cleanDomain("HTTP://EXAMPLE.COM")).toBe("example.com");
	});

	it("handles plain domains", () => {
		expect(cleanDomain("example.com")).toBe("example.com");
		expect(cleanDomain(" example.com ")).toBe("example.com");
	});

	it("returns empty for empty input", () => {
		expect(cleanDomain("")).toBe("");
		expect(cleanDomain("   ")).toBe("");
	});
});

describe("cleanAndValidateDomain", () => {
	it("accepts valid domains", () => {
		expect(cleanAndValidateDomain("example.com")).toBe("example.com");
		expect(cleanAndValidateDomain("https://www.example.co.uk")).toBe("example.co.uk");
	});

	it("rejects invalid domains", () => {
		expect(cleanAndValidateDomain("not-a-domain")).toBeNull();
		expect(cleanAndValidateDomain("just text")).toBeNull();
		expect(cleanAndValidateDomain("")).toBeNull();
	});
});

describe("inferBrandNameFromDomain", () => {
	it("capitalizes the second-level domain", () => {
		expect(inferBrandNameFromDomain("nike.com")).toBe("Nike");
		expect(inferBrandNameFromDomain("https://www.adidas.de")).toBe("Adidas");
	});

	it("falls back to the input when domain is unparseable", () => {
		expect(inferBrandNameFromDomain("")).toBe("");
	});
});

describe("uniqueLowercase / uniqueTrim", () => {
	it("uniqueLowercase dedupes case-insensitively", () => {
		expect(uniqueLowercase(["A", "a", "B"])).toEqual(["a", "b"]);
	});

	it("uniqueTrim preserves case but dedupes case-insensitively", () => {
		expect(uniqueTrim(["Acme", "acme", "  Acme ", "Globex"])).toEqual(["Acme", "Globex"]);
	});

	it("filters empty strings", () => {
		expect(uniqueLowercase(["", " ", "x"])).toEqual(["x"]);
		expect(uniqueTrim(["", " ", "x"])).toEqual(["x"]);
	});
});
