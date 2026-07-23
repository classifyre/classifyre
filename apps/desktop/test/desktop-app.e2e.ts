/**
 * Development end-to-end test for the single-window desktop shell.
 *
 * Prerequisites:
 *   1. API built: cd apps/api && bun run build
 *   2. Web dev server running: cd apps/web && bun dev
 *   3. Desktop main/preload built: cd apps/desktop && bun run build
 */

import { test } from '@playwright/test';
import { _electron as electron, type ElectronApplication, type Page } from 'playwright';
import fs from 'fs';
import http from 'http';
import { createRequire } from 'module';
import os from 'os';
import path from 'path';

const DESKTOP_DIR = path.resolve(__dirname, '..');
const MONOREPO_ROOT = path.resolve(DESKTOP_DIR, '../..');
const loadModule = createRequire(__filename);

function getShellPath(): string {
  const home = os.homedir();
  return [
    `${home}/.bun/bin`,
    `${home}/.local/bin`,
    `${home}/.nvm/versions/node/v22.22.3/bin`,
    '/usr/local/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
    process.env['PATH'] ?? '',
  ].join(':');
}

function waitForUrl(url: string, timeoutMs = 10_000): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const check = () => {
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      const request = http.get(url, (response) => {
        response.resume();
        resolve(true);
      });
      request.on('error', () => setTimeout(check, 500));
      request.setTimeout(2_000, () => {
        request.destroy();
        setTimeout(check, 500);
      });
    };
    check();
  });
}

function resolveElectronBin(): string {
  const bunDir = path.join(MONOREPO_ROOT, 'node_modules/.bun');
  const electronPackage = fs
    .readdirSync(bunDir)
    .filter((entry) => entry.startsWith('electron@'))
    .map((entry) => path.join(bunDir, entry, 'node_modules/electron'))
    .find((candidate) => fs.existsSync(candidate));
  if (!electronPackage) throw new Error('electron package not found');
  return loadModule(path.join(electronPackage, 'index.js')) as string;
}

let electronApp: ElectronApplication;
let page: Page;
let testDataDir: string;

test.beforeAll(async () => {
  if (!(await waitForUrl('http://localhost:3000', 3_000))) {
    throw new Error(
      'Next.js dev server is not running. Start it with: cd apps/web && bun dev',
    );
  }

  const mainEntry = path.join(DESKTOP_DIR, '.vite/build/index.js');
  if (!fs.existsSync(mainEntry)) {
    throw new Error('Desktop build not found. Run: cd apps/desktop && bun run build');
  }

  testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'classifyre-e2e-'));
  electronApp = await electron.launch({
    args: [DESKTOP_DIR],
    executablePath: resolveElectronBin(),
    cwd: DESKTOP_DIR,
    env: {
      ...process.env,
      PATH: getShellPath(),
      NODE_ENV: 'development',
      ELECTRON_DISABLE_SINGLE_INSTANCE: '1',
      CLASSIFYRE_DATA_DIR: testDataDir,
    },
  });
  page = await electronApp.firstWindow({ timeout: 180_000 });
});

test.afterAll(async () => {
  await electronApp?.close().catch(() => {});
  await fs.promises.rm(testDataDir, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
});

test('creates and opens a namespace through the shared API', async () => {
  const directory = page.locator(
    '[data-testid="workspace-directory"][data-app-state="ready"]',
  );
  await directory.waitFor({ state: 'visible', timeout: 120_000 });

  await page
    .locator('[data-testid="workspace-empty-state"] button')
    .first()
    .click();
  await page.locator('#ns-name').fill('E2E Test Workspace');
  await page.locator('form button[type="submit"]').click();

  await page.waitForURL('**/e2e-test-workspace', { timeout: 120_000 });
  await page
    .locator('[data-sidebar="sidebar"]')
    .waitFor({ state: 'visible', timeout: 120_000 });
});
