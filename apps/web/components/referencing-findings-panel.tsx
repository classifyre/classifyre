"use client";

import * as React from "react";
import Link from "next/link";
import { CornerUpLeft } from "lucide-react";
import { api, type ReferencingFindingDto } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  SeverityBadge,
  Spinner,
} from "@workspace/ui/components";
import { useNsPath } from "@/lib/ns-path";

/**
 * What other assets say about this one.
 *
 * An integrity check, a district profile or a derived record is its own asset
 * that `references()` the thing it is about. On the Köln region page the
 * Findings tab therefore read "No findings found" while *Zensus-Rebasing:
 * Köln* (−74,346, −6.9%) pointed straight at it: an analyst looking at a
 * district could not see what was known about it without leaving the page
 * (GENESIS field report P12).
 *
 * Renders nothing when no other asset points here, so it costs a page that has
 * no such findings one request and no space.
 */
export function ReferencingFindingsPanel({ assetId }: { assetId: string }) {
  const nsPath = useNsPath();
  const [items, setItems] = React.useState<ReferencingFindingDto[]>([]);
  const [referencingAssets, setReferencingAssets] = React.useState(0);
  const [truncated, setTruncated] = React.useState(false);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    api.assets
      .assetsControllerGetReferencingFindings({ id: assetId })
      .then((response) => {
        if (!active) return;
        setItems(response.items ?? []);
        setReferencingAssets(response.referencingAssets ?? 0);
        setTruncated(Boolean(response.truncated));
      })
      .catch(() => {
        // A panel that cannot load is not a reason to break the asset page.
        if (active) setItems([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [assetId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Spinner size="sm" />
        Looking for findings about this asset
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <Card className="border-2 border-border shadow-[0_1px_3px_rgba(28,25,23,0.04)]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 font-serif text-base font-black">
          <CornerUpLeft className="h-4 w-4 text-muted-foreground" />
          About this asset, recorded elsewhere
        </CardTitle>
        <CardDescription className="text-xs">
          {items.length} unresolved finding{items.length === 1 ? "" : "s"} on{" "}
          {referencingAssets} asset{referencingAssets === 1 ? "" : "s"} that point here
          {truncated ? " (showing the worst; there are more)" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.map((item) => (
          <Link
            key={item.findingId}
            href={nsPath(`/findings/${item.findingId}`)}
            className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border/60 px-3 py-2 text-xs transition-colors hover:bg-secondary/40"
          >
            <SeverityBadge
              severity={
                item.severity.toLowerCase() as
                  | "critical"
                  | "high"
                  | "medium"
                  | "low"
                  | "info"
              }
            >
              {item.severity}
            </SeverityBadge>
            <span className="font-medium">{item.findingType}</span>
            {item.matchedContent && (
              <span className="truncate font-mono text-[11px] text-muted-foreground">
                {item.matchedContent}
              </span>
            )}
            <span className="ml-auto text-[11px] text-muted-foreground">
              via {item.viaAssetName}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  );
}
