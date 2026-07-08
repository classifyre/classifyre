import { protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';

// Must match DYNAMIC_ID_SENTINEL / generateStaticParams in apps/web (the segment
// name the static export emits for dynamic [id] routes).
const DYNAMIC_ID_SENTINEL = '__id__';

export function registerAppProtocol(staticDir: string): void {
  const resolvedRoot = path.resolve(staticDir);
  const serve = (filePath: string) => net.fetch(`file://${filePath}`);
  const notFound = () => new Response('Not found', { status: 404 });
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

  // Resolve a dynamic-route request against the placeholder shell. The static
  // export emits every dynamic route once, under the DYNAMIC_ID_SENTINEL segment
  // (e.g. sources/__id__/…), including its RSC data files (index.txt,
  // __next.*.txt). We walk the requested path matching each segment to a literal
  // directory first, then the placeholder directory, so BOTH the document
  // (…/<id>/ -> …/__id__/index.html) and the client-navigation RSC payloads
  // (…/<id>/index.txt -> …/__id__/index.txt) resolve to that shell. The page then
  // reads the real id from the URL (apps/web/lib/use-route-id.ts). Returns the
  // file to serve, or null if the path doesn't correspond to any exported route.
  const resolveDynamic = (segments: string[]): string | null => {
    if (segments.length === 0) return null;
    let dir = resolvedRoot;
    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!;
      const isLast = i === segments.length - 1;
      const literalDir = path.join(dir, segment);
      if (isDir(literalDir)) {
        dir = literalDir;
        continue;
      }
      const placeholderDir = path.join(dir, DYNAMIC_ID_SENTINEL);
      if (isDir(placeholderDir)) {
        dir = placeholderDir; // this segment is a dynamic id value
        continue;
      }
      // No directory matches. Only a final segment may be a leaf file (e.g. the
      // route's index.txt / __next.*.txt data file living in the shell dir).
      if (isLast && isFile(path.join(dir, segment))) return path.join(dir, segment);
      return null;
    }
    // All segments consumed as directories → the route's document.
    const index = path.join(dir, 'index.html');
    return isFile(index) ? index : null;
  };

  protocol.handle('app', (request) => {
    const url = new URL(request.url);
    const rawPath = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const filePath = path.resolve(resolvedRoot, rawPath);

    // Reject path traversal outside the web root.
    if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) {
      return serve(rootIndex);
    }

    // Direct hit: an existing static asset (_next/static/…, images) or the files
    // of a static route (its index.html / index.txt / __next.*.txt).
    if (isFile(filePath)) return serve(filePath);
    const asDir = path.join(filePath, 'index.html');
    if (isFile(asDir)) return serve(asDir);
    if (isFile(filePath + '.html')) return serve(filePath + '.html');

    // Dynamic route (document or RSC data) resolved against the placeholder shell.
    const dynamic = resolveDynamic(rawPath.split('/').filter(Boolean));
    if (dynamic) return serve(dynamic);

    // Genuinely unresolved. For a document navigation (extension-less path) fall
    // back to the SPA shell so client routing can take over; for a missing asset
    // or data file (has an extension) return 404 rather than the overview HTML —
    // serving HTML in place of an RSC payload would make Next render the wrong
    // route.
    const lastSegment = rawPath.split('/').filter(Boolean).pop() ?? '';
    return lastSegment.includes('.') ? notFound() : serve(rootIndex);
  });
}
