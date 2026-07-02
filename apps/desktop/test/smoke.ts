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
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

const appPath = process.env['CLASSIFYRE_APP_PATH'];
if (!appPath || !fs.existsSync(appPath)) {
  console.error(`CLASSIFYRE_APP_PATH not set or missing: ${appPath}`);
  process.exit(2);
}

const launchArgs =
  process.platform === 'linux'
    ? ['--no-sandbox', '--disable-gpu', '--disable-software-rasterizer', '--disable-dev-shm-usage']
    : [];

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifyre-smoke-'));

// Playwright's electron.launch() only resolves after the app is up, so stdout
// listeners attached to it miss the early boot logs — including the embedded
// PostgreSQL error that makes the app quit before opening a window. Spawn the
// binary directly first, capturing everything from t=0, to surface the real
// cause. This runs to a short deadline (the app either boots and stays up, or
// dies early) and is purely diagnostic — the pass/fail check is Playwright's.
async function preflightCapture(): Promise<void> {
  console.log('--- preflight: direct launch to capture boot logs (diagnostic) ---');
  const diagDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifyre-diag-'));
  const child = spawn(appPath!, launchArgs, {
    env: {
      ...process.env,
      CLASSIFYRE_DATA_DIR: diagDir,
      ELECTRON_DISABLE_SINGLE_INSTANCE: '1',
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });
  child.stdout?.on('data', (d) => process.stdout.write(`[boot stdout] ${d}`));
  child.stderr?.on('data', (d) => process.stderr.write(`[boot stderr] ${d}`));
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      console.log('[boot] still alive after 30s (window likely up); killing preflight');
      child.kill('SIGKILL');
      resolve();
    }, 30_000);
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      console.log(`[boot] process exited early: code=${code} signal=${signal}`);
      resolve();
    });
  });
  fs.rmSync(diagDir, { recursive: true, force: true });
  console.log('--- end preflight ---');
}

async function main(): Promise<void> {
  await preflightCapture();

  console.log(`Launching packaged app: ${appPath}`);
  const app = await electron.launch({
    executablePath: appPath,
    // Linux CI (and some hardened distros) blocks Chromium's SUID/userns
    // sandbox for apps launched from arbitrary paths — disable it. Under xvfb
    // there is no real GPU, so Chromium's GPU process fails to initialize and
    // the app can exit before opening a window ("Exiting GPU process due to
    // errors during initialization"); disable GPU/SHM so a window renders.
    args: launchArgs,
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
