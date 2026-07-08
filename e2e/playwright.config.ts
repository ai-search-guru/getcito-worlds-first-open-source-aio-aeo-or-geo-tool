import { defineConfig, devices } from "@playwright/test";

// Base URL can be overridden via environment variable.
// Default: http://localhost:1515 (Docker Compose maps web:3000 → host:1515)
const BASE_URL = process.env.BASE_URL || "http://localhost:1515";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 4,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }], ["github"]]
    : [["list"], ["html", { open: "on-failure" }]],
  timeout: 60_000,
  expect: {
    timeout: 15_000,
  },
  maxFailures: process.env.CI ? 10 : 5,

  globalSetup: "./auth-setup.ts",

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    storageState: "e2e/.auth/user.json",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
