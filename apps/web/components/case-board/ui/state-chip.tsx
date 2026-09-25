import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";
import { STATUS_TONE } from "@workspace/ui/lib/status-tone";

export type ChipTone = "accent" | "destructive" | "muted" | "success" | "fresh" | "neutral";

/**
 * Self-labelling state chip. Tones come from the shared status scale; the
 * NEW chip is the accent *surface* with dark ink — `--accent` is never text
 * on a light ground (it measures 1.21:1 on white).
 */
const TONE: Record<ChipTone, string> = {
  accent: STATUS_TONE.done,
  destructive: STATUS_TONE.error,
  muted: STATUS_TONE.idle,
  success: STATUS_TONE.archived,
  fresh: STATUS_TONE.fresh,
  neutral: STATUS_TONE.neutral,
};

export function StateChip({
  tone,
  children,
  className,
  title,
  icon,
}: {
  tone: ChipTone;
  children: React.ReactNode;
  className?: string;
  title?: string;
  icon?: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-[3px] border px-1 py-px font-mono text-[9px] leading-none uppercase tracking-[0.06em] whitespace-nowrap",
        TONE[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  );
}
