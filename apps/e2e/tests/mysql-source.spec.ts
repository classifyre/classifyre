import { test, expect, type Page } from "@playwright/test";
import {
  API_BASE,
  requireEnv,
  deleteSourceViaApi,
  enableBuiltinDetector,
  setSamplingStrategy,
  setRowsPerPage,
  getFindingsCount,
} from "./helpers";

// ── Environment ────────────────────────────────────────────────────────────────

const MYSQL_HOST = requireEnv("MYSQL_HOST");
const MYSQL_PORT = requireEnv("MYSQL_PORT");
const MYSQL_USERNAME = requireEnv("MYSQL_USERNAME");
const MYSQL_PASSWORD = requireEnv("MYSQL_PASSWORD");
const MYSQL_DATABASE = requireEnv("MYSQL_DATABASE");
const MYSQL_CERT = requireEnv("MYSQL_CERT").replace(/\\n/g, "\n");

// ── Page-object helpers ────────────────────────────────────────────────────────

class MySQLSourceForm {
  constructor(private readonly page: Page) {}

  async open() {
    await this.page.goto("/sources/new");
    await this.page.locator('[data-testid="source-type-MYSQL"]').click();
    await this.page.locator('[data-testid="start-blank"]').click();
    await expect(this.page.locator('[data-testid="input-name"]')).toBeVisible();
  }

  async fillName(name: string) {
    await this.page.locator('[data-testid="input-name"]').fill(name);
  }

  async fillRequired(host: string, port: string) {
    await this.page.locator('[data-testid="input-required-host"]').fill(host);
    const portInput = this.page.locator('[data-testid="input-required-port"]');
    await portInput.fill("");
    await portInput.fill(port);
  }

  async fillMasked(username: string, password: string, sslCa?: string) {
    await this.page.locator('[data-testid="input-masked-username"]').fill(username);
    await this.page.locator('[data-testid="input-masked-password"]').fill(password);
    if (sslCa) {
      const caField = this.page.locator(
        '[data-testid="input-masked-ssl-ca"], [data-testid="textarea-masked-ssl-ca"]',
      );
      await caField.fill(sslCa);
    }
  }

  async expandOptional() {
    const trigger = this.page.locator('[data-testid="accordion-trigger-optional"]');
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
  }

  async setSSLMode(mode: "DISABLED" | "PREFERRED" | "REQUIRED" | "VERIFY_CA" | "VERIFY_IDENTITY") {
    const selectTrigger = this.page.locator(
      '[data-testid="select-optional-connection-ssl-mode"], [data-testid="select-mysqlsslmode"]',
    );
    if (await selectTrigger.isVisible()) {
      await selectTrigger.click();
      await this.page.getByRole("option", { name: mode, exact: true }).click();
      return;
    }
    const btn = this.page.locator(`[data-testid="option-ssl-mode-${mode}"]`);
    if (await btn.isVisible()) {
      await btn.click();
    }
  }

  async setDatabase(database: string) {
    const dbField = this.page.locator('[data-testid="input-optional-scope-database"]');
    if (await dbField.isVisible()) {
      await dbField.fill(database);
    }
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

  async saveAndScan() {
    const btn = this.page.locator('[data-testid="btn-save-and-scan"]');
    await btn.click();
    await this.page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 30_000 });
  }
}

// ── Tests ──────────────────────────────────────────────────────────────────────

test.describe("MySQL Source (SSL / Aiven)", () => {
  const createdSourceIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of createdSourceIds) {
      await deleteSourceViaApi(request, id);
    }
  });

  test("create source with VERIFY_CA SSL, test connection succeeds", async ({ page }) => {
    const form = new MySQLSourceForm(page);
    await form.open();

    const sourceName = `E2E MySQL SSL ${Date.now()}`;
    await form.fillName(sourceName);
    await form.fillRequired(MYSQL_HOST, MYSQL_PORT);
    await form.fillMasked(MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_CERT);

    await form.expandOptional();
    await form.setSSLMode("PREFERRED");
    await form.setDatabase(MYSQL_DATABASE);

    const result = await form.testConnection();
    const [status, message] = result.split("|");

    expect(status, `Connection test: ${message}`).toBe("success");
    expect(message).toMatch(/successfully connected/i);
  });

  test("ingest with PII detector, scan completes, cleanup succeeds", async ({ page }) => {
    test.setTimeout(420_000);
    const form = new MySQLSourceForm(page);
    await form.open();

    const sourceName = `E2E MySQL PII ${Date.now()}`;
    await form.fillName(sourceName);
    await form.fillRequired(MYSQL_HOST, MYSQL_PORT);
    await form.fillMasked(MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_CERT);

    await form.expandOptional();
    await form.setSSLMode("PREFERRED");
    await form.setDatabase(MYSQL_DATABASE);

    // Sampling: RANDOM with 10 rows to keep scan fast
    await setSamplingStrategy(page, "RANDOM");
    await setRowsPerPage(page, "10");

    // Save source then go to detectors step
    await page.locator('[data-testid="btn-save-source"]').click();
    await page.getByRole("button", { name: /detectors|detektoren/i }).first().click();
    await expect(page.locator('[data-testid="scan-config-section"]')).toBeVisible({ timeout: 15_000 });

    await enableBuiltinDetector(page, "PII");
    await form.saveAndScan();

    const badge = page.locator('[data-testid="scan-status-badge"]');
    await expect(badge).toBeVisible({ timeout: 30_000 });
    await expect(badge).toHaveText(/Completed|Error|Abgeschlossen|Fehler|Warning|Warnung/i, { timeout: 300_000 });
    const badgeText = (await badge.textContent()) ?? "";
    expect(/error|fehler/i.test(badgeText) ? "ERROR" : "COMPLETED", "Scan must finish with COMPLETED").toBe("COMPLETED");

    expect(await getFindingsCount(page), "PII scan must produce at least 1 finding").toBeGreaterThan(0);

    // Navigate to the source detail to record source ID for cleanup
    await page.goto("/sources");
    await page.getByText(sourceName).first().click();
    await page.waitForURL(/\/sources\/[a-z0-9-]+$/, { timeout: 10_000 });

    const sourceId = page.url().match(/\/sources\/([a-z0-9-]+)/)?.[1] ?? "";
    expect(sourceId).toBeTruthy();
    createdSourceIds.push(sourceId);

    // Verify assets were created
    const assetsResp = await page.request.get(`${API_BASE}/assets?sourceId=${sourceId}`);
    if (assetsResp.ok()) {
      const body = (await assetsResp.json()) as { items?: unknown[]; total?: number } | unknown[];
      const items = Array.isArray(body) ? body : ((body as { items?: unknown[] }).items ?? []);
      expect((items as unknown[]).length, "Expected at least one scanned asset").toBeGreaterThan(0);
    }

    // Delete and verify cleanup
    await page.goto(`/sources/${sourceId}`);
    await page.locator('[data-testid="btn-delete-source"]').click();
    await page.locator('[data-testid="btn-delete-confirm"]').click();
    await page.waitForURL(/\/sources$/, { timeout: 15_000 });
    await expect(page.getByText(sourceName)).not.toBeVisible({ timeout: 10_000 });

    const idx = createdSourceIds.indexOf(sourceId);
    if (idx !== -1) createdSourceIds.splice(idx, 1);
  });
});
