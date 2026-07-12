import { app, autoUpdater, dialog, net, shell } from 'electron';
import type { WebContentsView } from 'electron';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

// Release check + in-app update against GitHub releases.
//
// macOS: full auto-update via Electron's built-in autoUpdater (Squirrel.Mac).
// Squirrel needs an HTTP feed answering {"url": <zip>}, which GitHub's API
// does not provide, so a throwaway loopback server serves that one JSON body
// pointing at the release's darwin zip asset. Requires a signed app — unsigned
// dev builds fall back to a plain download.
//
// Windows (portable zip) and Linux (deb/rpm): no in-place install path exists,
// so the matching asset is downloaded to ~/Downloads with progress and then
// revealed/opened for the user to finish.

const RELEASES_API = 'https://api.github.com/repos/classifyre/classifyre/releases/latest';
const RELEASES_PAGE = 'https://github.com/classifyre/classifyre/releases/latest';

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export type UpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number | null }
  | { status: 'ready'; version: string } // Squirrel.Mac: click restarts + installs
  | { status: 'manual-ready'; version: string; path: string } // downloaded file: click reveals/opens
  | { status: 'not-available' }
  | { status: 'error'; message: string };

function parseVersion(raw: string): number[] | null {
  const match = raw.trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function isNewer(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return false;
}

/** Picks the release asset matching this platform + arch, or null. */
export function pickAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform,
  arch: string,
): { asset: ReleaseAsset; kind: 'squirrel-zip' | 'file' } | null {
  const lower = (a: ReleaseAsset) => a.name.toLowerCase();
  if (platform === 'darwin') {
    // Forge's darwin zip (Classifyre-darwin-arm64-x.y.z.zip) is the Squirrel
    // payload; the DMG is the manual fallback.
    const zip = assets.find((a) => lower(a).includes('darwin') && lower(a).includes(arch) && lower(a).endsWith('.zip'));
    if (zip) return { asset: zip, kind: 'squirrel-zip' };
    const dmg = assets.find((a) => lower(a).endsWith('.dmg') && lower(a).includes(arch));
    if (dmg) return { asset: dmg, kind: 'file' };
    return null;
  }
  if (platform === 'win32') {
    const zip = assets.find((a) => lower(a).includes('win32') && lower(a).includes(arch) && lower(a).endsWith('.zip'));
    return zip ? { asset: zip, kind: 'file' } : null;
  }
  // Linux: prefer the package format the system can install.
  const debArch = arch === 'arm64' ? 'arm64' : 'amd64';
  const rpmArch = arch === 'arm64' ? 'aarch64' : 'x86_64';
  const hasDpkg = fs.existsSync('/usr/bin/dpkg');
  const deb = assets.find((a) => lower(a).endsWith('.deb') && lower(a).includes(debArch));
  const rpm = assets.find((a) => lower(a).endsWith('.rpm') && lower(a).includes(rpmArch));
  const pick = hasDpkg ? (deb ?? rpm) : (rpm ?? deb);
  return pick ? { asset: pick, kind: 'file' } : null;
}

export class UpdateChecker {
  private tabBarView: WebContentsView | null = null;
  private latestVersion: string | null = null;
  private assets: ReleaseAsset[] = [];
  private lastStatus: UpdateStatus = { status: 'not-available' };
  private downloading = false;
  private manualPath: string | null = null;
  private feedServer: http.Server | null = null;
  private squirrelReady = false;
  private listeners = new Set<(status: UpdateStatus) => void>();
  private recheckTimer: NodeJS.Timeout | null = null;

  setTabBarView(view: WebContentsView): void {
    this.tabBarView = view;
    // A reloaded tab bar starts with no badge; replay the current state.
    this.sendStatus(this.lastStatus);
  }

  onStatus(listener: (status: UpdateStatus) => void): void {
    this.listeners.add(listener);
  }

  getStatus(): UpdateStatus {
    return this.lastStatus;
  }

  startPeriodicChecks(intervalMs = 6 * 60 * 60 * 1000): void {
    if (this.recheckTimer) return;
    this.recheckTimer = setInterval(() => {
      // Don't clobber an in-flight or completed download state.
      if (this.downloading || this.lastStatus.status === 'ready' || this.lastStatus.status === 'manual-ready') return;
      void this.checkForUpdates();
    }, intervalMs);
    this.recheckTimer.unref?.();
  }

  /**
   * Checks GitHub for a newer release. Background checks stay silent apart
   * from the tab-bar badge; `interactive` checks (the "Check for Updates…"
   * menu item) always answer with a dialog — including "you're up to date"
   * and check failures, which the badge cannot express.
   */
  async checkForUpdates(interactive = false): Promise<void> {
    if (!app.isPackaged) {
      if (interactive) {
        void dialog.showMessageBox({
          type: 'info',
          title: 'Updates',
          message: 'Update checks are only available in the packaged app.',
        });
      }
      return;
    }

    this.sendStatus({ status: 'checking' });
    let result: UpdateStatus;
    try {
      const response = await net.fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        result = { status: 'error', message: `GitHub responded with HTTP ${response.status}` };
      } else {
        const release = (await response.json()) as {
          tag_name?: string;
          draft?: boolean;
          assets?: ReleaseAsset[];
        };
        const tag = release.tag_name;
        if (!tag || release.draft) {
          result = { status: 'not-available' };
        } else if (isNewer(tag, app.getVersion())) {
          this.latestVersion = tag.replace(/^v/, '');
          this.assets = release.assets ?? [];
          result = { status: 'available', version: this.latestVersion };
        } else {
          result = { status: 'not-available' };
        }
      }
    } catch (err) {
      // Offline or rate-limited — badge stays silent, this is best-effort.
      result = { status: 'error', message: (err as Error).message };
    }

    this.sendStatus(result);
    if (interactive) await this.showCheckResultDialog(result);
  }

  private async showCheckResultDialog(status: UpdateStatus): Promise<void> {
    if (status.status === 'not-available') {
      await dialog.showMessageBox({
        type: 'info',
        title: 'You’re up to date',
        message: 'You’re up to date',
        detail: `Classifyre ${app.getVersion()} is currently the newest version available.`,
      });
    } else if (status.status === 'available') {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update available',
        message: `Classifyre ${status.version} is available`,
        detail: `You have ${app.getVersion()}. Download the update now?`,
        buttons: ['Download', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) void this.downloadUpdate();
    } else if (status.status === 'error') {
      await dialog.showMessageBox({
        type: 'warning',
        title: 'Update check failed',
        message: 'Could not check for updates',
        detail: status.message,
      });
    }
  }

  /**
   * Downloads the update for this platform. On macOS this hands the release
   * zip to Squirrel.Mac ('ready' → restartAndInstall applies it in place);
   * elsewhere the installer/archive lands in ~/Downloads ('manual-ready').
   * Any failure falls back to opening the releases page.
   */
  async downloadUpdate(): Promise<void> {
    if (this.downloading || !this.latestVersion) return;
    const picked = pickAsset(this.assets, process.platform, process.arch);
    if (!picked) {
      this.openDownloadPage();
      return;
    }

    this.downloading = true;
    try {
      if (picked.kind === 'squirrel-zip') {
        await this.downloadViaSquirrel(picked.asset);
      } else {
        await this.downloadToDisk(picked.asset);
      }
    } catch (err) {
      console.error('[update] download failed:', err);
      this.sendStatus({ status: 'error', message: (err as Error).message });
      this.openDownloadPage();
    } finally {
      this.downloading = false;
    }
  }

  /** Applies a downloaded update: restart-in-place (mac) or open the file. */
  restartAndInstall(): void {
    if (this.squirrelReady) {
      autoUpdater.quitAndInstall();
      return;
    }
    if (this.manualPath) {
      // .deb/.rpm/.dmg open in the system installer; a zip is revealed so the
      // user can extract it over the old install.
      if (this.manualPath.endsWith('.zip')) {
        shell.showItemInFolder(this.manualPath);
      } else {
        void shell.openPath(this.manualPath);
      }
    }
  }

  /** Opens the GitHub releases page in the default browser. */
  openDownloadPage(): void {
    void shell.openExternal(RELEASES_PAGE);
  }

  getLatestVersion(): string | null {
    return this.latestVersion;
  }

  private downloadViaSquirrel(asset: ReleaseAsset): Promise<void> {
    const version = this.latestVersion!;
    this.sendStatus({ status: 'downloading', version, percent: null });

    return new Promise<void>((resolve, reject) => {
      // Loopback feed answering Squirrel.Mac's update query with the GitHub
      // asset URL (Squirrel follows the S3 redirect itself).
      const body = JSON.stringify({ url: asset.browser_download_url, name: version });
      this.feedServer?.close();
      const server = http.createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(body);
      });
      this.feedServer = server;

      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not start update feed server'));
          return;
        }

        const cleanup = () => {
          autoUpdater.removeListener('update-downloaded', onDownloaded);
          autoUpdater.removeListener('error', onError);
          server.close();
          this.feedServer = null;
        };
        const onDownloaded = () => {
          cleanup();
          this.squirrelReady = true;
          this.sendStatus({ status: 'ready', version });
          resolve();
        };
        const onError = (err: Error) => {
          cleanup();
          // Typical on unsigned/dev builds ("Could not get code signature").
          // Fall back to downloading the asset like the other platforms.
          console.warn('[update] Squirrel.Mac failed, falling back to plain download:', err.message);
          this.downloadToDisk(asset).then(resolve, reject);
        };
        autoUpdater.once('update-downloaded', onDownloaded);
        autoUpdater.once('error', onError);

        try {
          autoUpdater.setFeedURL({ url: `http://127.0.0.1:${address.port}/` });
          autoUpdater.checkForUpdates();
        } catch (err) {
          cleanup();
          reject(err as Error);
        }
      });
      server.on('error', reject);
    });
  }

  private async downloadToDisk(asset: ReleaseAsset): Promise<void> {
    const version = this.latestVersion!;
    this.sendStatus({ status: 'downloading', version, percent: 0 });

    const dest = path.join(app.getPath('downloads'), asset.name);
    const response = await net.fetch(asset.browser_download_url);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed (HTTP ${response.status})`);
    }

    const total = Number(response.headers.get('content-length')) || asset.size || 0;
    let received = 0;
    let lastPercent = -1;
    const reportProgress = (chunk: Buffer) => {
      received += chunk.length;
      const percent = total > 0 ? Math.floor((received / total) * 100) : null;
      if (percent !== lastPercent) {
        lastPercent = percent ?? -1;
        this.sendStatus({ status: 'downloading', version, percent });
      }
    };

    const partial = `${dest}.download`;
    const nodeStream = Readable.fromWeb(response.body as import('stream/web').ReadableStream);
    nodeStream.on('data', reportProgress);
    await pipeline(nodeStream, fs.createWriteStream(partial));
    fs.renameSync(partial, dest);

    this.manualPath = dest;
    this.sendStatus({ status: 'manual-ready', version, path: dest });
  }

  private sendStatus(status: UpdateStatus): void {
    this.lastStatus = status;
    this.tabBarView?.webContents.send('update:status', status);
    for (const listener of this.listeners) listener(status);
  }
}
