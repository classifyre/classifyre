"use client";

import { ArrowUpRight, GitBranch } from "lucide-react";
import Link from "next/link";
import {
  ToneBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import type { StatusTone } from "@workspace/ui/lib/status-tone";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { useNsPath } from "@/lib/ns-path";

export const CLASSIFICATION_TONE: Record<string, StatusTone> = {
  public: "neutral",
  internal: "idle",
  confidential: "changed",
  personal: "progress",
  sensitive: "error",
  secret: "error",
};

/**
 * What a shared dataset's column inherits (docs/prd/DQ-data-query.md §5.12),
 * in the same sign as an owner inherited from a source: a mono "From input"
 * tag, the input column(s) it comes from in the tooltip.
 */
export function InheritedTag({
  floor,
  from,
  traced,
}: {
  floor: string | null;
  from: { assetId: string; table: string; column: string }[];
  traced: boolean;
}) {
  const { t } = useTranslation();
  const href = useNsPath();
  if (!floor) return null;
  const label = traced
    ? t("sharedDatasets.inherited.from", {
        list: from.map((u) => `${u.table}.${u.column}`).join(", "),
      })
    : t("sharedDatasets.inherited.untraced");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="inline-flex items-center gap-1"
          data-testid="inherited-floor"
        >
          <ToneBadge tone={CLASSIFICATION_TONE[floor] ?? "neutral"}>
            {t(`governance.classification.${floor}` as TranslationKey)}
          </ToneBadge>
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted-foreground">
            <GitBranch className="mr-0.5 inline h-2.5 w-2.5" aria-hidden />
            {t("sharedDatasets.inherited.tag")}
          </span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs space-y-1">
        <p>{label}</p>
        <p className="text-muted-foreground">
          {t("sharedDatasets.inherited.floorHint")}
        </p>
        {from.slice(0, 3).map((u) => (
          <Link
            key={`${u.assetId}.${u.column}`}
            href={href(`/assets/${u.assetId}?tab=governance`)}
            className="flex items-center gap-1 underline-offset-2 hover:underline"
          >
            {u.table}.{u.column}
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        ))}
      </TooltipContent>
    </Tooltip>
  );
}
