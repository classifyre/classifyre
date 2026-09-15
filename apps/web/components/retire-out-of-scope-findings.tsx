"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type FindingBulkOperationDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import { Progress } from "@workspace/ui/components/progress";
import { Loader2 } from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

const POLL_MS = 1500;

/** The API's retire counts (`FindingBulkOperationDto.counts` is untyped JSON). */
type RetireCounts = {
  candidates?: number;
  byReason?: Record<string, number>;
  citedByCase?: number;
  watchedByInquiries?: number;
  inquiries?: Array<{ id: string; title: string; count: number }>;
  wouldRetire?: number;
  wouldRetireIncludingWatched?: number;
  notProvable?: Array<{ dimension: string; hint: string }>;
  capReached?: boolean;
};

type Phase =
  | { step: "idle" }
  | { step: "counting"; operation: FindingBulkOperationDto }
  | { step: "review"; operation: FindingBulkOperationDto }
  | { step: "retiring"; operation: FindingBulkOperationDto }
  | { step: "done"; operation: FindingBulkOperationDto }
  | { step: "failed"; message: string };

type Props = {
  detectorId: string;
  detectorKey: string;
  /**
   * Set after a save that narrowed the detector: open the review and count.
   * A request the component acknowledges, not a counter it compares — the page
   * reloads the detector after a save, which remounts this section, and a
   * remount must neither lose the request nor replay it.
   */
  reviewRequested: boolean;
  onReviewStarted: () => void;
};

const countsOf = (operation: FindingBulkOperationDto): RetireCounts =>
  (operation.counts ?? {}) as RetireCounts;

const modeOf = (operation: FindingBulkOperationDto): string | undefined =>
  (operation.filters as { mode?: string } | undefined)?.mode;

/**
 * Review and retire findings this detector can no longer produce.
 *
 * Both steps are background operations on the API, so closing the dialog
 * never stops them; reopening picks up a running one. Nothing is retired
 * without a completed count the operator has seen.
 */
export function RetireOutOfScopeFindings({
  detectorId,
  detectorKey,
  reviewRequested,
  onReviewStarted,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ step: "idle" });
  const [includeWatched, setIncludeWatched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Development StrictMode runs effects twice; one save must start one count.
  const requestHandled = useRef(false);

  const startCount = useCallback(async () => {
    setIncludeWatched(false);
    setStopping(false);
    try {
      const operation =
        await api.customDetectors.customDetectorsControllerRetireOutOfScopeFindings(
          { id: detectorId, retireOutOfScopeFindingsDto: {} },
        );
      setPhase({ step: "counting", operation });
    } catch (error) {
      setPhase({
        step: "failed",
        message: await extractApiErrorMessage(
          error,
          t("detectors.retire.startFailed"),
        ),
      });
    }
  }, [detectorId, t]);

  // Reopening the dialog resumes an operation already running for this detector.
  const openReview = useCallback(async () => {
    setOpen(true);
    try {
      const active = await api.findings.findingsControllerListBulkOperations({
        active: true,
      });
      const running = active.find(
        (op) =>
          op.kind === "RETIRE_OUT_OF_SCOPE" &&
          (op.filters as { plan?: { detectorId?: string } } | undefined)?.plan
            ?.detectorId === detectorId,
      );
      if (running) {
        setPhase({
          step: modeOf(running) === "retire" ? "retiring" : "counting",
          operation: running,
        });
        return;
      }
    } catch {
      // Listing is a convenience; counting afresh is always correct.
    }
    await startCount();
  }, [detectorId, startCount]);

  useEffect(() => {
    if (!reviewRequested) {
      requestHandled.current = false;
      return;
    }
    if (requestHandled.current) return;
    requestHandled.current = true;
    onReviewStarted();
    void openReview();
  }, [reviewRequested, onReviewStarted, openReview]);

  const operationId =
    phase.step === "counting" || phase.step === "retiring"
      ? phase.operation.id
      : null;

  useEffect(() => {
    if (!operationId) return;
    const timer = setInterval(async () => {
      let operation: FindingBulkOperationDto;
      try {
        operation = await api.findings.findingsControllerGetBulkOperation({
          operationId,
        });
      } catch {
        return; // the next tick tries again
      }
      setPhase((current) => {
        if (
          (current.step !== "counting" && current.step !== "retiring") ||
          current.operation.id !== operationId
        ) {
          return current;
        }
        if (operation.status === "FAILED") {
          return { step: "failed", message: operation.errorMessage ?? "" };
        }
        const finished =
          operation.status === "COMPLETED" || operation.status === "CANCELLED";
        if (current.step === "counting") {
          if (operation.status === "CANCELLED") return { step: "idle" };
          return finished
            ? { step: "review", operation }
            : { step: "counting", operation };
        }
        return finished
          ? { step: "done", operation }
          : { step: "retiring", operation };
      });
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [operationId]);

  async function retire(dryRun: FindingBulkOperationDto) {
    const counts = countsOf(dryRun);
    const expectedCount = includeWatched
      ? (counts.wouldRetireIncludingWatched ?? 0)
      : (counts.wouldRetire ?? 0);
    setSubmitting(true);
    try {
      const operation =
        await api.customDetectors.customDetectorsControllerRetireOutOfScopeFindings(
          {
            id: detectorId,
            retireOutOfScopeFindingsDto: {
              dryRun: false,
              fromOperationId: dryRun.id,
              expectedCount,
              confirm: true,
              includeInquiryWatched: includeWatched,
            },
          },
        );
      setPhase({ step: "retiring", operation });
    } catch (error) {
      setPhase({
        step: "failed",
        message: await extractApiErrorMessage(
          error,
          t("detectors.retire.startFailed"),
        ),
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function stop(operation: FindingBulkOperationDto) {
    setStopping(true);
    try {
      await api.findings.findingsControllerCancelBulkOperation({
        operationId: operation.id,
      });
    } catch {
      setStopping(false);
    }
  }

  const reasonLabel = (reason: string) => {
    const [kind, ...rest] = reason.split(":");
    const value = rest.join(":");
    return kind === "asset_kind"
      ? t("detectors.retire.reasonAssetKind", { value })
      : t("detectors.retire.reasonPatternRemoved", { value });
  };

  return (
    <section className="space-y-3" data-testid="retire-out-of-scope">
      <div>
        <h2 className="font-serif text-2xl font-black uppercase tracking-[0.06em]">
          {t("detectors.retire.title")}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">
          {t("detectors.retire.description")}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="rounded-[4px] border-2 border-border"
        onClick={() => void openReview()}
        data-testid="btn-check-out-of-scope"
      >
        {t("detectors.retire.check")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {t("detectors.retire.dialogTitle", { key: detectorKey })}
            </DialogTitle>
            <DialogDescription>
              {t("detectors.retire.dialogDescription")}
            </DialogDescription>
          </DialogHeader>

          {phase.step === "counting" && (
            <div className="space-y-2 text-sm" aria-live="polite">
              <p className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {phase.operation.status === "PENDING"
                  ? t("detectors.retire.queued")
                  : t("detectors.retire.counting", {
                      percent: String(phase.operation.percent),
                    })}
              </p>
              <Progress value={phase.operation.percent} />
            </div>
          )}

          {phase.step === "review" &&
            (() => {
              const counts = countsOf(phase.operation);
              const candidates = counts.candidates ?? 0;
              const watched = counts.watchedByInquiries ?? 0;
              const willRetire = includeWatched
                ? (counts.wouldRetireIncludingWatched ?? 0)
                : (counts.wouldRetire ?? 0);
              return (
                <div className="space-y-4 text-sm" data-testid="retire-review">
                  {candidates === 0 ? (
                    <p>{t("detectors.retire.none")}</p>
                  ) : (
                    <>
                      <p className="font-medium">
                        {t("detectors.retire.candidates", {
                          count: candidates.toLocaleString(),
                        })}
                      </p>
                      <ul className="space-y-1">
                        {Object.entries(counts.byReason ?? {})
                          .sort(([, a], [, b]) => b - a)
                          .map(([reason, count]) => (
                            <li
                              key={reason}
                              className="flex justify-between gap-3 rounded-[4px] border border-border/30 px-3 py-1.5"
                            >
                              <span>{reasonLabel(reason)}</span>
                              <span className="font-mono">
                                {count.toLocaleString()}
                              </span>
                            </li>
                          ))}
                      </ul>
                      <div className="space-y-1 rounded-[4px] border border-border/30 bg-muted/30 px-3 py-2">
                        <p>
                          {t("detectors.retire.keptCited", {
                            count: (counts.citedByCase ?? 0).toLocaleString(),
                          })}
                        </p>
                        <p>
                          {t("detectors.retire.keptWatched", {
                            count: watched.toLocaleString(),
                          })}
                        </p>
                        {(counts.inquiries ?? []).length > 0 && (
                          <ul className="ml-4 list-disc text-muted-foreground">
                            {(counts.inquiries ?? []).map((inquiry) => (
                              <li key={inquiry.id}>
                                {inquiry.title} —{" "}
                                {inquiry.count.toLocaleString()}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      {watched > 0 && (
                        <label className="flex items-start gap-2">
                          <Checkbox
                            checked={includeWatched}
                            onCheckedChange={(checked) =>
                              setIncludeWatched(checked === true)
                            }
                            data-testid="retire-include-watched"
                          />
                          <span>
                            {t("detectors.retire.includeWatched", {
                              count: watched.toLocaleString(),
                            })}
                            <span className="block text-xs text-muted-foreground">
                              {t("detectors.retire.includeWatchedHint")}
                            </span>
                          </span>
                        </label>
                      )}
                      <p className="text-muted-foreground">
                        {t("detectors.retire.willRetire", {
                          count: willRetire.toLocaleString(),
                        })}
                      </p>
                    </>
                  )}
                  {(counts.notProvable ?? []).length > 0 && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        {t("detectors.retire.notProvable")}
                      </summary>
                      <ul className="mt-1 space-y-1">
                        {(counts.notProvable ?? []).map((item) => (
                          <li key={item.dimension}>
                            <span className="font-mono">{item.dimension}</span>
                            {" — "}
                            {item.hint}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              );
            })()}

          {phase.step === "retiring" && (
            <div className="space-y-2 text-sm" aria-live="polite">
              <p className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {phase.operation.status === "PENDING"
                  ? t("detectors.retire.queued")
                  : t("detectors.retire.retiring", {
                      changed: phase.operation.changed.toLocaleString(),
                      percent: String(phase.operation.percent),
                    })}
              </p>
              <Progress value={phase.operation.percent} />
            </div>
          )}

          {phase.step === "done" && (
            <div className="space-y-2 text-sm" data-testid="retire-done">
              <p className="font-medium">
                {phase.operation.status === "CANCELLED"
                  ? t("detectors.retire.cancelled", {
                      count: phase.operation.changed.toLocaleString(),
                    })
                  : t("detectors.retire.done", {
                      count: phase.operation.changed.toLocaleString(),
                    })}
              </p>
              {countsOf(phase.operation).capReached && (
                <p className="text-muted-foreground">
                  {t("detectors.retire.capReached")}
                </p>
              )}
            </div>
          )}

          {phase.step === "failed" && (
            <p
              className="rounded-[4px] border-2 border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {t("detectors.retire.failed", { message: phase.message })}
            </p>
          )}

          <DialogFooter>
            {phase.step === "retiring" ? (
              <Button
                variant="outline"
                disabled={stopping || phase.operation.cancelRequested}
                onClick={() => void stop(phase.operation)}
              >
                {stopping || phase.operation.cancelRequested
                  ? t("findings.bulkOperations.stopping")
                  : t("findings.bulkOperations.stop")}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setOpen(false)}>
                {t("detectors.retire.close")}
              </Button>
            )}
            {(phase.step === "failed" || phase.step === "done") && (
              <Button variant="outline" onClick={() => void startCount()}>
                {t("detectors.retire.countAgain")}
              </Button>
            )}
            {phase.step === "review" &&
              (() => {
                const counts = countsOf(phase.operation);
                const willRetire = includeWatched
                  ? (counts.wouldRetireIncludingWatched ?? 0)
                  : (counts.wouldRetire ?? 0);
                return (
                  <Button
                    variant="destructive"
                    disabled={submitting || willRetire === 0}
                    onClick={() => void retire(phase.operation)}
                    data-testid="btn-retire-confirm"
                  >
                    {t("detectors.retire.retireButton", {
                      count: willRetire.toLocaleString(),
                    })}
                  </Button>
                );
              })()}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
