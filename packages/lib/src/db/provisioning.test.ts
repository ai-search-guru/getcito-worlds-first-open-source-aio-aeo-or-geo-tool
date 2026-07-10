import { describe, expect, it } from "vitest";
import { slugifyOrgName } from "./provisioning";

describe("slugifyOrgName", () => {
	it("lowercases", () => {
		expect(slugifyOrgName("Acme")).toBe("acme");
	});

	it("replaces runs of non-alphanumerics with single hyphens", () => {
		expect(slugifyOrgName("Acme Co!")).toBe("acme-co");
		expect(slugifyOrgName("Foo   Bar")).toBe("foo-bar");
	});

	it("trims leading and trailing hyphens", () => {
		expect(slugifyOrgName("  hello world  ")).toBe("hello-world");
		expect(slugifyOrgName("!!!brand!!!")).toBe("brand");
	});

	it("falls back to 'brand' for empty / non-alphanumeric input", () => {
		expect(slugifyOrgName("")).toBe("brand");
		expect(slugifyOrgName("!!!")).toBe("brand");
	});

	it("preserves digits", () => {
		expect(slugifyOrgName("Acme 2")).toBe("acme-2");
	});
});
