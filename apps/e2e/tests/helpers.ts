import { expect, type Page, type APIRequestContext } from "@playwright/test";

export const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8000";

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}. Add it to apps/e2e/.env`);
  return value;
}

export async function waitForScanTerminal(page: Page, timeout = 300_000): Promise<string> {
  const badge = page.locator('[data-testid="scan-status-badge"]');
  await expect(badge).toBeVisible({ timeout: 30_000 });
  await expect(badge).toHaveText(/Completed|Error|Abgeschlossen|Fehler|Warning|Warnung/i, { timeout });
  const text = (await badge.textContent()) ?? "";
  return /error|fehler/i.test(text) ? "ERROR" : "COMPLETED";
}

export function sourceIdFromUrl(page: Page): string {
  const match = page.url().match(/\/sources\/([a-z0-9-]+)/);
  if (!match) throw new Error(`Cannot extract source ID from URL: ${page.url()}`);
  return match[1]!;
}

export async function deleteSourceViaApi(
  request: APIRequestContext,
  sourceId: string,
): Promise<void> {
  await request
    .delete(`${API_BASE}/sources/${sourceId}`)
    .catch((err) => console.warn(`Cleanup delete failed for ${sourceId}:`, err));
}

export async function enableBuiltinDetector(page: Page, type: string): Promise<void> {
  const enableBtn = page.locator(`[data-testid="detector-enable-${type}"]`);
  if (await enableBtn.isVisible()) {
    await enableBtn.click();
  }
  const toggle = page.locator(`[data-testid="detector-toggle-${type}"]`);
  await expect(toggle).toBeVisible({ timeout: 10_000 });
  const state = await toggle.getAttribute("data-state");
  if (state !== "on") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("data-state", "on");
}

export async function setSamplingStrategy(page: Page, strategy: "RANDOM" | "LATEST" | "ALL"): Promise<void> {
  await page.locator(`[data-testid="sampling-strategy-${strategy}"]`).click();
}

export async function setRowsPerPage(page: Page, rows: string): Promise<void> {
  const trigger = page.locator('[data-testid="accordion-trigger-advanced-sampling"]');
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
  await page.locator('[data-testid="input-rows-per-page"]').fill(rows);
}

export async function expandOptionalSection(page: Page): Promise<void> {
  const trigger = page.locator('[data-testid="accordion-trigger-optional"]');
  if ((await trigger.getAttribute("aria-expanded")) !== "true") {
    await trigger.click();
  }
}

/**
 * Get the findings count from the first stats card on the scan detail page.
 * The first stats card is always "Findings" (locale-agnostic).
 */
export async function getFindingsCount(page: Page): Promise<number> {
  const card = page.locator('[data-testid^="stats-card-"]').first();
  const valueEl = card.locator('[data-testid="stats-value"]');
  await expect(valueEl).toBeVisible({ timeout: 15_000 });
  const text = (await valueEl.textContent()) ?? "0";
  return Number(text.replace(/,/g, ""));
}

/**
 * Wait for a scan to reach terminal status by polling the API directly.
 * Scans are stored as "runners" in the database; the API uses /runners/:id.
 */
export async function waitForScanCompleteApi(
  page: Page,
  timeout = 600_000,
): Promise<string> {
  const scanId = page.url().match(/\/scans\/([a-z0-9-]+)/)?.[1];
  if (!scanId) throw new Error(`Cannot extract scan ID from URL: ${page.url()}`);

  const start = Date.now();
  while (Date.now() - start < timeout) {
    const resp = await page.request.get(`${API_BASE}/runners/${scanId}`);
    if (!resp.ok()) {
      // fallback: reload and check badge
      await page.reload({ waitUntil: "networkidle" });
      const badge = page.locator('[data-testid="scan-status-badge"]');
      if (await badge.isVisible({ timeout: 5_000 }).catch(() => false)) {
        const text = (await badge.textContent()) ?? "";
        if (/Completed|Abgeschlossen|Warning|Warnung/i.test(text)) return "COMPLETED";
        if (/Error|Fehler/i.test(text)) return "ERROR";
      }
      await new Promise((r) => setTimeout(r, 10_000));
      continue;
    }

    const body = (await resp.json()) as { status?: string };
    const status = body.status;

    if (status === "COMPLETED" || status === "WARNING") return "COMPLETED";
    if (status === "ERROR") return "ERROR";

    await new Promise((r) => setTimeout(r, 10_000));
  }

  throw new Error(`Scan did not complete within ${timeout / 1000}s (last status was not terminal)`);
}

export class ScanDetailPage {
  constructor(private readonly page: Page) {}

  async waitForCompletion(timeout = 1_500_000) {
    const status = await waitForScanCompleteApi(this.page, timeout);
    if (status === "ERROR") {
      throw new Error("Scan finished with ERROR status");
    }
    return status;
  }

  async getStatsValue(cardTestId: string): Promise<string> {
    const el = this.page.locator(`[data-testid="${cardTestId}"] [data-testid="stats-value"]`);
    return (await el.textContent()) ?? "0";
  }

  async switchToTab(tab: string) {
    await this.page.locator(`[data-testid="tab-${tab}"]`).click();
  }

  getAssetRows() {
    return this.page.locator('[data-testid="asset-row"]');
  }
}
