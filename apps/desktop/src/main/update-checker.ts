import { app, autoUpdater, dialog, net, powerMonitor, shell } from 'electron';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import { UpdateProgressWindow } from './update-progress-window.js';

// Release check + in-app update against GitHub releases.
//
// macOS: full auto-update via Electron's built-in autoUpdater (Squirrel.Mac).
// The zip is fetched here first (so the user sees a real percentage — Squirrel
// reports no progress of its own) and then handed to Squirrel through a
// throwaway loopback server that answers its update query with {"url": …} and
// serves the already-downloaded file. Requires a signed app — unsigned dev
// builds fall back to keeping the download.
//
// Windows (portable zip) and Linux (deb/rpm): no in-place install path exists,
// so the matching asset is downloaded to ~/Downloads with progress and then
// revealed/opened for the user to finish.
//
// Every path is bounded by a timeout and reports through a progress window and
// a completion prompt: a click on "Download" must never look like a no-op.

const RELEASES_API = 'https://api.github.com/repos/classifyre/classifyre/releases/latest';
const RELEASES_PAGE = 'https://github.com/classifyre/classifyre/releases/latest';

/**
 * How long to wait for Squirrel.Mac to stage an already-downloaded zip before
 * giving up. Squirrel is a black box: it can also answer with none of the
 * events we listen for, and without a deadline the updater would sit in
 * `downloading` forever and swallow every later click.
 */
const SQUIRREL_APPLY_TIMEOUT_MS = 5 * 60 * 1000;

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export type UpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; version: string }
  | { status: 'downloading'; version: string; percent: number | null }
  | { status: 'applying'; version: string } // Squirrel.Mac is staging the download
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
  private latestVersion: string | null = null;
  private assets: ReleaseAsset[] = [];
  private lastStatus: UpdateStatus = { status: 'not-available' };
  private downloading = false;
  private manualPath: string | null = null;
  private feedServer: http.Server | null = null;
  private squirrelReady = false;
  private listeners = new Set<(status: UpdateStatus) => void>();
  private recheckTimer: NodeJS.Timeout | null = null;
  private promptedVersion: string | null = null;

  onStatus(listener: (status: UpdateStatus) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatus(): UpdateStatus {
    return this.lastStatus;
  }

  startPeriodicChecks(intervalMs = 6 * 60 * 60 * 1000): void {
    if (this.recheckTimer) return;
    this.recheckTimer = setInterval(() => void this.backgroundCheck(), intervalMs);
    this.recheckTimer.unref?.();
    // A laptop that spent the night asleep skipped every interval tick, and the
    // machines this runs on are rarely rebooted — re-check shortly after wake.
    powerMonitor.on('resume', () => {
      setTimeout(() => void this.backgroundCheck(), 30_000).unref?.();
    });
  }

  /**
   * Periodic/startup check. Silent when there is nothing to do; when a new
   * version does show up it offers the download once per version, because the
   * tray label alone is too easy to never notice.
   */
  async backgroundCheck(): Promise<void> {
    // Don't clobber an in-flight or completed download state.
    if (
      this.downloading ||
      this.lastStatus.status === 'ready' ||
      this.lastStatus.status === 'manual-ready'
    ) {
      return;
    }
    await this.checkForUpdates();
    const status = this.lastStatus;
    if (status.status !== 'available' || this.promptedVersion === status.version) return;
    this.promptedVersion = status.version;
    await this.showCheckResultDialog(status);
  }

  /**
   * Checks GitHub for a newer release. Background checks stay silent;
   * `interactive` checks (the "Check for Updates…"
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
        const assets = release.assets ?? [];
        // Only advertise an update the user can actually install here: a newer
        // release whose assets include a downloadable build for THIS platform +
        // arch. A release that only carries, say, the macOS DMG must not light
        // up the "download" button for a Linux user — the button downloads and
        // installs in place, it never falls back to opening the GitHub page.
        const hasInstallableAsset = pickAsset(assets, process.platform, process.arch) !== null;
        if (!tag || release.draft) {
          result = { status: 'not-available' };
        } else if (isNewer(tag, app.getVersion()) && hasInstallableAsset) {
          this.latestVersion = tag.replace(/^v/, '');
          this.assets = assets;
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
   * Downloads the update for this platform, showing a progress window
   * throughout and prompting for the restart/install at the end. On macOS the
   * zip is handed to Squirrel.Mac ('ready' → restartAndInstall applies it in
   * place); elsewhere the installer/archive lands in ~/Downloads
   * ('manual-ready'). Any failure falls back to opening the releases page.
   */
  async downloadUpdate(): Promise<void> {
    if (this.downloading || !this.latestVersion) return;
    const picked = pickAsset(this.assets, process.platform, process.arch);
    if (!picked) {
      this.openDownloadPage();
      return;
    }

    this.downloading = true;
    const progress = new UpdateProgressWindow(this.latestVersion);
    progress.show();
    const unsubscribe = this.onStatus((status) => {
      if (status.status === 'downloading') {
        progress.setProgress(
          status.percent,
          status.percent === null
            ? 'Downloading…'
            : `Downloading… ${status.percent}%`,
        );
      } else if (status.status === 'applying') {
        progress.setProgress(null, 'Preparing the update…');
      }
    });

    try {
      if (picked.kind === 'squirrel-zip') {
        await this.installViaSquirrel(picked.asset);
      } else {
        await this.downloadToDisk(picked.asset, app.getPath('downloads'));
      }
    } catch (err) {
      console.error('[update] download failed:', err);
      this.sendStatus({ status: 'error', message: (err as Error).message });
    } finally {
      this.downloading = false;
      unsubscribe();
      progress.close();
    }

    await this.showDownloadResultDialog();
  }

  /** Reports how the download ended and offers the next step. */
  private async showDownloadResultDialog(): Promise<void> {
    const status = this.lastStatus;
    if (status.status === 'ready') {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update ready',
        message: `Classifyre ${status.version} is ready to install`,
        detail: 'Classifyre needs to restart to finish installing the update.',
        buttons: ['Restart Now', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) this.restartAndInstall();
    } else if (status.status === 'manual-ready') {
      const isArchive = status.path.endsWith('.zip');
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Update downloaded',
        message: `Classifyre ${status.version} was downloaded`,
        detail: isArchive
          ? `Extract it over your current install to finish updating.\n\n${status.path}`
          : `Open it to finish installing the update.\n\n${status.path}`,
        buttons: [isArchive ? 'Show in Folder' : 'Open Installer', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) this.restartAndInstall();
    } else if (status.status === 'error') {
      const { response } = await dialog.showMessageBox({
        type: 'warning',
        title: 'Update failed',
        message: 'The update could not be downloaded',
        detail: `${status.message}\n\nYou can download it manually from the releases page.`,
        buttons: ['Open Releases Page', 'Close'],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) this.openDownloadPage();
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

  /**
   * macOS in-place update. The zip is fetched here rather than by Squirrel so
   * the user sees a real percentage (Squirrel reports no progress), then
   * Squirrel is pointed at the local copy to stage it.
   */
  private async installViaSquirrel(asset: ReleaseAsset): Promise<void> {
    const version = this.latestVersion!;
    const stagingDir = path.join(app.getPath('temp'), 'classifyre-update');
    fs.mkdirSync(stagingDir, { recursive: true });
    const zipPath = await this.downloadToFile(asset, path.join(stagingDir, asset.name));

    this.sendStatus({ status: 'applying', version });
    try {
      await this.applyWithSquirrel(zipPath, version);
    } catch (err) {
      // Typical on unsigned/dev builds ("Could not get code signature") and on
      // any Squirrel refusal. The bytes are already on disk, so keep them
      // rather than making the user download the release a second time.
      console.warn('[update] Squirrel.Mac failed, keeping the download:', (err as Error).message);
      const dest = path.join(app.getPath('downloads'), asset.name);
      fs.copyFileSync(zipPath, dest);
      fs.rmSync(zipPath, { force: true });
      this.manualPath = dest;
      this.sendStatus({ status: 'manual-ready', version, path: dest });
    }
  }

  /**
   * Hands a downloaded zip to Squirrel.Mac over a throwaway loopback server:
   * `/` answers its update query, `/download` serves the local file. Always
   * settles — an unhandled Squirrel outcome rejects on the deadline instead of
   * leaving the updater stuck in `downloading` for the rest of the session.
   */
  private applyWithSquirrel(zipPath: string, version: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.feedServer?.close();
      const server = http.createServer((req, res) => {
        const address = server.address();
        const port = address && typeof address !== 'string' ? address.port : 0;
        if (req.url?.startsWith('/download')) {
          res.writeHead(200, {
            'Content-Type': 'application/zip',
            'Content-Length': String(fs.statSync(zipPath).size),
          });
          fs.createReadStream(zipPath).pipe(res);
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: `http://127.0.0.1:${port}/download`, name: version }));
      });
      this.feedServer = server;

      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Could not start update feed server'));
          return;
        }

        let settled = false;
        const finish = (err: Error | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          autoUpdater.removeListener('update-downloaded', onDownloaded);
          autoUpdater.removeListener('update-not-available', onNotAvailable);
          autoUpdater.removeListener('error', onError);
          server.close();
          this.feedServer = null;
          if (err) reject(err);
          else resolve();
        };
        const onDownloaded = () => {
          this.squirrelReady = true;
          this.sendStatus({ status: 'ready', version });
          finish(null);
        };
        const onNotAvailable = () =>
          finish(new Error('macOS rejected the update package (no update applied)'));
        const onError = (err: Error) => finish(err);
        const deadline = setTimeout(
          () => finish(new Error('Timed out waiting for macOS to prepare the update')),
          SQUIRREL_APPLY_TIMEOUT_MS,
        );
        deadline.unref?.();

        autoUpdater.on('update-downloaded', onDownloaded);
        autoUpdater.on('update-not-available', onNotAvailable);
        autoUpdater.on('error', onError);

        try {
          autoUpdater.setFeedURL({ url: `http://127.0.0.1:${address.port}/` });
          autoUpdater.checkForUpdates();
        } catch (err) {
          finish(err as Error);
        }
      });
    });
  }

  /** Downloads an asset to ~/Downloads and marks it as install-it-yourself. */
  private async downloadToDisk(asset: ReleaseAsset, targetDir: string): Promise<void> {
    const dest = await this.downloadToFile(asset, path.join(targetDir, asset.name));
    this.manualPath = dest;
    this.sendStatus({ status: 'manual-ready', version: this.latestVersion!, path: dest });
  }

  /** Streams an asset to `dest`, reporting percent progress. Returns `dest`. */
  private async downloadToFile(asset: ReleaseAsset, dest: string): Promise<string> {
    const version = this.latestVersion!;
    this.sendStatus({ status: 'downloading', version, percent: 0 });

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
    return dest;
  }

  private sendStatus(status: UpdateStatus): void {
    this.lastStatus = status;
    for (const listener of this.listeners) listener(status);
  }
}
