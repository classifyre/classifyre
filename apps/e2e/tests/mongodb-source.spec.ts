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

  async enableDetector(detector: string) {
    const toggle = this.page.locator(`[data-testid="detector-toggle-${detector}"]`);
    await toggle.scrollIntoViewIfNeeded();
    if ((await toggle.getAttribute("data-state")) !== "on") {
      await toggle.click();
    }
  }

  async customizeDetector(detector: string, options: string[]) {
    const customizeBtn = this.page.locator(`[data-testid="btn-customize-${detector}"]`);
    await customizeBtn.scrollIntoViewIfNeeded();
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
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    await this.page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 60_000 });
  }
}

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

// ── Custom Detector Page Helper ────────────────────────────────────────────────

class CustomDetectorPage {
  constructor(private readonly page: Page) {}

  async navigateToNew() {
    await this.page.goto("/detectors/new");
  }

  /** Click the "Start Blank" card for the given method section */
  async selectBlankStarter(method: "CLASSIFIER" | "RULESET" | "ENTITY") {
    await this.page
      .locator(`[data-testid="starter-card-${method}-blank"]`)
      .click();
  }

  async fillName(name: string) {
    await this.page.locator('[data-testid="input-detector-name"]').fill(name);
  }

  async fillKey(key: string) {
    await this.page.locator('[data-testid="input-detector-key"]').fill(key);
  }

  async fillClassifierLabels(labels: string[]) {
    await this.page
      .locator('[data-testid="textarea-classifier-labels"]')
      .fill(labels.join("\n"));
  }

  async fillHypothesisTemplate(template: string) {
    await this.page
      .locator('[data-testid="input-classifier-hypothesis"]')
      .fill(template);
  }

  async save() {
    const btn = this.page.locator('[data-testid="btn-save-detector"]');
    await btn.scrollIntoViewIfNeeded();
    await btn.click();
    // After save in create mode the page redirects to /detectors/{id}
    await this.page.waitForURL(/\/detectors\/[a-z0-9-]+$/, { timeout: 30_000 });
  }

  /**
   * Add a single classifier test scenario.
   *
   * btn-show-add-test TOGGLES the form (setShowAddForm(v => !v)), so we must
   * only click it when the form is closed. After saving we wait for the
   * btn-save-test-scenario button to disappear, which confirms the form
   * actually closed and the API call completed — NOT for btn-show-add-test
   * (which is always visible).
   */
  async addTestScenario(name: string, inputText: string, label: string, minConfidence?: string) {
    // Ensure the form is closed before opening it
    const saveBtn = this.page.locator('[data-testid="btn-save-test-scenario"]');
    if (await saveBtn.isVisible()) {
      // Form is already open from a previous call — close it first
      await this.page.locator('[data-testid="btn-show-add-test"]').click();
      await saveBtn.waitFor({ state: "hidden" });
    }

    await this.page.locator('[data-testid="btn-show-add-test"]').click();
    // Wait for the form to actually appear
    await saveBtn.waitFor({ state: "visible" });

    await this.page.locator('[data-testid="input-test-name"]').fill(name);
    await this.page.locator('[data-testid="textarea-test-input"]').fill(inputText);
    await this.page.locator('[data-testid="input-test-label"]').fill(label);
    if (minConfidence !== undefined) {
      await this.page.locator('[data-testid="input-test-confidence"]').fill(minConfidence);
    }
    await saveBtn.click();
    // Wait for the form to close — this is the reliable indicator that the
    // API call finished and the scenario list refreshed
    await saveBtn.waitFor({ state: "hidden", timeout: 15_000 });
  }

  /**
   * Run all test scenarios and return counts.
   *
   * Clicks "Run All Tests", waits for the button to re-enable (disabled while
   * NLI inference runs — can take 1–5 min on a cold model), then reads the
   * test-run-summary data attributes that the React component renders once
   * runResults is populated.
   */
  async runAllTests(timeout = 600_000) {
    const runBtn = this.page.locator('[data-testid="btn-run-all-tests"]');
    await runBtn.click();

    // Wait for the button to re-enable — this is the only reliable signal that
    // the synchronous /run request has finished (the backend runs all scenarios
    // serially and returns the full results in the 201 body).
    await expect(runBtn).toBeEnabled({ timeout });

    // The React component sets runResults from the response, which causes
    // test-run-summary to render. Give it a generous timeout for the state update.
    const summary = this.page.locator('[data-testid="test-run-summary"]');
    await expect(summary).toBeVisible({ timeout: 15_000 });
    const passed = Number(await summary.getAttribute("data-passed") ?? "0");
    const failed = Number(await summary.getAttribute("data-failed") ?? "0");
    const errored = Number(await summary.getAttribute("data-errored") ?? "0");
    return { passed, failed, errored };
  }

  async delete() {
    await this.page.locator('[data-testid="btn-delete-detector"]').click();
    await this.page.locator('[data-testid="btn-delete-detector-confirm"]').click();
    await expect(this.page).toHaveURL(/\/detectors$/, { timeout: 30_000 });
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

  test("should create European country classifier, verify with test scenarios, apply to MongoDB scan and detect findings", async ({ page }) => {
    test.setTimeout(1_800_000);

    const detector = new CustomDetectorPage(page);
    const form = new SourceFormPage(page);
    const scan = new ScanDetailPage(page);

    const ts = Date.now();
    const detectorKey = `e2e_eu_country_${ts}`;
    const detectorName = `E2E EU Country Classifier ${ts}`;
    const sourceName = `E2E-Mongo-Classifier-${ts}`;

    // ── 1. Create CLASSIFIER detector ─────────────────────────────────────────

    await test.step("Create CLASSIFIER detector", async () => {
      await detector.navigateToNew();
      await detector.selectBlankStarter("CLASSIFIER");

      await detector.fillName(detectorName);
      await detector.fillKey(detectorKey);
      await detector.fillClassifierLabels(["European country", "Non-European country"]);
      await detector.fillHypothesisTemplate("This text is about a {}.");

      await detector.save();
    });

    // ── 2. Add test scenarios ─────────────────────────────────────────────────

    await test.step("Add classification test scenarios", async () => {
      await detector.addTestScenario(
        "Germany is European",
        "Germany is a country located in the heart of Europe.",
        "European country",
      );
      await detector.addTestScenario(
        "France is European",
        "France shares borders with Belgium, Germany, and Spain in Western Europe.",
        "European country",
      );
      await detector.addTestScenario(
        "Italy is European",
        "Italy is a southern European country known for its Roman history and the Mediterranean coast.",
        "European country",
      );
      await detector.addTestScenario(
        "Spain is European",
        "Spain occupies most of the Iberian Peninsula in southwestern Europe.",
        "European country",
      );
    });

    // ── 3. Run test scenarios and assert all pass ──────────────────────────────

    await test.step("Run test scenarios — verify zero-shot classification", async () => {
      const { passed, failed, errored } = await detector.runAllTests();
      expect(errored, "No test scenarios should error").toBe(0);
      expect(failed, "All classification test scenarios should pass").toBe(0);
      expect(passed, "All 4 classification test scenarios should pass").toBe(4);
    });

    // ── 4. Create MongoDB source with this classifier enabled ──────────────────

    await test.step("Create MongoDB source with classifier detector enabled", async () => {
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

      const classifierToggle = page.locator(`[data-testid="toggle-custom-detector-${detectorKey}"]`);
      await classifierToggle.scrollIntoViewIfNeeded();
      if ((await classifierToggle.getAttribute("data-state")) !== "on") {
        await classifierToggle.click();
      }
    });

    // ── 5. Save and run scan ───────────────────────────────────────────────────

    await test.step("Save source and start scan", async () => {
      await form.saveAndScan();
    });

    // ── 6. Verify scan results ─────────────────────────────────────────────────

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

    // ── 7. Cleanup ─────────────────────────────────────────────────────────────

    await test.step("Cleanup — delete source and detector", async () => {
      await page.getByRole("button", { name: "Source Details" }).click();
      await page.locator('[data-testid="btn-delete-source"]').click();
      await page.locator('[data-testid="btn-delete-confirm"]').click();
      await expect(page).toHaveURL(/\/sources$/, { timeout: 30_000 });

      await page.goto("/detectors");
      await page.getByRole("link", { name: detectorName }).click();
      await detector.delete();
    });
  });
});
