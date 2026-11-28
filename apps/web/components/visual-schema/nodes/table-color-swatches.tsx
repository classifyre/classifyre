"use client";

import * as React from "react";
import { Check, RotateCcw } from "lucide-react";
import {
  SCHEMA_TABLE_COLORS,
  type SchemaTableColor,
} from "@workspace/schemas/data-request";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import { SWATCH_CSS_VAR } from "../types";

export interface TableColorSwatchesProps {
  value?: SchemaTableColor;
  onChange: (color: SchemaTableColor | undefined) => void;
  compact?: boolean;
}

export function TableColorSwatches({
  value,
  onChange,
  compact = false,
}: TableColorSwatchesProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", compact && "gap-1")}
      role="radiogroup"
      aria-label={t("visualSchema.color.label")}
    >
      {SCHEMA_TABLE_COLORS.map((swatch) => {
        const active = value === swatch;
        return (
          <button
            key={swatch}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={swatch}
            title={swatch}
            onClick={(e) => {
              e.stopPropagation();
              onChange(swatch);
            }}
            className={cn(
              "flex items-center justify-center rounded-xs border transition-transform hover:scale-110",
              compact ? "h-5 w-5" : "h-6 w-6",
              active ? "border-foreground ring-1 ring-foreground" : "border-border/50",
            )}
            style={{ backgroundColor: SWATCH_CSS_VAR[swatch] }}
            data-testid={`vs-swatch-${swatch}`}
          >
            {active && <Check className="h-3 w-3 text-white drop-shadow-xs" />}
          </button>
        );
      })}
      <button
        type="button"
        title={t("visualSchema.color.reset")}
        aria-label={t("visualSchema.color.reset")}
        onClick={(e) => {
          e.stopPropagation();
          onChange(undefined);
        }}
        className={cn(
          "flex items-center justify-center rounded-xs border border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
          compact ? "h-5 w-5" : "h-6 w-6",
          !value && "border-foreground text-foreground",
        )}
        data-testid="vs-swatch-reset"
      >
        <RotateCcw className="h-3 w-3" />
      </button>
    </div>
  );
}
