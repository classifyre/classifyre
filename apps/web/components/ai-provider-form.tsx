"use client";

import * as React from "react";
import {
  api,
  AiProviderConfigResponseDtoProviderEnum,
  type AiProviderConfigResponseDto,
  type CreateAiProviderConfigDto,
  type UpdateAiProviderConfigDto,
} from "@workspace/api-client";
import {
  Button,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@workspace/ui/components";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  Save,
  Server,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";

export const DEFAULT_MODELS: Record<
  AiProviderConfigResponseDtoProviderEnum,
  string
> = {
  OPENAI_COMPATIBLE: "gpt-4o",
  CLAUDE: "claude-sonnet-4-5",
  GEMINI: "gemini-2.0-flash",
};

type Draft = {
  name: string;
  provider: AiProviderConfigResponseDtoProviderEnum;
  model: string;
  apiKey: string;
  baseUrl: string;
  contextSize: string;
  supportsVision: boolean;
};

function buildDraft(config: AiProviderConfigResponseDto | null): Draft {
  if (!config) {
    return {
      name: "",
      provider: AiProviderConfigResponseDtoProviderEnum.Claude,
      model: DEFAULT_MODELS[AiProviderConfigResponseDtoProviderEnum.Claude],
      apiKey: "",
      baseUrl: "",
      contextSize: "",
      supportsVision: false,
    };
  }
  return {
    name: config.name,
    provider: config.provider,
    model: config.model,
    apiKey: "",
    baseUrl: config.baseUrl ?? "",
    contextSize: config.contextSize != null ? String(config.contextSize) : "",
    supportsVision: config.supportsVision ?? false,
  };
}

function parseContextSize(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function buildCreatePayload(draft: Draft): CreateAiProviderConfigDto {
  const isOpenAi =
    draft.provider === AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible;
  return {
    name: draft.name.trim(),
    provider: draft.provider,
    model: draft.model.trim() || undefined,
    ...(draft.apiKey.length > 0 ? { apiKey: draft.apiKey } : {}),
    ...(isOpenAi && draft.baseUrl.trim()
      ? { baseUrl: draft.baseUrl.trim() }
      : {}),
    ...(parseContextSize(draft.contextSize) !== undefined
      ? { contextSize: parseContextSize(draft.contextSize) }
      : {}),
    supportsVision: draft.supportsVision,
  };
}

function buildUpdatePayload(draft: Draft): UpdateAiProviderConfigDto {
  const isOpenAi =
    draft.provider === AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible;
  return {
    name: draft.name.trim(),
    provider: draft.provider,
    model: draft.model.trim() || undefined,
    ...(draft.apiKey.length > 0 ? { apiKey: draft.apiKey } : {}),
    ...(isOpenAi ? { baseUrl: draft.baseUrl.trim() || undefined } : { baseUrl: "" }),
    ...(parseContextSize(draft.contextSize) !== undefined
      ? { contextSize: parseContextSize(draft.contextSize) }
      : {}),
    supportsVision: draft.supportsVision,
  };
}

type AiProviderFormProps = {
  config: AiProviderConfigResponseDto | null;
  /**
   * Called after the credential is persisted. `close` is true for an explicit
   * save (the dialog should close) and false when persistence happened as part
   * of a test connection (keep the form open to show the result).
   */
  onSaved: (saved: AiProviderConfigResponseDto, close: boolean) => void;
  onCancel: () => void;
};

export function AiProviderForm({ config, onSaved, onCancel }: AiProviderFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState<Draft>(() => buildDraft(config));
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [editingKey, setEditingKey] = React.useState(!config?.hasApiKey);
  const [error, setError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<
    { model: string; provider: string } | { error: string } | null
  >(null);
  // Tracks the id once the credential has been persisted, so that a test
  // connection (which persists first) followed by a save updates the same
  // record instead of creating a duplicate.
  const [persistedId, setPersistedId] = React.useState<string | null>(
    config?.id ?? null,
  );

  React.useEffect(() => {
    setDraft(buildDraft(config));
    setEditingKey(!config?.hasApiKey);
    setTestResult(null);
    setPersistedId(config?.id ?? null);
  }, [config]);

  const isOpenAiCompatible =
    draft.provider === AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible;
  const hasStoredKey = config?.hasApiKey ?? false;

  const handleProviderChange = React.useCallback(
    (value: AiProviderConfigResponseDtoProviderEnum) => {
      setDraft((prev) => ({
        ...prev,
        provider: value,
        model: prev.model.trim() ? prev.model : DEFAULT_MODELS[value],
        baseUrl:
          value !== AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible
            ? ""
            : prev.baseUrl,
      }));
    },
    [],
  );

  const persist =
    React.useCallback(async (): Promise<AiProviderConfigResponseDto> => {
      if (persistedId) {
        return api.aiProviderConfigs.aiProviderConfigControllerUpdate({
          id: persistedId,
          updateAiProviderConfigDto: buildUpdatePayload(draft),
        });
      }
      const created =
        await api.aiProviderConfigs.aiProviderConfigControllerCreate({
          createAiProviderConfigDto: buildCreatePayload(draft),
        });
      setPersistedId(created.id);
      return created;
    }, [persistedId, draft]);

  const handleSave = React.useCallback(async () => {
    if (!draft.name.trim()) {
      setError(t("aiProvider.nameRequired"));
      return;
    }
    try {
      setSaving(true);
      setError(null);
      const saved = await persist();
      onSaved(saved, true);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("settings.failedToSave"),
      );
    } finally {
      setSaving(false);
    }
  }, [draft.name, persist, onSaved, t]);

  const handleTest = React.useCallback(async () => {
    if (!draft.name.trim()) {
      setError(t("aiProvider.nameRequired"));
      return;
    }
    try {
      setTesting(true);
      setError(null);
      setTestResult(null);
      const saved = await persist();
      onSaved(saved, false);
      const result = await api.aiProviderConfigs.aiProviderConfigControllerTest({
        id: saved.id,
      });
      setTestResult({ model: result.model, provider: result.provider });
    } catch (testError) {
      setTestResult({
        error: testError instanceof Error ? testError.message : "Test failed",
      });
    } finally {
      setTesting(false);
    }
  }, [draft.name, persist, onSaved, t]);

  const canTest = hasStoredKey || draft.apiKey.length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label className="text-xs font-mono uppercase tracking-[0.12em]">
          {t("aiProvider.name")}
        </Label>
        <Input
          className="h-10 rounded-[4px] border-2 border-border text-sm"
          placeholder={t("aiProvider.namePlaceholder")}
          value={draft.name}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, name: e.target.value }))
          }
          autoFocus={!config}
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-mono uppercase tracking-[0.12em]">
          <Server className="mr-1.5 inline h-3.5 w-3.5" />
          {t("aiProvider.provider")}
        </Label>
        <Select
          value={draft.provider}
          onValueChange={(v) =>
            handleProviderChange(v as AiProviderConfigResponseDtoProviderEnum)
          }
        >
          <SelectTrigger className="h-10 rounded-[4px] border-2 border-border">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(
              Object.values(
                AiProviderConfigResponseDtoProviderEnum,
              ) as AiProviderConfigResponseDtoProviderEnum[]
            ).map((p) => (
              <SelectItem key={p} value={p}>
                {t(`aiProvider.providers.${p}` as TranslationKey)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-mono uppercase tracking-[0.12em]">
          {t("aiProvider.model")}
        </Label>
        <Input
          className="h-10 rounded-[4px] border-2 border-border font-mono text-sm"
          placeholder={DEFAULT_MODELS[draft.provider]}
          value={draft.model}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, model: e.target.value }))
          }
        />
      </div>

      {isOpenAiCompatible ? (
        <div className="space-y-2">
          <Label className="text-xs font-mono uppercase tracking-[0.12em]">
            {t("aiProvider.baseUrl")}
          </Label>
          <Input
            className="h-10 rounded-[4px] border-2 border-border font-mono text-sm"
            placeholder="https://openrouter.ai/api/v1"
            value={draft.baseUrl}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, baseUrl: e.target.value }))
            }
          />
          <p className="text-xs text-muted-foreground">
            {t("aiProvider.baseUrlDesc")}
          </p>
        </div>
      ) : null}

      <div className="space-y-2">
        <Label className="text-xs font-mono uppercase tracking-[0.12em]">
          {t("aiProvider.contextSize")}
        </Label>
        <Input
          className="h-10 rounded-[4px] border-2 border-border font-mono text-sm"
          type="number"
          min={1}
          placeholder={t("aiProvider.contextSizePlaceholder")}
          value={draft.contextSize}
          onChange={(e) =>
            setDraft((prev) => ({ ...prev, contextSize: e.target.value }))
          }
        />
      </div>

      <div className="flex items-start justify-between gap-4 rounded-[4px] border-2 border-border px-3 py-3">
        <div className="space-y-1">
          <Label
            htmlFor="ai-provider-supports-vision"
            className="text-xs font-mono uppercase tracking-[0.12em]"
          >
            {t("aiProvider.supportsVision")}
          </Label>
          <p className="text-xs text-muted-foreground">
            {t("aiProvider.supportsVisionDesc")}
          </p>
        </div>
        <Switch
          id="ai-provider-supports-vision"
          checked={draft.supportsVision}
          onCheckedChange={(checked) =>
            setDraft((prev) => ({ ...prev, supportsVision: checked }))
          }
        />
      </div>

      <div className="space-y-2">
        <Label className="text-xs font-mono uppercase tracking-[0.12em]">
          <KeyRound className="mr-1.5 inline h-3.5 w-3.5" />
          {t("aiProvider.apiKey")}
        </Label>
        {hasStoredKey && !editingKey ? (
          <Input
            className="h-10 cursor-pointer rounded-[4px] border-2 border-border font-mono text-sm text-muted-foreground"
            type="text"
            readOnly
            value="••••••••••••••••••••••••"
            onFocus={() => setEditingKey(true)}
            onClick={() => setEditingKey(true)}
          />
        ) : (
          <Input
            className="h-10 rounded-[4px] border-2 border-border font-mono text-sm"
            type="password"
            placeholder={
              hasStoredKey
                ? t("aiProvider.enterNewKey")
                : t("aiProvider.enterApiKey")
            }
            value={draft.apiKey}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, apiKey: e.target.value }))
            }
            autoComplete="off"
            autoFocus={editingKey && hasStoredKey}
          />
        )}
        <p className="text-xs text-muted-foreground">
          {hasStoredKey
            ? t("aiProvider.keyStored")
            : t("aiProvider.keyNotStored")}
        </p>
      </div>

      {error ? (
        <div className="rounded-[4px] border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      {testResult ? (
        <div className="flex items-start gap-2 rounded-[4px] border border-border bg-muted/30 px-3 py-2.5">
          {"error" in testResult ? (
            <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" />
          ) : (
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
          )}
          <span className="font-mono text-xs text-foreground/80">
            {"error" in testResult
              ? testResult.error
              : t("aiProvider.connectionOk") +
                " · " +
                testResult.provider +
                " · " +
                testResult.model}
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3 pt-1">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleTest()}
          disabled={saving || testing || !canTest}
          title={
            !canTest
              ? t("aiProvider.needApiKey")
              : t("aiProvider.testDescription")
          }
        >
          {testing ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="mr-2 h-3.5 w-3.5" />
          )}
          {t("aiProvider.testConnection")}
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            {t("aiProvider.cancel")}
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving} size="sm">
            {saving ? (
              <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="mr-2 h-3.5 w-3.5" />
            )}
            {config ? t("aiProvider.save") : t("aiProvider.create")}
          </Button>
        </div>
      </div>
    </div>
  );
}
