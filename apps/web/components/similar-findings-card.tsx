"use client";

import { nsPath } from "@/lib/ns-path";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Layers } from "lucide-react";
import { api, type SimilarFindingDto } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Badge } from "@workspace/ui/components/badge";
import { Spinner } from "@workspace/ui/components/spinner";
import { useTranslation } from "@/hooks/use-translation";

const LIMIT = 8;

function truncate(text: string, max = 160): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * "Similar findings" — semantic neighbours of a finding, via the embeddings
 * index. Hidden entirely on error or empty: the finding may not have an
 * embedding yet (source not embedding-enabled, or not reindexed).
 */
export function SimilarFindingsCard({ findingId }: { findingId: string }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<SimilarFindingDto[] | null>(null);
  const [failed, setFailed] = useState(false);

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
        <CardTitle className="flex items-center gap-2 text-base">
          <Layers className="h-4 w-4" />
          {t("findings.detail.similarFindings.title")}
        </CardTitle>
        <CardDescription>{t("findings.detail.similarFindings.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {items === null ? (
          <div className="flex h-16 items-center justify-center">
            <Spinner label={t("findings.detail.similarFindings.loading")} />
          </div>
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
