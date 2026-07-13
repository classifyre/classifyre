"use client";

import * as React from "react";
import { Boxes, Minimize2 } from "lucide-react";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { useTranslation } from "@/hooks/use-translation";
import type { ClusteredGraph } from "./use-clustered-graph";

/**
 * Toolbar chip for the semantic-zoom state: how many communities were
 * detected, and a one-click way back to the calm overview.
 */
export function ClusterControls({ clustered }: { clustered: ClusteredGraph }) {
  const { t } = useTranslation();
  if (clustered.clusters.size === 0) return null;
  return (
    <>
      <Badge variant="outline" className="gap-1 text-[10px] uppercase">
        <Boxes className="h-3 w-3" />
        {t("graphExplorer.clusters", { count: String(clustered.clusters.size) })}
      </Badge>
      {clustered.expandedClusters.size > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-8"
          onClick={clustered.collapseAll}
        >
          <Minimize2 className="mr-1.5 h-3.5 w-3.5" />
          {t("graphExplorer.collapseAll")}
        </Button>
      )}
    </>
  );
}
