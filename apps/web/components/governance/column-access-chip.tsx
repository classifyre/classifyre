"use client";

import { EyeOff, VenetianMask } from "lucide-react";
import {
  ToneBadge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { DEFAULT_MASK } from "@/lib/column-access";

/**
 * How a column shows to people who may query its table but not read it in
 * clear (docs/prd/DQ-data-query.md §5.8): in clear, masked (and how), or
 * hidden. The same chip in the governance Columns step and the SQL page.
 */
export function ColumnAccessChip({
  action,
  mask,
  fromClassification,
  inClear,
  compact,
}: {
  action: string;
  mask?: string | null;
  /** Follows the classification rather than a steward's choice. */
  fromClassification?: boolean;
  /** The viewer reads it in clear although others do not. */
  inClear?: boolean;
  /** Icon only, for column lists. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  if (action !== "mask" && action !== "hide") {
    if (compact) return null;
    return (
      <span className="text-xs text-muted-foreground">
        {t("columnAccess.clear")}
      </span>
    );
  }
  const Icon = action === "hide" ? EyeOff : VenetianMask;
  const label =
    action === "hide"
      ? t("columnAccess.hide")
      : `${t("columnAccess.mask")} · ${t(`columnAccess.kind.${mask ?? DEFAULT_MASK}` as TranslationKey)}`;
  const why = inClear
    ? t("columnAccess.inClear")
    : fromClassification === undefined
      ? null
      : fromClassification
        ? t("columnAccess.fromClassification")
        : t("columnAccess.bySteward");
  const chip = compact ? (
    <Icon
      className={
        inClear
          ? "h-3 w-3 shrink-0 text-muted-foreground"
          : "h-3 w-3 shrink-0 text-amber-600"
      }
      aria-label={label}
      data-testid={`column-access-${action}`}
    />
  ) : (
    <ToneBadge
      tone={inClear ? "neutral" : action === "hide" ? "error" : "progress"}
      data-testid={`column-access-${action}`}
    >
      <Icon className="h-3 w-3" aria-hidden />
      {label}
    </ToneBadge>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center">{chip}</span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        {label}
        {why ? ` — ${why}` : ""}
      </TooltipContent>
    </Tooltip>
  );
}
