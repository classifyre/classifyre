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

/**
 * Every source type, in both deployments.
 *
 * The folder source used to be filtered out here on hosted deployments, on the
 * reasoning that they have no local disk to scan. That is true of the API pod
 * and irrelevant to the scan: a scan runs where the folder is mounted — inside
 * the all-in-one container, or in a CLI job pod that the chart's
 * `api.localFolders` mounts a PVC, an NFS export or a ConfigMap into. Nothing
 * is deployment-gated any more.
 */
const ALL_SOURCE_CATALOG_ENTRIES: SourceCatalogEntry[] = Object.keys(
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
      entries={ALL_SOURCE_CATALOG_ENTRIES}
      onSelect={(sourceType) => onSelect(sourceType as SourceType)}
    />
  );
}
