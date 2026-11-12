"use client";

import { BadgeCheck } from "lucide-react";
import { ToneBadge, type StatusTone } from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import type { GovernanceStatus } from "@/lib/governance";

const TONE: Record<GovernanceStatus | "UNGOVERNED", StatusTone> = {
  UNGOVERNED: "idle",
  DRAFT: "progress",
  ACTIVE: "done",
  DEPRECATED: "changed",
  RETIRED: "archived",
};

/**
 * Where an asset stands as a governed data asset: not governed (nobody owns
 * it), or its lifecycle (GOV §4). ACTIVE reads as certified.
 */
export function GovernanceBadge({
  status,
  className,
}: {
  status: string | null | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  const key = (status ?? "UNGOVERNED") as GovernanceStatus | "UNGOVERNED";
  return (
    <ToneBadge
      tone={TONE[key] ?? "idle"}
      className={className}
      data-testid="governance-badge"
      data-status={key}
      title={t(`governance.statusHint.${key}`)}
    >
      {key === "ACTIVE" && <BadgeCheck className="h-3 w-3" aria-hidden />}
      {t(`governance.status.${key}`)}
    </ToneBadge>
  );
}
