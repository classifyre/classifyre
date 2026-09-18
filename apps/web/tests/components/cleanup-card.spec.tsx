import * as React from "react";
import { expect, test } from "@playwright/experimental-ct-react";
import { CleanupCardHarness } from "./fixtures/cleanup-card-harness";

// Derive the page fixture type from the component-test `test` so this helper
// stays in sync with the playwright-core version the fixtures use.
type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

const overview = {
  schemaSizeBytes: 1000,
  bossSchemaSizeBytes: 0,
  activeJobs: 0,
  unlistedTables: [],
  unlistedSizeBytes: 0,
  datasets: [
    {
      key: "scans",
      cleanupKey: "scans",
      tables: ["runners", "runner_assets"],
      rowsEstimate: 86,
      sizeBytes: 500,
      cleanable: true,
    },
    {
      key: "duplicates",
      cleanupKey: "duplicates",
      tables: ["asset_clusters"],
      rowsEstimate: 12,
      sizeBytes: 200,
      cleanable: true,
    },
    {
      key: "embeddings",
      cleanupKey: "embeddings",
      tables: ["content_embeddings"],
      rowsEstimate: 34,
      sizeBytes: 300,
      cleanable: true,
    },
    {
      key: "findings",
      cleanupKey: null,
      tables: ["findings"],
      rowsEstimate: 50,
      sizeBytes: 500,
      cleanable: false,
    },
  ],
};

const settings = {
  id: 1,
  mcpEnabled: true,
  language: "ENGLISH",
  timezone: "UTC",
  timeFormat: "TWELVE_HOUR",
  aiProviderConfigId: null,
  harnessAiProviderConfigId: null,
  demoMode: false,
  createdAt: "2026-03-10T00:00:00.000Z",
  updatedAt: "2026-03-10T00:00:00.000Z",
};

async function mockCardApi(page: CtPage) {
  await page.route("**/instance-settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(settings),
    });
  });
  await page.route("**/maintenance/overview", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(overview),
    });
  });
}

test("cleanable datasets render in the first table, protected in the second", async ({
  mount,
  page,
}) => {
  await mockCardApi(page);
  const component = await mount(<CleanupCardHarness />);

  await expect(
    component.getByText("Can be cleaned", { exact: true }),
  ).toBeVisible();
  await expect(
    component.getByText("Never deleted here", { exact: true }),
  ).toBeVisible();

  const tables = component.getByRole("table");
  await expect(tables).toHaveCount(2);
  await expect(
    tables.nth(0).getByText("Scan history", { exact: true }),
  ).toBeVisible();
  await expect(
    tables
      .nth(0)
      .getByRole("row", { name: /Scan history/ })
      .getByRole("button", { name: "Clean", exact: true }),
  ).toBeVisible();
  await expect(
    tables.nth(1).getByText("Findings", { exact: true }),
  ).toBeVisible();
  await expect(
    tables.nth(1).getByText("Kept", { exact: true }),
  ).toBeVisible();
  // The protected table has no action buttons at all.
  await expect(tables.nth(1).getByRole("button")).toHaveCount(0);
});

test("the confirm dialog names the destructive damage, not live-work", async ({
  mount,
  page,
}) => {
  await mockCardApi(page);
  const component = await mount(<CleanupCardHarness />);

  await component
    .getByRole("table")
    .nth(0)
    .getByRole("row", { name: /Scan history/ })
    .getByRole("button", { name: "Clean", exact: true })
    .click();

  // The dialog renders in a portal outside the mount root, so assert on
  // the page, not the component locator.
  await expect(
    page.getByText("Finished run history is removed permanently", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByText("Live work is skipped", { exact: false }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("rebuildable datasets explain the impact instead of warning", async ({
  mount,
  page,
}) => {
  await mockCardApi(page);
  const component = await mount(<CleanupCardHarness />);
  const firstTable = component.getByRole("table").nth(0);
  const cancel = () => page.getByRole("button", { name: "Cancel", exact: true }).click();

  // Embeddings: features stay broken until re-index — amber warning.
  await firstTable
    .getByRole("row", { name: /Embeddings/ })
    .getByRole("button", { name: "Clean", exact: true })
    .click();
  await expect(
    page.getByText("return nothing until you re-run the embedding index", {
      exact: false,
    }),
  ).toBeVisible();
  await cancel();

  // Duplicates: queue empties but past decisions are kept — plain info line.
  await firstTable
    .getByRole("row", { name: /Duplicate artefacts/ })
    .getByRole("button", { name: "Clean", exact: true })
    .click();
  await expect(
    page.getByText("Your past review decisions are kept", { exact: false }),
  ).toBeVisible();
  await cancel();
});
