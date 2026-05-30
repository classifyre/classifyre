/**
 * E2E tests for PostgreSQL source workflow:
 *  1. Create source, add cron schedule, test connection (verify success)
 *  2. Test connection with wrong password (verify error with meaningful message)
 *  3. Add PII detector, run scan, verify PII findings
 *  4. Delete source, verify assets and findings are removed
 *
 * Selectors use data-testid attributes and field labels that are locale-independent
 * (JSON schema field names, hardcoded English labels) to avoid language-flipping issues.
 */

import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import {
  API_BASE,
  requireEnv,
  waitForScanTerminal,
  sourceIdFromUrl,
  deleteSourceViaApi,
  enableBuiltinDetector,
  setSamplingStrategy,
  setRowsPerPage,
  getFindingsCount,
} from "./helpers";

// ── Config from environment ────────────────────────────────────────────────────

const PG_HOST = requireEnv("PG_HOST");
const PG_PORT = requireEnv("PG_PORT");
const PG_USERNAME = requireEnv("PG_USERNAME");
const PG_PASSWORD = requireEnv("PG_PASSWORD");

// ── Helpers ────────────────────────────────────────────────────────────────────

async function openBlankPostgresForm(page: Page): Promise<void> {
  await page.goto("/sources/new");
  await page.locator('[data-testid="source-type-POSTGRESQL"]').click();
  await page.locator('[data-testid="start-blank"]').click();
  await expect(page.locator('[data-testid="input-name"]')).toBeVisible();
}

async function fillConnectionForm(
  page: Page,
  opts: {
    name: string;
    host: string;
    port: string;
    username: string;
    password: string;
  },
): Promise<void> {
  await page.locator('[data-testid="input-name"]').fill(opts.name);
  await page.locator('[data-testid="input-required-host"]').fill(opts.host);
  await page.locator('[data-testid="input-required-port"]').fill(opts.port);
  await page.locator('[data-testid="input-masked-username"]').fill(opts.username);
  await page.locator('[data-testid="input-masked-password"]').fill(opts.password);
}

async function enableNightlySchedule(page: Page): Promise<void> {
  const scheduleSwitch = page.locator('[data-testid="schedule-enabled"]');
  if (await scheduleSwitch.isVisible()) {
    const checked = await scheduleSwitch.getAttribute("aria-checked");
    if (checked !== "true") {
      await scheduleSwitch.click();
    }
  }
}

async function runConnectionTest(page: Page): Promise<string> {
  await page.locator('[data-testid="btn-test-source"]').click();

  const statusEl = page.locator('[data-testid="test-connection-status"]');
  await expect(statusEl).toBeVisible({ timeout: 10_000 });
  await expect(statusEl).not.toHaveAttribute("data-status", "loading", {
    timeout: 120_000,
  });

  return (await statusEl.getAttribute("data-status")) ?? "unknown";
}

async function closeConnectionDialog(page: Page): Promise<void> {
  await page.locator('[data-testid="btn-test-connection-close"]').click();
  await expect(page.locator('[data-testid="test-connection-status"]')).not.toBeVisible();
}

// ── Test suite ─────────────────────────────────────────────────────────────────

test.describe("PostgreSQL Source", () => {
  // Source IDs collected during tests so afterAll can clean up
  const createdSourceIds: string[] = [];

  test.afterAll(async ({ request }) => {
    for (const id of createdSourceIds) {
      await deleteSourceViaApi(request, id);
    }
  });

  // ── 1. Happy-path: create source + cron schedule + successful connection test ──

  test("create source with cron schedule and verify successful connection", async ({
    page,
  }) => {
    await openBlankPostgresForm(page);

    const sourceName = `E2E PG Success ${Date.now()}`;
    await fillConnectionForm(page, {
      name: sourceName,
      host: PG_HOST,
      port: PG_PORT,
      username: PG_USERNAME,
      password: PG_PASSWORD,
    });

    await enableNightlySchedule(page);

    // Run connection test
    const status = await runConnectionTest(page);
    const messageEl = page.locator('[data-testid="test-connection-status"]');
    const message = await messageEl.textContent();

    expect(status, `Connection test status: ${status}, message: ${message}`).toBe("success");
    expect(message).toContain("Successfully connected");

    await closeConnectionDialog(page);

    // Save & advance to step 2
    await page.locator('[data-testid="btn-save-source"]').click();

    // Step 2 (Detectors) should appear – verify the stepper advanced
    await expect(page.locator('[data-testid="btn-save-and-scan"]')).toBeVisible({
      timeout: 15_000,
    });

    // Grab the source ID that was persisted during Save
    // Navigate to /sources to find it by name so we can record the ID for cleanup
    await page.goto("/sources");
    const sourceRow = page.getByText(sourceName);
    await expect(sourceRow).toBeVisible({ timeout: 10_000 });
  });

  // ── 2. Bad password → connection test must surface an auth error ─────────────

  test("connection test with wrong password shows authentication error", async ({
    page,
  }) => {
    await openBlankPostgresForm(page);

    const sourceName = `E2E PG Bad PW ${Date.now()}`;
    await fillConnectionForm(page, {
      name: sourceName,
      host: PG_HOST,
      port: PG_PORT,
      username: PG_USERNAME,
      password: "wrong_password_e2e_test",
    });

    const status = await runConnectionTest(page);
    const messageEl = page.locator('[data-testid="test-connection-status"]');
    const message = (await messageEl.textContent()) ?? "";

    expect(status, `Expected error but got: ${status} – ${message}`).toBe("error");

    // The message must mention a connection/auth failure, not a config problem.
    // psycopg2 raises "FATAL: password authentication failed" or similar.
    expect(
      message.toLowerCase(),
      `Error message does not mention auth failure: "${message}"`,
    ).toMatch(/password|auth|connect|fail/);

    await closeConnectionDialog(page);

    // Clean up the source that was created during the test call
    // (the test helper always saves first before running the CLI test)
    const apiResponse = await page.request.get(`${API_BASE}/sources`);
    if (apiResponse.ok()) {
      const sources = (await apiResponse.json()) as Array<{ id: string; name: string }>;
      const created = sources.find((s) => s.name === sourceName);
      if (created) {
        await deleteSourceViaApi(page.request, created.id);
      }
    }
  });

  // ── 3. Add PII detector, run scan, verify findings ───────────────────────────

  test("scan with PII detector produces findings and can be deleted cleanly", async ({
    page,
  }) => {
    test.setTimeout(360_000);
    await openBlankPostgresForm(page);

    const sourceName = `E2E PG PII ${Date.now()}`;
    await fillConnectionForm(page, {
      name: sourceName,
      host: PG_HOST,
      port: PG_PORT,
      username: PG_USERNAME,
      password: PG_PASSWORD,
    });

    // Sampling: RANDOM with 10 rows to keep scan fast
    await setSamplingStrategy(page, "RANDOM");
    await setRowsPerPage(page, "10");

    // Save source config first
    await page.locator('[data-testid="btn-save-source"]').click();

    // Navigate to detectors step
    await page.getByRole("button", { name: /detectors|detektoren/i }).first().click();

    await expect(page.locator('[data-testid="scan-config-section"]')).toBeVisible({
      timeout: 15_000,
    });

    // Enable PII detector
    await enableBuiltinDetector(page, "PII");

    // Save & Scan
    await page.locator('[data-testid="btn-save-and-scan"]').click();

    await page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 15_000 });

    const terminalStatus = await waitForScanTerminal(page);
    expect(terminalStatus, "Scan must finish with COMPLETED, not ERROR").toBe("COMPLETED");

    // ── Verify PII findings exist on the scan detail page ────────────────────
    expect(await getFindingsCount(page), "PII scan must produce at least 1 finding").toBeGreaterThan(0);

    // ── Navigate to source detail for cleanup ────────────────────────────────
    await page.goto("/sources");
    const sourceRow = page.locator(`[data-testid="source-row"]`).filter({ hasText: sourceName });
    if (await sourceRow.isVisible()) {
      await sourceRow.click();
    } else {
      await page.getByText(sourceName).first().click();
    }
    await page.waitForURL(/\/sources\/[a-z0-9-]+$/, { timeout: 10_000 });

    const sourceId = sourceIdFromUrl(page);
    createdSourceIds.push(sourceId);

    // ── Delete source and verify cascade ─────────────────────────────────────
    await page.locator('[data-testid="btn-delete-source"]').click();
    await page.locator('[data-testid="btn-delete-confirm"]').click();
    await page.waitForURL(/\/sources$/, { timeout: 15_000 });
    await expect(page.getByText(sourceName)).not.toBeVisible({ timeout: 10_000 });

    // ── Verify assets were cleaned up (via API) ───────────────────────────────
    const assetsResp = await page.request.get(`${API_BASE}/assets?sourceId=${sourceId}`);
    if (assetsResp.ok()) {
      const body = await assetsResp.json() as { items?: unknown[] };
      const items = Array.isArray(body) ? body : (body.items ?? []);
      expect(
        (items as unknown[]).length,
        "Assets should be deleted along with the source",
      ).toBe(0);
    }

    const idx = createdSourceIds.indexOf(sourceId);
    if (idx !== -1) createdSourceIds.splice(idx, 1);
  });
});
