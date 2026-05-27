/**
 * E2E tests for S3-Compatible Storage source workflow (Backblaze B2).
 * Covers two separate bucket sources:
 *  - Bucket 1: testinertiabucket (S3_BUCKET_1)
 *  - Bucket 2: testmediabucket   (S3_BUCKET_2)
 *
 * Each test:
 *  1. Creates the source, fills credentials and endpoint from env vars
 *  2. Tests the connection (expects success)
 *  3. Runs a scan and verifies assets are discovered
 *  4. Deletes the source
 *
 * Note: detector configuration is intentionally omitted — detectors will be
 * added in a follow-up test iteration.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Config ─────────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}. Add it to apps/e2e/.env`);
  return value;
}

const S3_KEY_ID = requireEnv("S3_KEY_ID");
const S3_APP_KEY = requireEnv("S3_APP_KEY");
const S3_BUCKET_1 = requireEnv("S3_BUCKET_1");
const S3_BUCKET_2 = requireEnv("S3_BUCKET_2");
const S3_ENDPOINT = requireEnv("S3_ENDPOINT");

// ── Page helpers ───────────────────────────────────────────────────────────────

class ScanDetailPage {
  constructor(private readonly page: Page) {}

  async waitForCompletion(timeout = 1_500_000) {
    const badge = this.page.locator('[data-testid="scan-status-badge"]');
    await expect(badge).toHaveText(/Completed|Error/i, { timeout });
    const text = await badge.textContent();
    if (text?.toLowerCase().includes("error")) {
      throw new Error("Scan finished with ERROR status");
    }
    expect(text?.toLowerCase()).toContain("completed");
  }

  async getStatsValue(label: string) {
    const cardId = `stats-card-${label.toLowerCase().replace(/ \+ /g, "-")}`;
    return this.page
      .locator(`[data-testid="${cardId}"] [data-testid="stats-value"]`)
      .textContent();
  }

  async switchToTab(tab: "findings" | "assets" | "logs") {
    await this.page.locator(`[data-testid="tab-${tab}"]`).click();
  }

  getAssetRows() {
    return this.page.locator('[data-testid="asset-row"]');
  }
}

// ── Shared workflow ────────────────────────────────────────────────────────────

async function runS3BucketTest(page: Page, bucket: string): Promise<void> {
  const scan = new ScanDetailPage(page);
  const sourceName = `E2E-S3-${bucket}-${Date.now()}`;

  // ── 1. Open new-source form and select S3-Compatible Storage ───────────────

  await test.step("Navigate to new source and select S3-Compatible Storage type", async () => {
    await page.goto("/sources/new");
    await page.locator('[data-testid="source-type-S3_COMPATIBLE_STORAGE"]').click();
    await page.locator('[data-testid="start-blank"]').click();
    await expect(page.locator('[data-testid="input-name"]')).toBeVisible();
  });

  // ── 2. Fill connection details ─────────────────────────────────────────────

  await test.step(`Fill credentials for bucket: ${bucket}`, async () => {
    await page.locator('[data-testid="input-name"]').fill(sourceName);
    await page.locator('[data-testid="input-required-bucket"]').fill(bucket);
    await page.locator('[data-testid="input-masked-aws-access-key-id"]').fill(S3_KEY_ID);
    await page.locator('[data-testid="input-masked-aws-secret-access-key"]').fill(S3_APP_KEY);
  });

  // ── 3. Expand optional section and set custom endpoint ────────────────────

  await test.step("Set Backblaze B2 custom endpoint URL", async () => {
    const optTrigger = page.locator('[data-testid="accordion-trigger-optional"]');
    if ((await optTrigger.getAttribute("aria-expanded")) !== "true") {
      await optTrigger.click();
    }
    await page
      .locator('[data-testid="input-optional-connection-endpoint-url"]')
      .fill(S3_ENDPOINT);
  });

  // ── 4. Test connection ─────────────────────────────────────────────────────

  await test.step("Test connection — expect success", async () => {
    await page.locator('[data-testid="btn-test-source"]').click();
    const statusEl = page.locator('[data-testid="test-connection-status"]');
    await expect(statusEl).toBeVisible({ timeout: 30_000 });
    await expect(statusEl).not.toHaveAttribute("data-status", "loading", {
      timeout: 120_000,
    });
    const connStatus = await statusEl.getAttribute("data-status");
    expect(connStatus, `S3 connection test for bucket ${bucket} should succeed`).toBe("success");
    await page.locator('[data-testid="btn-test-connection-close"]').click();
  });

  // ── 5. Save and start scan ─────────────────────────────────────────────────
  // Detector configuration will be added in a follow-up iteration.

  await test.step("Save source and start scan", async () => {
    await page.locator('[data-testid="btn-save-and-scan"]').click();
    await page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 60_000 });
  });

  // ── 6. Verify scan results ─────────────────────────────────────────────────

  await test.step("Verify scan completed and assets discovered", async () => {
    await scan.waitForCompletion();

    const assetsCountStr = await scan.getStatsValue("Assets");
    expect(
      Number(assetsCountStr?.replace(/,/g, "")),
      `S3 scan for bucket ${bucket} should discover at least one asset`,
    ).toBeGreaterThan(0);

    await scan.switchToTab("assets");
    await expect(scan.getAssetRows()).not.toHaveCount(0, { timeout: 30_000 });
  });

  // ── 7. Cleanup ─────────────────────────────────────────────────────────────

  await test.step("Delete source and verify removal", async () => {
    await page.getByRole("button", { name: "Source Details" }).click();
    await page.locator('[data-testid="btn-delete-source"]').click();
    await page.locator('[data-testid="btn-delete-confirm"]').click();
    await expect(page).toHaveURL(/\/sources$/, { timeout: 30_000 });
    await expect(page.getByText(sourceName)).not.toBeVisible({ timeout: 10_000 });
  });
}

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe("S3-Compatible Storage Source E2E", () => {
  test(
    "should create S3 source for bucket 1 (testinertiabucket), run scan and verify assets",
    async ({ page }) => {
      test.setTimeout(1_800_000);
      await runS3BucketTest(page, S3_BUCKET_1);
    },
  );

  test(
    "should create S3 source for bucket 2 (testmediabucket), run scan and verify assets",
    async ({ page }) => {
      test.setTimeout(1_800_000);
      await runS3BucketTest(page, S3_BUCKET_2);
    },
  );
});
