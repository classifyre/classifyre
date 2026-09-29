"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { formatRelative } from "@/lib/date";
import { escalationBadgeClass } from "@/lib/escalation-tone";
import { useTranslation } from "@/hooks/use-translation";

/**
 * "▲ 3 escalated" on a case, as a HIGH severity badge: how many of its
 * findings an escalation rule marked, and — on hover — when the last one did.
 */
export function EscalatedPill({
  count,
  at,
  className,
}: {
  count: number;
  at?: Date | null;
  className?: string;
}) {
  const { t } = useTranslation();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={cn(escalationBadgeClass, "cursor-default gap-1 px-1.5", className)} data-testid="case-escalated-pill">
          <span aria-hidden>▲</span>
          {t("caseEscalation.table.badge", { count })}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {t("caseEscalation.table.tooltip", {
          count,
          when: at ? formatRelative(at) : "—",
        })}
      </TooltipContent>
    </Tooltip>
  );
}
