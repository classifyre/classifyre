"use client";

import { Gauge } from "lucide-react";
import { ToneBadge, type StatusTone } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";

/**
 * An asset's data quality at a glance: its score and how many checks fail
 * now. Failing checks read red, a full pass lime, nothing measured yet grey.
 */
export function QualityChip({
  quality,
  className,
}: {
  quality:
    | { rules: number; failing: number; score?: number | null }
    | null
    | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!quality || quality.rules === 0) return null;
  const tone: StatusTone =
    quality.failing > 0
      ? "error"
      : quality.score === null || quality.score === undefined
        ? "idle"
        : quality.score >= 100
          ? "done"
          : "progress";
  return (
    <ToneBadge
      tone={tone}
      className={`gap-1 ${className ?? ""}`}
      data-testid="quality-chip"
      data-failing={quality.failing}
      title={t("governance.qualityChip.hint", {
        rules: quality.rules,
        failing: quality.failing,
      })}
    >
      <Gauge className="h-3 w-3" aria-hidden />
      {quality.score === null || quality.score === undefined
        ? t("governance.qualityChip.unmeasured")
        : t("governance.qualityChip.score", { score: quality.score })}
      {quality.failing > 0 && (
        <span className="font-semibold">
          · {t("governance.qualityChip.failing", { count: quality.failing })}
        </span>
      )}
    </ToneBadge>
  );
}
