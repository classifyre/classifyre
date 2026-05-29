"use client";

import * as React from "react";
import {
  api,
  type AiProviderConfigResponseDto,
} from "@workspace/api-client";
import {
  Alert,
  AlertDescription,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import { BrainCircuit, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { AiProviderForm } from "@/components/ai-provider-form";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

const NONE_VALUE = "__none__";

export function AiProvidersCard() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useInstanceSettings();

  const [providers, setProviders] = React.useState<
    AiProviderConfigResponseDto[]
  >([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<AiProviderConfigResponseDto | null>(
    null,
  );
  const [deleteTarget, setDeleteTarget] =
    React.useState<AiProviderConfigResponseDto | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const defaultId = settings.aiProviderConfigId ?? null;

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result =
        await api.aiProviderConfigs.aiProviderConfigControllerList();
      setProviders(result);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : t("aiProvider.failedToLoad"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const openCreate = React.useCallback(() => {
    setEditing(null);
    setFormOpen(true);
  }, []);

  const openEdit = React.useCallback((config: AiProviderConfigResponseDto) => {
    setEditing(config);
    setFormOpen(true);
  }, []);

  const handleSaved = React.useCallback(
    async (saved: AiProviderConfigResponseDto, close: boolean) => {
      const isNew = !providers.some((p) => p.id === saved.id);
      if (close) {
        toast.success(isNew ? t("aiProvider.created") : t("aiProvider.updated"));
      }
      await load();
      // If this is the only provider and no default is set, make it the default.
      if (isNew && !defaultId) {
        try {
          await updateSettings({ aiProviderConfigId: saved.id });
        } catch {
          // Non-fatal: the user can pick a default manually.
        }
      }
      if (close) {
        setFormOpen(false);
        setEditing(null);
      }
      // When close is false the persistence happened as part of a test
      // connection: keep the dialog open so the result stays visible. The form
      // tracks the saved id internally so a later save updates the same record.
    },
    [providers, defaultId, load, updateSettings, t],
  );

  const handleDefaultChange = React.useCallback(
    async (value: string) => {
      const next = value === NONE_VALUE ? null : value;
      try {
        await updateSettings({ aiProviderConfigId: next });
      } catch (updateError) {
        toast.error(
          updateError instanceof Error
            ? updateError.message
            : t("settings.failedToSave"),
        );
      }
    },
    [updateSettings, t],
  );

  const handleDelete = React.useCallback(async () => {
    if (!deleteTarget) return;
    try {
      setDeleting(true);
      await api.aiProviderConfigs.aiProviderConfigControllerRemove({
        id: deleteTarget.id,
      });
      toast.success(t("aiProvider.deleted"));
      setDeleteTarget(null);
      await load();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : t("aiProvider.failedToDelete"),
      );
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, load, t]);

  return (
    <Card className="panel-card rounded-[6px]">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <BrainCircuit className="h-4 w-4" />
              <p className="text-xs font-mono uppercase tracking-[0.14em]">
                {t("aiProvider.sectionTitle")}
              </p>
            </div>
            <CardTitle>{t("aiProvider.sectionTitle")}</CardTitle>
            <CardDescription>{t("aiProvider.sectionDesc")}</CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            {t("aiProvider.addProvider")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("aiProvider.loading")}
          </div>
        ) : null}

        {!loading && error ? (
          <Alert variant="destructive" className="border-destructive/40">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!loading && !error ? (
          <>
            {providers.length === 0 ? (
              <p className="rounded-[4px] border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
                {t("aiProvider.noProviders")}
              </p>
            ) : (
              <>
                <div className="space-y-2">
                  <p className="text-xs font-mono uppercase tracking-[0.12em] text-muted-foreground">
                    {t("aiProvider.defaultLabel")}
                  </p>
                  <Select
                    value={defaultId ?? NONE_VALUE}
                    onValueChange={(v) => void handleDefaultChange(v)}
                  >
                    <SelectTrigger className="h-10 rounded-[4px] border-2 border-border">
                      <SelectValue placeholder={t("aiProvider.noDefault")} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE_VALUE}>
                        {t("aiProvider.noDefault")}
                      </SelectItem>
                      {providers.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    {t("aiProvider.defaultDesc")}
                  </p>
                </div>

                <ul className="divide-y divide-border rounded-[4px] border border-border">
                  {providers.map((p) => (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 px-4 py-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium">
                            {p.name}
                          </span>
                          {p.id === defaultId ? (
                            <Badge variant="secondary" className="text-[10px]">
                              {t("aiProvider.defaultBadge")}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {t(
                            `aiProvider.providers.${p.provider}` as TranslationKey,
                          )}
                          {p.model ? ` · ${p.model}` : ""}
                          {p.hasApiKey && p.apiKeyPreview
                            ? ` · ${p.apiKeyPreview}`
                            : ""}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => openEdit(p)}
                          title={t("aiProvider.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setDeleteTarget(p)}
                          title={t("aiProvider.delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        ) : null}
      </CardContent>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("aiProvider.editProvider")
                : t("aiProvider.newProvider")}
            </DialogTitle>
            <DialogDescription>{t("aiProvider.sectionDesc")}</DialogDescription>
          </DialogHeader>
          <AiProviderForm
            config={editing}
            onSaved={(saved, close) => void handleSaved(saved, close)}
            onCancel={() => setFormOpen(false)}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("aiProvider.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("aiProvider.deleteConfirm", { name: deleteTarget?.name ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("aiProvider.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
            >
              {deleting ? (
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
              ) : null}
              {t("aiProvider.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
