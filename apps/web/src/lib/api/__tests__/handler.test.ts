import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiError, createApiHandler } from "../handler";

const API_KEY = "test-api-key";

function makeRequest(options?: { method?: string; body?: string; apiKey?: string | null }) {
	const headers = new Headers();
	const apiKey = options?.apiKey === undefined ? API_KEY : options.apiKey;
	if (apiKey !== null) {
		headers.set("Authorization", `Bearer ${apiKey}`);
	}
	return new Request("http://localhost/api/v1/test", {
		method: options?.method ?? "GET",
		headers,
		body: options?.body,
	});
}

describe("createApiHandler", () => {
	beforeEach(() => {
		vi.stubEnv("ADMIN_API_KEYS", API_KEY);
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
	});

	it("returns 401 when the API key is missing", async () => {
		const handler = createApiHandler({ handle: async () => ({ ok: true }) });
		const response = await handler({ request: makeRequest({ apiKey: null }), params: {} });
		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: "Unauthorized", message: "Valid API key required" });
	});

	it("returns 401 when the API key is wrong", async () => {
		const handler = createApiHandler({ handle: async () => ({ ok: true }) });
		const response = await handler({ request: makeRequest({ apiKey: "wrong-key" }), params: {} });
		expect(response.status).toBe(401);
	});

	it("wraps a plain object return in Response.json with status 200", async () => {
		const handler = createApiHandler({ handle: async () => ({ ok: true }) });
		const response = await handler({ request: makeRequest(), params: {} });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
	});

	it("uses the configured success status for plain object returns", async () => {
		const handler = createApiHandler({ status: 201, handle: async () => ({ id: "abc" }) });
		const response = await handler({ request: makeRequest(), params: {} });
		expect(response.status).toBe(201);
	});

	it("passes through a Response returned by handle", async () => {
		const handler = createApiHandler({
			handle: async () => Response.json({ custom: true }, { status: 418 }),
		});
		const response = await handler({ request: makeRequest(), params: {} });
		expect(response.status).toBe(418);
		expect(await response.json()).toEqual({ custom: true });
	});

	it("returns 400 when params fail validation", async () => {
		const handler = createApiHandler({
			params: z.object({ promptId: z.guid("Invalid prompt ID format") }),
			handle: async () => ({ ok: true }),
		});
		const response = await handler({ request: makeRequest(), params: { promptId: "not-a-uuid" } });
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe("Validation Error");
		expect(body.message).toContain("promptId");
	});

	it("passes validated params to handle", async () => {
		const promptId = "123e4567-e89b-12d3-a456-426614174000";
		const handler = createApiHandler({
			params: z.object({ promptId: z.guid() }),
			handle: async ({ params }) => ({ received: params.promptId }),
		});
		const response = await handler({ request: makeRequest(), params: { promptId } });
		expect(await response.json()).toEqual({ received: promptId });
	});

	it("accepts IDs without RFC version bits, like the old isValidUUID regex", async () => {
		const promptId = "00000000-0000-0000-0000-000000000001";
		const handler = createApiHandler({
			params: z.object({ promptId: z.guid() }),
			handle: async ({ params }) => ({ received: params.promptId }),
		});
		const response = await handler({ request: makeRequest(), params: { promptId } });
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ received: promptId });
	});

	it("returns 400 when the body is not valid JSON", async () => {
		const handler = createApiHandler({
			body: z.object({ name: z.string() }),
			handle: async () => ({ ok: true }),
		});
		const response = await handler({
			request: makeRequest({ method: "POST", body: "{not json" }),
			params: {},
		});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "Validation Error",
			message: "Request body must be valid JSON",
		});
	});

	it("returns 400 with a zod summary when the body fails validation", async () => {
		const handler = createApiHandler({
			body: z.object({ name: z.string().min(1) }),
			handle: async () => ({ ok: true }),
		});
		const response = await handler({
			request: makeRequest({ method: "POST", body: JSON.stringify({ name: 42 }) }),
			params: {},
		});
		expect(response.status).toBe(400);
		const body = await response.json();
		expect(body.error).toBe("Validation Error");
		expect(body.message).toContain("name");
	});

	it("passes the parsed body to handle", async () => {
		const handler = createApiHandler({
			body: z.object({ name: z.string().trim() }),
			handle: async ({ body }) => ({ name: body.name }),
		});
		const response = await handler({
			request: makeRequest({ method: "POST", body: JSON.stringify({ name: "  Getcito  " }) }),
			params: {},
		});
		expect(await response.json()).toEqual({ name: "Getcito" });
	});

	it("converts a thrown ApiError into its error response", async () => {
		const handler = createApiHandler({
			handle: async () => {
				throw new ApiError(404, "Not Found", "Prompt not found");
			},
		});
		const response = await handler({ request: makeRequest(), params: {} });
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "Not Found", message: "Prompt not found" });
	});

	it("uses mapError to translate domain errors", async () => {
		class ConflictError extends Error {}
		const handler = createApiHandler({
			mapError: (err) => {
				if (err instanceof ConflictError) {
					return new ApiError(409, "Conflict", err.message);
				}
			},
			handle: async () => {
				throw new ConflictError("Already exists");
			},
		});
		const response = await handler({ request: makeRequest(), params: {} });
		expect(response.status).toBe(409);
		expect(await response.json()).toEqual({ error: "Conflict", message: "Already exists" });
	});

	it("falls back to the enveloped 500 when mapError itself throws", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const handler = createApiHandler({
			mapError: () => {
				throw new Error("mapError exploded");
			},
			handle: async () => {
				throw new Error("db exploded");
			},
		});
		const response = await handler({ request: makeRequest(), params: {} });
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "Internal Server Error",
			message: "An unexpected error occurred",
		});
		expect(consoleError).toHaveBeenCalled();
	});

	it("returns a logged 500 for unknown errors", async () => {
		const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
		const handler = createApiHandler({
			handle: async () => {
				throw new Error("db exploded");
			},
		});
		const response = await handler({ request: makeRequest(), params: {} });
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({
			error: "Internal Server Error",
			message: "An unexpected error occurred",
		});
		expect(consoleError).toHaveBeenCalledOnce();
	});

	it("checks auth before validating params", async () => {
		const handler = createApiHandler({
			params: z.object({ promptId: z.guid() }),
			handle: async () => ({ ok: true }),
		});
		const response = await handler({
			request: makeRequest({ apiKey: null }),
			params: { promptId: "not-a-uuid" },
		});
		expect(response.status).toBe(401);
	});
});
