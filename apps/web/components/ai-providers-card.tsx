"use client";

import * as React from "react";
import Link from "next/link";
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
  Switch,
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
import { useAiProviderConfigs } from "@/hooks/use-ai-provider-configs";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { useNsPath } from "@/lib/ns-path";

export function AiProvidersCard() {
  const { t } = useTranslation();
  const nsPath = useNsPath();
  const { settings, saving, updateSettings } = useInstanceSettings();
  const { providers, loading, error, refresh } = useAiProviderConfigs();

  // Map of providerId -> detector names that reference it (usage highlight).
  const [detectorUsage, setDetectorUsage] = React.useState<
    Record<string, string[]>
  >({});

  const [deleteTarget, setDeleteTarget] =
    React.useState<AiProviderConfigResponseDto | null>(null);
  const [deleting, setDeleting] = React.useState(false);
  const [roleSaving, setRoleSaving] = React.useState<string | null>(null);

  const assistantId = settings.aiProviderConfigId ?? null;
  const harnessId = settings.harnessAiProviderConfigId ?? null;

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

  const updateFeature = React.useCallback(
    async (
      payload: Parameters<typeof updateSettings>[0],
      key: string,
      message: string,
    ) => {
      try {
        setRoleSaving(key);
        await updateSettings(payload);
        toast.success(message);
      } catch (updateError) {
        toast.error(
          updateError instanceof Error
            ? updateError.message
            : t("settings.failedToSave"),
        );
      } finally {
        setRoleSaving(null);
      }
    },
    [t, updateSettings],
  );

  const updateAssignment = React.useCallback(
    async (
      role: "assistant" | "harness",
      providerId: string,
      checked: boolean,
    ) => {
      const payload =
        role === "assistant"
          ? { aiProviderConfigId: checked ? providerId : null }
          : { harnessAiProviderConfigId: checked ? providerId : null };
      await updateFeature(
        payload,
        `${role}:${providerId}`,
        t("aiProvider.assignmentSaved"),
      );
    },
    [t, updateFeature],
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
          <Button size="sm" asChild>
            <Link href={nsPath("/harness/providers/new")}>
              <Plus className="mr-2 h-3.5 w-3.5" />
              {t("aiProvider.addProvider")}
            </Link>
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
                const isHarness = p.id === harnessId;
                const detectors = detectorUsage[p.id] ?? [];
                const inUse = detectors.length > 0;
                const lockDelete = isAssistant || isHarness || inUse;
                const deleteHint =
                  isAssistant || isHarness
                    ? t("aiProvider.deleteRoleHint")
                    : inUse
                      ? t("aiProvider.deleteInUseHint")
                      : t("aiProvider.delete");

                return (
                  <li
                    key={p.id}
                    className={`flex items-center justify-between gap-3 rounded-[4px] border-2 bg-muted/20 px-4 py-3 transition-colors ${
                      isAssistant || isHarness
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
                        {isHarness ? (
                          <Badge className="gap-1 border-sky-600/40 bg-sky-600/10 text-sky-700 dark:text-sky-300">
                            <BrainCircuit className="h-3 w-3" />
                            {t("aiProvider.harnessBadge")}
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
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        {t("aiProvider.assistantRole")}
                        <Switch
                          checked={isAssistant}
                          disabled={saving || roleSaving !== null}
                          onCheckedChange={(checked) =>
                            void updateAssignment("assistant", p.id, checked)
                          }
                          aria-label={`${t("aiProvider.useForAssistant")} — ${p.name}`}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        {t("aiProvider.harnessRole")}
                        <Switch
                          checked={isHarness}
                          disabled={saving || roleSaving !== null}
                          onCheckedChange={(checked) =>
                            void updateAssignment("harness", p.id, checked)
                          }
                          aria-label={`${t("aiProvider.useForHarness")} — ${p.name}`}
                        />
                      </label>
                      <Button variant="ghost" size="icon" asChild>
                        <Link
                          href={nsPath(`/harness/providers/${p.id}/edit`)}
                          title={t("aiProvider.edit")}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Link>
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
