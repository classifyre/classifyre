import * as React from "react";

import { cn } from "../lib/utils";

export interface AiAssistedCardProps {
  title?: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  knowledge?: unknown | null;
  promptContext?: string;
  headerActions?: React.ReactNode;
  withShadow?: boolean;
  active?: boolean;
}

export function AiAssistedCard({
  title,
  description,
  children,
  headerActions,
  withShadow = true,
  active = true,
}: AiAssistedCardProps) {
  const showHeader = Boolean(title || description || headerActions);

  return (
    <div
      className={cn(
        "overflow-hidden rounded-[6px] border-2 border-border bg-card",
        withShadow && "shadow-[6px_6px_0_var(--color-border)]",
      )}
    >
      {showHeader ? (
        <div
          className={cn(
            "flex items-center justify-between gap-3 border-b-2 border-border px-4 py-3",
            active
              ? "bg-foreground text-primary-foreground"
              : "bg-muted/80 text-muted-foreground dark:bg-muted/40",
          )}
        >
          <div className="flex min-w-0 flex-col gap-0.5">
            {title ? (
              <span
                className={cn(
                  "text-xs font-mono font-bold uppercase tracking-[0.12em]",
                  active ? "text-primary-foreground" : "text-foreground/75",
                )}
              >
                {title}
              </span>
            ) : null}
            {description ? (
              <span
                className={cn(
                  "text-[10px] font-mono",
                  active
                    ? "text-primary-foreground/60"
                    : "text-muted-foreground",
                )}
              >
                {description}
              </span>
            ) : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
        </div>
      ) : null}
      <div className="p-4">{children}</div>
    </div>
  );
}
