"use client";

import { SourceCatalog } from "@workspace/ui/components/source-catalog";
import {
  resolveSourceCatalogMeta,
  SOURCE_TYPE_CATALOG_META,
  type SourceCatalogEntry,
} from "@workspace/ui/lib/source-catalog";
import type { SourceType } from "@/components/source-form";

interface SourceTypeSelectorProps {
  onSelect: (type: SourceType) => void;
}

const SOURCE_CATALOG_ENTRIES: SourceCatalogEntry[] = Object.keys(
  SOURCE_TYPE_CATALOG_META,
)
  .map((sourceType) => ({
    type: sourceType,
    ...resolveSourceCatalogMeta(sourceType),
  }))
  .sort((left, right) => left.label.localeCompare(right.label));

export function SourceTypeSelector({ onSelect }: SourceTypeSelectorProps) {
  return (
    <SourceCatalog
      entries={SOURCE_CATALOG_ENTRIES}
      onSelect={(sourceType) => onSelect(sourceType as SourceType)}
    />
  );
}
