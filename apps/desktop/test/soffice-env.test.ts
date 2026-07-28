/**
 * Unit test for the LibreOffice override handed to the CLI.
 *
 * Legacy Office extraction (.doc/.xls/.ppt) runs `soffice` out of process. The
 * desktop bundle does not ship LibreOffice, so a user whose install sits outside
 * PATH and outside the CLI's platform fallback table has exactly one way to point
 * the CLI at it: CLASSIFYRE_SOFFICE_PATH. If this stops being forwarded, those
 * users get the "install LibreOffice" failure despite having it installed.
 *
 * Run with Node 22:
 *   npx tsx test/soffice-env.test.ts
 */

import assert from 'node:assert/strict';

import { SOFFICE_PATH_ENV, sofficeEnv } from '../src/main/soffice-env';

// The name is a contract with apps/cli/src/utils/legacy_office.py; renaming one
// side alone breaks the override with no visible failure.
assert.equal(SOFFICE_PATH_ENV, 'CLASSIFYRE_SOFFICE_PATH');

// No override set: emit nothing, so the CLI runs its own PATH + platform-fallback
// resolution instead of being pinned to an empty value.
assert.deepEqual(sofficeEnv({}), {});

// An override reaches the child verbatim.
assert.deepEqual(sofficeEnv({ [SOFFICE_PATH_ENV]: '/opt/lo/program/soffice' }), {
  [SOFFICE_PATH_ENV]: '/opt/lo/program/soffice',
});

// Whitespace is trimmed rather than forwarded: the CLI treats a non-existent
// path as a warning and falls back, but a bare " " would be a confusing log line.
assert.deepEqual(sofficeEnv({ [SOFFICE_PATH_ENV]: '  /opt/lo/soffice  ' }), {
  [SOFFICE_PATH_ENV]: '/opt/lo/soffice',
});

// A blank or whitespace-only value must not be forwarded — it would otherwise
// override the user's real install with nothing.
assert.deepEqual(sofficeEnv({ [SOFFICE_PATH_ENV]: '' }), {});
assert.deepEqual(sofficeEnv({ [SOFFICE_PATH_ENV]: '   ' }), {});

console.log('soffice-env: all assertions passed');
