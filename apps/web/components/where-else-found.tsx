"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Radar } from "lucide-react";
import { api, type ValueOccurrencesResponseDto } from "@workspace/api-client";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  SourceIcon,
  Spinner,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";

/**
 * "Where else found" — lists every other asset that carries the same normalized
 * finding value, via the correlation reverse index. The most investigator-
 * valuable view: it reveals relationships without any embeddings.
 */
export function WhereElseFound({
  label,
  value,
  currentAssetId,
}: {
  label: string;
  value: string;
  currentAssetId?: string;
}) {
  const { t } = useTranslation();
  const [data, setData] = useState<ValueOccurrencesResponseDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setData(null);
    setError(null);
    if (!label || !value) {
      setData({ label, value, valueHash: "", assets: [] });
      return;
    }
    api.correlation
      .correlationControllerOccurrences({ label, value })
      .then((res) => {
        if (active) setData(res);
      })
      .catch((e: unknown) => {
        if (active)
          setError(
            e instanceof Error ? e.message : t("correlation.occurrences.loadFailed"),
          );
      });
    return () => {
      active = false;
    };
  }, [label, value, t]);

  const others =
    data?.assets.filter((a) => a.assetId !== currentAssetId) ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Radar className="h-4 w-4" />
          {t("correlation.occurrences.title")}
        </CardTitle>
        <CardDescription>{t("correlation.occurrences.desc")}</CardDescription>
      </CardHeader>
      <CardContent>
        {error ? (
          <EmptyState
            icon={Radar}
            title={t("correlation.occurrences.loadFailed")}
            description={error}
          />
        ) : data === null ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner label={t("correlation.occurrences.title")} />
          </div>
        ) : others.length === 0 ? (
          <EmptyState
            icon={Radar}
            title={t("correlation.occurrences.none")}
            description={t("correlation.occurrences.noneDesc")}
          />
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {t("correlation.occurrences.foundIn", {
                count: String(others.length),
              })}
            </p>
            {others.map((a) => (
              <div
                key={a.assetId}
                className="flex items-center justify-between gap-3 rounded-[4px] border border-border/60 bg-muted/30 p-3"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <SourceIcon source={a.sourceType} size="sm" />
                  <Link
                    href={`/assets/${a.assetId}`}
                    className="truncate text-sm font-semibold underline-offset-4 hover:underline"
                    title={a.name || a.externalUrl}
                  >
                    {a.name || a.externalUrl || a.assetId}
                  </Link>
                  <span className="truncate text-xs text-muted-foreground">
                    {a.sourceName}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
