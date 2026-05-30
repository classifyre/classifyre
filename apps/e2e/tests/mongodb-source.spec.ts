import { test, expect, type Page } from "@playwright/test";
import {
  requireEnv,
  deleteSourceViaApi,
  enableBuiltinDetector,
  setSamplingStrategy,
  setRowsPerPage,
  expandOptionalSection,
  getFindingsCount,
  sourceIdFromUrl,
} from "./helpers";

// ── Environment ───────────────────────────────────────────────────────────────

const MONGO_HOST = requireEnv("MONGO_HOST");
const MONGO_USERNAME = requireEnv("MONGO_USERNAME");
const MONGO_PASSWORD = requireEnv("MONGO_PASSWORD");
const MONGO_DATABASE = requireEnv("MONGO_DATABASE");
const MONGO_COLLECTION = requireEnv("MONGO_COLLECTION");

// ── Page object ────────────────────────────────────────────────────────────────

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
    await expandOptionalSection(this.page);
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
    await setSamplingStrategy(this.page, strategy);
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

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe("MongoDB Source", () => {
  const createdSourceIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of createdSourceIds) {
      await deleteSourceViaApi(request, id);
    }
  });

  test("should fill MongoDB source form, test connection, scan with PII, and verify findings", async ({ page }) => {
    test.setTimeout(420_000);

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

    await form.selectSamplingStrategy("RANDOM");
    await setRowsPerPage(page, "10");

    const connStatus = await form.testConnection();
    expect(connStatus, "Connection test should pass").toBe("success");

    await page.locator('[data-testid="btn-save-source"]').click();

    // Navigate to detectors step via visible stepper button
    await page.getByRole("button", { name: /detectors|detektoren/i }).first().click();
    await expect(page.locator('[data-testid="scan-config-section"]')).toBeVisible({ timeout: 15_000 });

    await enableBuiltinDetector(page, "PII");

    await page.locator('[data-testid="btn-save-and-scan"]').click();
    await page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 15_000 });

    // Wait for scan to complete via status badge
    const badge = page.locator('[data-testid="scan-status-badge"]');
    await expect(badge).toBeVisible({ timeout: 30_000 });
    await expect(badge).toHaveText(/Completed|Error|Abgeschlossen|Fehler|Warning|Warnung/i, { timeout: 300_000 });
    const badgeText = (await badge.textContent()) ?? "";
    expect(/error|fehler/i.test(badgeText) ? "ERROR" : "COMPLETED", "Scan must finish with COMPLETED").toBe("COMPLETED");

    expect(await getFindingsCount(page), "PII scan must produce at least 1 finding").toBeGreaterThan(0);

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
