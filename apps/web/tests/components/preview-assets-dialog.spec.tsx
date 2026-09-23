import { expect, test } from "@playwright/experimental-ct-react";
import { PreviewAssetsDialogHarness } from "./fixtures/preview-assets-dialog-harness";
import type { PreviewAsset } from "@/components/notebook/preview-assets-dialog";

// Derive the page fixture type from the component-test `test` so the mock
// helper stays in sync with the playwright-core version the fixtures use.
type CtPage = Parameters<Parameters<typeof test>[2]>[0]["page"];

async function mockSettings(page: CtPage) {
  await page.route("**/instance-settings", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
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
      }),
    });
  });
}

const sample: PreviewAsset[] = [
  {
    id: "asset-1",
    name: "Quarterly report",
    url: "https://example.com/report",
    kind: "page",
    contentType: "text/html",
    contentPreview: "Revenue grew…",
    contentLength: 1400,
    metadata: { author: "ops" },
    links: [{ url: "https://example.com/appendix" }],
  },
  {
    id: "asset-2",
    name: "attachment.pdf",
    kind: "file",
    contentPreview: "",
    contentLength: 0,
    metadata: {},
    links: [],
  },
];

test("preview dialog lists sampled assets as a table", async ({
  mount,
  page,
}) => {
  await mockSettings(page);
  await mount(<PreviewAssetsDialogHarness assets={sample} />);

  // The dialog renders in a portal outside the mount root, so page-level
  // queries — the same pattern the provider dialog tests use.
  const dialog = page.getByTestId("preview-assets-dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("row", { name: /Quarterly report/ }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("row", { name: /attachment.pdf/ }),
  ).toBeVisible();
  // Enrichment counts come from the sample itself, not the persisted store.
  await expect(dialog.getByText("1 metadata · 1 links")).toBeVisible();
});

test("expanding a preview row shows the raw asset", async ({ mount, page }) => {
  await mockSettings(page);
  await mount(<PreviewAssetsDialogHarness assets={sample} />);

  const dialog = page.getByTestId("preview-assets-dialog");
  await dialog.getByRole("row", { name: /Quarterly report/ }).click();
  await expect(page.getByTestId("preview-asset-detail")).toContainText(
    "Revenue grew",
  );
});

test("an empty sample explains itself instead of an empty table", async ({
  mount,
  page,
}) => {
  await mockSettings(page);
  await mount(<PreviewAssetsDialogHarness assets={[]} />);

  const dialog = page.getByTestId("preview-assets-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("table")).toHaveCount(0);
  await expect(page.getByTestId("preview-assets-close")).toBeVisible();
});
