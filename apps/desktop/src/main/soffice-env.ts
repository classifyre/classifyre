/**
 * LibreOffice location handed down to the CLI for legacy Office extraction.
 *
 * `.doc` / `.xls` / `.ppt` have no pure-Python parser, so the CLI shells out to
 * `soffice --headless --convert-to docx|xlsx|pptx` (apps/cli/src/utils/legacy_office.py).
 *
 * The desktop app does NOT bundle LibreOffice. It is ~550 MB even with help,
 * galleries and templates stripped, and slimming the upstream bundle breaks its
 * code signature — which Apple Silicon punishes by SIGKILLing the binary on
 * launch. Instead the app uses a system install, and the CLI reports a clear,
 * platform-specific "install LibreOffice" error when there is none, so those
 * documents fail visibly rather than being scanned as empty.
 *
 * The CLI finds a system install by itself:
 *   - Linux:   /usr/bin/soffice, already on the PATH the app rebuilds.
 *   - macOS:   /Applications/LibreOffice.app/... — NOT on PATH, because
 *              getSystemPath() deliberately refuses to inherit the user's login
 *              shell in packaged mode. The CLI's platform fallback table covers it.
 *   - Windows: %ProgramFiles%\LibreOffice\program\soffice.exe, likewise a fallback.
 *
 * This module covers only the remaining case: an install in none of those
 * places. Forwarding is explicit rather than incidental — packaged mode spreads
 * `process.env` into the child, so the variable would survive by accident today,
 * and silently stop surviving the day that spread is tightened.
 */

/** Env var read by apps/cli/src/utils/legacy_office.py (SOFFICE_PATH_ENV). */
export const SOFFICE_PATH_ENV = 'CLASSIFYRE_SOFFICE_PATH';

/**
 * Build the soffice-related env for the spawned API (which passes it to every
 * CLI process it starts). Returns an empty object when no override is set, so
 * the CLI falls through to its own PATH and platform-fallback resolution.
 */
export function sofficeEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const override = env[SOFFICE_PATH_ENV]?.trim();
  return override ? { [SOFFICE_PATH_ENV]: override } : {};
}
