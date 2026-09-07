"use client";

import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { FindingsDiscoveryTopAssetDto } from "@workspace/api-client";
import { Button, SeverityBadge } from "@workspace/ui/components";
import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";
import { formatRelative } from "@/lib/date";
import { nsPath } from "@/lib/ns-path";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

export type PriorityLevel = "critical" | "high" | "medium" | "low" | "info";

/** Stored enum → the lowercase level the badge and the palette are keyed by. */
export function toPriorityLevel(severity?: string | null): PriorityLevel {
  switch ((severity || "").toUpperCase()) {
    case "CRITICAL":
      return "critical";
    case "HIGH":
      return "high";
    case "MEDIUM":
      return "medium";
    case "LOW":
      return "low";
    default:
      return "info";
  }
}

/**
 * The assets carrying the most findings, ranked by priority mix.
 *
 * Lives on its own because it has two homes: the dashboard shows it in the
 * connections canvas rail, and it is the natural fallback for any panel that
 * wants "where is the material". It never claims the assets are risky — only
 * that they are where the findings are.
 */
export function BusiestAssets({
  assets,
  limit = 5,
  emptyAction = true,
}: {
  assets: FindingsDiscoveryTopAssetDto[];
  limit?: number;
  emptyAction?: boolean;
}) {
  const router = useRouter();
  const { t } = useTranslation();

  if (assets.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-[4px] border-2 border-dashed border-border/40 px-4 py-6 text-center">
        <div>
          <p className="font-mono text-sm uppercase tracking-[0.15em] text-muted-foreground">
            {t("discovery.firstScan")}
          </p>
          {emptyAction && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => router.push(nsPath("/scans"))}
              className="mt-3 rounded-[4px] border-2 border-border font-mono uppercase tracking-[0.1em] text-foreground"
            >
              {t("discovery.startScan")}
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="grid flex-1 gap-1.5">
      {assets.slice(0, limit).map((asset, index) => {
        const lastSeen = asset.lastDetectedAt
          ? formatRelative(asset.lastDetectedAt)
          : null;
        const level = toPriorityLevel(asset.highestSeverity);
        const accent = FINDING_SEVERITY_COLOR_BY_LEVEL[level];
        return (
          <button
            key={asset.assetId}
            type="button"
            onClick={() => router.push(nsPath(`/assets/${asset.assetId}`))}
            className="flex w-full min-w-0 cursor-pointer items-start justify-between gap-3 rounded-[4px] border-2 bg-white px-3 py-2 text-left transition-all hover:-translate-y-px hover:bg-white dark:bg-background dark:hover:bg-secondary/40"
            style={{
              borderColor: `${accent}33`,
              boxShadow: `3px 3px 0 0 ${accent}33`,
            }}
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2 leading-none">
                <span
                  className="w-4 shrink-0 font-serif text-lg font-black tabular-nums"
                  style={{ color: `${accent}99` }}
                >
                  {index + 1}
                </span>
                <span className="truncate text-xs font-bold text-foreground">
                  {asset.assetName}
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 pl-6 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                <span className="truncate">
                  {asset.sourceName ||
                    asset.sourceType ||
                    asset.assetType ||
                    "—"}
                </span>
                <span className="shrink-0 text-border">·</span>
                <span className="shrink-0">
                  <span className="font-semibold text-foreground">
                    {asset.totalFindings}
                  </span>{" "}
                  {t("discovery.findingsLabel")}
                </span>
                {lastSeen && (
                  <>
                    <span className="shrink-0 text-border">·</span>
                    <span className="shrink-0">{lastSeen}</span>
                  </>
                )}
              </div>
            </div>
            <div className="mt-0.5 flex shrink-0 items-center gap-2">
              <SeverityBadge severity={level}>
                {t(
                  `findings.severityLabels.${level.toUpperCase()}` as TranslationKey,
                )}
              </SeverityBadge>
              <ArrowRight className="h-3 w-3 text-muted-foreground/50" />
            </div>
          </button>
        );
      })}
    </div>
  );
}
