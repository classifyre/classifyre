"use client";

import * as React from "react";
import { ExternalLink, Link2, RotateCw } from "lucide-react";
import { api, type ValueOccurrencesResponseDto } from "@workspace/api-client";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import { SourceIcon } from "@workspace/ui/components/source-icon";
import { Spinner } from "@workspace/ui/components/spinner";
import { useDetailLink } from "@/hooks/use-detail-link";
import { useSourceTypeLabel } from "@/hooks/use-source-type-label";
import { useTranslation } from "@/hooks/use-translation";

/** Promise caching also coalesces two panels opening the same value at once. */
export type FingerprintOccurrencesCache = Map<
  string,
  Promise<ValueOccurrencesResponseDto>
>;

export function FingerprintValueOccurrences({
  valueHash,
  cache,
}: {
  valueHash: string;
  cache: FingerprintOccurrencesCache;
}) {
  const { t } = useTranslation();
  const detailLink = useDetailLink();
  const sourceTypeLabel = useSourceTypeLabel();
  const [data, setData] = React.useState<ValueOccurrencesResponseDto | null>(
    null,
  );
  const [error, setError] = React.useState<string | null>(null);
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let active = true;
    setData(null);
    setError(null);

    let request = cache.get(valueHash);
    if (!request) {
      request = api.correlation.correlationControllerOccurrences({ valueHash });
      cache.set(valueHash, request);
    }
    request
      .then((response) => {
        if (active) setData(response);
      })
      .catch((reason: unknown) => {
        // A failed request must remain retryable.
        if (cache.get(valueHash) === request) cache.delete(valueHash);
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : t("correlation.occurrences.loadFailed"),
          );
        }
      });

    return () => {
      active = false;
    };
  }, [attempt, cache, t, valueHash]);

  const sourceGroups = React.useMemo(() => {
    const groups = new Map<
      string,
      {
        sourceId: string;
        sourceName: string;
        sourceType: string;
        assets: NonNullable<typeof data>["assets"];
      }
    >();
    for (const asset of data?.assets ?? []) {
      const key = asset.sourceId || asset.sourceType;
      const group = groups.get(key);
      if (group) group.assets.push(asset);
      else {
        groups.set(key, {
          sourceId: asset.sourceId,
          sourceName: asset.sourceName,
          sourceType: asset.sourceType,
          assets: [asset],
        });
      }
    }
    return [...groups.values()].sort((a, b) =>
      (a.sourceName || a.sourceType).localeCompare(
        b.sourceName || b.sourceType,
      ),
    );
  }, [data]);

  if (error) {
    return (
      <div className="space-y-2 border-l-2 border-destructive/60 py-1 pl-3">
        <p className="text-xs text-destructive">
          {t("correlation.occurrences.loadFailed")}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setAttempt((n) => n + 1)}
        >
          <RotateCw className="mr-1.5 h-3.5 w-3.5" />
          {t("correlation.fingerprints.retry")}
        </Button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-20 items-center justify-center border-l-2 border-border pl-3">
        <Spinner label={t("correlation.occurrences.loading")} />
      </div>
    );
  }

  if (data.assets.length === 0) {
    return (
      <p className="border-l-2 border-border py-2 pl-3 text-xs text-muted-foreground">
        {t("correlation.occurrences.noneIndexed")}
      </p>
    );
  }

  return (
    <div className="space-y-3 border-l-2 border-foreground/70 pl-3">
      <div className="space-y-1">
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary" className="text-[10px]">
            {t("correlation.occurrences.sourceCount", {
              count: String(sourceGroups.length),
            })}
          </Badge>
          <Badge variant="outline" className="text-[10px]">
            {t("correlation.occurrences.assetCount", {
              count: String(data.assets.length),
            })}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("correlation.occurrences.sharedExplanation")}
        </p>
      </div>

      <div className="space-y-3">
        {sourceGroups.map((group) => {
          const sourceName =
            group.sourceName ||
            sourceTypeLabel(group.sourceType) ||
            group.sourceType;
          return (
            <section
              key={group.sourceId || group.sourceType}
              className="space-y-1.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <SourceIcon source={group.sourceType} size="sm" />
                <span
                  className="min-w-0 flex-1 truncate text-xs font-semibold"
                  title={sourceName}
                >
                  {sourceName}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {group.assets.length}
                </span>
              </div>
              <ul className="space-y-1">
                {group.assets.map((asset) => {
                  const assetName =
                    asset.name || asset.externalUrl || asset.assetId;
                  return (
                    <li
                      key={asset.assetId}
                      className="space-y-1.5 rounded-[4px] border border-border/70 bg-muted/20 p-2"
                    >
                      <a
                        {...detailLink(`/assets/${asset.assetId}`)}
                        className="block truncate text-xs font-medium underline-offset-2 hover:underline"
                        title={assetName}
                      >
                        {assetName}
                      </a>
                      {asset.findingId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          asChild
                          className="h-7 w-full text-[11px]"
                        >
                          <a {...detailLink(`/findings/${asset.findingId}`)}>
                            <ExternalLink className="mr-1.5 h-3 w-3" />
                            {t("correlation.occurrences.openFindingInSource", {
                              source: sourceName,
                            })}
                          </a>
                        </Button>
                      ) : (
                        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Link2 className="h-3 w-3 shrink-0" />
                          {t("correlation.occurrences.findingUnavailable")}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
