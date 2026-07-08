/**
 * External API (/api/v1) E2E Tests
 *
 * Tests the public REST API endpoints for prompt management.
 * These endpoints require API key authentication via Bearer token.
 */
import { test, expect } from "@playwright/test";

const API_KEY = "test-api-key-e2e";
const BRAND_ID = "default";

// Helper to make authenticated API requests
function authHeaders() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
  };
}

test.describe("External API - Authentication", () => {
  test("returns 401 without API key", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts`);
    expect(response.status()).toBe(401);

    const body = await response.json();
    expect(body.error).toBe("Unauthorized");
  });

  test("returns 401 with invalid API key", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts`, {
      headers: { Authorization: "Bearer invalid-key" },
    });
    expect(response.status()).toBe(401);
  });
});

test.describe("External API - GET /api/v1/prompts", () => {
  test("lists all prompts with valid API key", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.prompts).toBeDefined();
    expect(Array.isArray(body.prompts)).toBeTruthy();
    expect(body.prompts.length).toBeGreaterThan(0);
    expect(body.pagination).toBeDefined();
    expect(body.pagination.total).toBeGreaterThanOrEqual(5); // We seeded 5 prompts
  });

  test("filters prompts by brandId", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts?brandId=${BRAND_ID}`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.prompts.length).toBeGreaterThan(0);

    // All returned prompts should belong to the specified brand
    for (const prompt of body.prompts) {
      expect(prompt.brandId).toBe(BRAND_ID);
    }
  });

  test("returns empty list for non-existent brand", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts?brandId=non-existent`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.prompts).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  test("supports pagination", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts?page=1&limit=2`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.prompts.length).toBeLessThanOrEqual(2);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(2);
    expect(body.pagination.totalPages).toBeGreaterThan(1); // 5 prompts / 2 per page
  });
});

test.describe("External API - GET /api/v1/prompts/:id", () => {
  const PROMPT_ID = "00000000-0000-0000-0000-000000000001";

  test("returns a specific prompt", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts/${PROMPT_ID}`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.id).toBe(PROMPT_ID);
    expect(body.brandId).toBe(BRAND_ID);
    expect(body.value).toContain("monitoring tool");
    expect(body.tags).toContain("monitoring");
    expect(body.enabled).toBe(true);
  });

  test("returns 404 for non-existent prompt", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts/00000000-0000-0000-0000-999999999999`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(404);
  });

  test("returns 400 for invalid UUID format", async ({ request }) => {
    const response = await request.get(`/api/v1/prompts/not-a-uuid`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(400);
  });
});

test.describe("External API - CRUD Operations", () => {
  let createdPromptId: string;

  test("POST creates a new prompt", async ({ request }) => {
    const response = await request.post(`/api/v1/prompts`, {
      headers: authHeaders(),
      data: {
        brandId: BRAND_ID,
        value: "E2E test prompt - what is the best testing framework?",
        tags: ["e2e-test", "testing"],
      },
    });
    expect(response.status()).toBe(201);

    const body = await response.json();
    expect(body.id).toBeDefined();
    expect(body.brandId).toBe(BRAND_ID);
    expect(body.value).toContain("E2E test prompt");
    expect(body.tags).toContain("e2e-test");
    expect(body.enabled).toBe(true);

    createdPromptId = body.id;
  });

  test("POST validates required fields", async ({ request }) => {
    // Missing value
    const response1 = await request.post(`/api/v1/prompts`, {
      headers: authHeaders(),
      data: { brandId: BRAND_ID },
    });
    expect(response1.status()).toBe(400);

    // Missing brandId
    const response2 = await request.post(`/api/v1/prompts`, {
      headers: authHeaders(),
      data: { value: "test prompt" },
    });
    expect(response2.status()).toBe(400);
  });

  test("POST rejects invalid brand ID", async ({ request }) => {
    const response = await request.post(`/api/v1/prompts`, {
      headers: authHeaders(),
      data: {
        brandId: "non-existent-brand",
        value: "This should fail",
      },
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.message).toContain("not found");
  });

  test("PATCH updates a prompt", async ({ request }) => {
    // First create a prompt to update
    const createResponse = await request.post(`/api/v1/prompts`, {
      headers: authHeaders(),
      data: {
        brandId: BRAND_ID,
        value: "Original prompt text for PATCH test",
        tags: ["original"],
      },
    });
    const created = await createResponse.json();

    // Update it
    const response = await request.patch(`/api/v1/prompts/${created.id}`, {
      headers: authHeaders(),
      data: {
        value: "Updated prompt text via PATCH",
        tags: ["updated"],
      },
    });
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body.value).toBe("Updated prompt text via PATCH");
    expect(body.tags).toContain("updated");

    // Clean up
    await request.delete(`/api/v1/prompts/${created.id}`, {
      headers: authHeaders(),
    });
  });

  test("PATCH rejects an empty body", async ({ request }) => {
    const response = await request.patch(`/api/v1/prompts/00000000-0000-0000-0000-000000000001`, {
      headers: authHeaders(),
      data: {},
    });
    expect(response.status()).toBe(400);

    const body = await response.json();
    expect(body.error).toBe("Validation Error");
    expect(body.message).toContain("At least one of");
  });

  test("DELETE removes a prompt", async ({ request }) => {
    // First create a prompt to delete
    const createResponse = await request.post(`/api/v1/prompts`, {
      headers: authHeaders(),
      data: {
        brandId: BRAND_ID,
        value: "Prompt to be deleted in E2E test",
      },
    });
    const created = await createResponse.json();

    // Delete it
    const response = await request.delete(`/api/v1/prompts/${created.id}`, {
      headers: authHeaders(),
    });
    expect(response.status()).toBe(200);

    // DELETE returns the deleted resource bare, plus cascade info
    const body = await response.json();
    expect(body.id).toBe(created.id);
    expect(body.value).toContain("Prompt to be deleted");
    expect(body.deletedRunsCount).toBe(0);

    // Verify it's gone
    const getResponse = await request.get(`/api/v1/prompts/${created.id}`, {
      headers: authHeaders(),
    });
    expect(getResponse.status()).toBe(404);
  });
});
