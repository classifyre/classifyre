/**
 * Smoke test for a PACKAGED desktop build. Launches the real binary, waits
 * for the namespace selector to render (which requires embedded PostgreSQL to
 * have started), and exits 0 on success.
 *
 * Usage:
 *   CLASSIFYRE_APP_PATH=/path/to/binary npx tsx test/smoke.ts
 *
 * On Linux CI run under xvfb: xvfb-run -a npx tsx test/smoke.ts
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

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifyre-smoke-'));

async function main(): Promise<void> {
  console.log(`Launching packaged app: ${appPath}`);
  const app = await electron.launch({
    executablePath: appPath,
    // Linux CI (and some hardened distros) blocks Chromium's SUID/userns
    // sandbox for apps launched from arbitrary paths — disable it for the test.
    args: process.platform === 'linux' ? ['--no-sandbox'] : [],
    timeout: 120_000,
    env: {
      ...process.env,
      CLASSIFYRE_DATA_DIR: dataDir,
      ELECTRON_DISABLE_SINGLE_INSTANCE: '1',
    } as Record<string, string>,
  });

  try {
    // The selector view shows up as a Playwright "window". Postgres must be
    // running before the main window is created, so a visible selector proves
    // the embedded database booted on a clean machine profile.
    const deadline = Date.now() + 120_000;
    let found = false;
    while (Date.now() < deadline && !found) {
      for (const win of app.windows()) {
        try {
          const heading = await win.locator('h1').textContent({ timeout: 2000 });
          if (heading?.trim() === 'Classifyre') {
            found = true;
            break;
          }
        } catch {
          // window not ready yet
        }
      }
      if (!found) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    if (!found) {
      const urls = app.windows().map((w) => w.url());
      throw new Error(`Selector never rendered. Windows: ${urls.join(', ') || '(none)'}`);
    }

    console.log('Smoke test passed: app booted and selector rendered.');
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
