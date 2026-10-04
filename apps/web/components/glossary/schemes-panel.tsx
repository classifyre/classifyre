"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Label,
  Textarea,
} from "@workspace/ui/components";
import { cn } from "@workspace/ui/lib/utils";
import { useTranslation } from "@/hooks/use-translation";
import {
  deleteScheme,
  listSchemes,
  saveScheme,
  schemeTree,
  semanticErrorMessage,
  type Scheme,
  type SchemeTreeNode,
} from "@/lib/semantic-api";
import { MICRO_LABEL, TermLink, TermStatusBadge } from "./glossary-ui";

/** One level of a scheme's BROADER tree, loading children on expand. */
function TreeLevel({
  schemeKey,
  parentId,
  depth,
}: {
  schemeKey: string;
  parentId?: string;
  depth: number;
}) {
  const { t } = useTranslation();
  const [nodes, setNodes] = React.useState<SchemeTreeNode[] | null>(null);
  const [open, setOpen] = React.useState<Set<string>>(new Set());

  React.useEffect(() => {
    let active = true;
    schemeTree(schemeKey, parentId)
      .then((result) => {
        if (active) setNodes(result.nodes);
      })
      .catch(() => {
        if (active) setNodes([]);
      });
    return () => {
      active = false;
    };
  }, [schemeKey, parentId]);

  if (nodes === null) {
    return (
      <div className="flex items-center gap-2 py-1 pl-6 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }
  if (nodes.length === 0 && depth === 0) {
    return (
      <p className="py-2 pl-2 text-xs text-muted-foreground">
        {t("glossary.schemes.emptyTree")}
      </p>
    );
  }
  return (
    <ul role={depth === 0 ? "tree" : "group"}>
      {nodes.map((node) => {
        const expanded = open.has(node.id);
        return (
          <li key={node.id} role="treeitem" aria-expanded={node.childCount ? expanded : undefined}>
            <div
              className="flex items-center gap-1.5 py-1"
              style={{ paddingLeft: depth * 18 }}
            >
              {node.childCount > 0 ? (
                <button
                  type="button"
                  aria-label={expanded ? t("glossary.schemes.collapse") : t("glossary.schemes.expand")}
                  onClick={() =>
                    setOpen((previous) => {
                      const next = new Set(previous);
                      if (next.has(node.id)) next.delete(node.id);
                      else next.add(node.id);
                      return next;
                    })
                  }
                  className="rounded-[2px] p-0.5 hover:bg-muted"
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                </button>
              ) : (
                <span className="inline-block w-[18px]" />
              )}
              <TermLink termKey={node.key} className="text-sm font-medium">
                {node.term}
              </TermLink>
              {node.codes.length > 0 && (
                <span className="font-mono text-[11px] text-muted-foreground">
                  {node.codes.join(", ")}
                </span>
              )}
              {node.status !== "APPROVED" && <TermStatusBadge status={node.status} />}
              {node.childCount > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  ({node.childCount})
                </span>
              )}
            </div>
            {expanded && (
              <TreeLevel schemeKey={schemeKey} parentId={node.id} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SchemeDialog({
  scheme,
  open,
  onOpenChange,
  onSaved,
}: {
  scheme: Scheme | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [color, setColor] = React.useState("#6b7280");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(scheme?.name ?? "");
    setDescription(scheme?.description ?? "");
    setColor(scheme?.color ?? "#6b7280");
    setError(null);
  }, [open, scheme]);

  async function save() {
    if (!name.trim()) {
      setError(t("glossary.schemes.nameRequired"));
      return;
    }
    setSaving(true);
    try {
      await saveScheme({
        id: scheme?.id,
        name: name.trim(),
        description: description.trim() || null,
        color,
      });
      onSaved();
      onOpenChange(false);
    } catch (saveError) {
      setError(semanticErrorMessage(saveError, t("glossary.saveFailed")));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {scheme ? t("glossary.schemes.edit") : t("glossary.schemes.add")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <Label htmlFor="scheme-name">{t("glossary.schemes.name")}</Label>
            <Input
              id="scheme-name"
              value={name}
              autoFocus
              onChange={(event) => setName(event.target.value)}
              placeholder={t("glossary.schemes.namePlaceholder")}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scheme-description">
              {t("glossary.schemes.description")}
            </Label>
            <Textarea
              id="scheme-description"
              value={description}
              rows={2}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="scheme-color">{t("glossary.schemes.color")}</Label>
            <Input
              id="scheme-color"
              type="color"
              value={color}
              onChange={(event) => setColor(event.target.value)}
              className="h-9 w-20 p-1"
            />
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t("glossary.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Schemes (SL1 R3): controlled vocabularies such as *Rechtsformen*, each with
 * its BROADER tree. A scheme is removed only once it is empty.
 */
export function SchemesPanel({
  refreshKey,
  onChanged,
}: {
  refreshKey: number;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const [schemes, setSchemes] = React.useState<Scheme[] | null>(null);
  const [selected, setSelected] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<Scheme | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);

  React.useEffect(() => {
    listSchemes()
      .then((rows) => {
        setSchemes(rows);
        setSelected((current) => current ?? rows[0]?.key ?? null);
      })
      .catch(() => setSchemes([]));
  }, [refreshKey]);

  const current = schemes?.find((scheme) => scheme.key === selected) ?? null;

  async function remove(scheme: Scheme) {
    try {
      await deleteScheme(scheme.id);
      toast.success(t("glossary.schemes.deleted"));
      setSelected(null);
      onChanged();
    } catch (error) {
      toast.error(semanticErrorMessage(error, t("glossary.schemes.deleteFailed")));
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className={MICRO_LABEL}>{t("glossary.tabs.schemes")}</span>
          <Button
            size="sm"
            variant="outline"
            className="h-7 rounded-[4px] border-2 border-border text-xs"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
            {t("glossary.schemes.add")}
          </Button>
        </div>
        {schemes === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : schemes.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("glossary.schemes.none")}</p>
        ) : (
          <ul className="space-y-1">
            {schemes.map((scheme) => (
              <li key={scheme.id}>
                <button
                  type="button"
                  onClick={() => setSelected(scheme.key)}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 rounded-[4px] border-2 px-3 py-2 text-left",
                    scheme.key === selected
                      ? "border-accent bg-accent/10"
                      : "border-transparent hover:bg-muted",
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="size-2.5 shrink-0 rounded-full border border-border"
                      style={{ backgroundColor: scheme.color ?? "transparent" }}
                    />
                    <span className="truncate text-sm">{scheme.name}</span>
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {scheme.termCount}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-h-[300px] rounded-[4px] border-2 border-border p-4">
        {current ? (
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{current.name}</h3>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {current.key}
                  {current.packKey ? ` · ${t("glossary.schemes.fromPack", { pack: current.packKey })}` : ""}
                </p>
                {current.description && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {current.description}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t("glossary.schemes.edit")}
                  className="h-8 rounded-[4px] border-2 border-border"
                  onClick={() => {
                    setEditing(current);
                    setDialogOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  aria-label={t("glossary.schemes.delete")}
                  disabled={current.termCount > 0}
                  title={
                    current.termCount > 0
                      ? t("glossary.schemes.notEmpty")
                      : undefined
                  }
                  className="h-8 rounded-[4px] border-2 border-destructive text-destructive"
                  onClick={() => remove(current)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <TreeLevel key={current.key} schemeKey={current.key} depth={0} />
          </div>
        ) : (
          <EmptyState
            icon={FolderTree}
            title={t("glossary.schemes.pick")}
            description={t("glossary.schemes.pickHint")}
          />
        )}
      </div>

      <SchemeDialog
        scheme={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSaved={onChanged}
      />
    </div>
  );
}
