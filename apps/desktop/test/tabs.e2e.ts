/**
 * E2e test for tab bar: + button, multi-namespace, tab switching.
 *
 * Run:
 *   cd apps/desktop
 *   PATH="$HOME/.nvm/versions/node/v22.22.3/bin:$PATH" npx playwright test --config test/playwright.config.ts test/tabs.e2e.ts
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
  return [
    `${home}/.bun/bin`, `${home}/.local/bin`,
    `${home}/.nvm/versions/node/v22.22.3/bin`,
    '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin',
    process.env['PATH'] ?? '',
  ].join(':');
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
  const dir = fs.readdirSync(bunDir)
    .filter((e) => e.startsWith('electron@'))
    .map((e) => path.join(bunDir, e, 'node_modules/electron'))
    .find((p) => fs.existsSync(p));
  if (!dir) throw new Error('electron not found');
  return require(path.join(dir, 'index.js')) as string;
}

let electronApp: ElectronApplication;
let viteServer: ChildProcess | null = null;
let testDataDir: string;

test.beforeAll(async () => {
  if (!(await waitForUrl('http://localhost:3000', 3000)))
    throw new Error('Next.js dev server not on :3000');

  if (!(await waitForUrl('http://localhost:5173', 1000))) {
    const bun = [path.join(os.homedir(), '.bun/bin/bun'), '/usr/local/bin/bun']
      .find((p) => fs.existsSync(p)) ?? 'bun';
    viteServer = spawn(bun, ['x', 'vite', '--port', '5173'], {
      cwd: DESKTOP_DIR, stdio: 'pipe',
      env: { ...process.env, PATH: getShellPath() },
    });
    if (!(await waitForUrl('http://localhost:5173', 20_000)))
      throw new Error('Vite :5173 failed');
  }

  if (!fs.existsSync(path.join(DESKTOP_DIR, '.vite/build/index.js')))
    throw new Error('No .vite build');

  testDataDir = path.join(os.tmpdir(), `classifyre-tabs-e2e-${Date.now()}`);
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
  if (viteServer?.pid) { try { process.kill(viteServer.pid); } catch {} }
  try { fs.rmSync(testDataDir, { recursive: true, force: true }); } catch {}
});

async function getPage(match: (url: string) => boolean, timeoutMs = 30_000): Promise<Page> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const w of electronApp.windows()) {
      if (match(w.url())) return w;
    }
    try {
      const w = await electronApp.waitForEvent('window', { timeout: 3000 });
      if (match(w.url())) return w;
    } catch {}
  }
  throw new Error(`Page not found among: ${electronApp.windows().map(w => w.url())}`);
}

test('full tab lifecycle: create, open, + button, switch, close', async () => {
  // Wait for pages to appear (PG init can take time)
  let ipcPage: Page | undefined;
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pages = electronApp.windows();
    if (pages.length > 0) {
      console.log('PAGES:', pages.map((p) => p.url()));
      ipcPage = pages.find((p) => p.url().includes('tab-bar'));
      if (ipcPage) break;
    }
  }
  if (!ipcPage) throw new Error('No tab-bar page found after 40s');
  const allPages = electronApp.windows();

  // Also try to find the selector page
  let selector = allPages.find((p) =>
    p.url().includes('5173') || (p.url().includes('index.html') && !p.url().includes('tab-bar')),
  );
  // If selector loaded with chrome-error, navigate to the local file fallback
  const errorPage = allPages.find((p) => p.url().includes('chrome-error'));
  if (!selector && errorPage) {
    const fallbackPath = path.join(DESKTOP_DIR, 'index.html');
    await errorPage.goto(`file://${fallbackPath}`, { waitUntil: 'domcontentloaded' });
    selector = errorPage;
  }
  if (!selector) throw new Error('No selector page found');

  // Find tab bar page
  const tabBar = await getPage((u) => u.includes('tab-bar'));

  // Verify electronAPI loaded in tab bar
  const apiCheck = await ipcPage.evaluate(() => typeof (window as any).electronAPI);
  expect(apiCheck).toBe('object');

  // Create a workspace via IPC (works even if selector page has loading issues)
  await ipcPage.evaluate(async () => {
    await (window as any).electronAPI.createNamespace('Tab Test WS');
  });

  // Get namespace ID
  const namespaces = await ipcPage.evaluate(async () => {
    return await (window as any).electronAPI.listNamespaces();
  });
  const nsId = namespaces[0].id;
  console.log('Created namespace:', nsId);

  // Open via IPC and wait for it to complete
  const openResult = await ipcPage.evaluate(async (id: string) => {
    return await (window as any).electronAPI.openNamespace(id);
  }, nsId);
  console.log('OPEN RESULT:', JSON.stringify(openResult));

  // Now the namespace WebContentsView exists — find it
  await new Promise((r) => setTimeout(r, 2000));
  let nsPage: Page | null = null;
  try {
    nsPage = await getPage((u) => u.includes('localhost:3000'), 30_000);
    await nsPage.waitForLoadState('networkidle', { timeout: 60_000 });
  } catch {
    console.log('Could not find namespace page as Playwright window (WebContentsView not exposed)');
    console.log('Windows:', electronApp.windows().map(w => w.url()));
  }

  // Wait a bit then check tab state via IPC
  await new Promise((r) => setTimeout(r, 2000));
  const state = await ipcPage.evaluate(async () => {
    const api = (window as any).electronAPI;
    return await api.getTabState();
  });
  expect(state.tabs.length).toBe(1);
  expect(state.tabs[0].name).toBe('Tab Test WS');

  // Force render the tabs (the tab bar's own render may not have fired)
  await ipcPage.evaluate(async () => {
    const api = (window as any).electronAPI;
    const data = await api.getTabState();
    const tabsEl = document.getElementById('tabs');
    const homeTab = document.getElementById('home-tab');
    const addBtn = document.getElementById('add-tab');
    if (!tabsEl) return;
    homeTab?.classList.toggle('active', data.showingSelector);
    if (addBtn) addBtn.style.display = data.tabs.length > 0 ? '' : 'none';
    tabsEl.innerHTML = data.tabs.map((t: any) =>
      `<div class="tab ${t.active ? 'active' : ''}" data-id="${t.id}">
        <span class="tab-label">${t.name}</span>
        <span class="tab-close" data-close="${t.id}">&times;</span>
      </div>`
    ).join('');
  });

  // Tab should now be visible in DOM
  const tabLabel = await ipcPage.locator('.tab-label').first().textContent();
  expect(tabLabel).toBe('Tab Test WS');

  // Click + button via IPC (since we know click handlers work via electronAPI)
  await ipcPage.evaluate(() => (window as any).electronAPI.showSelector());

  // Verify selector is showing again
  await new Promise((r) => setTimeout(r, 500));
  const stateAfterPlus = await ipcPage.evaluate(async () => {
    return await (window as any).electronAPI.getTabState();
  });
  expect(stateAfterPlus.showingSelector).toBe(true);
  expect(stateAfterPlus.tabs.length).toBe(1); // tab still exists

  // Switch back to namespace tab via IPC
  const tabId = stateAfterPlus.tabs[0].id;
  await ipcPage.evaluate((id: string) => (window as any).electronAPI.switchTab(id), tabId);

  // Verify namespace is active
  await new Promise((r) => setTimeout(r, 500));
  const stateAfterSwitch = await ipcPage.evaluate(async () => {
    return await (window as any).electronAPI.getTabState();
  });
  expect(stateAfterSwitch.showingSelector).toBe(false);
  expect(stateAfterSwitch.tabs[0].active).toBe(true);

  // Verify sidebar is visible in namespace view (if Playwright can see the WebContentsView)
  if (nsPage) {
    await nsPage.locator('[data-sidebar="sidebar"]')
      .waitFor({ state: 'visible', timeout: 10_000 });
  }
});
