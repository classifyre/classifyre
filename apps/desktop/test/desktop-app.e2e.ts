/**
 * Desktop app e2e test using Playwright's Electron support.
 *
 * Prerequisites:
 *   1. API built:    cd apps/api && bun run build
 *   2. Web dev server running: cd apps/web && bun dev  (on port 3000)
 *   3. .vite build exists: run `bun run dev` once in apps/desktop, then Ctrl+C
 *   4. Node 22 on PATH
 *
 * Run:
 *   cd apps/desktop
 *   PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" bun run test:e2e
 */

import { test, expect } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { spawn, type ChildProcess } from 'child_process';

const DESKTOP_DIR = path.resolve(__dirname, '..');
const MONOREPO_ROOT = path.resolve(DESKTOP_DIR, '../..');

function getShellPath(): string {
  const home = os.homedir();
  const extras = [
    `${home}/.bun/bin`,
    `${home}/.local/bin`,
    `${home}/.nvm/versions/node/v22.22.3/bin`,
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  const existing = process.env['PATH'] ?? '';
  return [...extras, existing].join(':');
}

function waitForUrl(url: string, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) { resolve(false); return; }
      const req = http.get(url, (res) => { res.resume(); resolve(true); });
      req.on('error', () => setTimeout(check, 500));
      req.setTimeout(2000, () => { req.destroy(); setTimeout(check, 500); });
    };
    check();
  });
}

function resolveElectronBin(): string {
  const bunDir = path.join(MONOREPO_ROOT, 'node_modules/.bun');
  const electronPkgDir = fs.readdirSync(bunDir)
    .filter((e) => e.startsWith('electron@'))
    .map((e) => path.join(bunDir, e, 'node_modules/electron'))
    .find((p) => fs.existsSync(p));
  if (!electronPkgDir) throw new Error('electron package not found');
  return require(path.join(electronPkgDir, 'index.js')) as string;
}

let electronApp: ElectronApplication;
let viteServer: ChildProcess | null = null;
let testDataDir: string;

test.beforeAll(async () => {
  const webRunning = await waitForUrl('http://localhost:3000', 3000);
  if (!webRunning) {
    throw new Error(
      'Next.js dev server not running on port 3000. Start it: cd apps/web && bun dev',
    );
  }

  // Start Vite dev server for namespace selector on :5173
  const rendererRunning = await waitForUrl('http://localhost:5173', 1000);
  if (!rendererRunning) {
    viteServer = spawn('npx', ['vite', '--port', '5173'], {
      cwd: DESKTOP_DIR,
      stdio: 'pipe',
      shell: true,
      env: { ...process.env, PATH: getShellPath() },
    });
    const ready = await waitForUrl('http://localhost:5173', 15_000);
    if (!ready) throw new Error('Failed to start Vite renderer server on :5173');
  }

  const mainEntry = path.join(DESKTOP_DIR, '.vite/build/index.js');
  if (!fs.existsSync(mainEntry)) {
    throw new Error('Vite build not found. Run `bun run dev` once first, then Ctrl+C.');
  }

  testDataDir = path.join(os.tmpdir(), `classifyre-e2e-${Date.now()}`);
  fs.mkdirSync(testDataDir, { recursive: true });

  electronApp = await electron.launch({
    args: [DESKTOP_DIR],
    executablePath: resolveElectronBin(),
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      PATH: getShellPath(),
      NODE_ENV: 'development',
      ELECTRON_DISABLE_DEVTOOLS: '1',
      ELECTRON_DISABLE_SINGLE_INSTANCE: '1',
      CLASSIFYRE_DATA_DIR: testDataDir,
    },
  });
});

test.afterAll(async () => {
  if (electronApp) await electronApp.close();
  if (viteServer?.pid) {
    try { process.kill(viteServer.pid); } catch {}
    viteServer = null;
  }
  try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch {}
});

async function waitForPage(match: (url: string) => boolean, timeoutMs = 30_000): Promise<Page> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const windows = electronApp.windows();
    for (const w of windows) {
      if (match(w.url())) return w;
    }
    // WebContentsViews appear as new windows in Playwright when they load
    try {
      const newWin = await electronApp.waitForEvent('window', { timeout: 3000 });
      if (match(newWin.url())) return newWin;
    } catch {
      // timeout, try again
    }
  }
  const urls = electronApp.windows().map(w => w.url());
  throw new Error(`Page not found. Current windows: ${urls.join(', ')}`);
}

async function findSelectorPage(): Promise<Page> {
  return waitForPage((url) =>
    url.includes('5173') ||
    url.includes('namespace-selector') ||
    url.includes('index.html'),
  );
}

test('namespace selector shows with Classifyre branding', async () => {
  const selector = await findSelectorPage();
  await selector.waitForLoadState('domcontentloaded');

  await selector.locator('h1').waitFor({ state: 'visible', timeout: 15_000 });
  const heading = await selector.locator('h1').textContent();
  expect(heading).toBe('Classifyre');

  // Logo is visible
  await selector.locator('.logo img').waitFor({ state: 'visible', timeout: 5_000 });

  // Input and create button
  await selector.locator('#new-name').waitFor({ state: 'visible', timeout: 5_000 });
  await selector.locator('#create-btn').waitFor({ state: 'visible', timeout: 5_000 });
});

test('can create a workspace', async () => {
  const selector = await findSelectorPage();

  await selector.locator('#new-name').waitFor({ state: 'visible', timeout: 10_000 });
  await selector.fill('#new-name', 'E2E Test Workspace');
  await selector.click('#create-btn');

  await selector.locator('.namespace-name', { hasText: 'E2E Test Workspace' })
    .waitFor({ state: 'visible', timeout: 10_000 });
});

test('can open workspace and see web UI with sidebar', async () => {
  const selector = await findSelectorPage();

  const openBtn = selector.locator('[data-action="open"]').first();
  await openBtn.waitFor({ state: 'visible', timeout: 5_000 });
  await openBtn.click();

  // In the tabbed architecture, a new WebContentsView is created for the namespace.
  // Playwright sees it as a new "window". Wait for it.
  const namespaceWindow = await electronApp.waitForEvent('window', { timeout: 90_000 });

  await namespaceWindow.waitForLoadState('networkidle', { timeout: 60_000 });

  // Verify Classifyre logo in the web app sidebar
  await namespaceWindow.locator('img[alt="Classifyre"]')
    .waitFor({ state: 'visible', timeout: 30_000 });

  // Verify sidebar
  await namespaceWindow.locator('[data-sidebar="sidebar"]')
    .waitFor({ state: 'visible', timeout: 10_000 });

  // Verify navigation links
  await namespaceWindow.locator('a[href="/sources"], a[href="/sources/"]').first()
    .waitFor({ state: 'visible', timeout: 10_000 });

  await namespaceWindow.locator('a[href="/findings"], a[href="/findings/"]').first()
    .waitFor({ state: 'visible', timeout: 10_000 });

  // Verify main content area
  await namespaceWindow.locator('main, [data-sidebar="inset"]').first()
    .waitFor({ state: 'visible', timeout: 10_000 });
});
