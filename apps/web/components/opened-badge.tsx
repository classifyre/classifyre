"use client";

import { Clock } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { formatDate, formatRelative } from "@/lib/date";

/**
 * "Opened 2 hours ago": when this browser last opened a case or a workspace
 * (`lib/recently-opened.ts`). Ink on the page's ground colour, inverted, so it
 * reads as a sticker on whatever picture a card puts under it.
 */
export function OpenedBadge({ at, className }: { at: number; className?: string }) {
  const { t } = useTranslation();
  const when = new Date(at);
  return (
    <span
      title={formatDate(when)}
      className={cn(
        "inline-flex items-center gap-1 rounded-[3px] bg-foreground px-1.5 py-0.5 font-mono text-[10px] tracking-[0.1em] text-background uppercase",
        className,
      )}
      data-testid="opened-badge"
    >
      <Clock className="size-3" aria-hidden />
      {t("common.openedAgo", { when: formatRelative(when) })}
    </span>
  );
}
