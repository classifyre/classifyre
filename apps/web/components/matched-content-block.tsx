"use client";

import { FINDING_SEVERITY_COLOR_BY_LEVEL } from "@workspace/ui/lib/finding-severity";
import { useTranslation } from "@/hooks/use-translation";

type Severity = keyof typeof FINDING_SEVERITY_COLOR_BY_LEVEL;

interface MatchedContentBlockProps {
  severity?: Severity;
  matchedContent?: string | null;
  redactedContent?: string | null;
  contextBefore?: string | null;
  contextAfter?: string | null;
}

export function MatchedContentBlock({
  severity = "info",
  matchedContent,
  redactedContent,
  contextBefore,
  contextAfter,
}: MatchedContentBlockProps) {
  const { t } = useTranslation();
  const color =
    FINDING_SEVERITY_COLOR_BY_LEVEL[severity] ??
    FINDING_SEVERITY_COLOR_BY_LEVEL.info;
  const content =
    redactedContent || matchedContent || t("findings.signals.noMatchedContent");

  return (
    <div
      className="overflow-hidden rounded-[4px] border-2"
      style={{ borderColor: color, boxShadow: `4px 4px 0 ${color}66` }}
    >
      <div
        className="border-b-2 px-6 py-4"
        style={{ backgroundColor: color, borderBottomColor: color }}
      >
        <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-white/70">
          {t("findings.signals.signal")}
        </div>
        <div className="text-sm font-semibold uppercase tracking-[0.04em] text-white">
          {t("findings.signals.matchedContent")}
        </div>
        <div className="mt-0.5 text-xs text-white/60">
          {t("findings.signals.matchedContentDesc")}
        </div>
      </div>
      <div className="space-y-3 bg-white p-6 dark:bg-card">
        {contextBefore && (
          <pre className="overflow-x-auto rounded-[4px] border border-black/20 bg-muted/40 p-4 text-xs text-muted-foreground">
            {contextBefore}
          </pre>
        )}
        <pre
          className="overflow-x-auto rounded-[4px] border-2 p-4 text-xs text-foreground"
          style={{ borderColor: color, backgroundColor: `${color}15` }}
        >
          {content}
        </pre>
        {contextAfter && (
          <pre className="overflow-x-auto rounded-[4px] border border-black/20 bg-muted/40 p-4 text-xs text-muted-foreground">
            {contextAfter}
          </pre>
        )}
      </div>
    </div>
  );
}
