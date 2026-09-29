"use client";

import * as React from "react";
import { Loader2, Search } from "lucide-react";
import { api, type CaseResponseDto } from "@workspace/api-client";
import { Input } from "@workspace/ui/components/input";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";

/** Open cases take new evidence and watches; a closed case is a record. */
const OPEN_STATUSES = ["OPEN", "IN_PROGRESS"] as const;

/**
 * The open cases, searched as the person types and read afresh every time
 * the list is shown (a case opened meanwhile in another tab is there). One
 * is picked at a time.
 */
export function CaseSearchList({
  selectedId,
  onSelect,
  excludeIds,
  autoFocus = false,
  onLoaded,
  className,
}: {
  selectedId: string | null;
  onSelect: (c: CaseResponseDto) => void;
  /** Cases not to offer (already linked, the case we are in). */
  excludeIds?: ReadonlySet<string>;
  autoFocus?: boolean;
  /** The first answer (no search yet): lets a caller react to "there are no open cases". */
  onLoaded?: (cases: CaseResponseDto[]) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [search, setSearch] = React.useState("");
  const [cases, setCases] = React.useState<CaseResponseDto[] | null>(null);
  const onLoadedRef = React.useRef(onLoaded);
  onLoadedRef.current = onLoaded;
  const firstRead = React.useRef(true);

  React.useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      api.cases
        .casesControllerList({ search: search.trim() || undefined, status: [...OPEN_STATUSES], limit: 50 })
        .then((res) => {
          if (cancelled) return;
          const items = res.items ?? [];
          setCases(items);
          if (firstRead.current && !search.trim()) {
            firstRead.current = false;
            onLoadedRef.current?.(items);
          }
        })
        .catch(() => {
          if (!cancelled) setCases([]);
        });
    }, search ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const shown = (cases ?? []).filter((c) => !excludeIds?.has(c.id));

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={search}
          autoFocus={autoFocus}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.stopPropagation()}
          placeholder={t("caseTarget.search")}
          className="h-8 pl-7 text-sm"
          aria-label={t("caseTarget.search")}
        />
      </div>
      <ul className="max-h-48 space-y-0.5 overflow-y-auto" role="listbox" aria-label={t("caseTarget.existing")}>
        {cases === null ? (
          <li className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> {t("caseTarget.loading")}
          </li>
        ) : shown.length === 0 ? (
          <li className="px-2 py-2 text-xs text-muted-foreground">{t("caseTarget.noCases")}</li>
        ) : (
          shown.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={selectedId === c.id}
                onClick={() => onSelect(c)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-[3px] px-2 py-1.5 text-left text-sm hover:bg-muted",
                  selectedId === c.id && "bg-foreground text-background hover:bg-foreground",
                )}
                data-testid="case-search-option"
              >
                <span className="min-w-0 flex-1 truncate">{c.title}</span>
                <span className="shrink-0 font-mono text-[10px] opacity-70">{c.severity}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
