/**
 * Validation for the packages a notebook declares.
 *
 * Kept out of the component so it can be tested directly, and because these
 * patterns are a boundary rather than a convenience: the name ends up in a
 * package installer's argv, so an argument-looking value must not get past the
 * form. The same patterns are enforced by the JSON schema and re-checked in
 * `apps/cli/src/notebook/packages.py` before the subprocess runs.
 */

/** Mirrors NotebookPackage.name in all_input_sources.json. */
export const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/** Mirrors NotebookPackage.version. Empty means "latest". */
export const PACKAGE_VERSION_PATTERN =
  /^$|^(==|>=|<=|~=|!=|>|<).+$|^[0-9][A-Za-z0-9._*+!-]*$/;

export interface NotebookPackage {
  name: string;
  version?: string;
}

export type PackageProblem =
  | "nameRequired"
  | "invalidName"
  | "invalidVersion"
  | "duplicate";

export function validatePackage(
  packages: NotebookPackage[],
  index: number,
): PackageProblem | null {
  const entry = packages[index];
  if (!entry) return null;

  const name = entry.name.trim();
  if (!name) return "nameRequired";
  if (!PACKAGE_NAME_PATTERN.test(name)) return "invalidName";

  const names = packages.map((other) => other.name.trim().toLowerCase());
  if (names.indexOf(name.toLowerCase()) !== index) return "duplicate";

  if (!PACKAGE_VERSION_PATTERN.test((entry.version ?? "").trim()))
    return "invalidVersion";

  return null;
}

export function packageEntriesAreValid(packages: NotebookPackage[]): boolean {
  return packages.every(
    (_, index) => validatePackage(packages, index) === null,
  );
}

/**
 * The list as it should be saved.
 *
 * A blank row is the in-progress state of the table, not a declaration, so it
 * is dropped rather than sent as an unnamed package.
 */
export function packagesToConfig(
  packages: NotebookPackage[],
): Array<{ name: string; version?: string }> {
  return packages
    .filter((entry) => entry.name.trim())
    .map((entry) => ({
      name: entry.name.trim(),
      ...(entry.version?.trim() ? { version: entry.version.trim() } : {}),
    }));
}
