"use client";

import * as React from "react";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api, type CaseFindingFilterDto } from "@workspace/api-client";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { cn } from "@workspace/ui/lib/utils";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";
import { useTranslation } from "@/hooks/use-translation";

/**
 * A scope's filters as chips: what kind (type or value), the pattern, and why.
 * A value filter opens for editing; × removes one. Removing a filter puts
 * nothing back — that is said in the toast, since it is the one thing about
 * filters that is easy to assume the other way round.
 */
export function FindingFilterChips({
  caseId,
  filters,
  readOnly,
  onEdit,
  onChanged,
}: {
  caseId: string;
  filters: CaseFindingFilterDto[];
  readOnly?: boolean;
  onEdit: (filter: CaseFindingFilterDto) => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [removing, setRemoving] = React.useState<string | null>(null);

  const remove = async (filter: CaseFindingFilterDto) => {
    setRemoving(filter.id);
    try {
      await api.cases.caseCleanupControllerRemoveFilter({ id: caseId, filterId: filter.id });
      toast.success(t("caseFilters.removed"));
      onChanged();
    } catch (error) {
      toast.error(await extractApiErrorMessage(error, t("caseFilters.failedToRemove")));
    } finally {
      setRemoving(null);
    }
  };

  if (filters.length === 0) return null;
  return (
    <ul className="flex flex-wrap gap-1" data-testid="finding-filter-chips">
      {filters.map((filter) => {
        const editable = !readOnly && filter.kind === "VALUE_PATTERN";
        const escalation = filter.action === "ESCALATE";
        return (
          <li key={filter.id} className="min-w-0 max-w-full">
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className={cn(
                    "inline-flex max-w-full items-center gap-1 rounded-[4px] border px-1.5 py-0.5 text-[11px]",
                    escalation
                      ? "border-escalation/50 bg-escalation-soft"
                      : "border-border bg-card",
                  )}
                  data-testid="finding-filter-chip"
                  data-action={filter.action}
                >
                  <span
                    className={cn(
                      "shrink-0 font-mono text-[9px] uppercase tracking-wide",
                      escalation ? "text-escalation" : "text-muted-foreground",
                    )}
                  >
                    {escalation && (
                      <span className="mr-0.5" aria-hidden>
                        ▲
                      </span>
                    )}
                    {t(`caseFilters.kind.${filter.kind}`)}
                  </span>
                  {editable ? (
                    <button
                      type="button"
                      className="min-w-0 truncate font-mono hover:underline"
                      onClick={() => onEdit(filter)}
                      aria-label={t("caseFilters.edit")}
                    >
                      {filter.pattern}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate font-mono">{filter.pattern}</span>
                  )}
                  {filter.description && (
                    <span className="min-w-0 max-w-[140px] truncate text-muted-foreground">· {filter.description}</span>
                  )}
                  {!readOnly && (
                    <button
                      type="button"
                      className="-mr-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-[2px] text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={t("caseFilters.remove")}
                      disabled={removing === filter.id}
                      onClick={() => void remove(filter)}
                    >
                      {removing === filter.id ? <Loader2 className="size-3 animate-spin" /> : <X className="size-3" />}
                    </button>
                  )}
                </span>
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="font-mono text-xs">{filter.pattern}</p>
                {filter.description && <p className="text-xs">{filter.description}</p>}
                {filter.createdBy && (
                  <p className="text-[11px] opacity-70">{t("caseFilters.addedBy", { name: filter.createdBy })}</p>
                )}
              </TooltipContent>
            </Tooltip>
          </li>
        );
      })}
    </ul>
  );
}
