"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FindingBulkOperationDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components";
import { Loader2, X } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

const POLL_MS = 2000;
const MAX_FINISHED_SHOWN = 3;

const RETIRE = "RETIRE_OUT_OF_SCOPE";

type RetireFilters = { mode?: string; plan?: { customDetectorKey?: string } };

/** A retire dry run changes nothing; its progress lives in the detector's dialog. */
const isDryRun = (op: FindingBulkOperationDto): boolean =>
  op.kind === RETIRE && (op.filters as RetireFilters).mode === "dry_run";

const detectorKeyOf = (op: FindingBulkOperationDto): string =>
  (op.filters as RetireFilters).plan?.customDetectorKey ?? "";

const finishedKey = (op: FindingBulkOperationDto): TranslationKey => {
  const retire = op.kind === RETIRE;
  if (op.status === "COMPLETED") {
    return retire
      ? "findings.bulkOperations.retireCompleted"
      : "findings.bulkOperations.completed";
  }
  return retire
    ? "findings.bulkOperations.retireCancelled"
    : "findings.bulkOperations.cancelled";
};

type Props = {
  /** Bumped when this page queues an operation, to look for it immediately. */
  refreshKey: number;
  /** Called when an operation this banner was watching finishes. */
  onSettled?: () => void;
};

/**
 * Background bulk finding operations for this workspace.
 *
 * A select-all over a large corpus no longer runs inside the request that
 * started it, so the dialog closes at once and progress lives here. Polls only
 * while something is queued or running.
 */
export function FindingsBulkOperationsBanner({ refreshKey, onSettled }: Props) {
  const { t } = useTranslation();
  const [active, setActive] = useState<FindingBulkOperationDto[]>([]);
  const [finished, setFinished] = useState<FindingBulkOperationDto[]>([]);
  const [stopping, setStopping] = useState<Set<string>>(new Set());
  const watching = useRef<Set<string>>(new Set());
  const onSettledRef = useRef(onSettled);
  onSettledRef.current = onSettled;

  const poll = useCallback(async () => {
    let current: FindingBulkOperationDto[];
    try {
      current = (
        await api.findings.findingsControllerListBulkOperations({
          active: true,
        })
      ).filter((op) => !isDryRun(op));
    } catch {
      return; // keep what is on screen; the next poll tries again
    }
    const currentIds = new Set(current.map((op) => op.id));
    const done = [...watching.current].filter((id) => !currentIds.has(id));
    watching.current = currentIds;
    setActive(current);
    if (done.length === 0) return;

    const finals = await Promise.all(
      done.map((operationId) =>
        api.findings
          .findingsControllerGetBulkOperation({ operationId })
          .catch(() => null),
      ),
    );
    setFinished((previous) =>
      [
        ...finals.filter((op): op is FindingBulkOperationDto => op !== null),
        ...previous,
      ].slice(0, MAX_FINISHED_SHOWN),
    );
    onSettledRef.current?.();
  }, []);

  useEffect(() => {
    void poll();
  }, [poll, refreshKey]);

  useEffect(() => {
    if (active.length === 0) return;
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(timer);
  }, [active.length, poll]);

  async function stop(operationId: string) {
    setStopping((previous) => new Set(previous).add(operationId));
    try {
      await api.findings.findingsControllerCancelBulkOperation({ operationId });
    } finally {
      void poll();
    }
  }

  if (active.length === 0 && finished.length === 0) return null;

  return (
    <div className="space-y-2" aria-live="polite">
      {active.map((op) => {
        const total = Math.max(op.totalEstimate, op.processed);
        return (
          <div
            key={op.id}
            className="rounded-[4px] border-2 border-border bg-card px-4 py-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {op.status === "PENDING" ? (
                  // Background work shares a few global worker slots with
                  // embedding and correlation; on a busy instance a queued
                  // change can wait minutes before its first page.
                  op.kind === RETIRE ? (
                    t("findings.bulkOperations.retireQueued", {
                      key: detectorKeyOf(op),
                    })
                  ) : (
                    t("findings.bulkOperations.queued", {
                      total: total.toLocaleString(),
                    })
                  )
                ) : op.kind === RETIRE ? (
                  t("findings.bulkOperations.retireRunning", {
                    key: detectorKeyOf(op),
                    changed: op.changed.toLocaleString(),
                    percent: String(op.percent),
                  })
                ) : (
                  <>
                    {t("findings.bulkOperations.running", {
                      processed: op.processed.toLocaleString(),
                      total: total.toLocaleString(),
                      percent: String(op.percent),
                    })}
                    <span className="text-muted-foreground">
                      {t("findings.bulkOperations.changed", {
                        count: op.changed.toLocaleString(),
                      })}
                    </span>
                  </>
                )}
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={op.cancelRequested || stopping.has(op.id)}
                onClick={() => void stop(op.id)}
                className="rounded-[4px] border-2 border-border"
              >
                {op.cancelRequested || stopping.has(op.id)
                  ? t("findings.bulkOperations.stopping")
                  : t("findings.bulkOperations.stop")}
              </Button>
            </div>
            <div
              className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={op.percent}
            >
              <div
                className="h-full bg-foreground transition-[width]"
                style={{ width: `${op.percent}%` }}
              />
            </div>
          </div>
        );
      })}

      {finished.map((op) => (
        <div
          key={op.id}
          className={
            op.status === "FAILED"
              ? "flex items-start justify-between gap-3 rounded-[4px] border-2 border-destructive/40 bg-destructive/5 px-4 py-3 text-sm text-destructive"
              : "flex items-start justify-between gap-3 rounded-[4px] border-2 border-border bg-muted/40 px-4 py-3 text-sm"
          }
        >
          <p>
            {op.status === "FAILED"
              ? t("findings.bulkOperations.failed", {
                  message: op.errorMessage ?? "",
                })
              : t(finishedKey(op), {
                  count: op.changed.toLocaleString(),
                  key: detectorKeyOf(op),
                })}
          </p>
          <button
            type="button"
            aria-label={t("findings.bulkOperations.dismiss")}
            onClick={() =>
              setFinished((previous) => previous.filter((o) => o.id !== op.id))
            }
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
