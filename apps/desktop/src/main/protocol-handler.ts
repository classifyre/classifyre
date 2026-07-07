import { protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';

// Must match DYNAMIC_ID_SENTINEL / generateStaticParams in apps/web (the segment
// name the static export emits for dynamic [id] routes).
const DYNAMIC_ID_SENTINEL = '__id__';

export function registerAppProtocol(staticDir: string): void {
  const resolvedRoot = path.resolve(staticDir);
  const serve = (filePath: string) => net.fetch(`file://${filePath}`);
  const rootIndex = path.join(resolvedRoot, 'index.html');

  const isDir = (p: string): boolean => {
    try {
      return fs.statSync(p).isDirectory();
    } catch {
      return false;
    }
  };
  const isFile = (p: string): boolean => {
    try {
      return fs.statSync(p).isFile();
    } catch {
      return false;
    }
  };

  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rawPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.resolve(resolvedRoot, rawPath);

    // Reject path traversal outside the web root.
    if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) {
      return serve(rootIndex);
    }

    // Direct hit: an existing static asset (_next/static/…, images, .txt payloads).
    if (isFile(filePath)) return serve(filePath);

    // A directory route with an index.html (e.g. /sources/ -> sources/index.html)
    // or a sibling .html (e.g. /404 -> 404.html).
    const asDir = path.join(filePath, 'index.html');
    if (isFile(asDir)) return serve(asDir);
    if (isFile(filePath + '.html')) return serve(filePath + '.html');

    // Dynamic route: the static export only emitted a placeholder shell at the
    // DYNAMIC_ID_SENTINEL segment. Walk the exported tree matching each requested
    // segment against a literal directory first, then the placeholder, and serve
    // that shell's index.html. The page reads the real id from the URL at runtime
    // (apps/web/lib/use-route-id.ts). Without this the fallback below would serve
    // the home page, which is what made every detail URL "redirect" to overview.
    const segments = rawPath.split('/').filter(Boolean);
    let dir = resolvedRoot;
    let matched = segments.length > 0;
    for (const segment of segments) {
      const literal = path.join(dir, segment);
      const placeholder = path.join(dir, DYNAMIC_ID_SENTINEL);
      if (isDir(literal)) {
        dir = literal;
      } else if (isDir(placeholder)) {
        dir = placeholder;
      } else {
        matched = false;
        break;
      }
    }
    if (matched) {
      const shell = path.join(dir, 'index.html');
      if (isFile(shell)) return serve(shell);
    }

    // Last resort: the app shell at the root.
    return serve(rootIndex);
  });
}
