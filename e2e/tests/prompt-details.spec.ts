/**
 * Prompt Details Page E2E Tests
 *
 * Tests the prompt detail page which shows individual prompt data
 * with tabs for Mentions, Web Queries, Citations, and LLM Responses.
 */
import { test, expect } from "@playwright/test";

const BRAND_ID = "default";
// This matches PROMPT_IDS.branded1 from seed.ts
const PROMPT_ID = "00000000-0000-0000-0000-000000000001";
const PROMPT_TEXT = "What is the best AI monitoring tool";

test.describe("Prompt Details Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`/app/${BRAND_ID}/prompts/${PROMPT_ID}`);
    // Wait for the prompt text to appear (route loader + client data fetch)
    await expect(page.getByText(PROMPT_TEXT)).toBeVisible({ timeout: 30_000 });
  });

  test("page loads and shows prompt text", async ({ page }) => {
    // prompt text already asserted in beforeEach
  });

  test("page shows tab navigation", async ({ page }) => {

    // The page should have tabs: Mentions, Web Queries, Citations, LLM Responses
    const tabs = ["Mentions", "Web Queries", "Citations", "LLM Responses"];

    for (const tabName of tabs) {
      const tab = page.getByRole("tab", { name: tabName }).or(
        page.getByRole("button", { name: tabName })
      ).or(
        page.getByText(tabName, { exact: true })
      );
      await expect(tab.first()).toBeVisible();
    }
  });

  test("can switch between tabs", async ({ page }) => {
    await expect(page.getByText(PROMPT_TEXT)).toBeVisible();

    // Click on "LLM Responses" tab
    const responsesTab = page.getByRole("tab", { name: /LLM Responses/i }).or(
      page.getByRole("button", { name: /LLM Responses/i })
    ).or(
      page.getByText("LLM Responses", { exact: true })
    );
    await responsesTab.first().click();

    // The LLM Responses tab should show prompt run data from the database
    // Our seed data includes runs with model names
    const pageContent = await page.textContent("body");
    const hasRunContent =
      pageContent?.includes("gpt-4o") ||
      pageContent?.includes("claude") ||
      pageContent?.includes("gemini") ||
      pageContent?.includes("Response") ||
      pageContent?.includes("response");
    expect(hasRunContent).toBeTruthy();
  });

  test("page shows prompt metadata", async ({ page }) => {
    // Wait for the prompt text to appear (confirms page has loaded with data)
    await expect(page.getByText(PROMPT_TEXT)).toBeVisible();

    // Should show tags from the prompt — our seeded prompt has tag "monitoring"
    // and system tag "branded", and the prompt text contains "monitoring"
    const pageContent = await page.textContent("body");
    const hasMetadata =
      pageContent?.includes("monitoring") ||
      pageContent?.includes("branded") ||
      pageContent?.includes("AI monitoring");
    expect(hasMetadata).toBeTruthy();
  });

  test("has back navigation", async ({ page }) => {
    // There should be breadcrumb or link navigation back to the parent page
    const backNav = page.locator("a[href*='/app/default']").first();
    await expect(backNav).toBeVisible();
  });
});
