/**
 * Applying `patch_fields` to the parts of a CUSTOM source that are not in the
 * form.
 *
 * A CUSTOM source's packages, variables, secrets and folders are rendered by
 * hand, not by the schema renderer — the source form strips those sections out
 * precisely so `CustomSourceConfig` can own them. That left the assistant
 * patching a form that no longer had the fields: it would report "Filled in
 * optional.packages", nothing would change, and the next run failed on the
 * import it thought it had declared. These paths are routed here instead.
 */

import type { KeyValueEntry } from "@/components/key-value-field";
import type { CustomSourceDraft } from "@/components/notebook/custom-source-config";
import type { NotebookPackage } from "@/lib/notebook-packages";
import type { NotebookLocalFolder } from "@/lib/notebook-local-folders";

export interface DraftPatch {
  path: string;
  value: unknown;
}

/** The prefixes this module owns. Anything else belongs to the schema form. */
const DRAFT_PREFIXES = [
  "optional.packages",
  "optional.variables",
  "optional.local_folders",
  "masked.secrets",
] as const;

export function isDraftPatchPath(path: string): boolean {
  return DRAFT_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}.`),
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toEntries(value: unknown): KeyValueEntry[] | null {
  const record = asRecord(value);
  if (!record) return null;
  return Object.entries(record).map(([key, entry]) => ({
    key,
    value: typeof entry === "string" ? entry : String(entry ?? ""),
  }));
}

function upsertEntry(
  entries: KeyValueEntry[],
  key: string,
  value: unknown,
): KeyValueEntry[] {
  const text = typeof value === "string" ? value : String(value ?? "");
  const index = entries.findIndex((entry) => entry.key === key);
  if (index === -1) return [...entries, { key, value: text }];
  return entries.map((entry, position) =>
    position === index ? { ...entry, value: text } : entry,
  );
}

function toPackages(value: unknown): NotebookPackage[] | null {
  if (!Array.isArray(value)) return null;
  const packages: NotebookPackage[] = [];
  for (const entry of value) {
    // Both shapes the model reaches for: {"name":"pandas"} and "pandas".
    if (typeof entry === "string" && entry.trim()) {
      packages.push({ name: entry.trim() });
      continue;
    }
    const record = asRecord(entry);
    const name = record && typeof record.name === "string" ? record.name : "";
    if (!name.trim()) continue;
    const version =
      record && typeof record.version === "string" && record.version.trim()
        ? record.version.trim()
        : undefined;
    packages.push(version ? { name: name.trim(), version } : { name: name.trim() });
  }
  return packages;
}

function toFolders(value: unknown): NotebookLocalFolder[] | null {
  if (!Array.isArray(value)) return null;
  const folders: NotebookLocalFolder[] = [];
  for (const entry of value) {
    const record = asRecord(entry);
    if (!record) continue;
    const name = typeof record.name === "string" ? record.name : "";
    const path = typeof record.path === "string" ? record.path : "";
    if (name && path) folders.push({ name, path });
  }
  return folders;
}

/**
 * Merge the packages a patch declares into the ones already there.
 *
 * Merged rather than replaced: the model is usually adding the one import it
 * just wrote, and sending only that would otherwise wipe the packages the
 * author added by hand. A repeated name keeps the incoming version.
 */
function mergePackages(
  current: NotebookPackage[],
  incoming: NotebookPackage[],
): NotebookPackage[] {
  const merged = [...current];
  for (const entry of incoming) {
    const index = merged.findIndex(
      (existing) => existing.name.toLowerCase() === entry.name.toLowerCase(),
    );
    if (index === -1) merged.push(entry);
    else merged[index] = entry;
  }
  return merged;
}

/**
 * Apply the draft-owned patches, returning the new draft and the paths taken.
 *
 * Unknown or malformed values are skipped rather than throwing: one bad patch
 * in a reply should cost that patch, not the whole edit.
 */
export function applyDraftPatches(
  draft: CustomSourceDraft,
  patches: readonly DraftPatch[],
): { draft: CustomSourceDraft; applied: string[] } {
  let next = draft;
  const applied: string[] = [];

  const take = (path: string, change: () => CustomSourceDraft | null) => {
    const result = change();
    if (result) {
      next = result;
      applied.push(path);
    }
  };

  for (const patch of patches) {
    const { path, value } = patch;

    if (path === "optional.packages") {
      take(path, () => {
        const packages = toPackages(value);
        return packages
          ? { ...next, packages: mergePackages(next.packages, packages) }
          : null;
      });
      continue;
    }

    if (path === "optional.variables") {
      take(path, () => {
        const entries = toEntries(value);
        return entries ? { ...next, variables: entries } : null;
      });
      continue;
    }

    if (path.startsWith("optional.variables.")) {
      const key = path.slice("optional.variables.".length);
      take(path, () =>
        key
          ? { ...next, variables: upsertEntry(next.variables, key, value) }
          : null,
      );
      continue;
    }

    if (path === "masked.secrets") {
      take(path, () => {
        const entries = toEntries(value);
        return entries ? { ...next, secrets: entries } : null;
      });
      continue;
    }

    if (path.startsWith("masked.secrets.")) {
      const key = path.slice("masked.secrets.".length);
      take(path, () =>
        key ? { ...next, secrets: upsertEntry(next.secrets, key, value) } : null,
      );
      continue;
    }

    if (path === "optional.local_folders") {
      take(path, () => {
        const folders = toFolders(value);
        return folders ? { ...next, localFolders: folders } : null;
      });
    }
  }

  return { draft: next, applied };
}
