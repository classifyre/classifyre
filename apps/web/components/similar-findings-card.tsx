"use client";

import { useNsPath } from "@/lib/ns-path";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Layers, List, Share2 } from "lucide-react";
import { api, type SimilarFindingDto } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { Spinner } from "@workspace/ui/components/spinner";
import { SimilarFindingsGraph } from "@/components/similar-findings-graph";
import { useTranslation } from "@/hooks/use-translation";

const LIMIT = 8;

function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * "Similar findings" — semantic neighbours of a finding, via the embeddings
 * index. Hidden entirely on error or empty: the finding may not have an
 * embedding yet (source not embedding-enabled, or not reindexed).
 *
 * Defaults to the graph view, where neighbours group under the document they
 * came from and the edge label carries the similarity score; the flat list is
 * still one click away for scanning the matched text.
 */
export function SimilarFindingsCard({
  findingId,
  matchedContent = "",
  assetId,
  assetName,
}: {
  findingId: string;
  /** Matched text of the finding being viewed — labels the graph's centre node. */
  matchedContent?: string;
  assetId?: string;
  assetName?: string;
}) {
  const nsPath = useNsPath();
  const { t } = useTranslation();
  const [items, setItems] = useState<SimilarFindingDto[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [view, setView] = useState<"graph" | "list">("graph");

  useEffect(() => {
    let active = true;
    setItems(null);
    setFailed(false);
    api.embeddings
      .embeddingControllerSimilar({ findingId, limit: LIMIT as unknown as object })
      .then((res) => {
        if (active) setItems(res);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [findingId]);

  if (failed || items?.length === 0) return null;

  return (
    <Card className="rounded-[6px] border-2">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4" />
              {t("findings.detail.similarFindings.title")}
            </CardTitle>
            <CardDescription>
              {t("findings.detail.similarFindings.desc")}
            </CardDescription>
          </div>
          {items !== null && (
            <div className="flex shrink-0 items-center gap-1">
              <Button
                size="sm"
                variant={view === "graph" ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setView("graph")}
              >
                <Share2 className="mr-1.5 h-3.5 w-3.5" />
                {t("findings.detail.similarFindings.showGraph")}
              </Button>
              <Button
                size="sm"
                variant={view === "list" ? "default" : "outline"}
                className="h-8 text-xs"
                onClick={() => setView("list")}
              >
                <List className="mr-1.5 h-3.5 w-3.5" />
                {t("findings.detail.similarFindings.showList")}
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <div className="flex h-16 items-center justify-center">
            <Spinner label={t("findings.detail.similarFindings.loading")} />
          </div>
        ) : view === "graph" ? (
          <SimilarFindingsGraph
            findingId={findingId}
            items={items}
            anchorLabel={matchedContent}
            anchorAssetId={assetId}
            anchorAssetName={assetName}
          />
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <Link
                key={item.id}
                href={nsPath(`/findings/${item.id}`)}
                className="block rounded-[4px] border border-border/60 bg-muted/30 p-3 transition-colors hover:border-border"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="rounded-[3px] text-[10px]">
                    {t("findings.detail.similarFindings.similarity")}{" "}
                    {Math.round(item.similarity * 100)}%
                  </Badge>
                  {item.evidenceAnalysis && (
                    <Badge variant="outline" className="rounded-[3px] text-[10px]">
                      {t("findings.detail.similarFindings.importance")}{" "}
                      {Math.round(item.evidenceAnalysis.importanceScore * 100)}
                    </Badge>
                  )}
                  {item.asset?.name && (
                    <span className="text-muted-foreground truncate text-xs">
                      {item.asset.name}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 truncate font-mono text-xs text-muted-foreground">
                  {truncate(item.matchedContent)}
                </p>
              </Link>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
