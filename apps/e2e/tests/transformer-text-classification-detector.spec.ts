/**
 * E2E tests for the transformer TEXT_CLASSIFICATION detector workflow:
 *
 *  1. Create a text-classification detector via the method-selection → editor flow
 *  2. Configure a lightweight DistilBERT model for sentiment analysis
 *  3. Save the detector → redirect to detail page
 *  4. Sandbox scan: upload a text snippet with mixed sentiment
 *     with the custom detector enabled → verify COMPLETED + findings appear
 *  5. Cleanup: delete the detector
 *
 * Uses a tiny model (distilbert-base-uncased-finetuned-sst-2-english) so the
 * sandbox scan is fast and reliable in CI.
 */

import { test, expect, type Page } from "@playwright/test";

// ── Helpers ────────────────────────────────────────────────────────────────────

function uniqueSuffix(): string {
  return Date.now().toString(36);
}

async function waitForToast(page: Page, pattern: string | RegExp): Promise<void> {
  await expect(
    page.locator("[data-sonner-toaster] li").filter({ hasText: pattern }),
  ).toBeVisible({ timeout: 30_000 });
}

async function waitForRunTerminal(page: Page, fileName: string): Promise<string> {
  const row = page
    .locator('[data-testid="sandbox-run-row"]')
    .filter({ hasText: fileName })
    .first();

  await expect(row).toBeVisible({ timeout: 30_000 });

  const statusBadge = row.locator('[data-testid="run-status-badge"]');
  await expect(statusBadge).toHaveAttribute(
    "data-status",
    /^(COMPLETED|ERROR)$/,
    { timeout: 300_000 },
  );
  return (await statusBadge.getAttribute("data-status")) ?? "UNKNOWN";
}

// ── Suite ──────────────────────────────────────────────────────────────────────

test.describe("Transformer Text Classification Detector", () => {
  let detectorId: string | null = null;
  const suffix = uniqueSuffix();
  const detectorName = `Sentiment E2E ${suffix}`;
  const detectorKey = `sentiment_e2e_${suffix}`;

  // Best-effort cleanup
  test.afterAll(async ({ browser }) => {
    if (!detectorId) return;
    const id = detectorId;
    const page = await browser.newPage();
    page.setDefaultTimeout(20_000);
    try {
      await page.goto(`/detectors/${id}`, { timeout: 15_000 });
      await page.locator('[data-testid="btn-delete-detector"]').click();
      await page.locator('[data-testid="btn-delete-detector-confirm"]').click();
      await page.waitForURL(/\/detectors$/, { timeout: 15_000 });
    } catch {
      // Best-effort — don't fail the suite
    } finally {
      await page.close();
    }
  });

  // ── 1. Create detector ─────────────────────────────────────────────────────

  test("creates a text-classification detector", async ({ page }) => {
    await page.goto("/detectors/new");

    // Select text_classification type
    const methodCard = page.locator('[data-testid="method-card-text_classification"]');
    await expect(methodCard).toBeVisible({ timeout: 10_000 });
    await methodCard.click();

    // Choose "Start blank"
    const startBlank = page.locator('[data-testid="start-blank"]');
    await expect(startBlank).toBeVisible({ timeout: 10_000 });
    await startBlank.click();

    // Wait for transformer editor
    await expect(page.locator('#tx-name')).toBeVisible({ timeout: 10_000 });

    // Fill identity
    await page.locator('#tx-name').fill(detectorName);
    await page.locator('#tx-key').fill(detectorKey);
    await page.locator('#tx-description').fill(
      "E2E transformer sentiment classifier",
    );

    // Fill model (small, fast DistilBERT)
    await page.locator('#tx-model').fill(
      "distilbert/distilbert-base-uncased-finetuned-sst-2-english",
    );

    // Scroll submit button into view and click it
    // The sticky toolbar at the bottom contains the submit button
    const toolbar = page.locator('.sticky.bottom-0');
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
    const submitBtn = toolbar.locator('button').last();
    await expect(submitBtn).not.toBeDisabled({ timeout: 10_000 });
    await submitBtn.click();

    // Wait for toast and redirect
    await waitForToast(page, /created|saved|erstellt|gespeichert/i);
    await page.waitForURL(/\/detectors\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const match = page.url().match(/\/detectors\/([0-9a-f-]{36})/);
    detectorId = match?.[1] ?? null;
    expect(detectorId, "Detector ID must be a UUID in URL after create").not.toBeNull();
  });

  // ── 2. Sandbox scan with custom detector ──────────────────────────────────

  test("runs a sandbox scan using the custom text-classification detector", async ({
    page,
  }) => {
    expect(detectorId, "Detector must exist").not.toBeNull();

    const fileName = `sentiment-scan-${Date.now()}.txt`;
    const scanText = `
This product is absolutely amazing and I love it!
The service was terrible and I am very disappointed.
I am extremely happy with the results so far.
What a horrible experience, I will never come back.
    `.trim();

    await page.goto("/sandbox/new");
    await expect(page.locator('[data-testid="file-upload-area"]')).toBeVisible();

    await page.locator('[data-testid="file-input"]').setInputFiles({
      name: fileName,
      mimeType: "text/plain",
      buffer: Buffer.from(scanText, "utf-8"),
    });

    await expect(page.locator('[data-testid="file-list"]')).toBeVisible({ timeout: 5_000 });

    // Enable the custom detector by its key
    const customToggle = page.locator(
      `[data-testid="toggle-custom-detector-${detectorKey}"]`,
    );
    await expect(customToggle).toBeVisible({ timeout: 15_000 });

    const isChecked = await customToggle.getAttribute("data-state");
    if (isChecked !== "checked" && isChecked !== "on") {
      await customToggle.click();
    }

    // Run the scan
    await expect(
      page.locator('[data-testid="btn-run-sandbox"]'),
    ).not.toBeDisabled({ timeout: 5_000 });
    await page.locator('[data-testid="btn-run-sandbox"]').click();
    await page.waitForURL(/\/sandbox$/, { timeout: 15_000 });

    // Wait for completion
    const status = await waitForRunTerminal(page, fileName);
    expect(status, "Scan must complete without error").toBe("COMPLETED");

    // Findings count must be > 0
    const row = page
      .locator('[data-testid="sandbox-run-row"]')
      .filter({ hasText: fileName })
      .first();

    const countBadge = row.locator('[data-testid="run-findings-count"]');
    await expect(countBadge).toBeVisible();
    const count = Number(await countBadge.getAttribute("data-count"));
    expect(count, "Expected at least one finding from text classifier").toBeGreaterThan(0);

    // Expand and verify at least one CUSTOM finding
    await row.click();
    const detail = page.locator('[data-testid="findings-detail"]').first();
    await expect(detail).toBeVisible({ timeout: 10_000 });

    const findingRows = detail.locator('[data-testid="finding-row"]');
    await expect(findingRows.first()).toBeVisible({ timeout: 10_000 });

    const allRows = await findingRows.all();
    const detectorTypes = await Promise.all(
      allRows.map((r) => r.getAttribute("data-detector-type")),
    );
    expect(
      detectorTypes.some((t) => t === "CUSTOM"),
      `Expected at least one CUSTOM finding. Got: ${detectorTypes.join(", ")}`,
    ).toBe(true);
  });

  // ── 3. Delete detector ─────────────────────────────────────────────────────

  test("deletes the detector and redirects to the list", async ({ page }) => {
    expect(detectorId, "Detector must exist").not.toBeNull();

    await page.goto(`/detectors/${detectorId}`);
    await expect(
      page.locator('[data-testid="btn-delete-detector"]'),
    ).toBeVisible({ timeout: 15_000 });

    await page.locator('[data-testid="btn-delete-detector"]').click();
    await expect(
      page.locator('[data-testid="btn-delete-detector-confirm"]'),
    ).toBeVisible({ timeout: 10_000 });
    await page.locator('[data-testid="btn-delete-detector-confirm"]').click();

    await page.waitForURL(/\/detectors$/, { timeout: 20_000 });
    detectorId = null;
  });
});
