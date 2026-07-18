/**
 * Deep smoke test for a PACKAGED desktop build, run from OUTSIDE the repo.
 * Boots the app, waits for the namespace selector (PG up), creates a
 * namespace, and waits for the workspace window (API up = prisma migrate ran,
 * venv relocated, api node_modules resolved).
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
  let appOutput = '';
  proc.stdout?.on('data', (d) => { appOutput += d; process.stdout.write(`[app] ${d}`); });
  proc.stderr?.on('data', (d) => { appOutput += d; process.stderr.write(`[app!] ${d}`); });

  try {
    // 1. selector renders (embedded PG booted)
    let selector = null as Awaited<ReturnType<typeof app.firstWindow>> | null;
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline && !selector) {
      for (const win of app.windows()) {
        try {
          const h1 = await win.locator('h1').textContent({ timeout: 1500 });
          if (h1?.trim() === 'Classifyre') { selector = win; break; }
        } catch { /* not ready */ }
      }
      if (!selector) await new Promise((r) => setTimeout(r, 1000));
    }
    if (!selector) throw new Error('selector never rendered (PG boot failed?)');
    console.log('STEP 1 OK: namespace selector rendered (PostgreSQL up)');

    // 2. create a namespace → workspace window opens once the API is healthy.
    // The selector lives in a WebContentsView, whose native visibility defeats
    // Playwright's actionability checks — drive the DOM directly instead.
    // Wait for the workspace list to finish loading (the create section is
    // hidden until then), then walk the create flow: new workspace → local →
    // name → create.
    await selector.waitForFunction(
      () => !document.getElementById('new-workspace-section')?.classList.contains('hidden'),
      undefined,
      { timeout: 30_000 },
    );
    await selector.evaluate(() => {
      // Opens the create dialog (or re-opens it in local mode on first run).
      (document.getElementById('new-workspace-btn') as HTMLButtonElement).click();
      const input = document.getElementById('new-name') as HTMLInputElement;
      input.value = 'smoketest';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      (document.getElementById('create-btn') as HTMLButtonElement).click();
    });

    // Creation only adds the workspace to the list — opening it is what boots
    // the API. Wait for the item, then click it.
    await selector.waitForFunction(
      () => !!document.querySelector('.namespace-item'),
      undefined,
      { timeout: 60_000 },
    );
    await selector.evaluate(() => {
      (document.querySelector('.namespace-item') as HTMLElement).click();
    });
    console.log('Creating namespace… (prisma migrate + API boot + venv relocation)');

    // The workspace UI renders inside a WebContentsView, which Playwright
    // does not list under app.windows() — detect success from the main
    // process's own logs instead: the API must report "successfully started"
    // AND the runtime must make the namespace view visible.
    const bootDeadline = Date.now() + 300_000;
    let workspaceUp = false;
    while (Date.now() < bootDeadline && !workspaceUp) {
      const apiStarted = /Nest application successfully started/.test(appOutput);
      const viewVisible = /namespace .* view\.setVisible\(true\)/.test(appOutput);
      if (apiStarted && viewVisible) {
        workspaceUp = true;
        console.log('STEP 2 OK: API booted and workspace view is visible');
        break;
      }
      if (/Error occurred in handler/.test(appOutput)) {
        throw new Error('main process reported a handler error during namespace open');
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    if (!workspaceUp) throw new Error('workspace never opened — API boot failed');

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
