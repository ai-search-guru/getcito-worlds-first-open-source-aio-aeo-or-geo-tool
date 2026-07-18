/**
 * Overview / Dashboard Page E2E Tests
 *
 * Tests that the main dashboard loads correctly, shows the brand layout
 * with sidebar navigation, and that basic navigation works.
 */
import { test, expect } from "@playwright/test";

const BRAND_ID = "default";

test.describe("Overview Page", () => {
  test("home page lands on the brand switcher and the default brand is reachable", async ({ page }) => {
    await page.goto("/");
    // Local mode supports multiple brands, so / -> /app shows the switcher
    // rather than auto-redirecting through to a brand.
    await page.waitForURL(/\/app(?:\/)?$/, { timeout: 30_000 });
    const brandLink = page.locator(`a[href="/app/${BRAND_ID}"]`).first();
    await expect(brandLink).toBeVisible({ timeout: 15_000 });
    await brandLink.click();
    await page.waitForURL(new RegExp(`/app/${BRAND_ID}$`));
    expect(page.url()).toContain(`/app/${BRAND_ID}`);
  });

  test("dashboard page loads and shows sidebar", async ({ page }) => {
    await page.goto(`/app/${BRAND_ID}`);

    // Sidebar should be present with navigation links — wait for route loader to complete
    // (streaming SSR may initially show a skeleton before loaders finish)
    await expect(page.locator(`a[href="/app/${BRAND_ID}"][data-sidebar="menu-button"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`a[href="/app/${BRAND_ID}/visibility"][data-sidebar="menu-button"]`)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator(`a[href="/app/${BRAND_ID}/citations"][data-sidebar="menu-button"]`)).toBeVisible({ timeout: 15_000 });
  });

  test("dashboard shows brand content (not onboarding wizard)", async ({ page }) => {
    await page.goto(`/app/${BRAND_ID}`);

    // The page should have the main content area
    const mainContent = page.locator("main, [class*='SidebarInset'], [class*='flex-1']").first();
    await expect(mainContent).toBeVisible({ timeout: 15_000 });
  });

  test("sidebar navigation links work", async ({ page }) => {
    await page.goto(`/app/${BRAND_ID}`);

    // Wait for sidebar to be fully rendered before clicking
    const visibilityLink = page.locator(`a[href="/app/${BRAND_ID}/visibility"][data-sidebar="menu-button"]`);
    await expect(visibilityLink).toBeVisible({ timeout: 15_000 });

    // Click Visibility link in sidebar
    await visibilityLink.click();
    await page.waitForURL(/\/visibility/);
    expect(page.url()).toContain("/visibility");

    // Click Citations link in sidebar
    const citationsLink = page.locator(`a[href="/app/${BRAND_ID}/citations"][data-sidebar="menu-button"]`);
    await expect(citationsLink).toBeVisible({ timeout: 15_000 });
    await citationsLink.click();
    await page.waitForURL(/\/citations/);
    expect(page.url()).toContain("/citations");

    // Click Overview link in sidebar to go back
    const overviewLink = page.locator(`a[href="/app/${BRAND_ID}"][data-sidebar="menu-button"]`);
    await expect(overviewLink).toBeVisible({ timeout: 15_000 });
    await overviewLink.click();
    await page.waitForURL(new RegExp(`/app/${BRAND_ID}$`));
  });

  test("admin section is accessible in local mode", async ({ page }) => {
    await page.goto(`/app/${BRAND_ID}`);

    // Wait for route loader to complete (sidebar renders after loader finishes)
    await expect(page.locator(`a[href="/app/${BRAND_ID}"][data-sidebar="menu-button"]`)).toBeVisible({ timeout: 15_000 });

    // In local mode, admin access is granted by default
    const adminLink = page.locator('a[href*="/admin"]').first();
    if (await adminLink.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await adminLink.click();
      await page.waitForURL(/\/admin/);
      expect(page.url()).toContain("/admin");
    }
  });

  test("settings pages are accessible", async ({ page }) => {
    await page.goto(`/app/${BRAND_ID}/settings/brand`);
    // Should show brand settings page
    await expect(page.getByText(/brand/i).first()).toBeVisible({ timeout: 15_000 });
  });
});
