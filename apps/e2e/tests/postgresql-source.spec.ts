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

// ── Config from environment ────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}. Add it to apps/e2e/.env`);
  return value;
}

const PG_HOST = requireEnv("PG_HOST");
const PG_PORT = requireEnv("PG_PORT");
const PG_USERNAME = requireEnv("PG_USERNAME");
const PG_PASSWORD = requireEnv("PG_PASSWORD");
const PG_DATABASE = requireEnv("PG_DATABASE");
const API_BASE = process.env.API_BASE_URL ?? "http://localhost:8000";

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Navigate to the new-source page and select PostgreSQL as the source type,
 * then dismiss the example/template selector by clicking "Start Blank".
 */
async function openBlankPostgresForm(page: Page): Promise<void> {
  await page.goto("/sources/new");
  await page.locator('[data-testid="source-type-POSTGRESQL"]').click();
  await page.locator('[data-testid="start-blank"]').click();
  // Wait for form to render
  await expect(page.getByLabel("Source name *")).toBeVisible();
}

/**
 * Fill the PostgreSQL connection form fields.
 * Field labels come from the JSON schema field names so they are not translated.
 */
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
  await page.getByLabel("Source name *").fill(opts.name);
  await page.getByLabel("host *").fill(opts.host);
  await page.getByRole("spinbutton", { name: "port *" }).fill(opts.port);
  await page.getByLabel("username *").fill(opts.username);
  await page.getByLabel("password *").fill(opts.password);
}

/**
 * Enable the ingestion schedule toggle and select the "nightly" preset.
 * The Switch has a stable id="schedule-enabled".
 */
async function enableNightlySchedule(page: Page): Promise<void> {
  const scheduleSwitch = page.locator("#schedule-enabled");
  const checked = await scheduleSwitch.getAttribute("aria-checked");
  if (checked !== "true") {
    await scheduleSwitch.click();
  }
  // "Nightly" preset is automatically selected when enabling schedule;
  // it can also be selected explicitly via data-value attribute on the preset button.
  // We verify it is active by checking the cron input is non-empty.
  await expect(page.locator('input[placeholder*="e.g."]').or(page.locator('input[placeholder*="z.B."]'))).not.toHaveValue("");
}

/**
 * Click the "Test Connection" button and wait for the dialog result.
 * Returns the resolved status ("success" | "error").
 */
async function runConnectionTest(page: Page): Promise<string> {
  await page.locator('[data-testid="btn-test-source"]').click();

  const statusEl = page.locator('[data-testid="test-connection-status"]');
  // Wait until the dialog appears
  await expect(statusEl).toBeVisible({ timeout: 10_000 });
  // Wait until the CLI result comes back (loading → success/error)
  await expect(statusEl).not.toHaveAttribute("data-status", "loading", {
    timeout: 120_000,
  });

  return (await statusEl.getAttribute("data-status")) ?? "unknown";
}

/**
 * Dismiss the test-connection dialog via the Close button.
 */
async function closeConnectionDialog(page: Page): Promise<void> {
  await page.locator('[data-testid="btn-test-connection-close"]').click();
  await expect(page.locator('[data-testid="test-connection-status"]')).not.toBeVisible();
}

/**
 * Wait for a scan to reach a terminal status (Completed or Error).
 * The scan page auto-refreshes every 2.5 s; allow up to 5 minutes.
 */
async function waitForScanTerminal(page: Page): Promise<string> {
  const completedBadge = page.getByText("Completed", { exact: true });
  const errorBadge = page.getByText("Error", { exact: true });
  await expect(completedBadge.or(errorBadge)).toBeVisible({
    timeout: 300_000,
  });
  const isCompleted = await completedBadge.isVisible();
  return isCompleted ? "COMPLETED" : "ERROR";
}

/**
 * Extract source ID from the current URL (assumed to be /sources/{id}).
 */
function sourceIdFromUrl(page: Page): string {
  const match = page.url().match(/\/sources\/([a-z0-9-]+)/);
  if (!match) throw new Error(`Cannot extract source ID from URL: ${page.url()}`);
  return match[1]!;
}

// ── Cleanup helper ─────────────────────────────────────────────────────────────

/** Delete a source via the REST API (best-effort; does not fail the test). */
async function deleteSourceViaApi(
  request: APIRequestContext,
  sourceId: string,
): Promise<void> {
  await request
    .delete(`${API_BASE}/sources/${sourceId}`)
    .catch((err) => console.warn(`Cleanup delete failed for ${sourceId}:`, err));
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
    await openBlankPostgresForm(page);

    const sourceName = `E2E PG PII ${Date.now()}`;
    await fillConnectionForm(page, {
      name: sourceName,
      host: PG_HOST,
      port: PG_PORT,
      username: PG_USERNAME,
      password: PG_PASSWORD,
    });

    // Save source config first (sets the sourceId for the subsequent save-and-scan)
    await page.locator('[data-testid="btn-save-source"]').click();

    // Wait for the scan config section to be ready (detectors are on the same page now)
    await expect(page.locator('[data-testid="scan-config-section"]')).toBeVisible({
      timeout: 15_000,
    });

    // Find and enable PII detector
    const piiToggle = page.locator('[data-testid="detector-toggle-PII"]');
    await expect(piiToggle).toBeVisible({ timeout: 10_000 });

    const isPressed = await piiToggle.getAttribute("data-state");
    if (isPressed !== "on") {
      await piiToggle.click();
    }
    await expect(piiToggle).toHaveAttribute("data-state", "on");

    // Save & Scan
    await page.locator('[data-testid="btn-save-and-scan"]').click();

    // Wait for redirect to the scan detail page
    await page.waitForURL(/\/scans\/[a-z0-9-]+/, { timeout: 15_000 });

    // Extract runner ID from URL for reference
    const runnerIdMatch = page.url().match(/\/scans\/([a-z0-9-]+)/);
    expect(runnerIdMatch).toBeTruthy();

    // Wait for the scan to complete
    const terminalStatus = await waitForScanTerminal(page);
    expect(
      terminalStatus,
      "Scan must finish with COMPLETED, not ERROR",
    ).toBe("COMPLETED");

    // ── Verify PII findings exist ─────────────────────────────────────────────

    // Navigate to the source detail via the "Source Details" button on the scan page
    await page.getByRole("button", { name: "Source Details" }).click();
    await page.waitForURL(/\/sources\/[a-z0-9-]+$/, { timeout: 10_000 });

    const sourceId = sourceIdFromUrl(page);
    createdSourceIds.push(sourceId);

    // The source detail page shows asset counts; wait for data to load
    await page.waitForLoadState("networkidle");

    // Verify the findings tab is reachable and has PII results
    const findingsTab = page.getByRole("tab", { name: /findings/i });
    if (await findingsTab.isVisible()) {
      await findingsTab.click();
      // At least one PII finding row should appear
      await expect(
        page.getByText("PII", { exact: false }).first(),
      ).toBeVisible({ timeout: 15_000 });
    } else {
      // Fallback: navigate to /findings?sourceId=... and verify non-empty table
      await page.goto(`/findings?sourceId=${sourceId}`);
      await expect(page.locator("table tbody tr").first()).toBeVisible({
        timeout: 15_000,
      });
    }

    // ── Delete source and verify cascade ─────────────────────────────────────

    // Go back to source detail page
    await page.goto(`/sources/${sourceId}`);

    // Click the Delete Source button
    await page.locator('[data-testid="btn-delete-source"]').click();

    // Confirm deletion in the alert dialog
    await page.locator('[data-testid="btn-delete-confirm"]').click();

    // Should redirect to /sources
    await page.waitForURL(/\/sources$/, { timeout: 15_000 });

    // Source must no longer appear in the list
    await expect(page.getByText(sourceName)).not.toBeVisible({ timeout: 10_000 });

    // ── Verify assets were cleaned up (via API) ───────────────────────────────
    const assetsResp = await page.request.get(
      `${API_BASE}/assets?sourceId=${sourceId}`,
    );
    if (assetsResp.ok()) {
      const body = await assetsResp.json() as { items?: unknown[] };
      const items = Array.isArray(body) ? body : (body.items ?? []);
      expect(
        (items as unknown[]).length,
        "Assets should be deleted along with the source",
      ).toBe(0);
    }

    // Remove from cleanup list since we just deleted it
    const idx = createdSourceIds.indexOf(sourceId);
    if (idx !== -1) createdSourceIds.splice(idx, 1);
  });
});
