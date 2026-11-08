import { defineConfig, devices } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

// Minimal .env loader – avoids requiring the dotenv package. The smoke seed
// (scripts/smoke/seed.sh) writes this file.
const envFile = path.resolve(__dirname, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const [key, ...rest] = trimmed.split("=");
    const value = rest.join("=").trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  }
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // The smoke test waits for what it needs instead of retrying: a retry would
  // start a second scan in a workspace the first attempt already made.
  retries: 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],

  use: {
    baseURL: process.env.BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // A scan starts a job pod, which can pull the scanner image first.
  timeout: 15 * 60_000,
  expect: { timeout: 30_000 },
});
