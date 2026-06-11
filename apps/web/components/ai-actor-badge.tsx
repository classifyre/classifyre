"use client";

import { Sparkles } from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

/** Actor identifier the autopilot stamps on every mutation (mirrors the API). */
export const AI_ACTOR = "ai-autopilot";

export function isAiActor(actor?: string | null): boolean {
  return actor === AI_ACTOR;
}

/**
 * Small badge marking content produced by the Investigation Autopilot.
 * Render wherever an actor / createdBy equals the AI actor.
 */
export function AiActorBadge({ className }: { className?: string }) {
  const { t } = useTranslation();
  return (
    <span
      title={t("settings.autopilot.aiBadgeTooltip")}
      className={cn(
        "inline-flex items-center gap-1 rounded-[3px] border border-[#d97706]/40 bg-[#d97706]/10 px-1.5 py-px text-[10px] font-mono uppercase tracking-wide text-[#d97706]",
        className,
      )}
    >
      <Sparkles className="h-2.5 w-2.5" />
      {t("settings.autopilot.aiBadge")}
    </span>
  );
}
