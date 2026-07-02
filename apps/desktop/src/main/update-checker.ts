import { app, net, shell } from 'electron';
import type { WebContentsView } from 'electron';

// Lightweight release check against GitHub. Full auto-update is intentionally
// not implemented: Electron Forge does not produce electron-updater metadata,
// and unsigned macOS apps cannot self-update anyway. Instead we surface an
// "update available" badge in the tab bar; clicking it opens the release page.

const RELEASES_API = 'https://api.github.com/repos/classifyre/classifyre/releases/latest';
const RELEASES_PAGE = 'https://github.com/classifyre/classifyre/releases/latest';

type UpdateStatus =
  | { status: 'checking' }
  | { status: 'available'; version: string }
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

export class UpdateChecker {
  private tabBarView: WebContentsView | null = null;
  private latestVersion: string | null = null;

  setTabBarView(view: WebContentsView): void {
    this.tabBarView = view;
  }

  async checkForUpdates(): Promise<void> {
    if (!app.isPackaged) return;

    this.sendStatus({ status: 'checking' });
    try {
      const response = await net.fetch(RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        this.sendStatus({ status: 'not-available' });
        return;
      }
      const release = (await response.json()) as { tag_name?: string; draft?: boolean };
      const tag = release.tag_name;
      if (!tag || release.draft) {
        this.sendStatus({ status: 'not-available' });
        return;
      }

      if (isNewer(tag, app.getVersion())) {
        this.latestVersion = tag.replace(/^v/, '');
        this.sendStatus({ status: 'available', version: this.latestVersion });
      } else {
        this.sendStatus({ status: 'not-available' });
      }
    } catch (err) {
      // Offline or rate-limited — stay silent, this is best-effort.
      this.sendStatus({ status: 'error', message: (err as Error).message });
    }
  }

  /** Opens the GitHub releases page in the default browser. */
  openDownloadPage(): void {
    void shell.openExternal(RELEASES_PAGE);
  }

  getLatestVersion(): string | null {
    return this.latestVersion;
  }

  private sendStatus(status: UpdateStatus): void {
    if (!this.tabBarView) return;
    this.tabBarView.webContents.send('update:status', status);
  }
}
