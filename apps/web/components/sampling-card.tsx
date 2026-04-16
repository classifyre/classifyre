"use client";

import * as React from "react";
import { Database, Shuffle, Clock, Infinity } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Checkbox } from "@workspace/ui/components/checkbox";
import { Separator } from "@workspace/ui/components/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion";
import { cn } from "@workspace/ui/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type SamplingStrategy = "RANDOM" | "LATEST" | "ALL";

export type SamplingValue = {
  strategy: SamplingStrategy;
  fetch_all_until_first_success?: boolean | undefined;
  limit?: number | undefined;
  order_by_column?: string | undefined;
  fallback_to_random?: boolean | undefined;
  max_columns?: number | undefined;
  max_cell_chars?: number | undefined;
  max_total_chars?: number | undefined;
  include_column_names?: boolean | undefined;
};

// ─── Props ─────────────────────────────────────────────────────────────────────

interface SamplingCardProps {
  value: SamplingValue;
  onChange: (value: SamplingValue) => void;
  isTabular?: boolean;
  disabled?: boolean;
  className?: string;
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function SamplingCard({
  value,
  onChange,
  isTabular,
  disabled,
  className,
}: SamplingCardProps) {
  const { t } = useTranslation();

  const STRATEGIES: {
    value: SamplingStrategy;
    label: string;
    hint: string;
    Icon: React.ElementType;
  }[] = [
    {
      value: "LATEST",
      label: t("sources.sampling.strategyLatest"),
      hint: t("sources.sampling.hintLatest"),
      Icon: Clock,
    },
    {
      value: "RANDOM",
      label: t("sources.sampling.strategyRandom"),
      hint: t("sources.sampling.hintRandom"),
      Icon: Shuffle,
    },
    {
      value: "ALL",
      label: t("sources.sampling.strategyAll"),
      hint: t("sources.sampling.hintAll"),
      Icon: Infinity,
    },
  ];

  const handleStrategyChange = (strategy: SamplingStrategy) => {
    onChange({ ...value, strategy });
  };

  const handleLimitChange = (raw: string) => {
    const parsed = parseInt(raw, 10);
    onChange({ ...value, limit: isNaN(parsed) ? undefined : parsed });
  };

  const handleFetchAllUntilFirstSuccessChange = (checked: boolean) => {
    onChange({ ...value, fetch_all_until_first_success: checked });
  };

  const handleOrderByColumnChange = (raw: string) => {
    onChange({ ...value, order_by_column: raw || undefined });
  };

  const handleMaxColumnsChange = (raw: string) => {
    const parsed = parseInt(raw, 10);
    onChange({ ...value, max_columns: isNaN(parsed) ? undefined : parsed });
  };

  const handleMaxCellCharsChange = (raw: string) => {
    const parsed = parseInt(raw, 10);
    onChange({ ...value, max_cell_chars: isNaN(parsed) ? undefined : parsed });
  };

  const handleMaxTotalCharsChange = (raw: string) => {
    const parsed = parseInt(raw, 10);
    onChange({ ...value, max_total_chars: isNaN(parsed) ? undefined : parsed });
  };

  const showLimit = value.strategy !== "ALL";
  const showOrderByColumn = isTabular && value.strategy === "LATEST";

  return (
    <div
      className={cn(
        "border-2 border-border rounded-[6px] shadow-[6px_6px_0_var(--color-border)] bg-card overflow-hidden",
        disabled && "opacity-60 pointer-events-none",
        className,
      )}
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 py-3 border-b-2 border-border bg-foreground text-primary-foreground">
        <Database className="h-4 w-4 text-accent" />
        <span className="text-xs font-mono uppercase tracking-[0.12em] font-bold">
          {t("sources.sampling.title")}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* ── Strategy picker ────────────────────────────────────────────────── */}
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
            {t("sources.sampling.strategy")}
          </p>
          <div className="grid grid-cols-3 gap-1.5">
            {STRATEGIES.map(({ value: stratVal, label, hint, Icon }) => {
              const active = value.strategy === stratVal;
              return (
                <button
                  key={stratVal}
                  type="button"
                  onClick={() => handleStrategyChange(stratVal)}
                  disabled={disabled}
                  data-testid={`sampling-strategy-${stratVal}`}
                  className={cn(
                    "group flex flex-col items-start gap-0.5 rounded-[4px] border-2 px-3 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
                    active
                      ? "border-border bg-accent text-accent-foreground shadow-[2px_2px_0_var(--color-border)]"
                      : "border-border/20 hover:border-border hover:bg-foreground/5",
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <Icon
                      className={cn(
                        "h-3 w-3",
                        active
                          ? "text-accent-foreground"
                          : "text-muted-foreground",
                      )}
                    />
                    <span
                      className={cn(
                        "text-xs font-semibold leading-tight",
                        active ? "text-accent-foreground" : "text-foreground",
                      )}
                    >
                      {label}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "text-[10px] font-mono",
                      active
                        ? "text-accent-foreground/60"
                        : "text-muted-foreground",
                    )}
                  >
                    {hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Limit ──────────────────────────────────────────────────────────── */}
        <Separator className="bg-border/10" />
        <div className="space-y-2">
          <div className="flex items-start gap-2 rounded-[4px] border border-border/25 bg-muted/20 px-3 py-2">
            <Checkbox
              id="sampling-fetch-all-first-success"
              checked={value.fetch_all_until_first_success === true}
              onCheckedChange={(checked) =>
                handleFetchAllUntilFirstSuccessChange(checked === true)
              }
              disabled={disabled}
              className="mt-0.5"
            />
            <div className="space-y-0.5">
              <Label
                htmlFor="sampling-fetch-all-first-success"
                className="text-[10px] font-mono uppercase tracking-[0.14em] text-foreground"
              >
                {t("sources.sampling.fetchAll")}
              </Label>
              <p className="text-[10px] text-muted-foreground font-mono">
                {t("sources.sampling.fetchAllDesc")}
              </p>
            </div>
          </div>
        </div>

        {showLimit && (
          <>
            <div className="space-y-1.5">
              <Label className="text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground">
                {t("sources.sampling.limit")}
              </Label>
              <Input
                type="number"
                min={1}
                max={100000}
                placeholder="100"
                value={value.limit ?? ""}
                onChange={(e) => handleLimitChange(e.target.value)}
                disabled={disabled}
                className="font-mono text-xs border-2 border-border/40 focus:border-border rounded-[4px] h-9"
              />
              <p className="text-[10px] text-muted-foreground font-mono pl-0.5">
                {t("sources.sampling.maxItems")}
              </p>
            </div>
          </>
        )}

        {/* ── Tabular advanced ───────────────────────────────────────────────── */}
        {isTabular && (
          <Accordion type="multiple">
            <AccordionItem
              value="tabular-advanced"
              className="border-border/20"
            >
              <AccordionTrigger className="py-2 text-[10px] font-mono uppercase tracking-[0.14em] text-muted-foreground hover:no-underline hover:text-foreground">
                {t("sources.sampling.advanced")}
              </AccordionTrigger>
              <AccordionContent className="pt-2 space-y-3">
                {showOrderByColumn && (
                  <div className="space-y-1">
                    <Label className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                      {t("sources.sampling.orderByColumn")}
                    </Label>
                    <Input
                      placeholder={t("sources.sampling.orderByPlaceholder")}
                      value={value.order_by_column ?? ""}
                      onChange={(e) =>
                        handleOrderByColumnChange(e.target.value)
                      }
                      disabled={disabled}
                      className="font-mono text-xs border-2 border-border/40 focus:border-border rounded-[4px] h-9"
                    />
                    <p className="text-[10px] text-muted-foreground font-mono pl-0.5">
                      {t("sources.sampling.orderByDesc")}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                      {t("sources.sampling.maxColumns")}
                    </Label>
                    <Input
                      type="number"
                      min={1}
                      max={500}
                      placeholder="25"
                      value={value.max_columns ?? ""}
                      onChange={(e) => handleMaxColumnsChange(e.target.value)}
                      disabled={disabled}
                      className="font-mono text-xs border-2 border-border/40 focus:border-border rounded-[4px] h-9"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                      {t("sources.sampling.maxCellChars")}
                    </Label>
                    <Input
                      type="number"
                      min={16}
                      max={50000}
                      placeholder="512"
                      value={value.max_cell_chars ?? ""}
                      onChange={(e) => handleMaxCellCharsChange(e.target.value)}
                      disabled={disabled}
                      className="font-mono text-xs border-2 border-border/40 focus:border-border rounded-[4px] h-9"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <Label className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    {t("sources.sampling.maxTotalChars")}
                  </Label>
                  <Input
                    type="number"
                    min={128}
                    max={500000}
                    placeholder="20000"
                    value={value.max_total_chars ?? ""}
                    onChange={(e) => handleMaxTotalCharsChange(e.target.value)}
                    disabled={disabled}
                    className="font-mono text-xs border-2 border-border/40 focus:border-border rounded-[4px] h-9"
                  />
                  <p className="text-[10px] text-muted-foreground font-mono pl-0.5">
                    {t("sources.sampling.maxTotalCharsDesc")}
                  </p>
                </div>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {/* ── Strategy hint ──────────────────────────────────────────────────── */}
        <p className="text-[11px] text-muted-foreground font-mono text-center py-1">
          {value.strategy === "RANDOM" && t("sources.sampling.hintRandom2")}
          {value.strategy === "LATEST" && t("sources.sampling.hintLatest2")}
          {value.strategy === "ALL" && t("sources.sampling.hintAll2")}
        </p>
      </div>
    </div>
  );
}

// ─── Default value helper ──────────────────────────────────────────────────────

export function defaultSamplingValue(sampling?: {
  strategy?: string;
  fetch_all_until_first_success?: boolean;
  limit?: number;
  order_by_column?: string;
  fallback_to_random?: boolean;
  max_columns?: number;
  max_cell_chars?: number;
  max_total_chars?: number;
  include_column_names?: boolean;
}): SamplingValue {
  return {
    strategy: (sampling?.strategy as SamplingStrategy) ?? "RANDOM",
    fetch_all_until_first_success:
      sampling?.fetch_all_until_first_success ?? false,
    limit: sampling?.limit ?? 100,
    order_by_column: sampling?.order_by_column,
    fallback_to_random: sampling?.fallback_to_random,
    max_columns: sampling?.max_columns,
    max_cell_chars: sampling?.max_cell_chars,
    max_total_chars: sampling?.max_total_chars,
    include_column_names: sampling?.include_column_names,
  };
}
