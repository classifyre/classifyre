"use client";

import * as React from "react";
import { ExternalLink, MessageSquarePlus } from "lucide-react";
import { api, type SupervisorJournalEntryDto } from "@workspace/api-client";
import { Button, Textarea } from "@workspace/ui/components";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";
import { useNsPath } from "@/lib/ns-path";

const PAGE = 20;

/**
 * The supervisor's journal.
 *
 * This is the screen that answers "what is it doing", and it is also the one
 * place steering it is direct: the agent starts every wake with no memory of
 * the last one except these entries, so a correction attached here is read back
 * as authoritative. That is why the note field sits on the entry rather than in
 * a settings page — the correction and the thing being corrected belong
 * together.
 */
export function SupervisorJournal() {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const [entries, setEntries] = React.useState<SupervisorJournalEntryDto[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [limit, setLimit] = React.useState(PAGE);
  const [noting, setNoting] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await api.autopilot.supervisorControllerJournal({
        limit: String(limit),
        before: "",
      });
      setEntries(res.entries);
    } catch {
      /* transient */
    } finally {
      setLoading(false);
    }
  }, [limit]);

  React.useEffect(() => {
    void load();
  }, [load]);

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
        {t("harness.supervisor.journal.desc")}
      </p>

      {entries.length === 0 ? (
        <p className="rounded-[4px] border-2 border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
          {t("harness.supervisor.journal.empty")}
        </p>
      ) : (
        <ol className="relative space-y-3 border-l-2 border-border pl-5">
          {entries.map((entry) => (
            <li key={entry.id} className="relative">
              <span className="absolute -left-[1.65rem] top-4 h-2 w-2 rounded-full border-2 border-background bg-[#d97706]" />
              <article className="rounded-[4px] border-2 border-border bg-card p-4">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {formatRelative(entry.createdAt)} · {entry.wakeReason}
                  </p>
                  <div className="flex items-center gap-3">
                    {entry.costUsd !== null &&
                      entry.costUsd !== undefined && (
                        <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
                          {t("harness.supervisor.journal.cost")} $
                          {entry.costUsd.toFixed(4)}
                        </span>
                      )}
                    {entry.runId && (
                      <a
                        href={nsPath(`/harness?tab=runs&run=${entry.runId}`)}
                        className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-[#d97706] hover:underline"
                      >
                        {t("harness.supervisor.journal.openRun")}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </header>

                <Field
                  label={t("harness.supervisor.journal.found")}
                  value={entry.situation}
                />
                <Field
                  label={t("harness.supervisor.journal.did")}
                  value={entry.did}
                />
                {/* `next` is emphasised because it is not a summary — it is the
                    instruction the following wake actually acts on. */}
                <Field
                  label={t("harness.supervisor.journal.next")}
                  value={entry.next}
                  emphasis
                />

                {entry.nextWakeAt && (
                  <p className="mt-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {t("harness.supervisor.journal.scheduled")}{" "}
                    {formatRelative(entry.nextWakeAt)}
                  </p>
                )}

                {entry.operatorNote ? (
                  <div className="mt-3 rounded-[3px] border-l-2 border-sky-500/60 bg-sky-500/[0.06] px-3 py-2">
                    <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                      {t("harness.supervisor.journal.operatorNote")}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">
                      {entry.operatorNote}
                    </p>
                  </div>
                ) : noting === entry.id ? (
                  <NoteEditor
                    entryId={entry.id}
                    onDone={() => {
                      setNoting(null);
                      void load();
                    }}
                    onCancel={() => setNoting(null)}
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="mt-2 h-7 px-2"
                    onClick={() => setNoting(entry.id)}
                  >
                    <MessageSquarePlus className="mr-1 h-3.5 w-3.5" />
                    {t("harness.supervisor.journal.correct")}
                  </Button>
                )}
              </article>
            </li>
          ))}
        </ol>
      )}

      {entries.length >= limit && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setLimit((n) => n + PAGE)}
          >
            {t("harness.supervisor.journal.loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="mt-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p
        className={
          emphasis
            ? "mt-0.5 whitespace-pre-wrap text-sm font-medium leading-relaxed"
            : "mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground"
        }
      >
        {value}
      </p>
    </div>
  );
}

function NoteEditor({
  entryId,
  onDone,
  onCancel,
}: {
  entryId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    if (!note.trim()) return;
    setSaving(true);
    try {
      await api.autopilot.supervisorControllerAnnotate({
        id: entryId,
        annotateJournalDto: { note: note.trim() },
      });
      toast.success(t("harness.supervisor.journal.correctionSaved"));
      onDone();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <Textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t("harness.supervisor.journal.correctPlaceholder")}
        rows={3}
        className="rounded-[4px] border-2 text-sm"
      />
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
        {t("harness.supervisor.journal.correctHint")}
      </p>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => void save()} disabled={saving}>
          {t("harness.supervisor.goals.save")}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t("harness.supervisor.goals.cancel")}
        </Button>
      </div>
    </div>
  );
}
