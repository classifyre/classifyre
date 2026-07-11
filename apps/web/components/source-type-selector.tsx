"use client";

import { SourceCatalog } from "@workspace/ui/components/source-catalog";
import {
  resolveSourceCatalogMeta,
  SOURCE_TYPE_CATALOG_META,
  type SourceCatalogEntry,
} from "@workspace/ui/lib/source-catalog";
import type { SourceType } from "@/components/source-form";
import { isDesktopRuntime } from "@/lib/desktop";

interface SourceTypeSelectorProps {
  onSelect: (type: SourceType) => void;
}

// Source types that scan the machine the API runs on. Only safe to expose in
// the desktop (Electron) app or local development — never in a hosted /
// kubernetes / docker deployment. Kept data-driven so filtering doesn't need
// per-type string checks scattered around the UI.
const DESKTOP_ONLY_SOURCE_TYPES = new Set<string>(["LOCAL_FOLDER"]);

const ALL_SOURCE_CATALOG_ENTRIES: SourceCatalogEntry[] = Object.keys(
  SOURCE_TYPE_CATALOG_META,
)
  .map((sourceType) => ({
    type: sourceType,
    ...resolveSourceCatalogMeta(sourceType),
  }))
  .sort((left, right) => left.label.localeCompare(right.label));

export function SourceTypeSelector({ onSelect }: SourceTypeSelectorProps) {
  const entries = isDesktopRuntime()
    ? ALL_SOURCE_CATALOG_ENTRIES
    : ALL_SOURCE_CATALOG_ENTRIES.filter(
        (entry) => !DESKTOP_ONLY_SOURCE_TYPES.has(entry.type),
      );

  return (
    <SourceCatalog
      entries={entries}
      onSelect={(sourceType) => onSelect(sourceType as SourceType)}
    />
  );
}
