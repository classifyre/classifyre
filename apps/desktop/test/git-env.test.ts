/**
 * Unit test for the git binary handed to the CLI.
 *
 * Git-repository scans run `git` out of process. Which git that is decides two
 * things at once: whether a scan is possible at all (Windows ships none) and
 * whether it is isolated (a system git reads the user's ~/.gitconfig, credential
 * helpers and SSH agent — the exact ambient state the source is built to avoid).
 * Both failures are silent, so the resolution rules are pinned here.
 *
 * Run with Node 22:
 *   npx tsx test/git-env.test.ts
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { GIT_BINARY_ENV, findBundledGit, gitEnv } from '../src/main/git-env';

// The name is a contract with apps/cli/src/sources/git/source.py (_git_binary);
// renaming one side alone silently drops the pin and falls back to PATH.
assert.equal(GIT_BINARY_ENV, 'CLASSIFYRE_GIT_BINARY');

// An explicit override reaches the child verbatim, so a user with an unusual
// install can point the app at it.
assert.deepEqual(gitEnv({ [GIT_BINARY_ENV]: '/opt/git/bin/git' }), {
  [GIT_BINARY_ENV]: '/opt/git/bin/git',
});
assert.deepEqual(gitEnv({ [GIT_BINARY_ENV]: '  /opt/git/bin/git  ' }), {
  [GIT_BINARY_ENV]: '/opt/git/bin/git',
});

// A blank value must not be forwarded: pinning the CLI to an empty path would
// break every scan on a machine that has a perfectly good git.
assert.deepEqual(gitEnv({ [GIT_BINARY_ENV]: '' }), {});
assert.deepEqual(gitEnv({ [GIT_BINARY_ENV]: '   ' }), {});

// Both layouts a staged portable git arrives in are recognised: MinGit unpacks
// to cmd/git.exe, a relocatable POSIX build to bin/git.
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-env-test-'));
try {
  assert.equal(findBundledGit(root), null, 'an empty resources/git must not be treated as a git');

  const posix = path.join(root, 'bin');
  fs.mkdirSync(posix, { recursive: true });
  fs.writeFileSync(path.join(posix, 'git'), '');
  assert.equal(findBundledGit(root), path.join(posix, 'git'));

  const windows = path.join(root, 'cmd');
  fs.mkdirSync(windows, { recursive: true });
  fs.writeFileSync(path.join(windows, 'git.exe'), '');
  const expected =
    process.platform === 'win32'
      ? path.join(windows, 'git.exe')
      : path.join(posix, 'git');
  assert.equal(findBundledGit(root), expected);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('git-env: all assertions passed');
