"use client";

import { nsPath } from "@/lib/ns-path";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate, formatRelative, formatShortUTC } from "@/lib/date";
import { Filter, Loader2 } from "lucide-react";
import { AiActorBadge, isAiActor } from "@/components/ai-actor-badge";
import { api, type CaseResponseDto } from "@workspace/api-client";
import {
  EmptyState,
  SeverityBadge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components";
import { CaseStatusBadge } from "./case-status-badge";
import { EscalatedPill } from "./cases/escalated-pill";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

export interface CasesTableProps {
  /** Rows to show: the most recently updated cases. */
  limit?: number;
}

/**
 * The dashboard's casework list: the latest cases as table rows, each opening
 * its case. The investigations page shows the same cases as cards
 * (`components/cases/cases-grid.tsx`), with the same status and severity
 * badges, so the two agree on how a case is labelled.
 */
export function CasesTable({ limit = 6 }: CasesTableProps = {}) {
  const { t } = useTranslation();
  const router = useRouter();

  const [data, setData] = useState<CaseResponseDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api.cases
      .casesControllerList({ skip: 0, limit })
      .then((res) => {
        if (!active) return;
        setError(null);
        setData(res.items);
      })
      .catch((loadError: unknown) => {
        if (!active) return;
        console.error("Failed to load cases:", loadError);
        setError(loadError instanceof Error ? loadError.message : "Failed to load cases");
        setData([]);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [limit]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="relative min-h-0 flex-1">
        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
            <span className="ml-2 text-sm">{t("cases.loading")}</span>
          </div>
        ) : data.length === 0 ? (
          <EmptyState
            icon={Filter}
            title={t("cases.noInvestigations")}
            description={t("cases.noInvestigationsHint")}
          />
        ) : (
          <div className="max-h-full overflow-auto rounded-[4px] bg-white dark:bg-card">
            <Table>
              <TableHeader className="sticky top-0 z-20 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80 dark:bg-card/95 dark:supports-[backdrop-filter]:bg-card/80">
                <TableRow>
                  <ColumnHead label={t("cases.columns.title")} hint="Investigation title" />
                  <ColumnHead label={t("cases.columns.status")} hint="Current investigation status" />
                  <ColumnHead label={t("cases.columns.severity")} hint="Risk level assigned to this investigation" />
                  <ColumnHead label={t("cases.columns.inquiries")} hint="Number of linked inquiries" align="right" />
                  <ColumnHead label={t("cases.columns.updated")} hint="Last updated timestamp" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((c) => (
                  <TableRow
                    key={c.id}
                    className="cursor-pointer hover:bg-muted/40"
                    onClick={() => router.push(nsPath(`/investigations/${c.id}`))}
                    data-escalated={c.escalatedCount > 0 ? "true" : undefined}
                  >
                    <TableCell className="font-medium">
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {c.title}
                        {isAiActor(c.createdBy) && <AiActorBadge />}
                        {c.escalatedCount > 0 && <EscalatedPill count={c.escalatedCount} at={c.lastEscalatedAt} />}
                      </span>
                    </TableCell>
                    <TableCell>
                      <CaseStatusBadge status={c.status} />
                    </TableCell>
                    <TableCell>
                      <SeverityBadge
                        severity={c.severity.toLowerCase() as "critical" | "high" | "medium" | "low" | "info"}
                      >
                        {t(`cases.severityLabels.${c.severity}` as TranslationKey)}
                      </SeverityBadge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{c.inquiryCount}</TableCell>
                    <TableCell>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default text-xs text-muted-foreground">
                            {formatRelative(c.updatedAt)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="left">
                          <div>{formatDate(c.updatedAt)}</div>
                          {formatShortUTC(c.updatedAt) && (
                            <div className="text-muted-foreground/70">{formatShortUTC(c.updatedAt)}</div>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}

function ColumnHead({ label, hint, align }: { label: string; hint: string; align?: "right" }) {
  return (
    <TableHead className={align === "right" ? "bg-white/95 text-right dark:bg-card/95" : "bg-white/95 dark:bg-card/95"}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="cursor-default text-[10px] tracking-[0.14em] text-muted-foreground uppercase">{label}</span>
        </TooltipTrigger>
        <TooltipContent>{hint}</TooltipContent>
      </Tooltip>
    </TableHead>
  );
}
