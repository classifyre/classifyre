import { test, expect, type Page, type APIRequestContext } from "@playwright/test";

// ── Environment ───────────────────────────────────────────────────────────────

const MONGO_HOST = process.env.MONGO_HOST!;
const MONGO_USERNAME = process.env.MONGO_USERNAME!;
const MONGO_PASSWORD = process.env.MONGO_PASSWORD!;
const MONGO_DATABASE = process.env.MONGO_DATABASE!;
const MONGO_COLLECTION = process.env.MONGO_COLLECTION!;
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8000";

if (!MONGO_HOST || !MONGO_USERNAME || !MONGO_PASSWORD) {
  throw new Error("Missing MongoDB environment variables in apps/e2e/.env");
}

// ── Helpers ────────────────────────────────────────────────────────────────────

class SourceFormPage {
  constructor(private readonly page: Page) {}

  async navigateToNew() {
    await this.page.goto("/sources/new");
  }

  async selectType(type: "MONGODB") {
    await this.page.locator(`[data-testid="source-type-${type}"]`).click();
  }

  async startBlank() {
    await this.page.locator('[data-testid="start-blank"]').click();
  }

  async fillBasicInfo(name: string) {
    await this.page.locator('[data-testid="input-name"]').fill(name);
  }

  async selectRequiredOption(optionLabel: string) {
    await this.page.locator('[data-testid="select-mongodbrequired"]').click();
    await this.page.getByRole("option", { name: optionLabel }).click();
  }

  async fillRequiredField(fieldName: string, value: string) {
    const testId = `input-required-${fieldName.toLowerCase().replace(/_/g, "-")}`;
    await this.page.locator(`[data-testid="${testId}"]`).fill(value);
  }

  async selectMaskedOption(optionLabel: string) {
    await this.page.locator('[data-testid="select-mongodbmasked"]').click();
    await this.page.getByRole("option", { name: optionLabel }).click();
  }

  async fillMaskedField(fieldName: string, value: string) {
    const testId = `input-masked-${fieldName.toLowerCase().replace(/_/g, "-")}`;
    await this.page.locator(`[data-testid="${testId}"]`).fill(value);
  }

  async expandOptional() {
    const trigger = this.page.locator('[data-testid="accordion-trigger-optional"]');
    if ((await trigger.getAttribute("aria-expanded")) !== "true") {
      await trigger.click();
    }
  }

  async fillOptionalField(group: string, fieldName: string, value: string) {
    const testId = `input-optional-${group.toLowerCase()}-${fieldName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    await this.page.locator(`[data-testid="${testId}"]`).fill(value);
  }

  async addAndFillOptionalArrayField(group: string, fieldName: string, value: string, index = 0) {
    const fieldPath = `optional-${group.toLowerCase()}-${fieldName.toLowerCase().replace(/[^a-z0-9]/g, "-")}`;
    const addBtn = this.page.locator(`[data-testid="btn-add-${fieldPath}"]`);
    await addBtn.click();

    const inputId = `input-${fieldPath}-${index}`;
    await this.page.locator(`[data-testid="${inputId}"]`).fill(value);
  }

  async selectSamplingStrategy(strategy: "ALL" | "RANDOM" | "LATEST") {
    await this.page.locator(`[data-testid="sampling-strategy-${strategy}"]`).click();
  }

  async testConnection() {
    await this.page.locator('[data-testid="btn-test-source"]').click();
    const statusEl = this.page.locator('[data-testid="test-connection-status"]');
    await expect(statusEl).toBeVisible({ timeout: 30_000 });
    await expect(statusEl).not.toHaveAttribute("data-status", "loading", { timeout: 120_000 });
    const status = await statusEl.getAttribute("data-status");
    await this.page.locator('[data-testid="btn-test-connection-close"]').click();
    return status;
  }

}

async function waitForScanTerminal(page: Page, timeout = 300_000): Promise<string> {
  const badge = page.locator('[data-testid="scan-status-badge"]');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveText(/Completed|Error|Abgeschlossen|Fehler|Warning|Warnung/i, { timeout });
  const badgeText = (await badge.textContent()) ?? "";
  return /error|fehler/i.test(badgeText) ? "ERROR" : "COMPLETED";
}

function sourceIdFromUrl(page: Page): string {
  const match = page.url().match(/\/sources\/([a-z0-9-]+)/);
  if (!match) throw new Error(`Cannot extract source ID from URL: ${page.url()}`);
  return match[1]!;
}

async function deleteSourceViaApi(request: APIRequestContext, sourceId: string): Promise<void> {
  await request
    .delete(`${API_BASE}/sources/${sourceId}`)
    .catch((err) => console.warn(`Cleanup delete failed for ${sourceId}:`, err));
}

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe("MongoDB Source", () => {
  const createdSourceIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of createdSourceIds) {
      await deleteSourceViaApi(request, id);
    }
  });

  test("should fill MongoDB source form, test connection, scan with PII, and verify findings", async ({ page }) => {
    test.setTimeout(360_000);

    const form = new SourceFormPage(page);

    const sourceName = `E2E-Mongo-${Date.now()}`;

    await form.navigateToNew();
    await form.selectType("MONGODB");
    await form.startBlank();

    await form.fillBasicInfo(sourceName);

    await form.selectRequiredOption("MongoDBRequiredAtlas");
    await form.fillRequiredField("cluster_host", MONGO_HOST);

    await form.selectMaskedOption("MongoDBMaskedUsernamePassword");
    await form.fillMaskedField("username", MONGO_USERNAME);
    await form.fillMaskedField("password", MONGO_PASSWORD);

    await form.expandOptional();
    await form.fillOptionalField("scope", "database", MONGO_DATABASE);
    await form.addAndFillOptionalArrayField("scope", "include_collections", MONGO_COLLECTION);

    // Sampling: RANDOM with 10 rows to keep scan fast
    await form.selectSamplingStrategy("RANDOM");
    await page.locator('[data-testid="accordion-trigger-advanced-sampling"]').click();
    await page.locator('[data-testid="input-rows-per-page"]').fill("10");

    const connStatus = await form.testConnection();
    expect(connStatus, "Connection test should pass").toBe("success");

    // Save source config (advances to detectors step)
    await page.locator('[data-testid="btn-save-source"]').click();

    // Navigate to detectors step
    await page.locator('[data-testid="stepper-step-detectors"]').first().click();

    // Wait for the scan config section to be ready
    await expect(page.locator('[data-testid="scan-config-section"]')).toBeVisible({ timeout: 15_000 });

    // Enable PII detector
    const piiEnable = page.locator('[data-testid="detector-enable-PII"]');
    if (await piiEnable.isVisible()) {
      await piiEnable.click();
    }

    const piiToggle = page.locator('[data-testid="detector-toggle-PII"]');
    await expect(piiToggle).toBeVisible({ timeout: 10_000 });

    const isPressed = await piiToggle.getAttribute("data-state");
    if (isPressed !== "on") {
      await piiToggle.click();
    }
    await expect(piiToggle).toHaveAttribute("data-state", "on");

    // Save & Scan
    await page.locator('[data-testid="btn-save-and-scan"]').click();

    // Wait for redirect to scan detail page
    await page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 15_000 });

    // Wait for scan to complete
    const terminalStatus = await waitForScanTerminal(page);
    expect(terminalStatus, "Scan must finish with COMPLETED, not ERROR").toBe("COMPLETED");

    // Verify PII findings exist
    const findingsStats = page.locator('[data-testid="stats-card-findings"] [data-testid="stats-value"], [data-testid="stats-card-befunde"] [data-testid="stats-value"]');
    await expect(findingsStats).toBeVisible({ timeout: 10_000 });
    const findingsCount = Number((await findingsStats.textContent())?.replace(/,/g, ""));
    expect(findingsCount, "PII scan must produce at least 1 finding").toBeGreaterThan(0);

    // Navigate to source list and find the source for cleanup
    await page.goto("/sources");
    const sourceRow = page.getByText(sourceName);
    await expect(sourceRow).toBeVisible({ timeout: 10_000 });
    await sourceRow.click();
    await page.waitForURL(/\/sources\/[a-z0-9-]+$/, { timeout: 10_000 });
    const sourceId = sourceIdFromUrl(page);
    createdSourceIds.push(sourceId);
  });
});
