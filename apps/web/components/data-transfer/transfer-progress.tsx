"use client";

import * as React from "react";
import { Button } from "@workspace/ui/components";
import {
  CheckCircle2,
  CircleSlash,
  Loader2,
  TriangleAlert,
  XCircle,
} from "lucide-react";
import { cn } from "@workspace/ui/lib/utils";

import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import {
  formatRows,
  isTerminal,
  type TransferJob,
} from "@/lib/data-transfer-api";

/**
 * Live state of one transfer.
 *
 * The bar is deliberately a thin rule rather than a rounded pill: this sits
 * inside a settings card that is otherwise all hairlines and mono counters, and
 * a chunky progress widget would read as borrowed from somewhere else. The
 * counters do the real work — a transfer's honest unit is rows, and a percent
 * derived from an up-front estimate deserves less prominence than the number it
 * was derived from.
 */
export function TransferProgressPanel({
  job,
  onCancel,
  cancelling,
  children,
}: {
  job: TransferJob;
  onCancel?: () => void;
  cancelling?: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  const running = !isTerminal(job.status);

  return (
    <div className="space-y-3 rounded-[4px] border-2 border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusIcon status={job.status} />
          <span className="text-xs font-mono uppercase tracking-[0.14em]">
            {t(
              job.kind === "EXPORT"
                ? "dataTransfer.exportHeading"
                : "dataTransfer.importHeading",
            )}
          </span>
          <span
            className={cn(
              "rounded-[2px] border px-1.5 py-px font-mono text-[10px] uppercase tracking-[0.1em]",
              statusChipClass(job.status),
            )}
          >
            {t(`dataTransfer.status.${job.status}` as TranslationKey)}
          </span>
        </div>

        {running && onCancel ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCancel}
            disabled={cancelling || job.cancelRequested}
            className="h-7 text-[11px]"
          >
            {job.cancelRequested
              ? t("dataTransfer.cancelling")
              : t("dataTransfer.cancel")}
          </Button>
        ) : null}
      </div>

      {running ? (
        <div className="space-y-1.5">
          <div className="h-[3px] w-full overflow-hidden bg-border">
            <div
              className="h-full bg-primary transition-[width] duration-500 ease-out"
              style={{ width: `${Math.max(job.percent, 2)}%` }}
            />
          </div>
          <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] tabular-nums text-muted-foreground">
            <span>
              {job.currentTable
                ? t("dataTransfer.processingTable", { table: job.currentTable })
                : t("dataTransfer.preparing")}
            </span>
            <span>
              {formatRows(job.processedRows)}
              {job.totalRows > 0 ? ` / ${formatRows(job.totalRows)}` : ""}
              {" · "}
              {job.percent}%
            </span>
          </div>
        </div>
      ) : (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 font-mono text-[11px] tabular-nums sm:grid-cols-3">
          <Stat
            label={t("dataTransfer.rowsTransferred")}
            value={formatRows(job.processedRows)}
          />
          {job.skippedRows > 0 ? (
            <Stat
              label={t("dataTransfer.rowsSkipped")}
              value={formatRows(job.skippedRows)}
            />
          ) : null}
          {children}
        </dl>
      )}

      {job.errorMessage ? (
        <p className="rounded-[4px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {job.errorMessage}
        </p>
      ) : null}

      {job.warnings.length > 0 ? (
        <ul className="space-y-1.5 rounded-[4px] border border-amber-500/30 bg-amber-500/5 px-3 py-2">
          {job.warnings.map((warning) => (
            <li
              key={warning}
              className="flex items-start gap-2 text-[11px] leading-relaxed text-amber-700 dark:text-amber-500"
            >
              <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      {!running && Object.keys(job.counts).length > 0 ? (
        <details className="group">
          <summary className="cursor-pointer list-none font-mono text-[11px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:text-foreground">
            {t("dataTransfer.showManifest")}
          </summary>
          <ul className="mt-2 divide-y divide-border border-t border-border">
            {Object.entries(job.counts)
              .sort(([, a], [, b]) => b - a)
              .map(([table, count]) => (
                <li
                  key={table}
                  className="flex items-baseline justify-between gap-4 py-1 font-mono text-[11px] tabular-nums"
                >
                  <span className="text-muted-foreground">{table}</span>
                  <span>{formatRows(count)}</span>
                </li>
              ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function StatusIcon({ status }: { status: TransferJob["status"] }) {
  switch (status) {
    case "COMPLETED":
      return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
    case "FAILED":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "CANCELLED":
      return <CircleSlash className="h-4 w-4 text-muted-foreground" />;
    default:
      return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
  }
}

function statusChipClass(status: TransferJob["status"]): string {
  switch (status) {
    case "COMPLETED":
      return "border-emerald-600/40 text-emerald-700 dark:text-emerald-500";
    case "FAILED":
      return "border-destructive/40 text-destructive";
    case "CANCELLED":
      return "border-border text-muted-foreground";
    default:
      return "border-primary/40 text-primary";
  }
}
