"use client";

import * as React from "react";
import type { FindingsDiscoveryTopAssetDto } from "@workspace/api-client";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { ConnectionsCanvas } from "./connections-canvas";
import { SemanticMapCard } from "./semantic-map-card";

type MapMode = "sources" | "meaning";

function readMode(): MapMode {
  if (typeof window === "undefined") return "sources";
  return new URLSearchParams(window.location.search).get("map") === "meaning"
    ? "meaning"
    : "sources";
}

/**
 * Discovery's map card (SL5 B1): *Sources* is the connections map, *Meaning*
 * the semantic map. The choice lives in the URL (`?map=meaning`).
 */
export function DiscoveryMapCard({
  topAssets,
}: {
  topAssets?: FindingsDiscoveryTopAssetDto[];
}) {
  const { t } = useTranslation();
  const [mode, setMode] = React.useState<MapMode>("sources");

  React.useEffect(() => {
    setMode(readMode());
  }, []);

  const choose = (next: MapMode) => {
    setMode(next);
    const url = new URL(window.location.href);
    if (next === "meaning") url.searchParams.set("map", "meaning");
    else url.searchParams.delete("map");
    window.history.replaceState(null, "", url.toString());
  };

  const toggle = (
    <div className="flex rounded-[4px] border-2 border-border" role="tablist">
      {(["sources", "meaning"] as const).map((value) => (
        <button
          key={value}
          type="button"
          role="tab"
          aria-selected={mode === value}
          onClick={() => choose(value)}
          className={cn(
            "px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em]",
            mode === value ? "bg-accent text-accent-foreground" : "hover:bg-muted",
          )}
        >
          {value === "sources" ? t("semanticMap.modes.sources") : t("semanticMap.modes.meaning")}
        </button>
      ))}
    </div>
  );

  return mode === "meaning" ? (
    <SemanticMapCard headerSlot={toggle} />
  ) : (
    <ConnectionsCanvas topAssets={topAssets} headerSlot={toggle} />
  );
}
