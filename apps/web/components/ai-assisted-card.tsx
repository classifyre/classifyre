"use client";

import * as React from "react";
import { cn } from "@workspace/ui/lib/utils";
import type { KnowledgeSection } from "@/lib/assistant-knowledge";

export interface AiAssistedCardProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  knowledge?: KnowledgeSection | null;
  promptContext?: string;
  headerActions?: React.ReactNode;
  withShadow?: boolean;
  active?: boolean;
}

export function AiAssistedCard({
  title,
  description,
  children,
  knowledge: _knowledge,
  promptContext: _promptContext,
  headerActions,
  withShadow = true,
  active = true,
}: AiAssistedCardProps) {
  const showHeader = Boolean(title || description || headerActions);

  return (
    <div
      className={cn(
        "border-2 border-border rounded-[6px] bg-card overflow-hidden",
        withShadow && "shadow-[6px_6px_0_var(--color-border)]",
      )}
    >
      {showHeader && (
        <div
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-3 border-b-2 border-border",
            active
              ? "bg-foreground text-primary-foreground"
              : "bg-muted/80 text-muted-foreground dark:bg-muted/40",
          )}
        >
          <div className="flex flex-col gap-0.5 min-w-0">
            {title && (
              <span
                className={cn(
                  "text-xs font-mono uppercase tracking-[0.12em] font-bold",
                  active ? "text-primary-foreground" : "text-foreground/75",
                )}
              >
                {title}
              </span>
            )}
            {description && (
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
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {headerActions}
          </div>
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
