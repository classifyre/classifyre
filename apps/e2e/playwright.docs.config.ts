import { defineConfig, devices } from "@playwright/test";

/**
 * Captures the screenshots of the docs site's Access pages
 * (apps/docs/app/access/images) from a running dev stack with sign-in.
 * Not part of the smoke test; see the header of docs/iam-screenshots.spec.ts.
 */
export default defineConfig({
  testDir: "./docs",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 20 * 60_000,
  expect: { timeout: 60_000 },
  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    actionTimeout: 60_000,
    navigationTimeout: 120_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1280, height: 800 },
        colorScheme: "dark",
      },
    },
  ],
});
