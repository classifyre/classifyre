import { app } from 'electron';
import path from 'path';
import fs from 'fs';

// Workspace thumbnails: a snapshot of the workspace view captured when the
// user switches away from (or closes) a tab, shown on the selector cards.
// Best-effort everywhere — a missing or failed thumbnail must never affect
// the workspace lifecycle.

const THUMBNAIL_WIDTH = 640;

function thumbnailDir(): string {
  const base = process.env['CLASSIFYRE_DATA_DIR'] || app.getPath('userData');
  return path.join(base, 'thumbnails');
}

function thumbnailPath(namespaceId: string): string {
  // Namespace ids are randomUUID()s, so they are filesystem-safe as-is.
  return path.join(thumbnailDir(), `${namespaceId}.png`);
}

export async function captureViewThumbnail(
  namespaceId: string,
  view: Electron.WebContentsView,
): Promise<void> {
  try {
    const wc = view.webContents;
    if (wc.isDestroyed() || wc.isCrashed()) return;
    const image = await wc.capturePage();
    if (image.isEmpty()) return;
    const { width } = image.getSize();
    const scaled = width > THUMBNAIL_WIDTH ? image.resize({ width: THUMBNAIL_WIDTH }) : image;
    await fs.promises.mkdir(thumbnailDir(), { recursive: true });
    await fs.promises.writeFile(thumbnailPath(namespaceId), scaled.toPNG());
  } catch (err) {
    console.warn(`[thumbnails] capture failed for ${namespaceId}:`, err);
  }
}

export function getThumbnailDataUrl(namespaceId: string): string | null {
  try {
    const buffer = fs.readFileSync(thumbnailPath(namespaceId));
    return `data:image/png;base64,${buffer.toString('base64')}`;
  } catch {
    return null;
  }
}

export function deleteThumbnail(namespaceId: string): void {
  try {
    fs.rmSync(thumbnailPath(namespaceId), { force: true });
  } catch {
    // best-effort
  }
}
