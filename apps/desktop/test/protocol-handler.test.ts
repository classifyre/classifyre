/**
 * Unit test for the app:// static-export resolver.
 *
 * Guards the regression that made every namespaced page reload forever: RSC
 * data files (`index.txt`, `__next.*.txt`) of a route that owns a dynamic child
 * were resolved into that child's shell and answered with `index.html`. Next
 * saw HTML where it expected an RSC payload, fell back to a hard navigation,
 * and the fresh document re-issued the same request.
 *
 * Run with Node 22:
 *   npx tsx test/protocol-handler.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { resolveRequestPath } from '../src/main/protocol-handler';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'classifyre-export-'));

// A miniature of `apps/web/out` for the namespaced dashboard: every page lives
// under a `[locale]` tree, then the `[namespaceSlug]` shell, and
// findings/sources own a further `[id]` shell of their own. The app's own deep
// links stay locale-free (`app://classifyre/acme/findings/`), so the resolver
// has to find them under the default locale.
const localised = [
  'index.html',
  'index.txt',
  '__id__/index.html',
  '__id__/index.txt',
  '__id__/findings/index.html',
  '__id__/findings/index.txt',
  '__id__/findings/__next._tree.txt',
  '__id__/findings/__id__/index.html',
  '__id__/findings/__id__/index.txt',
  '__id__/sources/index.html',
  '__id__/sources/index.txt',
  '__id__/sources/new/index.html',
  '__id__/sources/__id__/index.html',
  'namespaces/__id__/settings/index.html',
];
const files = [
  ...localised.flatMap((file) => [`en/${file}`, `de/${file}`]),
  '_next/static/chunks/app.js',
  // The bundled documentation site is English-only and sits outside the
  // locale trees.
  'docs/how-it-works/index.html',
];
for (const file of files) {
  fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), '');
}

const expectFile = (pathname: string, expected: string) => {
  const resolved = resolveRequestPath(root, pathname);
  assert.equal(resolved.kind, 'file', `${pathname} should resolve to a file`);
  assert.equal(
    path.relative(root, (resolved as { filePath: string }).filePath),
    path.normalize(expected),
    `${pathname} resolved to the wrong file`,
  );
};

const expectKind = (pathname: string, kind: 'shell' | 'notFound') => {
  assert.equal(resolveRequestPath(root, pathname).kind, kind, `${pathname}`);
};

// Documents: the namespace slug and every entity id map onto the shells, with
// the default locale supplied by the resolver.
expectFile('/', 'en/index.html');
expectFile('/index.html', 'en/index.html');
expectFile('/acme/', 'en/__id__/index.html');
expectFile('/acme/findings/', 'en/__id__/findings/index.html');
expectFile('/acme/findings/abc-123/', 'en/__id__/findings/__id__/index.html');
expectFile('/acme/sources/new/', 'en/__id__/sources/new/index.html');
expectFile('/acme/sources/abc-123/', 'en/__id__/sources/__id__/index.html');
expectFile('/namespaces/abc-123/settings/', 'en/namespaces/__id__/settings/index.html');

// An explicit locale prefix resolves directly, without the fallback.
expectFile('/de/', 'de/index.html');
expectFile('/de/acme/findings/', 'de/__id__/findings/index.html');
expectFile('/en/acme/findings/abc-123/', 'en/__id__/findings/__id__/index.html');

// The bundled docs are not localised and must not be pushed under a locale.
expectFile('/docs/how-it-works/', 'docs/how-it-works/index.html');

// RSC payloads of a route that ALSO has a dynamic child must resolve to that
// route's own data file, never to the child's document. This is the regression.
expectFile('/acme/index.txt', 'en/__id__/index.txt');
expectFile('/acme/findings/index.txt', 'en/__id__/findings/index.txt');
expectFile('/acme/findings/__next._tree.txt', 'en/__id__/findings/__next._tree.txt');
expectFile('/acme/sources/index.txt', 'en/__id__/sources/index.txt');
expectFile('/acme/findings/abc-123/index.txt', 'en/__id__/findings/__id__/index.txt');
expectFile('/de/acme/findings/index.txt', 'de/__id__/findings/index.txt');

// Static assets are served verbatim.
expectFile('/_next/static/chunks/app.js', '_next/static/chunks/app.js');

// Unresolved: a document falls back to the SPA shell, an asset/data file 404s
// rather than being answered with HTML.
expectKind('/acme/nope/', 'shell');
expectKind('/acme/nope/index.txt', 'notFound');
expectKind('/_next/static/chunks/missing.js', 'notFound');

// Path traversal never escapes the web root.
expectKind('/../../etc/passwd', 'shell');

fs.rmSync(root, { recursive: true, force: true });
console.log('protocol-handler: all assertions passed');
