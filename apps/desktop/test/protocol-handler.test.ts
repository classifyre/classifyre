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

// A miniature of `apps/web/out` for the namespaced dashboard: every tenant page
// lives under the `[namespaceSlug]` shell, and findings/sources own a further
// `[id]` shell of their own.
const files = [
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
  '_next/static/chunks/app.js',
  'namespaces/__id__/settings/index.html',
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

// Documents: the namespace slug and every entity id map onto the shells.
expectFile('/', 'index.html');
expectFile('/index.html', 'index.html');
expectFile('/acme/', '__id__/index.html');
expectFile('/acme/findings/', '__id__/findings/index.html');
expectFile('/acme/findings/abc-123/', '__id__/findings/__id__/index.html');
expectFile('/acme/sources/new/', '__id__/sources/new/index.html');
expectFile('/acme/sources/abc-123/', '__id__/sources/__id__/index.html');
expectFile('/namespaces/abc-123/settings/', 'namespaces/__id__/settings/index.html');

// RSC payloads of a route that ALSO has a dynamic child must resolve to that
// route's own data file, never to the child's document. This is the regression.
expectFile('/acme/index.txt', '__id__/index.txt');
expectFile('/acme/findings/index.txt', '__id__/findings/index.txt');
expectFile('/acme/findings/__next._tree.txt', '__id__/findings/__next._tree.txt');
expectFile('/acme/sources/index.txt', '__id__/sources/index.txt');
expectFile('/acme/findings/abc-123/index.txt', '__id__/findings/__id__/index.txt');

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
