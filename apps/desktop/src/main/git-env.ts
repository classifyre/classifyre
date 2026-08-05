import { app } from 'electron';
import fs from 'fs';
import path from 'path';

/**
 * Which `git` the CLI uses for Git-repository scans.
 *
 * The Git source talks the wire protocol through the git binary rather than any
 * provider's REST API, so a scan is only possible if there is a git to run. That
 * is not a given on a user's machine:
 *
 *   - Windows ships none at all.
 *   - macOS has `/usr/bin/git`, but it is a stub that prompts to install the
 *     Xcode Command Line Tools — and in packaged mode the app deliberately does
 *     not inherit the user's login shell, so a Homebrew git on the PATH is not
 *     visible either.
 *   - Linux distributions usually have one, and it is on the rebuilt PATH.
 *
 * So the app prefers a git staged into `resources/git` at build time (see
 * scripts/stage-resources.sh) and falls back to whatever is on the PATH. The
 * choice is handed to the CLI explicitly through `CLASSIFYRE_GIT_BINARY` rather
 * than left to PATH order, so a user's own git can never quietly take over a
 * scan — which matters because a system git reads the user's `~/.gitconfig`,
 * credential helpers and SSH agent, and the source's whole isolation contract
 * depends on those being unreachable.
 */

/** Env var read by apps/cli/src/sources/git/source.py (`_git_binary`). */
export const GIT_BINARY_ENV = 'CLASSIFYRE_GIT_BINARY';

/** Where a staged git would be, or null outside an Electron main process. */
function bundledGitRoot(): string | null {
  // `app` is undefined when this module is loaded outside Electron (tests, and
  // any tooling that imports it), where there is no bundle to look in.
  if (!app) return null;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'git')
    : path.join(app.getAppPath(), 'resources', 'git');
}

/**
 * The bundled git executable, or null when this build ships none.
 *
 * Both layouts a portable git can arrive in are accepted: MinGit on Windows
 * unpacks to `cmd/git.exe`, while a relocatable POSIX build has `bin/git`.
 */
export function findBundledGit(root: string | null = bundledGitRoot()): string | null {
  if (!root) return null;

  const candidates =
    process.platform === 'win32'
      ? [path.join(root, 'cmd', 'git.exe'), path.join(root, 'bin', 'git.exe')]
      : [path.join(root, 'bin', 'git'), path.join(root, 'libexec', 'git-core', 'git')];

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      // Not this layout; try the next.
    }
  }
  return null;
}

/**
 * Git-related env for the spawned API, which passes it to every CLI process.
 *
 * An explicit override always wins, so a user with an unusual install can point
 * the app at it. Returning an empty object leaves the CLI to resolve git from
 * the PATH itself, and to report a clear "git is not installed" error when there
 * is none — which is what makes a missing git a visible failure rather than a
 * source that mysteriously finds nothing.
 */
export function gitEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const override = env[GIT_BINARY_ENV]?.trim();
  if (override) return { [GIT_BINARY_ENV]: override };

  const bundled = findBundledGit();
  return bundled ? { [GIT_BINARY_ENV]: bundled } : {};
}
