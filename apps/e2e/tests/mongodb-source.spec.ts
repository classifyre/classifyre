import { test, expect, type Page } from "@playwright/test";

// ── Environment ───────────────────────────────────────────────────────────────

const MONGO_HOST = process.env.MONGO_HOST!;
const MONGO_USERNAME = process.env.MONGO_USERNAME!;
const MONGO_PASSWORD = process.env.MONGO_PASSWORD!;
const MONGO_DATABASE = process.env.MONGO_DATABASE!;
const MONGO_COLLECTION = process.env.MONGO_COLLECTION!;

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

  async goToDetectorsStep() {
    // The source form now uses a stepper; detectors are on step 2.
    // Click the stepper nav button to scroll the detectors section into view.
    await this.page.getByRole("button", { name: /detektoren/i }).click();
    // Wait for the scan-config section to be visible
    await expect(this.page.locator('[data-testid="scan-config-section"]')).toBeVisible({
      timeout: 10_000,
    });
  }

  async enableDetector(detector: string) {
    const enableBtn = this.page.locator(`[data-testid="detector-enable-${detector}"]`);
    if (await enableBtn.isVisible()) {
      await enableBtn.click();
    }
    const toggle = this.page.locator(`[data-testid="detector-toggle-${detector}"]`);
    if ((await toggle.getAttribute("data-state")) !== "on") {
      await toggle.click();
    }
  }

  async customizeDetector(detector: string, options: string[]) {
    const customizeBtn = this.page.locator(`[data-testid="btn-customize-${detector}"]`);
    await customizeBtn.click();
    for (const option of options) {
      const toggle = this.page.locator(`[data-testid="toggle-option-${option}"]`);
      if ((await toggle.getAttribute("data-state")) !== "on") {
        await toggle.click();
      }
    }
    await this.page.keyboard.press("Escape");
  }

  async saveAndScan() {
    const btn = this.page.locator('[data-testid="btn-save-and-scan"]');
    await btn.click();
    await this.page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 60_000 });
  }
}

class ScanDetailPage {
  constructor(private readonly page: Page) {}

  async waitForCompletion(timeout = 1_500_000) {
    const badge = this.page.locator('[data-testid="scan-status-badge"]');
    // Match English (Completed/Error) and German (Abgeschlossen/Fehler)
    await expect(badge).toHaveText(/Completed|Error|Abgeschlossen|Fehler/i, {
      timeout,
    });
    const text = await badge.textContent();
    if (/error|fehler/i.test(text ?? "")) {
      throw new Error("Scan finished with ERROR status");
    }
    expect(text).toMatch(/completed|abgeschlossen/i);
  }

  async getStatsValue(label: string) {
    const cardId = `stats-card-${label.toLowerCase().replace(/ \+ /g, "-")}`;
    return await this.page.locator(`[data-testid="${cardId}"] [data-testid="stats-value"]`).textContent();
  }

  async switchToTab(tab: "findings" | "assets" | "logs") {
    await this.page.locator(`[data-testid="tab-${tab}"]`).click();
  }

  getAssetRows() {
    return this.page.locator('[data-testid="asset-row"]');
  }

  getFindingRows() {
    return this.page.locator('[data-testid="finding-row"]');
  }
}

// ── Test ───────────────────────────────────────────────────────────────────────

test.describe("MongoDB Source E2E", () => {
  test("should create MongoDB source, run scan and verify results in UI", async ({ page }) => {
    test.setTimeout(1_800_000);

    const form = new SourceFormPage(page);
    const scan = new ScanDetailPage(page);

    const sourceName = `E2E-Mongo-${Date.now()}`;

    // 1. Create Source
    await form.navigateToNew();
    await form.selectType("MONGODB");
    await form.startBlank();
    
    await form.fillBasicInfo(sourceName);
    
    // Config Required: Atlas
    await form.selectRequiredOption("MongoDBRequiredAtlas");
    await form.fillRequiredField("cluster_host", MONGO_HOST);

    // Config Masked: Username/Password
    await form.selectMaskedOption("MongoDBMaskedUsernamePassword");
    await form.fillMaskedField("username", MONGO_USERNAME);
    await form.fillMaskedField("password", MONGO_PASSWORD);

    // Config Optional
    await form.expandOptional();
    await form.fillOptionalField("scope", "database", MONGO_DATABASE);
    await form.addAndFillOptionalArrayField("scope", "include_collections", MONGO_COLLECTION);

    // Sampling: Use ALL
    await form.selectSamplingStrategy("ALL");

    // Test Connection
    const connStatus = await form.testConnection();
    expect(connStatus, "Connection test should pass").toBe("success");

    // 2. Configure Detectors
    await form.enableDetector("PII");
    await form.customizeDetector("PII", ["email", "phone_number", "credit_card", "ssn"]);

    // 3. Save and Scan
    await form.saveAndScan();

    // 4. Verify Results
    await scan.waitForCompletion();

    // Verify stats
    const findingsCountStr = await scan.getStatsValue("Findings");
    expect(Number(findingsCountStr?.replace(/,/g, ""))).toBeGreaterThan(0);

    const assetsCountStr = await scan.getStatsValue("Assets");
    expect(Number(assetsCountStr?.replace(/,/g, ""))).toBeGreaterThan(0);

    // Verify Tabs
    await scan.switchToTab("assets");
    await expect(scan.getAssetRows()).not.toHaveCount(0, { timeout: 30_000 });
    
    await scan.switchToTab("findings");
    await expect(scan.getFindingRows()).not.toHaveCount(0, { timeout: 30_000 });

    await expect(page.locator('[data-testid="finding-type"]').first()).toBeVisible();
    
    // Cleanup
    await page.getByRole("button", { name: "Source Details" }).click();
    await page.locator('[data-testid="btn-delete-source"]').click();
    await page.locator('[data-testid="btn-delete-confirm"]').click();
    await expect(page).toHaveURL(/\/sources$/, { timeout: 30_000 });
  });

  test("should create transformer text-classification detector and apply to MongoDB scan", async ({ page }) => {
    test.setTimeout(1_800_000);

    const form = new SourceFormPage(page);
    const scan = new ScanDetailPage(page);

    const ts = Date.now();
    const detectorKey = `e2e_sentiment_${ts}`;
    const detectorName = `E2E Sentiment ${ts}`;
    const sourceName = `E2E-Mongo-Sentiment-${ts}`;
    let detectorId: string | null = null;

    // ── 1. Create text-classification transformer detector ────────────────────

    await test.step("Create transformer text-classification detector", async () => {
      await page.goto("/detectors/new");

      await expect(
        page.locator('[data-testid="method-card-text_classification"]'),
      ).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="method-card-text_classification"]').click();

      await expect(page.locator('[data-testid="start-blank"]')).toBeVisible({ timeout: 10_000 });
      await page.locator('[data-testid="start-blank"]').click();

      await expect(page.locator('#tx-name')).toBeVisible({ timeout: 10_000 });

      await page.locator('#tx-name').fill(detectorName);
      await page.locator('#tx-key').fill(detectorKey);
      await page.locator('#tx-description').fill("E2E sentiment detector for MongoDB scan");
      await page.locator('#tx-model').fill(
        "distilbert/distilbert-base-uncased-finetuned-sst-2-english",
      );
      await page.locator('#tx-conf').fill("0.5");

      // Add severity rule: POSITIVE → high
      await page.evaluate(() => {
        const el = document.getElementById("section-severity");
        el?.scrollIntoView({ behavior: "instant", block: "center" });
      });
      await page.locator("#section-severity").locator('input[placeholder*="label"]').first().fill("POSITIVE");
      await page.locator("#section-severity").locator('button[role="combobox"]').first().click();
      await page.getByRole("option", { name: "high" }).click();

      const submitBtn = page.locator("button", { hasText: /create/i }).or(page.locator("button", { hasText: /erstellen/i })).first();
      await expect(submitBtn).not.toBeDisabled({ timeout: 10_000 });
      await submitBtn.click();

      await page.waitForURL(/\/detectors\/[0-9a-f-]{36}$/, { timeout: 20_000 });
      const match = page.url().match(/\/detectors\/([0-9a-f-]{36})/);
      detectorId = match?.[1] ?? null;
      expect(detectorId, "Detector ID must be a UUID in URL after create").not.toBeNull();
    });

    // ── 2. Create MongoDB source with transformer detector enabled ─────────────

    await test.step("Create MongoDB source with transformer detector enabled", async () => {
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
      await form.selectSamplingStrategy("ALL");

      const connStatus = await form.testConnection();
      expect(connStatus, "Connection test should pass").toBe("success");

      await form.goToDetectorsStep();

      const detectorToggle = page.locator(`[data-testid="toggle-custom-detector-${detectorKey}"]`);
      if ((await detectorToggle.getAttribute("data-state")) !== "on") {
        await detectorToggle.click();
      }
    });

    // ── 3. Save and run scan ───────────────────────────────────────────────────

    await test.step("Save source and start scan", async () => {
      await form.saveAndScan();
    });

    // ── 4. Verify scan results ─────────────────────────────────────────────────

    await test.step("Verify scan completed with findings", async () => {
      await scan.waitForCompletion();

      const findingsCountStr = await scan.getStatsValue("Findings");
      expect(Number(findingsCountStr?.replace(/,/g, "")), "Scan should have findings").toBeGreaterThan(0);

      const assetsCountStr = await scan.getStatsValue("Assets");
      expect(Number(assetsCountStr?.replace(/,/g, "")), "Scan should have assets").toBeGreaterThan(0);

      await scan.switchToTab("findings");
      await expect(scan.getFindingRows()).not.toHaveCount(0, { timeout: 30_000 });
      await expect(page.locator('[data-testid="finding-type"]').first()).toBeVisible();
    });

    // ── 5. Cleanup ─────────────────────────────────────────────────────────────

    await test.step("Cleanup — delete source and detector", async () => {
      await page.getByRole("button", { name: "Source Details" }).click();
      await page.locator('[data-testid="btn-delete-source"]').click();
      await page.locator('[data-testid="btn-delete-confirm"]').click();
      await expect(page).toHaveURL(/\/sources$/, { timeout: 30_000 });

      if (detectorId) {
        await page.goto(`/detectors/${detectorId}`);
        await page.locator('[data-testid="btn-delete-detector"]').click();
        await page.locator('[data-testid="btn-delete-detector-confirm"]').click();
        await page.waitForURL(/\/detectors$/, { timeout: 20_000 });
      }
    });
  });
});
