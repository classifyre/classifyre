/**
 * Deep smoke test for a PACKAGED desktop build, run from OUTSIDE the repo.
 * Boots the app, waits for the shared workspace directory, creates a local
 * namespace through the web-owned flow, and waits for its first scoped API
 * request to succeed (registry + schema migration + tenant routing).
 *
 * CLASSIFYRE_APP_PATH=/path/to/binary npx tsx deep-smoke.ts
 */
import { _electron as electron } from 'playwright';
import fs from 'fs';
import os from 'os';
import path from 'path';

const appPath = process.env['CLASSIFYRE_APP_PATH'];
if (!appPath || !fs.existsSync(appPath)) {
  console.error(`CLASSIFYRE_APP_PATH not set or missing: ${appPath}`);
  process.exit(2);
}

// Linux CI: no SUID sandbox for arbitrary paths, no real GPU under xvfb.
const launchArgs =
  process.platform === 'linux'
    ? ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage']
    : [];

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifyre-deep-smoke-'));

async function main(): Promise<void> {
  console.log(`Launching ${appPath}`);
  const app = await electron.launch({
    executablePath: appPath!,
    args: launchArgs,
    timeout: 120_000,
    // Launch from OUTSIDE the repo. The API resolves its bundled JSON schemas by
    // walking up from the api dir AND process.cwd(); if cwd sits inside the
    // monorepo (the default here is apps/desktop) a missing bundle can still
    // find the source packages/schemas and silently pass — masking a broken
    // install. Running from a temp dir forces the test to exercise what a real
    // user gets.
    cwd: dataDir,
    env: {
      ...process.env,
      CLASSIFYRE_DATA_DIR: dataDir,
      ELECTRON_DISABLE_SINGLE_INSTANCE: '1',
    } as Record<string, string>,
  });
  const proc = app.process();
  proc.stdout?.on('data', (d) => process.stdout.write(`[app] ${d}`));
  proc.stderr?.on('data', (d) => process.stderr.write(`[app!] ${d}`));

  try {
    // 1. The directory reaches ready only after hydration and a successful
    // registry request through the shared API.
    let webView = null as Awaited<ReturnType<typeof app.firstWindow>> | null;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !webView) {
      for (const win of app.windows()) {
        try {
          const directory = win.locator(
            '[data-testid="workspace-directory"][data-app-state="ready"]',
          );
          if (await directory.isVisible({ timeout: 1500 })) {
            webView = win;
            break;
          }
        } catch { /* not ready */ }
      }
      if (!webView) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!webView) throw new Error('workspace directory never became ready');
    console.log('STEP 1 OK: shared API and namespace registry are ready');

    // 2. Exercise the actual first-run UI. A successful submit creates the
    // registry row/schema and navigates directly to /smoketest/discovery.
    await webView
      .locator('[data-testid="workspace-empty-state"] button')
      .first()
      .click({ timeout: 30_000 });
    await webView.locator('#ns-name').fill('smoketest');
    await webView.locator('form button[type="submit"]').click();
    console.log('Creating namespace… (schema migration + tenant routing)');

    const workspace = webView.locator(
      '[data-testid="namespace-workspace"][data-app-state="ready"]',
    );
    await workspace.waitFor({ state: 'visible', timeout: 120_000 });
    if (!webView.url().includes('/smoketest/discovery')) {
      throw new Error(`unexpected workspace URL after creation: ${webView.url()}`);
    }
    console.log('STEP 2 OK: namespace-scoped discovery API request succeeded');

    console.log('DEEP SMOKE PASSED');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('DEEP SMOKE FAILED:', err);
  process.exit(1);
});
