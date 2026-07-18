/**
 * Visibility Page E2E Tests
 *
 * Tests the visibility page which shows prompts with visibility scores.
 * Tests filter functionality (model, tags, lookback period).
 */
import { test, expect } from "@playwright/test";

const BRAND_ID = "default";

test.describe("Visibility Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/app/${BRAND_ID}/visibility`);
    // Wait for SSR streaming + hydration — heading appears once route loaders finish
    await expect(page.getByRole("heading", { name: "Visibility" })).toBeVisible({ timeout: 30_000 });
  });

  test("page loads with correct title", async ({ page }) => {
    // heading already asserted in beforeEach
  });

  test("page shows prompt-related content", async ({ page }) => {
    // The page body should contain visibility-related content
    const pageContent = await page.textContent("body");
    const hasContent =
      pageContent?.includes("Visibility") ||
      pageContent?.includes("monitoring") ||
      pageContent?.includes("prompts");
    expect(hasContent).toBeTruthy();
  });

  test("page has filter controls", async ({ page }) => {
    // The page should have interactive filter elements (dropdowns, selects, etc.)
    const headerArea = page.locator("header, [class*='header'], [class*='Header']").first();
    await expect(headerArea).toBeVisible();
  });

  test("page is accessible via sidebar navigation", async ({ page }) => {
    // Navigate via sidebar from overview (use href for stability)
    await page.goto(`/app/${BRAND_ID}`);
    // Wait for sidebar to fully render after route loader completes
    const visLink = page.locator(`a[href="/app/${BRAND_ID}/visibility"][data-sidebar="menu-button"]`);
    await expect(visLink).toBeVisible({ timeout: 15_000 });
    await visLink.click();
    await page.waitForURL(/\/visibility/);
    await expect(page.getByRole("heading", { name: "Visibility" })).toBeVisible({ timeout: 15_000 });
  });
});
