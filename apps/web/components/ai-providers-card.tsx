"use client";

import * as React from "react";
import { api, type AiProviderConfigResponseDto } from "@workspace/api-client";
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
} from "@workspace/ui/components";
import {
  BrainCircuit,
  Loader2,
  Pencil,
  Plus,
  ScanSearch,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { AiProviderForm } from "@/components/ai-provider-form";
import { useAiProviderConfigs } from "@/hooks/use-ai-provider-configs";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

export function AiProvidersCard() {
  const { t } = useTranslation();
  const { settings } = useInstanceSettings();
  const { providers, loading, error, refresh } = useAiProviderConfigs();

  // Map of providerId -> detector names that reference it (usage highlight).
  const [detectorUsage, setDetectorUsage] = React.useState<
    Record<string, string[]>
  >({});

  const [formOpen, setFormOpen] = React.useState(false);
  const [editing, setEditing] =
    React.useState<AiProviderConfigResponseDto | null>(null);
  const [deleteTarget, setDeleteTarget] =
    React.useState<AiProviderConfigResponseDto | null>(null);
  const [deleting, setDeleting] = React.useState(false);

  const assistantId = settings.aiProviderConfigId ?? null;

  const loadDetectorUsage = React.useCallback(async () => {
    try {
      const detectors = await api.listCustomDetectors({
        includeInactive: true,
      });
      const usage: Record<string, string[]> = {};
      for (const detector of detectors) {
        const pid = detector.aiProviderConfigId;
        if (!pid) continue;
        (usage[pid] ??= []).push(detector.name);
      }
      setDetectorUsage(usage);
    } catch {
      // Usage badges are an enhancement; ignore failures silently.
      setDetectorUsage({});
    }
  }, []);

  React.useEffect(() => {
    void loadDetectorUsage();
  }, [loadDetectorUsage]);

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
        toast.success(
          isNew ? t("aiProvider.created") : t("aiProvider.updated"),
        );
      }
      await refresh();
      if (close) {
        setFormOpen(false);
        setEditing(null);
      }
    },
    [providers, refresh, t],
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
      await refresh();
    } catch (deleteError) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : t("aiProvider.failedToDelete"),
      );
    } finally {
      setDeleting(false);
    }
  }, [deleteTarget, refresh, t]);

  function detectorLabel(count: number): string {
    return count === 1
      ? t("aiProvider.detectorBadgeOne")
      : t("aiProvider.detectorsBadge", { count });
  }

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
            <CardTitle>{t("aiProvider.manageTitle")}</CardTitle>
            <CardDescription>{t("aiProvider.manageDesc")}</CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-2 h-3.5 w-3.5" />
            {t("aiProvider.addProvider")}
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
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
          providers.length === 0 ? (
            <p className="rounded-[4px] border border-dashed border-border bg-muted/20 px-4 py-6 text-center text-sm text-muted-foreground">
              {t("aiProvider.noProviders")}
            </p>
          ) : (
            <ul className="grid gap-3">
              {providers.map((p) => {
                const isAssistant = p.id === assistantId;
                const detectors = detectorUsage[p.id] ?? [];
                const inUse = detectors.length > 0;
                const lockDelete = isAssistant || inUse;
                const deleteHint = isAssistant
                  ? t("aiProvider.deleteAssistantHint")
                  : inUse
                    ? t("aiProvider.deleteInUseHint")
                    : t("aiProvider.delete");

                return (
                  <li
                    key={p.id}
                    className={`flex items-center justify-between gap-3 rounded-[4px] border-2 bg-muted/20 px-4 py-3 transition-colors ${
                      isAssistant
                        ? "border-[#d97706]/50 bg-[#d97706]/[0.06]"
                        : "border-border"
                    }`}
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold">
                          {p.name}
                        </span>
                        {isAssistant ? (
                          <Badge className="gap-1 border-[#d97706]/40 bg-[#d97706]/10 text-[#b45309] dark:text-[#fbbf24]">
                            <Sparkles className="h-3 w-3" />
                            {t("aiProvider.assistantBadge")}
                          </Badge>
                        ) : null}
                        {inUse ? (
                          <Badge
                            variant="outline"
                            className="gap-1"
                            title={detectors.join(", ")}
                          >
                            <ScanSearch className="h-3 w-3" />
                            {detectorLabel(detectors.length)}
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
                        disabled={lockDelete}
                        title={deleteHint}
                      >
                        <Trash2
                          className={`h-3.5 w-3.5 ${lockDelete ? "" : "text-destructive"}`}
                        />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )
        ) : null}
      </CardContent>

      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[6px] border-2 border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editing
                ? t("aiProvider.editProvider")
                : t("aiProvider.newProvider")}
            </DialogTitle>
            <DialogDescription>{t("aiProvider.manageDesc")}</DialogDescription>
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
        <AlertDialogContent className="rounded-[6px] border-2 border-border">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("aiProvider.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("aiProvider.deleteConfirm", {
                name: deleteTarget?.name ?? "",
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {t("aiProvider.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
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
