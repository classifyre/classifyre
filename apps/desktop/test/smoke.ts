/**
 * Smoke test for a PACKAGED desktop build. Launches the real binary, waits
 * for the workspace directory to finish its first API-backed load (which
 * requires the renderer, shared API, and embedded PostgreSQL), and exits 0 on
 * success.
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

async function removeTemporaryDirectory(directory: string): Promise<void> {
  try {
    // Chromium can keep files such as Network/Trust Tokens locked briefly on
    // Windows after its parent process closes. Node retries the transient
    // EBUSY/EPERM/ENOTEMPTY failures before we leave any diagnostic data behind.
    await fs.promises.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 20,
      retryDelay: 250,
    });
  } catch (error) {
    // Temp cleanup must not hide the application result. The operating system
    // will eventually reclaim its temp directory if a third-party lock outlives
    // the retry window.
    console.warn(`Unable to remove temporary directory ${directory}:`, error);
  }
}

// Playwright's electron.launch() only resolves after the app is up, so stdout
// listeners attached to it miss the early boot logs — including the embedded
// PostgreSQL error that makes the app quit before opening a window. Spawn the
// binary directly first, capturing everything from t=0, to surface the real
// cause. This runs to a short deadline (the app either boots and stays up, or
// dies early) and is purely diagnostic — the pass/fail check is Playwright's.
async function preflightCapture(): Promise<string> {
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
  let captured = '';
  child.stdout?.on('data', (d) => {
    captured += d;
    process.stdout.write(`[boot stdout] ${d}`);
  });
  child.stderr?.on('data', (d) => {
    captured += d;
    process.stderr.write(`[boot stderr] ${d}`);
  });
  await new Promise<void>((resolve) => {
    let settled = false;
    let forcedCloseTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forcedCloseTimer) clearTimeout(forcedCloseTimer);
      resolve();
    };
    const timer = setTimeout(() => {
      console.log('[boot] still alive after 30s (window likely up); killing preflight');
      child.kill('SIGKILL');
      // A close event normally follows immediately. Keep a bounded fallback so
      // a platform-specific process-handle failure cannot hang the smoke test.
      forcedCloseTimer = setTimeout(finish, 5_000);
    }, 30_000);
    child.once('close', (code, signal) => {
      console.log(`[boot] process exited early: code=${code} signal=${signal}`);
      finish();
    });
    child.once('error', finish);
  });
  await removeTemporaryDirectory(diagDir);
  console.log('--- end preflight ---');
  return captured;
}

async function main(): Promise<void> {
  const bootOutput = await preflightCapture();

  // PostgreSQL refuses to run as a user with administrative privileges, and
  // GitHub's Windows runners execute as an elevated admin user. This is a
  // property of the CI host, not a defect in the app (real users aren't admin),
  // and there is no supported way to run PG elevated on Windows — so treat this
  // specific condition as a skip rather than failing the release.
  if (process.platform === 'win32' && /administrative permissions/i.test(bootOutput)) {
    console.log(
      'Smoke test SKIPPED on Windows: embedded PostgreSQL cannot run under the ' +
        "CI runner's elevated admin account. Not an app defect; skipping.",
    );
    await removeTemporaryDirectory(dataDir);
    return;
  }

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
    // The shared web view shows up as a Playwright "window". Its state changes
    // from loading to ready only after client hydration and a successful
    // namespace-registry request, proving the renderer, API, and database all
    // work in the packaged application.
    const deadline = Date.now() + 120_000;
    let found = false;
    while (Date.now() < deadline && !found) {
      for (const win of app.windows()) {
        try {
          const directory = win.locator(
            '[data-testid="workspace-directory"][data-app-state="ready"]',
          );
          if (await directory.isVisible({ timeout: 2000 })) {
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
      throw new Error(
        `Workspace directory never became ready. Windows: ${urls.join(', ') || '(none)'}`,
      );
    }

    console.log(
      'Smoke test passed: packaged renderer, shared API, and database are ready.',
    );
  } finally {
    await app.close().catch(() => {});
    await removeTemporaryDirectory(dataDir);
  }
}

main().catch((err) => {
  console.error('Smoke test failed:', err);
  process.exit(1);
});
