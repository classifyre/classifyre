import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/experimental-ct-react";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./tests/components",
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  timeout: 30_000,
  use: {
    trace: "on-first-retry",
    ctViteConfig: {
      plugins: [tsconfigPaths()],
      worker: {
        format: "es",
      },
      resolve: {
        alias: [
          {
            find: "@/components/ai-assisted-card",
            replacement: path.resolve(
              __dirname,
              "tests/component-mocks/ai-assisted-card.mock.tsx",
            ),
          },
          {
            find: "@",
            replacement: __dirname,
          },
        ],
      },
    },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
