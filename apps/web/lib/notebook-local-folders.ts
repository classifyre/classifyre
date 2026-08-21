/**
 * Validation for the local folders a CUSTOM source declares.
 *
 * Kept out of the component for the same reason the package rules are: these
 * mirror `NotebookLocalFolder` in `all_input_sources.json`, and a form that
 * accepts what the schema rejects turns a typo into a 400 on save.
 */

/** Mirrors NotebookLocalFolder.name -- a Python identifier, since ctx.folder() takes it. */
export const FOLDER_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

export interface NotebookLocalFolder {
  name: string;
  path: string;
}

export type FolderProblem =
  | "nameRequired"
  | "invalidName"
  | "duplicate"
  | "pathRequired"
  | "pathNotAbsolute";

export function validateLocalFolder(
  folders: NotebookLocalFolder[],
  index: number,
): FolderProblem | null {
  const entry = folders[index];
  if (!entry) return null;

  const name = entry.name.trim();
  if (!name) return "nameRequired";
  if (!FOLDER_NAME_PATTERN.test(name)) return "invalidName";

  const names = folders.map((other) => other.name.trim());
  if (names.indexOf(name) !== index) return "duplicate";

  const path = entry.path.trim();
  if (!path) return "pathRequired";
  // Both shapes, because the desktop app runs on Windows too and a relative
  // path would resolve against the runner's working directory rather than
  // against anything the author meant.
  if (!(path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)))
    return "pathNotAbsolute";

  return null;
}

export function localFoldersAreValid(folders: NotebookLocalFolder[]): boolean {
  return folders.every(
    (_, index) => validateLocalFolder(folders, index) === null,
  );
}

/**
 * The list as it should be saved.
 *
 * A half-filled row is the in-progress state of the form, not a declaration, so
 * it is dropped rather than sent as a folder with no path.
 */
export function localFoldersToConfig(
  folders: NotebookLocalFolder[],
): NotebookLocalFolder[] {
  return folders
    .filter((entry) => entry.name.trim() && entry.path.trim())
    .map((entry) => ({ name: entry.name.trim(), path: entry.path.trim() }));
}
