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
    // sandbox for apps launched from arbitrary paths — disable it. Under xvfb
    // there is no real GPU, so Chromium's GPU process fails to initialize and
    // the app can exit before opening a window ("Exiting GPU process due to
    // errors during initialization"); disable GPU/SHM so a window renders.
    args:
      process.platform === 'linux'
        ? ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage']
        : [],
    timeout: 120_000,
    env: {
      ...process.env,
      CLASSIFYRE_DATA_DIR: dataDir,
      ELECTRON_DISABLE_SINGLE_INSTANCE: '1',
    } as Record<string, string>,
  });

  // Surface the app's own output. A silent "Windows: (none)" failure in CI
  // means the main process died before opening a window; without these the
  // cause is invisible, so stream main-process stdout/stderr and renderer logs.
  const proc = app.process();
  proc.stdout?.on('data', (d) => process.stdout.write(`[app stdout] ${d}`));
  proc.stderr?.on('data', (d) => process.stderr.write(`[app stderr] ${d}`));
  app.on('window', (win) => console.log(`[app] window opened: ${win.url()}`));
  app.on('console', (msg) => console.log(`[app console] ${msg.type()}: ${msg.text()}`));
  app.process().on('exit', (code, signal) =>
    console.error(`[app] main process exited early: code=${code} signal=${signal}`),
  );

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
