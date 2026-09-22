import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/experimental-ct-react";
import tsconfigPaths from "vite-tsconfig-paths";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Test doubles for modules that cannot run in the CT sandbox:
 * - `next/navigation` hooks throw without the Next app router mounted.
 * - `ai-assisted-card` and `stepper-nav` are shaped for the app shell and are
 *   irrelevant to the tests that mount forms alongside them.
 */
const componentTestDoubles: Array<{ find: string; replacement: string }> = [
  {
    find: "next/navigation",
    replacement: path.resolve(
      __dirname,
      "tests/component-mocks/next-navigation.mock.ts",
    ),
  },
  {
    find: "@/components/ai-assisted-card",
    replacement: path.resolve(
      __dirname,
      "tests/component-mocks/ai-assisted-card.mock.tsx",
    ),
  },
  {
    find: "@/components/stepper-nav",
    replacement: path.resolve(
      __dirname,
      "tests/component-mocks/stepper-nav.mock.tsx",
    ),
  },
];

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
          ...componentTestDoubles,
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
