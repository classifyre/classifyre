import { test, expect, type Page } from "@playwright/test";
import {
  API_BASE,
  requireEnv,
  deleteSourceViaApi,
  enableBuiltinDetector,
  setSamplingStrategy,
  setRowsPerPage,
  getFindingsCount,
  waitForScanCompleteApi,
} from "./helpers";

// ── Environment ────────────────────────────────────────────────────────────────

const DATABRICKS_WORKSPACE_URL = requireEnv("DATABRICKS_WORKSPACE_URL");
const DATABRICKS_WAREHOUSE_ID = requireEnv("DATABRICKS_WAREHOUSE_ID");
const DATABRICKS_TOKEN = requireEnv("DATABICKS_TOKEN");

// ── Page object ────────────────────────────────────────────────────────────────

class DatabricksSourceForm {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/sources/new");
    await this.page.locator('[data-testid="source-type-DATABRICKS"]').click();
    await this.page.locator('[data-testid="start-blank"]').click();
    await expect(this.page.locator('[data-testid="input-name"]')).toBeVisible();
  }

  async fillName(name: string) {
    await this.page.locator('[data-testid="input-name"]').fill(name);
  }

  async fillRequiredFields() {
    await this.page.locator('[data-testid="input-required-workspace-url"]').fill(DATABRICKS_WORKSPACE_URL);
    await this.page.locator('[data-testid="input-required-warehouse-id"]').fill(DATABRICKS_WAREHOUSE_ID);
  }

  async fillToken() {
    await this.page.locator('[data-testid="input-masked-token"]').fill(DATABRICKS_TOKEN);
  }

  async testConnection(): Promise<string> {
    await this.page.locator('[data-testid="btn-test-source"]').click();
    const statusEl = this.page.locator('[data-testid="test-connection-status"]');
    await expect(statusEl).toBeVisible({ timeout: 30_000 });
    await expect(statusEl).not.toHaveAttribute("data-status", "loading", { timeout: 120_000 });
    const status = (await statusEl.getAttribute("data-status")) ?? "unknown";
    const message = (await statusEl.textContent()) ?? "";
    await this.page.locator('[data-testid="btn-test-connection-close"]').click();
    await expect(statusEl).not.toBeVisible();
    return status + "|" + message;
  }
}

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe("Databricks Source", () => {
  const createdSourceIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of createdSourceIds) {
      await deleteSourceViaApi(request, id);
    }
  });

  test("create Databricks source, test connection, scan with PII, verify findings and cleanup", async ({ page }) => {
    test.setTimeout(900_000);

    const form = new DatabricksSourceForm(page);
    const sourceName = `E2E-DB-${Date.now()}`;

    await form.open();
    await form.fillName(sourceName);
    await form.fillRequiredFields();
    await form.fillToken();

    await setSamplingStrategy(page, "RANDOM");
    await setRowsPerPage(page, "10");

    const result = await form.testConnection();
    const [status, message] = result.split("|");
    expect(status, `Connection test: ${message}`).toBe("success");

    // Save source
    await page.locator('[data-testid="btn-save-source"]').click();

    // Go to detectors step
    await page.getByRole("button", { name: /detectors|detektoren/i }).first().click();
    await expect(page.locator('[data-testid="scan-config-section"]')).toBeVisible({ timeout: 15_000 });

    await enableBuiltinDetector(page, "PII");

    // Save & Scan
    await page.locator('[data-testid="btn-save-and-scan"]').click();
    await page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 30_000 });

    // Wait for scan to complete (polling API directly for long scans)
    const terminalStatus = await waitForScanCompleteApi(page, 900_000);
    expect(terminalStatus, "Scan must finish with COMPLETED, not ERROR").toBe("COMPLETED");

    // Verify PII findings exist
    const findingsCount = await getFindingsCount(page);
    expect(findingsCount, "PII scan must produce at least 1 finding").toBeGreaterThan(0);

    // Navigate to source list, find source, record ID for cleanup
    await page.goto("/sources");
    await page.getByText(sourceName).first().click();
    await page.waitForURL(/\/sources\/[a-z0-9-]+$/, { timeout: 10_000 });

    const sourceId = page.url().match(/\/sources\/([a-z0-9-]+)/)?.[1] ?? "";
    expect(sourceId).toBeTruthy();
    createdSourceIds.push(sourceId);

    // Verify assets via API
    const assetsResp = await page.request.get(`${API_BASE}/assets?sourceId=${sourceId}`);
    if (assetsResp.ok()) {
      const body = (await assetsResp.json()) as { items?: unknown[] } | unknown[];
      const items = Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? []);
      expect((items as unknown[]).length, "Expected at least one scanned asset").toBeGreaterThan(0);
    }

    // Delete source and verify cleanup
    await page.goto(`/sources/${sourceId}`);
    await page.locator('[data-testid="btn-delete-source"]').click();
    await page.locator('[data-testid="btn-delete-confirm"]').click();
    await page.waitForURL(/\/sources$/, { timeout: 15_000 });
    await expect(page.getByText(sourceName)).not.toBeVisible({ timeout: 10_000 });

    const idx = createdSourceIds.indexOf(sourceId);
    if (idx !== -1) createdSourceIds.splice(idx, 1);
  });
});
