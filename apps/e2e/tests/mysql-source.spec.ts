/**
 * E2E tests for MySQL source workflow:
 *  1. Create source with SSL (VERIFY_CA + pasted CA certificate)
 *  2. Test connection — verify success
 *  3. Run scan with PII detector, verify it completes
 *  4. Delete source, verify cleanup
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// ── Environment ────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env variable: ${name}. Add it to apps/e2e/.env`);
  return value;
}

const MYSQL_HOST = requireEnv("MYSQL_HOST");
const MYSQL_PORT = requireEnv("MYSQL_PORT");
const MYSQL_USERNAME = requireEnv("MYSQL_USERNAME");
const MYSQL_PASSWORD = requireEnv("MYSQL_PASSWORD");
const MYSQL_DATABASE = requireEnv("MYSQL_DATABASE");
// The custom .env loader is line-based, so the cert is stored with literal \n escapes.
const MYSQL_CERT = requireEnv("MYSQL_CERT").replace(/\\n/g, "\n");
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8000";

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
    // ssl_mode is an enum — the UI renders it as a select or segmented control
    const selectTrigger = this.page.locator(
      '[data-testid="select-optional-connection-ssl-mode"], [data-testid="select-mysqlsslmode"]',
    );
    if (await selectTrigger.isVisible()) {
      await selectTrigger.click();
      await this.page.getByRole("option", { name: mode, exact: true }).click();
      return;
    }
    // Fallback: segmented button
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

  async saveSource() {
    await this.page.locator('[data-testid="btn-save-source"]').click();
    await expect(this.page.locator('[data-testid="scan-config-section"]')).toBeVisible({
      timeout: 15_000,
    });
  }

  async enableDetector(detector: string) {
    const toggle = this.page.locator(`[data-testid="detector-toggle-${detector}"]`);
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute("data-state")) !== "on") {
      await toggle.click();
    }
    await expect(toggle).toHaveAttribute("data-state", "on");
  }

  async saveAndScan() {
    const btn = this.page.locator('[data-testid="btn-save-and-scan"]');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await this.page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 30_000 });
  }
}

async function waitForScanCompletion(page: Page, timeout = 600_000): Promise<string> {
  const badge = page.locator('[data-testid="scan-status-badge"]');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveText(/Completed|Error/i, { timeout });
  const badgeText = (await badge.textContent()) ?? "";
  return badgeText.toLowerCase().includes("error") ? "ERROR" : "COMPLETED";
}

function sourceIdFromUrl(page: Page): string {
  const match = page.url().match(/\/sources\/([a-z0-9-]+)/);
  if (!match) throw new Error(`Cannot extract source ID from URL: ${page.url()}`);
  return match[1]!;
}

async function deleteSourceViaApi(request: APIRequestContext, sourceId: string) {
  await request
    .delete(`${API_BASE}/sources/${sourceId}`)
    .catch((err) => console.warn(`Cleanup delete failed for ${sourceId}:`, err));
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
    await form.setSSLMode("VERIFY_CA");
    await form.setDatabase(MYSQL_DATABASE);

    const result = await form.testConnection();
    const [status, message] = result.split("|");

    expect(status, `Connection test: ${message}`).toBe("success");
    expect(message).toMatch(/successfully connected/i);
  });

  test("ingest with PII detector, scan completes, cleanup succeeds", async ({ page }) => {
    const form = new MySQLSourceForm(page);
    await form.open();

    const sourceName = `E2E MySQL PII ${Date.now()}`;
    await form.fillName(sourceName);
    await form.fillRequired(MYSQL_HOST, MYSQL_PORT);
    await form.fillMasked(MYSQL_USERNAME, MYSQL_PASSWORD, MYSQL_CERT);

    await form.expandOptional();
    await form.setSSLMode("VERIFY_CA");
    await form.setDatabase(MYSQL_DATABASE);

    await form.saveSource();
    await form.enableDetector("PII");
    await form.saveAndScan();

    const terminalStatus = await waitForScanCompletion(page);
    expect(terminalStatus, "Scan must finish with COMPLETED, not ERROR").toBe("COMPLETED");

    // Navigate to the source detail to record source ID for cleanup
    const sourceDetailsBtn = page.getByRole("button", { name: "Source Details" });
    if (await sourceDetailsBtn.isVisible()) {
      await sourceDetailsBtn.click();
      await page.waitForURL(/\/sources\/[a-z0-9-]+$/, { timeout: 10_000 });
    } else {
      await page.goto("/sources");
      await page.getByText(sourceName).click();
      await page.waitForURL(/\/sources\/[a-z0-9-]+$/, { timeout: 10_000 });
    }

    const sourceId = sourceIdFromUrl(page);
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
