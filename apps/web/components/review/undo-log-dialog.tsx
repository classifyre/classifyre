"use client";

import * as React from "react";
import { api, type UndoLogEntryDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@workspace/ui/components/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip";
import { Spinner } from "@workspace/ui/components/spinner";
import { useTranslation } from "@/hooks/use-translation";
import { fmt } from "./review-format";

/**
 * Recent actions, reversible ones first.
 *
 * Undo here is not unbounded time travel: once the index has been rebuilt, the
 * pairs a batch referred to may have been re-scored or re-clustered. Those
 * entries are shown greyed with an explanation rather than offered and then
 * failing, which is the difference between a limit and a bug.
 */
export function UndoLogDialog({
  open,
  onOpenChange,
  onUndone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUndone: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [entries, setEntries] = React.useState<UndoLogEntryDto[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    let active = true;
    setLoading(true);
    api.correlationReview
      .correlationReviewControllerUndoLog({ limit: "20" })
      .then((r) => {
        if (active) setEntries(r.entries);
      })
      .catch(() => {
        if (active) setEntries([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [open]);

  const undo = async (entry: UndoLogEntryDto) => {
    setBusyId(entry.id);
    try {
      const result =
        await api.correlationReview.correlationReviewControllerUndo({
          undoBatchDto: { batchId: entry.id },
        });
      setEntries((prev) =>
        prev.map((e) =>
          e.id === entry.id
            ? { ...e, undoneAt: new Date().toISOString(), undoable: false }
            : e,
        ),
      );
      onUndone(t("review.undo.done", { count: fmt(result.reverted) }));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{t("review.undo.title")}</DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">
            {t("review.undo.empty")}
          </p>
        ) : (
          <ul className="max-h-[50vh] overflow-y-auto border-t-2 border-border">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center gap-3 border-b-2 border-border py-2.5"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-foreground">
                    {entry.summary}
                  </span>
                  <span className="block font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {t("review.undo.pairs", { count: fmt(entry.pairCount) })}
                    {" · "}
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </span>

                {entry.undoneAt ? (
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    {t("review.undo.undone")}
                  </span>
                ) : entry.undoable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => undo(entry)}
                    disabled={busyId === entry.id}
                  >
                    {t("review.undo.undo")}
                  </Button>
                ) : (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="shrink-0 cursor-help font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground underline decoration-dotted underline-offset-2">
                        {t("review.undo.undo")}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px]">
                      {t("review.undo.stale")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  );
}
