"use client";

import * as React from "react";
import type { AiProviderConfigResponseDto } from "@workspace/api-client";
import {
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
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@workspace/ui/components";
import { BrainCircuit, Cpu, Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useInstanceSettings } from "@/components/instance-settings-provider";
import { AiProviderForm } from "@/components/ai-provider-form";
import { useAiProviderConfigs } from "@/hooks/use-ai-provider-configs";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

const NONE_VALUE = "__none__";

export function AiAssistantSettingsCard() {
  const { t } = useTranslation();
  const { settings, saving, updateSettings } = useInstanceSettings();
  const { providers, loading, refresh } = useAiProviderConfigs();

  const [toggling, setToggling] = React.useState(false);
  const [savingModel, setSavingModel] = React.useState(false);
  const [createOpen, setCreateOpen] = React.useState(false);

  const aiEnabled = settings.aiEnabled;
  const selectedId = settings.aiProviderConfigId ?? null;
  const selected = React.useMemo(
    () => providers.find((p) => p.id === selectedId) ?? null,
    [providers, selectedId],
  );

  const handleToggle = React.useCallback(
    async (enabled: boolean) => {
      try {
        setToggling(true);
        await updateSettings({ aiEnabled: enabled });
        toast.success(
          enabled
            ? t("settings.assistant.enabledToast")
            : t("settings.assistant.disabledToast"),
        );
      } catch (toggleError) {
        toast.error(
          toggleError instanceof Error
            ? toggleError.message
            : t("settings.failedToSave"),
        );
      } finally {
        setToggling(false);
      }
    },
    [updateSettings, t],
  );

  const handleModelChange = React.useCallback(
    async (value: string) => {
      const next = value === NONE_VALUE ? null : value;
      try {
        setSavingModel(true);
        await updateSettings({ aiProviderConfigId: next });
      } catch (updateError) {
        toast.error(
          updateError instanceof Error
            ? updateError.message
            : t("settings.failedToSave"),
        );
      } finally {
        setSavingModel(false);
      }
    },
    [updateSettings, t],
  );

  const handleCreated = React.useCallback(
    async (saved: AiProviderConfigResponseDto, close: boolean) => {
      await refresh();
      if (close) {
        toast.success(t("aiProvider.created"));
        // Auto-select the freshly created provider as the assistant model.
        try {
          await updateSettings({ aiProviderConfigId: saved.id });
        } catch {
          // Non-fatal — the user can pick it from the dropdown.
        }
        setCreateOpen(false);
      }
    },
    [refresh, updateSettings, t],
  );

  const busy = toggling || saving || savingModel;

  return (
    <Card className="panel-card rounded-[6px]">
      <CardHeader className="gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4 text-[#d97706]" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t("settings.assistant.subtitle")}
            </p>
          </div>
          <CardTitle>{t("settings.assistant.title")}</CardTitle>
          <CardDescription>
            {t("settings.assistant.description")}
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Enable toggle */}
        <div className="flex items-center justify-between gap-4 rounded-[4px] border-2 border-border bg-muted/20 px-4 py-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-sm font-medium">
                {t("settings.assistant.enable")}
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("settings.assistant.enableDesc")}
            </p>
          </div>
          <Switch
            checked={aiEnabled}
            disabled={busy}
            onCheckedChange={(checked) => void handleToggle(checked)}
            aria-label={t("settings.assistant.enable")}
          />
        </div>

        {/* Model selector */}
        <div
          className="space-y-2 transition-opacity"
          data-disabled={!aiEnabled}
          style={{ opacity: aiEnabled ? 1 : 0.55 }}
        >
          <div className="flex items-center gap-2">
            <Cpu className="h-3.5 w-3.5" />
            <Label className="text-xs font-mono uppercase tracking-[0.12em]">
              {t("settings.assistant.model")}
            </Label>
          </div>

          {loading ? (
            <div className="flex h-10 items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("settings.assistant.loading")}
            </div>
          ) : providers.length === 0 ? (
            <div className="flex flex-col gap-3 rounded-[4px] border border-dashed border-border bg-muted/20 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                {t("settings.assistant.noProviders")}
              </p>
              <Button
                size="sm"
                onClick={() => setCreateOpen(true)}
                disabled={!aiEnabled}
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                {t("settings.assistant.createNew")}
              </Button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Select
                  value={selectedId ?? NONE_VALUE}
                  onValueChange={(v) => void handleModelChange(v)}
                  disabled={!aiEnabled || busy}
                >
                  <SelectTrigger className="h-10 flex-1 rounded-[4px] border-2 border-border">
                    <SelectValue
                      placeholder={t("settings.assistant.selectModel")}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>
                      {t("settings.assistant.usingNone")}
                    </SelectItem>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-10 shrink-0"
                  onClick={() => setCreateOpen(true)}
                  disabled={!aiEnabled}
                  title={t("settings.assistant.createNew")}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
              </div>
              <p className="font-mono text-xs text-muted-foreground">
                {selected
                  ? `${t(
                      `aiProvider.providers.${selected.provider}` as TranslationKey,
                    )}${selected.model ? ` · ${selected.model}` : ""}`
                  : t("settings.assistant.modelDesc")}
              </p>
            </>
          )}
        </div>
      </CardContent>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto rounded-[6px] border-2 border-border sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("aiProvider.newProvider")}</DialogTitle>
            <DialogDescription>{t("aiProvider.manageDesc")}</DialogDescription>
          </DialogHeader>
          <AiProviderForm
            config={null}
            onSaved={(saved, close) => void handleCreated(saved, close)}
            onCancel={() => setCreateOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </Card>
  );
}
