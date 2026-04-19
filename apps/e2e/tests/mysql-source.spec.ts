/**
 * E2E tests for MySQL source workflow:
 *  1. Create source, fill connection details from MYSQL env var, test connection
 *  2. Run scan and verify assets are discovered
 *  3. Delete source and verify cleanup
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

function parseMysqlUrl(url: string) {
  const match = url.match(/^mysql:\/\/([^:]+):([^@]+)@([^:/]+):(\d+)\/([^?]+)/);
  if (!match) throw new Error(`Cannot parse MYSQL URL: ${url}`);
  return {
    username: match[1]!,
    password: match[2]!,
    host: match[3]!,
    port: match[4]!,
    database: match[5]!,
  };
}

const {
  host: MYSQL_HOST,
  port: MYSQL_PORT,
  username: MYSQL_USERNAME,
  password: MYSQL_PASSWORD,
} = parseMysqlUrl(requireEnv("MYSQL"));

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

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe("MySQL Source E2E", () => {
  test("should create MySQL source, run scan and verify assets", async ({ page }) => {
    test.setTimeout(1_800_000);

    const scan = new ScanDetailPage(page);
    const sourceName = `E2E-MySQL-${Date.now()}`;

    // ── 1. Open new-source form and select MySQL ───────────────────────────────

    await test.step("Navigate to new source and select MySQL type", async () => {
      await page.goto("/sources/new");
      await page.locator('[data-testid="source-type-MYSQL"]').click();
      await page.locator('[data-testid="start-blank"]').click();
      await expect(page.locator('[data-testid="input-name"]')).toBeVisible();
    });

    // ── 2. Fill connection details ─────────────────────────────────────────────

    await test.step("Fill connection credentials", async () => {
      await page.locator('[data-testid="input-name"]').fill(sourceName);
      await page.locator('[data-testid="input-required-host"]').fill(MYSQL_HOST);
      await page.locator('[data-testid="input-required-port"]').fill(MYSQL_PORT);
      await page.locator('[data-testid="input-masked-username"]').fill(MYSQL_USERNAME);
      await page.locator('[data-testid="input-masked-password"]').fill(MYSQL_PASSWORD);
    });

    // ── 3. Test connection ─────────────────────────────────────────────────────

    await test.step("Test connection — expect success", async () => {
      await page.locator('[data-testid="btn-test-source"]').click();
      const statusEl = page.locator('[data-testid="test-connection-status"]');
      await expect(statusEl).toBeVisible({ timeout: 30_000 });
      await expect(statusEl).not.toHaveAttribute("data-status", "loading", {
        timeout: 120_000,
      });
      const connStatus = await statusEl.getAttribute("data-status");
      expect(connStatus, "MySQL connection test should succeed").toBe("success");
      await page.locator('[data-testid="btn-test-connection-close"]').click();
    });

    // ── 4. Save and start scan ─────────────────────────────────────────────────
    // Detector configuration will be added in a follow-up iteration.

    await test.step("Save source and start scan", async () => {
      await page.locator('[data-testid="btn-save-and-scan"]').click();
      await page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 60_000 });
    });

    // ── 5. Verify scan results ─────────────────────────────────────────────────

    await test.step("Verify scan completed and assets discovered", async () => {
      await scan.waitForCompletion();

      const assetsCountStr = await scan.getStatsValue("Assets");
      expect(
        Number(assetsCountStr?.replace(/,/g, "")),
        "MySQL scan should discover at least one asset",
      ).toBeGreaterThan(0);

      await scan.switchToTab("assets");
      await expect(scan.getAssetRows()).not.toHaveCount(0, { timeout: 30_000 });
    });

    // ── 6. Cleanup ─────────────────────────────────────────────────────────────

    await test.step("Delete source and verify removal", async () => {
      await page.getByRole("button", { name: "Source Details" }).click();
      await page.locator('[data-testid="btn-delete-source"]').click();
      await page.locator('[data-testid="btn-delete-confirm"]').click();
      await expect(page).toHaveURL(/\/sources$/, { timeout: 30_000 });
      await expect(page.getByText(sourceName)).not.toBeVisible({ timeout: 10_000 });
    });
  });
});
