"use client";

import {
  Badge,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";

type DetectorSummaryItem = {
  detector: string;
  count: number;
};

type TopFindingItem = {
  label: string;
  count: number;
};

const DETECTOR_DOT_COLOR_BY_KEY: Record<string, string> = {
  SECRETS: "bg-rose-500",
  PII: "bg-amber-500",
  TOXIC: "bg-fuchsia-500",
  NSFW: "bg-cyan-500",
  YARA: "bg-emerald-500",
  BROKEN_LINKS: "bg-orange-500",
  PROMPT_INJECTION: "bg-violet-500",
  SPAM: "bg-slate-400",
  LANGUAGE: "bg-blue-400",
  CODE_SECURITY: "bg-indigo-500",
  CUSTOM: "bg-slate-600",
};

function useDetectorLabelMap(): Record<string, string> {
  const { t } = useTranslation();
  return {
    SECRETS: t("findings.categories.secrets"),
    PII: t("findings.categories.pii"),
    TOXIC: t("findings.categories.toxic"),
    NSFW: t("findings.categories.nsfw"),
    YARA: t("findings.categories.yara"),
    BROKEN_LINKS: t("findings.categories.brokenLinks"),
    PROMPT_INJECTION: t("findings.categories.promptInjection"),
    SPAM: t("findings.categories.spam"),
    LANGUAGE: t("findings.categories.language"),
    CODE_SECURITY: t("findings.categories.codeSecurity"),
    CUSTOM: t("findings.categories.custom"),
  };
}

function formatEnumLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
    .join(" ");
}

function parseCustomDetector(value: string): string | null {
  if (!value.toUpperCase().startsWith("CUSTOM:")) {
    return null;
  }
  const customName = value.slice("CUSTOM:".length).trim();
  return customName.length > 0 ? customName : null;
}

function toDetectorDisplay(
  detector: string,
  labelMap: Record<string, string>,
): {
  label: string;
  tooltipLabel: string;
  dotClass: string;
} {
  const raw = detector.trim();
  if (!raw) {
    return {
      label: labelMap.UNKNOWN ?? "Unknown",
      tooltipLabel: labelMap.UNKNOWN ?? "Unknown",
      dotClass: "bg-slate-400",
    };
  }

  const customName = parseCustomDetector(raw);
  if (customName) {
    return {
      label: customName,
      tooltipLabel: customName,
      dotClass: DETECTOR_DOT_COLOR_BY_KEY.CUSTOM ?? "bg-slate-600",
    };
  }

  const key = raw.toUpperCase();
  return {
    label: labelMap[key] ?? formatEnumLabel(key),
    tooltipLabel: labelMap[key] ?? raw,
    dotClass: DETECTOR_DOT_COLOR_BY_KEY[key] ?? "bg-slate-400",
  };
}

export function DetectorSummaryBadges({
  items,
  maxVisible = 3,
}: {
  items: DetectorSummaryItem[];
  maxVisible?: number;
}) {
  const { t } = useTranslation();
  const labelMap = useDetectorLabelMap();

  if (items.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const visibleItems = items.slice(0, maxVisible);
  const extra = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleItems.map((item) => {
        const display = toDetectorDisplay(item.detector, labelMap);
        return (
          <Tooltip key={`${item.detector}-${item.count}`}>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="cursor-default gap-1.5">
                <span className={`h-2 w-2 rounded-full ${display.dotClass}`} />
                <span className="text-[11px]">{display.label}</span>
                <span className="text-[11px] text-muted-foreground">
                  {item.count}
                </span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent>
              {item.count} {display.tooltipLabel} finding
              {item.count !== 1 ? "s" : ""}
            </TooltipContent>
          </Tooltip>
        );
      })}

      {extra > 0 ? (
        <Badge variant="outline" className="text-[11px]">
          {t("findings.categories.moreCount", { count: extra })}
        </Badge>
      ) : null}
    </div>
  );
}

export function TopFindingsBadges({
  items,
  maxVisible = 2,
}: {
  items: TopFindingItem[];
  maxVisible?: number;
}) {
  const { t } = useTranslation();

  if (items.length === 0) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }

  const visibleItems = items.slice(0, maxVisible);
  const extra = Math.max(0, items.length - visibleItems.length);

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleItems.map((item) => (
        <Badge
          key={`${item.label}-${item.count}`}
          variant="secondary"
          className="text-[11px]"
        >
          {item.label} · {item.count}
        </Badge>
      ))}
      {extra > 0 ? (
        <Badge variant="outline" className="text-[11px]">
          {t("findings.categories.moreCount", { count: extra })}
        </Badge>
      ) : null}
    </div>
  );
}
