import { protocol, net } from 'electron';
import path from 'path';
import fs from 'fs';

// Must match DYNAMIC_ID_SENTINEL / generateStaticParams in apps/web (the segment
// name the static export emits for dynamic [id] routes).
const DYNAMIC_ID_SENTINEL = '__id__';

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

/** What {@link resolveRequestPath} decided to do with a request. */
export type ResolvedRequest =
  | { kind: 'file'; filePath: string }
  /** Unresolved document navigation → serve the SPA shell (root index.html). */
  | { kind: 'shell' }
  /** Unresolved asset or RSC data file → 404 (never HTML). */
  | { kind: 'notFound' };

/**
 * Resolve a dynamic-route request against the placeholder shell. The static
 * export emits every dynamic route once, under the DYNAMIC_ID_SENTINEL segment
 * (e.g. sources/__id__/…), including its RSC data files (index.txt,
 * __next.*.txt). We walk the requested path matching each segment to a literal
 * directory first, then the placeholder directory, so BOTH the document
 * (…/<id>/ -> …/__id__/index.html) and the client-navigation RSC payloads
 * (…/<id>/index.txt -> …/__id__/index.txt) resolve to that shell. The page then
 * reads the real id from the URL (apps/web/lib/use-route-id.ts). Returns the
 * file to serve, or null if the path doesn't correspond to any exported route.
 *
 * The FINAL segment is matched against a literal file BEFORE the placeholder
 * directory: a route that has a dynamic child (findings/__id__, sources/__id__)
 * also owns RSC data files next to that child, and descending into the child
 * shell would answer `…/findings/index.txt` with the child's index.html. Next
 * then sees HTML where it expected an RSC payload and falls back to a hard
 * navigation, which re-triggers the same request — an endless reload loop.
 */
function resolveDynamic(resolvedRoot: string, segments: string[]): string | null {
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
    // A final segment may be a leaf file (the route's index.txt /
    // __next.*.txt data file living in the shell dir).
    if (isLast && isFile(path.join(dir, segment))) return path.join(dir, segment);
    const placeholderDir = path.join(dir, DYNAMIC_ID_SENTINEL);
    if (isDir(placeholderDir)) {
      dir = placeholderDir; // this segment is a dynamic id value
      continue;
    }
    return null;
  }
  // All segments consumed as directories → the route's document.
  const index = path.join(dir, 'index.html');
  return isFile(index) ? index : null;
}

/**
 * Map an `app://classifyre/<pathname>` request onto a file in the static export.
 * Pure apart from filesystem reads, so it is unit-testable without Electron.
 */
export function resolveRequestPath(
  resolvedRoot: string,
  pathname: string,
): ResolvedRequest {
  const rawPath = decodeURIComponent(pathname).replace(/^\/+/, '');
  const filePath = path.resolve(resolvedRoot, rawPath);

  // Reject path traversal outside the web root.
  if (filePath !== resolvedRoot && !filePath.startsWith(resolvedRoot + path.sep)) {
    return { kind: 'shell' };
  }

  // Direct hit: an existing static asset (_next/static/…, images) or the files
  // of a static route (its index.html / index.txt / __next.*.txt).
  if (isFile(filePath)) return { kind: 'file', filePath };
  const asDir = path.join(filePath, 'index.html');
  if (isFile(asDir)) return { kind: 'file', filePath: asDir };
  if (isFile(filePath + '.html')) return { kind: 'file', filePath: filePath + '.html' };

  // Dynamic route (document or RSC data) resolved against the placeholder shell.
  const dynamic = resolveDynamic(resolvedRoot, rawPath.split('/').filter(Boolean));
  if (dynamic) return { kind: 'file', filePath: dynamic };

  // Genuinely unresolved. For a document navigation (extension-less path) fall
  // back to the SPA shell so client routing can take over; for a missing asset
  // or data file (has an extension) return 404 rather than the overview HTML —
  // serving HTML in place of an RSC payload would make Next render the wrong
  // route.
  const lastSegment = rawPath.split('/').filter(Boolean).pop() ?? '';
  return lastSegment.includes('.') ? { kind: 'notFound' } : { kind: 'shell' };
}

export function registerAppProtocol(staticDir: string): void {
  const resolvedRoot = path.resolve(staticDir);
  const rootIndex = path.join(resolvedRoot, 'index.html');
  const serve = (filePath: string) => net.fetch(`file://${filePath}`);

  protocol.handle('app', (request) => {
    const resolved = resolveRequestPath(
      resolvedRoot,
      new URL(request.url).pathname,
    );
    switch (resolved.kind) {
      case 'file':
        return serve(resolved.filePath);
      case 'shell':
        return serve(rootIndex);
      case 'notFound':
        return new Response('Not found', { status: 404 });
    }
  });
}
