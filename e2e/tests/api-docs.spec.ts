/**
 * API Documentation Page E2E Tests
 *
 * Tests that GET /api/v1/docs redirects to the public API reference
 * on the marketing site.
 */
import { test, expect } from "@playwright/test";

const PUBLIC_DOCS_URL = "https://www.getcito.com/docs/api";

test.describe("API Documentation", () => {
	test("GET /api/v1/docs redirects to the public API reference", async ({ request }) => {
		const response = await request.get("/api/v1/docs", { maxRedirects: 0 });

		expect([301, 302, 307, 308]).toContain(response.status());
		expect(response.headers().location).toBe(PUBLIC_DOCS_URL);
	});
});
