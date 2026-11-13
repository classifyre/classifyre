"use client";

import { BookCheck, Crown, Wrench, type LucideIcon } from "lucide-react";
import type { GovernanceRoleKind } from "@/lib/governance";

/**
 * One picture per governance role, used wherever a role is named: the owner
 * wears the crown (accountable), the steward keeps the book (meaning and
 * quality), the custodian holds the wrench (runs the system).
 */
export const ROLE_ICON: Record<GovernanceRoleKind, LucideIcon> = {
  OWNER: Crown,
  STEWARD: BookCheck,
  CUSTODIAN: Wrench,
};

/** Tinted square behind a role's icon, readable in both themes. */
export const ROLE_TONE: Record<GovernanceRoleKind, string> = {
  OWNER: "border-border bg-accent text-accent-foreground",
  STEWARD:
    "border-sky-600/35 bg-sky-50 text-sky-700 dark:border-sky-400/30 dark:bg-sky-950/40 dark:text-sky-300",
  CUSTODIAN:
    "border-violet-600/30 bg-violet-50 text-violet-700 dark:border-violet-400/30 dark:bg-violet-950/40 dark:text-violet-300",
};

export function RoleIcon({
  role,
  size = "md",
}: {
  role: GovernanceRoleKind;
  size?: "sm" | "md";
}) {
  const Icon = ROLE_ICON[role];
  const box = size === "sm" ? "h-5 w-5" : "h-8 w-8";
  const glyph = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center rounded-[4px] border ${box} ${ROLE_TONE[role]}`}
      aria-hidden
    >
      <Icon className={glyph} />
    </span>
  );
}
