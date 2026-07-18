/**
 * E2E tests for the transformer TEXT_CLASSIFICATION detector workflow:
 *
 *  1. Create a text-classification detector via the method-selection → editor flow
 *  2. Configure a lightweight DistilBERT model for sentiment analysis
 *  3. Save the detector → redirect to detail page
 *  4. Cleanup: delete the detector
 *
 * Uses a tiny model (distilbert-base-uncased-finetuned-sst-2-english).
 */

import { test, expect, type Page } from "@playwright/test";

// ── Helpers ────────────────────────────────────────────────────────────────────

function uniqueSuffix(): string {
  return Date.now().toString(36);
}

async function waitForToast(
  page: Page,
  pattern: string | RegExp,
): Promise<void> {
  await expect(
    page.locator("[data-sonner-toaster] li").filter({ hasText: pattern }),
  ).toBeVisible({ timeout: 30_000 });
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
    const methodCard = page.locator(
      '[data-testid="method-card-text_classification"]',
    );
    await expect(methodCard).toBeVisible({ timeout: 10_000 });
    await methodCard.click();

    // Choose "Start blank"
    const startBlank = page.locator('[data-testid="start-blank"]');
    await expect(startBlank).toBeVisible({ timeout: 10_000 });
    await startBlank.click();

    // Wait for transformer editor
    await expect(page.locator("#tx-name")).toBeVisible({ timeout: 10_000 });

    // Fill identity
    await page.locator("#tx-name").fill(detectorName);
    await page.locator("#tx-key").fill(detectorKey);
    await page
      .locator("#tx-description")
      .fill("E2E transformer sentiment classifier");

    // Fill model (small, fast DistilBERT)
    await page
      .locator("#tx-model")
      .fill("distilbert/distilbert-base-uncased-finetuned-sst-2-english");

    // Scroll submit button into view and click it
    // The sticky toolbar at the bottom contains the submit button
    const toolbar = page.locator(".sticky.bottom-0");
    await expect(toolbar).toBeVisible({ timeout: 5_000 });
    const submitBtn = toolbar.locator("button").last();
    await expect(submitBtn).not.toBeDisabled({ timeout: 10_000 });
    await submitBtn.click();

    // Wait for toast and redirect
    await waitForToast(page, /created|saved|erstellt|gespeichert/i);
    await page.waitForURL(/\/detectors\/[0-9a-f-]{36}$/, { timeout: 20_000 });

    const match = page.url().match(/\/detectors\/([0-9a-f-]{36})/);
    detectorId = match?.[1] ?? null;
    expect(
      detectorId,
      "Detector ID must be a UUID in URL after create",
    ).not.toBeNull();
  });

  // ── 2. Delete detector ─────────────────────────────────────────────────────

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
