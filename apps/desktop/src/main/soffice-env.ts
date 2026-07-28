/**
 * LibreOffice location handed down to the CLI for legacy Office extraction.
 *
 * `.doc` / `.xls` / `.ppt` have no pure-Python parser, so the CLI shells out to
 * `soffice --headless --convert-to docx|xlsx|pptx` (apps/cli/src/utils/legacy_office.py).
 * Without a binary those files scan as "no content available" — a silent
 * coverage gap rather than a visible error, which is why the desktop bundle
 * ships its own copy (scripts/stage-libreoffice.sh) instead of hoping the user
 * installed one.
 *
 * Resolution order, most explicit first:
 *   1. CLASSIFYRE_SOFFICE_PATH already in the environment — an operator override.
 *   2. The bundled copy under resources/libreoffice (packaged builds only).
 *   3. Nothing: the CLI then runs its own PATH + platform-fallback search, which
 *      is what unpackaged dev runs and any future unbundled build rely on.
 */

import fs from 'node:fs';
import path from 'node:path';

/** Env var read by apps/cli/src/utils/legacy_office.py (SOFFICE_PATH_ENV). */
export const SOFFICE_PATH_ENV = 'CLASSIFYRE_SOFFICE_PATH';

/**
 * Where stage-libreoffice.sh puts the binary inside resources/, per platform.
 * macOS keeps the .app wrapper: soffice resolves its own libraries and registry
 * relative to the bundle, so flattening it breaks startup.
 */
const BUNDLED_SOFFICE_RELATIVE: Partial<Record<NodeJS.Platform, string>> = {
  darwin: path.join('libreoffice', 'LibreOffice.app', 'Contents', 'MacOS', 'soffice'),
  win32: path.join('libreoffice', 'program', 'soffice.exe'),
  linux: path.join('libreoffice', 'program', 'soffice'),
};

export interface SofficeEnvOptions {
  env?: NodeJS.ProcessEnv;
  /** electron's process.resourcesPath; ignored when isPackaged is false. */
  resourcesPath?: string;
  platform?: NodeJS.Platform;
  isPackaged?: boolean;
  /** Injectable for tests. */
  fileExists?: (candidate: string) => boolean;
}

/**
 * Absolute path to the bundled binary, or null when this build has none
 * (unpackaged dev, an unsupported platform, or a bundle staged with
 * SKIP_LIBREOFFICE=1).
 */
export function bundledSofficePath(options: SofficeEnvOptions = {}): string | null {
  const {
    resourcesPath,
    platform = process.platform,
    isPackaged = false,
    fileExists = fs.existsSync,
  } = options;

  if (!isPackaged || !resourcesPath) return null;

  const relative = BUNDLED_SOFFICE_RELATIVE[platform];
  if (!relative) return null;

  const candidate = path.join(resourcesPath, relative);
  return fileExists(candidate) ? candidate : null;
}

/**
 * Build the soffice-related env for the spawned API, which passes it to every
 * CLI process it starts. Empty when there is nothing to say, leaving the CLI to
 * find a system install by itself.
 */
export function sofficeEnv(options: SofficeEnvOptions = {}): Record<string, string> {
  const { env = process.env } = options;

  const override = env[SOFFICE_PATH_ENV]?.trim();
  if (override) return { [SOFFICE_PATH_ENV]: override };

  const bundled = bundledSofficePath(options);
  return bundled ? { [SOFFICE_PATH_ENV]: bundled } : {};
}
