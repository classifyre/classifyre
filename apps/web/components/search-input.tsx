"use client";

import { BrainCircuit, Search, TextCursorInput } from "lucide-react";
import {
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

export type SearchMode = "hybrid" | "off";

/**
 * The search box of the lists (assets, findings): the text, and — when the
 * list can search by meaning — how it matches, picked inside the box rather
 * than beside it. `hybrid` matches by meaning and by the words; `off` the
 * exact words only.
 */
export function SearchInput({
  value,
  onChange,
  placeholder,
  mode,
  onModeChange,
  autoFocus = false,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Omit to hide the picker. */
  mode?: SearchMode;
  onModeChange?: (mode: SearchMode) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const { t } = useTranslation();
  const picker = mode !== undefined && onModeChange !== undefined;
  return (
    <div className={cn("relative", className)}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className={cn(
          "h-9 rounded-[4px] border-2 border-border pl-9",
          picker && "pr-[124px]",
        )}
        autoFocus={autoFocus}
      />
      {picker && (
        <Select
          value={mode}
          onValueChange={(next) => onModeChange(next as SearchMode)}
        >
          <SelectTrigger
            size="sm"
            aria-label={t("common.searchMode.label")}
            data-testid="search-mode"
            className="absolute right-[3px] top-1/2 h-[26px] -translate-y-1/2 gap-1.5 rounded-[3px] border-0 bg-secondary px-2 font-mono text-[10px] font-semibold uppercase tracking-[0.1em] shadow-none hover:bg-secondary/70 dark:bg-secondary dark:hover:bg-secondary/70 [&_svg:not([class*='size-'])]:size-3.5"
          >
            <SelectValue>
              {mode === "hybrid" ? (
                <BrainCircuit aria-hidden />
              ) : (
                <TextCursorInput aria-hidden />
              )}
              {mode === "hybrid"
                ? t("common.searchMode.semantic")
                : t("common.searchMode.exact")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent position="popper" align="end" className="w-64">
            <SelectItem value="hybrid">
              <span className="flex items-start gap-2">
                <BrainCircuit className="mt-0.5 size-4" aria-hidden />
                <span>
                  <span className="block font-medium">
                    {t("common.searchMode.semantic")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("common.searchMode.semanticHint")}
                  </span>
                </span>
              </span>
            </SelectItem>
            <SelectItem value="off">
              <span className="flex items-start gap-2">
                <TextCursorInput className="mt-0.5 size-4" aria-hidden />
                <span>
                  <span className="block font-medium">
                    {t("common.searchMode.exact")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("common.searchMode.exactHint")}
                  </span>
                </span>
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
