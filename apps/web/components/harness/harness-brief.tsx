"use client";

import * as React from "react";
import { api, type AgentSystemBriefDto } from "@workspace/api-client";
import { EmptyState } from "@workspace/ui/components/empty-state";
import { Badge, Button, Textarea } from "@workspace/ui/components";
import { BookOpen, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";
import { formatRelative } from "@/lib/date";

function humanizeFactKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

/** The living system brief — what the harness understands about the system. */
export function HarnessBrief() {
  const { t } = useTranslation();
  const [brief, setBrief] = React.useState<AgentSystemBriefDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    api.autopilot
      .autopilotControllerGetSystemBrief()
      .then(setBrief)
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  const startEdit = () => {
    setDraft(brief?.content ?? "");
    setEditing(true);
  };

  const saveBrief = async () => {
    try {
      setSaving(true);
      const updated = await api.autopilot.autopilotControllerUpdateSystemBrief({
        updateSystemBriefDto: { content: draft },
      });
      setBrief(updated);
      setEditing(false);
      toast.success(t("harness.brief.saved"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("settings.failedToSave"));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-16 text-sm">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("harness.loading")}
      </div>
    );
  }

  if (editing) {
    return (
      <div className="space-y-3">
        <Textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={16}
          maxLength={20000}
          placeholder={t("harness.brief.placeholder")}
          className="rounded-[6px] border-2 border-border font-serif text-[15px] leading-relaxed"
        />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditing(false)}>
            {t("harness.brief.cancel")}
          </Button>
          <Button onClick={() => void saveBrief()} disabled={saving}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {t("harness.brief.save")}
          </Button>
        </div>
      </div>
    );
  }

  if (!brief || brief.version === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-4">
        <EmptyState
          icon={BookOpen}
          title={t("harness.brief.empty")}
          description={t("harness.brief.emptyDesc")}
        />
        <Button onClick={startEdit}>
          <Pencil className="h-3.5 w-3.5" />
          {t("harness.brief.create")}
        </Button>
      </div>
    );
  }

  const facts = Object.entries(brief.facts ?? {}).filter(
    ([k]) => k !== "refreshedAt",
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <BookOpen className="h-4 w-4 text-[#d97706]" />
        <Badge variant="outline" className="font-mono text-[10px]">
          {t("harness.brief.version", { n: brief.version })}
        </Badge>
        {brief.updatedBy && (
          <span className="font-mono text-[10px] text-muted-foreground">
            {t("harness.brief.updatedBy", { who: brief.updatedBy })}
          </span>
        )}
        {brief.updatedAt && (
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground/70">
            {formatRelative(brief.updatedAt)}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          className="ml-auto"
          onClick={startEdit}
        >
          <Pencil className="h-3.5 w-3.5" />
          {t("harness.brief.edit")}
        </Button>
      </div>

      {facts.length > 0 && (
        <div>
          <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
            {t("harness.brief.facts")}
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {facts.map(([key, value]) => (
              <div
                key={key}
                className="rounded-[4px] border-2 border-border bg-card px-3 py-2.5 shadow-[2px_2px_0_var(--color-border)]"
              >
                <p className="font-serif text-2xl font-black tabular-nums">
                  {typeof value === "number" || typeof value === "string"
                    ? String(value)
                    : JSON.stringify(value)}
                </p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  {humanizeFactKey(key)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
          {t("harness.brief.narrative")}
        </p>
        <article className="whitespace-pre-wrap rounded-[6px] border-2 border-border bg-card p-5 font-serif text-[15px] leading-relaxed shadow-[2px_2px_0_var(--color-border)]">
          {brief.content?.trim() || t("harness.brief.never")}
        </article>
      </div>
    </div>
  );
}
