"use client";

import * as React from "react";
import { Undo2 } from "lucide-react";
import { api, type AgentUndoEntryDto } from "@workspace/api-client";
import { Button } from "@workspace/ui/components";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";

/**
 * The undo log.
 *
 * Honest about what it can do: a "rescan" entry does not restore anything, it
 * re-derives. Findings and assets come back from a scan; the triage decisions
 * someone made about them do not, which is why the purge tools refuse to touch
 * anything a case cites in the first place.
 */
export function SupervisorUndo() {
  const { t } = useTranslation();
  const [entries, setEntries] = React.useState<AgentUndoEntryDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [reverting, setReverting] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await api.autopilot.supervisorControllerUndoLog({ limit: "50" });
      setEntries(res.entries);
    } catch {
      /* transient */
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const revert = async (id: string) => {
    if (!window.confirm(t("harness.supervisor.undo.confirm"))) return;
    setReverting(id);
    try {
      const res = await api.autopilot.supervisorControllerRevert({ id });
      toast.success(res.outcome);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setReverting(null);
    }
  };

  if (loading) {
    return (
      <p className="py-16 text-center text-sm text-muted-foreground">
        {t("harness.loading")}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-muted-foreground">
        {t("harness.supervisor.undo.desc")}
      </p>

      {entries.length === 0 ? (
        <p className="rounded-[4px] border-2 border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {t("harness.supervisor.undo.empty")}
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-[4px] border-2 border-border bg-card p-3"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-[3px] border border-border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {entry.revertKind === "rescan"
                      ? t("harness.supervisor.undo.rescan")
                      : t("harness.supervisor.undo.restoreValue")}
                  </span>
                  <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                    {formatRelative(entry.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-sm">{entry.label}</p>
                {entry.blockedReason && (
                  <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {entry.revertedAt
                      ? t("harness.supervisor.undo.revertedAt", {
                          when: formatRelative(entry.revertedAt),
                        })
                      : t("harness.supervisor.undo.expired")}
                    {entry.revertedBy
                      ? ` ${t("harness.supervisor.undo.revertedBy", {
                          who: entry.revertedBy,
                        })}`
                      : ""}
                  </p>
                )}
              </div>
              {entry.undoable && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reverting === entry.id}
                  onClick={() => void revert(entry.id)}
                >
                  <Undo2 className="mr-1 h-3.5 w-3.5" />
                  {reverting === entry.id
                    ? t("harness.supervisor.undo.reverting")
                    : t("harness.supervisor.undo.revert")}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
