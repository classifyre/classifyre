"use client";

import * as React from "react";
import { BookOpenText, Brain, Eye, Loader2, Pencil, Plus, Scale, Search, Settings, Table2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api, type AgentMemoryDto } from "@workspace/api-client";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@workspace/ui/components";
import { useTranslation } from "@/hooks/use-translation";
import { cn } from "@workspace/ui/lib/utils";

type Kind = "GLOSSARY" | "DECISION_PRECEDENT" | "ENTITY_MAP" | "SOURCE_PROFILE" | "DETECTOR_INSIGHT" | "OPERATOR_DIRECTIVE";

/**
 * The agent's long-term memory as an editable card catalog. The operator can
 * correct wrong lessons, boost important ones (weight) or plant new knowledge
 * to steer future cycles.
 */
export function AutopilotMemory() {
  const { t } = useTranslation();
  const [items, setItems] = React.useState<AgentMemoryDto[]>([]);
  const [total, setTotal] = React.useState(0);
  const [loading, setLoading] = React.useState(true);
  const [kind, setKind] = React.useState<Kind | "ALL">("ALL");
  const [search, setSearch] = React.useState("");
  const [editing, setEditing] = React.useState<AgentMemoryDto | null>(null);
  const [adding, setAdding] = React.useState(false);

  const KINDS: Array<{ value: Kind | "ALL"; label: string; icon: React.ReactNode }> = React.useMemo(
    () => [
      { value: "ALL",                label: t("investigations.autopilot.memory.filterAll"),             icon: <Brain className="h-3 w-3" /> },
      { value: "GLOSSARY",           label: t("investigations.autopilot.memory.filterGlossary"),         icon: <BookOpenText className="h-3 w-3" /> },
      { value: "DECISION_PRECEDENT", label: t("investigations.autopilot.memory.filterPrecedents"),       icon: <Scale className="h-3 w-3" /> },
      { value: "ENTITY_MAP",         label: t("investigations.autopilot.memory.filterEntityMap"),        icon: <Table2 className="h-3 w-3" /> },
      { value: "SOURCE_PROFILE",     label: t("investigations.autopilot.memory.filterSourceProfile"),    icon: <Eye className="h-3 w-3" /> },
      { value: "DETECTOR_INSIGHT",   label: t("investigations.autopilot.memory.filterDetectorInsight"),  icon: <Search className="h-3 w-3" /> },
      { value: "OPERATOR_DIRECTIVE", label: t("investigations.autopilot.memory.filterOperatorDirective"),icon: <Settings className="h-3 w-3" /> },
    ],
    [t],
  );

  const kindLabel = React.useCallback(
    (kind: string): string => {
      switch (kind) {
        case "GLOSSARY":           return t("investigations.autopilot.memory.kindGlossary");
        case "DECISION_PRECEDENT": return t("investigations.autopilot.memory.kindPrecedent");
        case "ENTITY_MAP":         return t("investigations.autopilot.memory.kindEntityMap");
        case "SOURCE_PROFILE":     return t("investigations.autopilot.memory.kindSourceProfile");
        case "DETECTOR_INSIGHT":   return t("investigations.autopilot.memory.kindDetectorInsight");
        case "OPERATOR_DIRECTIVE": return t("investigations.autopilot.memory.kindOperatorDirective");
        default: return kind;
      }
    },
    [t],
  );

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.autopilot.autopilotControllerListMemory({
        kind: kind === "ALL" ? undefined : kind,
        search: search.trim() || undefined,
        limit: 100,
      });
      setItems(res.items);
      setTotal(res.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("investigations.autopilot.memory.toastLoadError"));
    } finally {
      setLoading(false);
    }
  }, [kind, search, t]);

  React.useEffect(() => {
    const t = setTimeout(() => void load(), search ? 300 : 0);
    return () => clearTimeout(t);
  }, [load, search]);

  const remove = async (m: AgentMemoryDto) => {
    try {
      await api.autopilot.autopilotControllerDeleteMemory({ id: m.id });
      toast.success(t("investigations.autopilot.memory.toastForgotten"));
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("investigations.autopilot.memory.toastDeleteError"));
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-[4px] border-2 border-border p-0.5">
          {KINDS.map((k) => (
            <button
              key={k.value}
              onClick={() => setKind(k.value)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-[2px] px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors",
                kind === k.value
                  ? "bg-foreground text-background"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {k.icon}
              {k.label}
            </button>
          ))}
        </div>
        <div className="relative ml-auto w-56">
          <Search className="text-muted-foreground absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("investigations.autopilot.memory.searchPlaceholder")}
            className="h-8 rounded-[4px] border-2 border-border pl-8 text-sm"
          />
        </div>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" /> {t("investigations.autopilot.memory.teach")}
        </Button>
      </div>

      {loading ? (
        <div className="text-muted-foreground flex items-center justify-center gap-2 py-12 text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("investigations.autopilot.memory.loading")}
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Brain}
          title={t("investigations.autopilot.memory.emptyTitle")}
          description={t("investigations.autopilot.memory.emptyDesc")}
        />
      ) : (
        <>
          <p className="font-mono text-[11px] text-muted-foreground">
            {t("investigations.autopilot.memory.entryCount", { count: String(total), suffix: total === 1 ? "y" : "ies" })}
          </p>
          <div className="grid gap-2.5 md:grid-cols-2">
            {items.map((m) => (
              <div
                key={m.id}
                className="group rounded-[4px] border-2 border-border bg-card px-3.5 py-3 shadow-[0_1px_3px_rgba(28,25,23,0.04)]"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className="border-[#d97706]/40 px-1.5 text-[9px] uppercase tracking-wider text-[#d97706]"
                  >
                    {kindLabel(m.kind)}
                  </Badge>
                  <span className="truncate font-mono text-xs">{m.key}</span>
                  <span
                    className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground"
                    title={t("investigations.autopilot.memory.weightTooltip")}
                  >
                    ×{m.weight}
                  </span>
                </div>
                <p className="mt-1.5 line-clamp-3 text-sm text-muted-foreground">{m.content}</p>
                <div className="mt-2 flex items-center gap-1.5">
                  {m.tags.slice(0, 4).map((t) => (
                    <span key={t} className="rounded bg-muted/60 px-1.5 py-px font-mono text-[9px]">
                      {t}
                    </span>
                  ))}
                  <span className="ml-auto flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => setEditing(m)}
                      title={t("investigations.autopilot.memory.editTitle")}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-red-600 hover:text-red-700"
                      onClick={() => void remove(m)}
                      title={t("investigations.autopilot.memory.forgetTitle")}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      <MemoryEditDialog memory={editing} onClose={() => setEditing(null)} onSaved={load} />
      <MemoryAddDialog open={adding} onClose={() => setAdding(false)} onSaved={load} />
    </div>
  );
}

function MemoryEditDialog({
  memory,
  onClose,
  onSaved,
}: {
  memory: AgentMemoryDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [content, setContent] = React.useState("");
  const [tags, setTags] = React.useState("");
  const [weight, setWeight] = React.useState(1);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    if (memory) {
      setContent(memory.content);
      setTags(memory.tags.join(", "));
      setWeight(memory.weight);
    }
  }, [memory]);

  const save = async () => {
    if (!memory) return;
    try {
      setSaving(true);
      await api.autopilot.autopilotControllerUpdateMemory({
        id: memory.id,
        updateAgentMemoryDto: {
          content: content.trim(),
          tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
          weight,
        },
      });
      toast.success(t("investigations.autopilot.memory.toastUpdated"));
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("investigations.autopilot.memory.toastUpdateError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!memory} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-[6px] border-2 border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-mono text-sm">{memory?.key}</DialogTitle>
          <DialogDescription>
            {t("investigations.autopilot.memory.editDialogTitle")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            maxLength={2000}
            className="rounded-[4px] border-2 border-border text-sm"
          />
          <div className="grid grid-cols-[1fr_90px] gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] font-mono uppercase tracking-wider">{t("investigations.autopilot.memory.labelTags")}</Label>
              <Input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder={t("investigations.autopilot.memory.placeholders.tags")}
                className="h-8 rounded-[4px] border-2 border-border text-sm"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-mono uppercase tracking-wider">{t("investigations.autopilot.memory.labelWeight")}</Label>
              <Input
                type="number"
                min={0}
                value={weight}
                onChange={(e) => setWeight(Math.max(0, Number(e.target.value) || 0))}
                className="h-8 rounded-[4px] border-2 border-border text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("investigations.autopilot.memory.editCancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving || !content.trim()}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("investigations.autopilot.memory.editSave")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MemoryAddDialog({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [kind, setKind] = React.useState<Kind>("GLOSSARY");
  const [key, setKey] = React.useState("");
  const [content, setContent] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  const save = async () => {
    try {
      setSaving(true);
      await api.autopilot.autopilotControllerCreateMemory({
        createAgentMemoryDto: { kind, key: key.trim(), content: content.trim() },
      });
      toast.success(t("investigations.autopilot.memory.toastAdded"));
      setKey("");
      setContent("");
      onClose();
      onSaved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("investigations.autopilot.memory.toastAddError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-[6px] border-2 border-border sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("investigations.autopilot.memory.addDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("investigations.autopilot.memory.addDialogDesc")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-[150px_1fr] gap-2">
            <div className="space-y-1">
              <Label className="text-[10px] font-mono uppercase tracking-wider">{t("investigations.autopilot.memory.labelKind")}</Label>
              <Select value={kind} onValueChange={(v) => setKind(v as Kind)}>
                <SelectTrigger className="h-8 rounded-[4px] border-2 border-border text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GLOSSARY">{t("investigations.autopilot.memory.kindGlossary")}</SelectItem>
                  <SelectItem value="DECISION_PRECEDENT">{t("investigations.autopilot.memory.kindPrecedent")}</SelectItem>
                  <SelectItem value="ENTITY_MAP">{t("investigations.autopilot.memory.kindEntityMap")}</SelectItem>
                  <SelectItem value="SOURCE_PROFILE">{t("investigations.autopilot.memory.kindSourceProfile")}</SelectItem>
                  <SelectItem value="DETECTOR_INSIGHT">{t("investigations.autopilot.memory.kindDetectorInsight")}</SelectItem>
                  <SelectItem value="OPERATOR_DIRECTIVE">{t("investigations.autopilot.memory.kindOperatorDirective")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label className="text-[10px] font-mono uppercase tracking-wider">{t("investigations.autopilot.memory.labelKey")}</Label>
              <Input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={t("investigations.autopilot.memory.placeholders.key")}
                maxLength={200}
                className="h-8 rounded-[4px] border-2 border-border text-sm"
              />
            </div>
          </div>
          <Textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder={t("investigations.autopilot.memory.placeholders.content")}
            className="rounded-[4px] border-2 border-border text-sm"
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              {t("investigations.autopilot.memory.cancel")}
            </Button>
            <Button onClick={() => void save()} disabled={saving || !key.trim() || !content.trim()}>
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {t("investigations.autopilot.memory.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
