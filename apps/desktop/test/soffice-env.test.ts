/**
 * Unit test for the LibreOffice path handed to the CLI.
 *
 * Legacy Office extraction (.doc/.xls/.ppt) runs `soffice` out of process. The
 * desktop bundle ships its own LibreOffice under resources/libreoffice, and this
 * is the only thing that tells the CLI where it is. If that stops resolving,
 * every legacy Office file silently scans as "no content available" — no error,
 * no crash, just missing coverage that looks exactly like an empty document.
 *
 * Run with Node 22:
 *   npx tsx test/soffice-env.test.ts
 */

import assert from 'node:assert/strict';
import path from 'node:path';

import { SOFFICE_PATH_ENV, bundledSofficePath, sofficeEnv } from '../src/main/soffice-env';

// The name is a contract with apps/cli/src/utils/legacy_office.py; renaming one
// side alone breaks the handoff with no visible failure.
assert.equal(SOFFICE_PATH_ENV, 'CLASSIFYRE_SOFFICE_PATH');

const RESOURCES = '/Applications/Classifyre.app/Contents/Resources';
const always = () => true;
const never = () => false;

// --- bundled resolution, per platform ---------------------------------------
// These relative paths mirror the layout stage-libreoffice.sh produces. macOS
// keeps the .app wrapper because soffice resolves its libraries relative to it.
const expected: Array<[NodeJS.Platform, string]> = [
  ['darwin', 'libreoffice/LibreOffice.app/Contents/MacOS/soffice'],
  ['win32', 'libreoffice/program/soffice.exe'],
  ['linux', 'libreoffice/program/soffice'],
];

for (const [platform, relative] of expected) {
  assert.equal(
    bundledSofficePath({
      resourcesPath: RESOURCES,
      platform,
      isPackaged: true,
      fileExists: always,
    }),
    path.join(RESOURCES, ...relative.split('/')),
    `bundled path for ${platform}`,
  );
}

// Unpackaged dev runs have no staged resources; the CLI must fall through to its
// own PATH search rather than be pinned to a path that does not exist.
assert.equal(
  bundledSofficePath({
    resourcesPath: RESOURCES,
    platform: 'darwin',
    isPackaged: false,
    fileExists: always,
  }),
  null,
);

// A bundle staged with SKIP_LIBREOFFICE=1: the directory is simply absent.
assert.equal(
  bundledSofficePath({
    resourcesPath: RESOURCES,
    platform: 'darwin',
    isPackaged: true,
    fileExists: never,
  }),
  null,
);

// --- env assembly -----------------------------------------------------------
// Packaged app, LibreOffice present: point the CLI straight at it.
assert.deepEqual(
  sofficeEnv({ env: {}, resourcesPath: RESOURCES, platform: 'linux', isPackaged: true, fileExists: always }),
  { [SOFFICE_PATH_ENV]: path.join(RESOURCES, 'libreoffice', 'program', 'soffice') },
);

// An operator override outranks the bundled copy — that is the whole point of
// the variable, and it must not be silently overwritten by what we ship.
assert.deepEqual(
  sofficeEnv({
    env: { [SOFFICE_PATH_ENV]: '/opt/lo/program/soffice' },
    resourcesPath: RESOURCES,
    platform: 'linux',
    isPackaged: true,
    fileExists: always,
  }),
  { [SOFFICE_PATH_ENV]: '/opt/lo/program/soffice' },
);

// Nothing bundled and no override: emit nothing, leaving the CLI to run its own
// PATH + platform-fallback search.
assert.deepEqual(sofficeEnv({ env: {}, isPackaged: false }), {});

// Whitespace is trimmed rather than forwarded, and a blank value must not
// override the bundled copy with nothing.
assert.deepEqual(sofficeEnv({ env: { [SOFFICE_PATH_ENV]: '  /opt/lo/soffice  ' }, isPackaged: false }), {
  [SOFFICE_PATH_ENV]: '/opt/lo/soffice',
});
assert.deepEqual(
  sofficeEnv({ env: { [SOFFICE_PATH_ENV]: '   ' }, resourcesPath: RESOURCES, platform: 'linux', isPackaged: true, fileExists: always }),
  { [SOFFICE_PATH_ENV]: path.join(RESOURCES, 'libreoffice', 'program', 'soffice') },
);

console.log('soffice-env: all assertions passed');
