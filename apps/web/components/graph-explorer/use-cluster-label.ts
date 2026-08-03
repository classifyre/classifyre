"use client";

import * as React from "react";
import { useSourceTypeLabel } from "@/hooks/use-source-type-label";
import { useTranslation } from "@/hooks/use-translation";
import type {
  ClusterLabelInput,
  ClusterSourceShare,
} from "./use-clustered-graph";

/**
 * How a cluster introduces itself: the source it actually came from, with the
 * connector type as a secondary caption.
 *
 * `title` is the operator's own name for the source ("Enron Email Archive"),
 * falling back to the localized connector name ("S3-Compatible Storage") and
 * finally to the dominant detector — never the raw `S3_COMPATIBLE_STORAGE`
 * enum. `caption` carries the connector name when the title is already a
 * source name, so the two lines never repeat each other.
 */
export interface ClusterCaption {
  title: string;
  caption?: string;
  /** The source to link to — only set when exactly one source is involved. */
  soleSource?: ClusterSourceShare;
  /** Sources beyond the dominant one. */
  extraSourceCount: number;
}

export function useClusterCaption(): (meta: ClusterLabelInput) => ClusterCaption {
  const sourceTypeLabel = useSourceTypeLabel();

  return React.useCallback(
    (meta: ClusterLabelInput): ClusterCaption => {
      const [primary, ...rest] = meta.sources;
      const typeLabel = sourceTypeLabel(primary?.type ?? meta.dominantSourceType);
      const title = primary?.name || typeLabel || meta.dominantDetector || "";
      return {
        title,
        // Only a genuine source name leaves room for the type underneath.
        caption: primary?.name && typeLabel ? typeLabel : undefined,
        soleSource: rest.length === 0 && primary?.id ? primary : undefined,
        extraSourceCount: rest.length,
      };
    },
    [sourceTypeLabel],
  );
}

/**
 * Formatter for the caption drawn under a cluster bubble on the canvas. Kept
 * to a single line — the bubble itself already carries the asset and finding
 * counts, so repeating them here would only crowd the graph.
 */
export function useClusterLabelFormatter(): (meta: ClusterLabelInput) => string {
  const { t } = useTranslation();
  const clusterCaption = useClusterCaption();

  return React.useCallback(
    (meta: ClusterLabelInput) => {
      const { title, extraSourceCount } = clusterCaption(meta);
      if (extraSourceCount === 0) return title;
      return `${title} ${t("graphExplorer.clusterSourcePlusMore", {
        count: String(extraSourceCount),
      })}`;
    },
    [clusterCaption, t],
  );
}
