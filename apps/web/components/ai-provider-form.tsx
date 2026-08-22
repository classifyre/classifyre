"use client";

import * as React from "react";
import {
  api,
  AiProviderConfigResponseDtoProviderEnum,
  type AiCapabilityProgressEvent,
  type AiProviderConfigTestResultDto,
  type AssistantCapabilityReportDto,
  type CapabilityProbeResultDto,
  type AiProviderConfigResponseDto,
  type CreateAiProviderConfigDto,
  type UpdateAiProviderConfigDto,
} from "@workspace/api-client";
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Progress,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@workspace/ui/components";
import {
  CheckCircle2,
  Coins,
  KeyRound,
  Loader2,
  Save,
  Server,
  XCircle,
  Zap,
} from "lucide-react";
import { useTranslation } from "@/hooks/use-translation";
import type { TranslationKey } from "@/i18n";
import { AssistantCapabilityReport } from "@/components/assistant-capability-report";
import { extractApiErrorMessage } from "@/lib/extract-api-error-message";

export type ProviderAssignments = {
  assistant: boolean;
  harness: boolean;
};

const NO_ASSIGNMENTS: ProviderAssignments = {
  assistant: false,
  harness: false,
};

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
  supportsEmbedding: boolean;
  embeddingDimensions: string;
  embeddingPooling: string;
  inputCostPerMTok: string;
  outputCostPerMTok: string;
};

type CapabilityProgressState = {
  total: number;
  current: { title: string; tier: string } | null;
  probes: CapabilityProbeResultDto[];
  capacityRunning: boolean;
};

function updateCapabilityProgress(
  event: AiCapabilityProgressEvent,
  setProgress: React.Dispatch<React.SetStateAction<CapabilityProgressState>>,
) {
  switch (event.type) {
    case "started":
      setProgress({
        total: event.totalProbes,
        current: null,
        probes: [],
        capacityRunning: false,
      });
      break;
    case "probe_started":
      setProgress((current) => ({
        ...current,
        total: event.totalProbes,
        current: { title: event.probe.title, tier: event.probe.tier },
        capacityRunning: false,
      }));
      break;
    case "probe_completed":
      setProgress((current) => ({
        ...current,
        total: event.totalProbes,
        current: null,
        probes: [...current.probes, event.probe],
      }));
      break;
    case "capacity_started":
      setProgress((current) => ({
        ...current,
        current: null,
        capacityRunning: true,
      }));
      break;
    case "capacity_completed":
    case "complete":
    case "error":
      setProgress((current) => ({
        ...current,
        current: null,
        capacityRunning: false,
      }));
      break;
  }
}

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
      supportsEmbedding: false,
      embeddingDimensions: "",
      embeddingPooling: "mean",
      inputCostPerMTok: "",
      outputCostPerMTok: "",
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
    supportsEmbedding: config.supportsEmbedding ?? false,
    embeddingDimensions:
      config.embeddingDimensions != null
        ? String(config.embeddingDimensions)
        : "",
    embeddingPooling: config.embeddingPooling ?? "mean",
    inputCostPerMTok:
      config.inputCostPerMTok != null ? String(config.inputCostPerMTok) : "",
    outputCostPerMTok:
      config.outputCostPerMTok != null ? String(config.outputCostPerMTok) : "",
  };
}

function parseContextSize(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const n = Number.parseInt(trimmed, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Empty → null (clear the stored price); invalid/negative → undefined (skip). */
function parseCost(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number.parseFloat(trimmed);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function buildCreatePayload(draft: Draft): CreateAiProviderConfigDto {
  const isOpenAi =
    draft.provider === AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible;
  const inputCost = parseCost(draft.inputCostPerMTok);
  const outputCost = parseCost(draft.outputCostPerMTok);
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
    supportsEmbedding: draft.supportsEmbedding,
    // Only meaningful for an embedding provider; cleared otherwise so a
    // provider that stops serving embeddings does not keep a stale width.
    embeddingDimensions: draft.supportsEmbedding
      ? parseContextSize(draft.embeddingDimensions)
      : undefined,
    embeddingPooling: draft.supportsEmbedding
      ? draft.embeddingPooling || undefined
      : undefined,
    ...(typeof inputCost === "number" ? { inputCostPerMTok: inputCost } : {}),
    ...(typeof outputCost === "number"
      ? { outputCostPerMTok: outputCost }
      : {}),
  };
}

function buildUpdatePayload(draft: Draft): UpdateAiProviderConfigDto {
  const isOpenAi =
    draft.provider === AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible;
  const inputCost = parseCost(draft.inputCostPerMTok);
  const outputCost = parseCost(draft.outputCostPerMTok);
  return {
    name: draft.name.trim(),
    provider: draft.provider,
    model: draft.model.trim() || undefined,
    ...(draft.apiKey.length > 0 ? { apiKey: draft.apiKey } : {}),
    ...(isOpenAi
      ? { baseUrl: draft.baseUrl.trim() || undefined }
      : { baseUrl: "" }),
    ...(parseContextSize(draft.contextSize) !== undefined
      ? { contextSize: parseContextSize(draft.contextSize) }
      : {}),
    supportsVision: draft.supportsVision,
    ...(inputCost !== undefined ? { inputCostPerMTok: inputCost } : {}),
    ...(outputCost !== undefined ? { outputCostPerMTok: outputCost } : {}),
  };
}

type AiProviderFormProps = {
  config: AiProviderConfigResponseDto | null;
  initialAssignments?: ProviderAssignments;
  /**
   * Called after the credential is persisted. `close` is true for an explicit
   * save (the editor may navigate away) and false when persistence happened as
   * part of a test (keep the editor open to show the result).
   */
  onSaved: (
    saved: AiProviderConfigResponseDto,
    close: boolean,
    assignments: ProviderAssignments,
  ) => void | Promise<void>;
  onCancel: () => void;
};

export function AiProviderForm({
  config,
  initialAssignments = NO_ASSIGNMENTS,
  onSaved,
  onCancel,
}: AiProviderFormProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = React.useState<Draft>(() => buildDraft(config));
  const [saving, setSaving] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testType, setTestType] = React.useState<"connection" | "harness">(
    "connection",
  );
  const [assignments, setAssignments] =
    React.useState<ProviderAssignments>(initialAssignments);
  const [editingKey, setEditingKey] = React.useState(!config?.hasApiKey);
  const [error, setError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<
    AiProviderConfigTestResultDto | { error: string } | null
  >(null);
  const [capabilityReport, setCapabilityReport] =
    React.useState<AssistantCapabilityReportDto | null>(null);
  const [capabilityProgress, setCapabilityProgress] =
    React.useState<CapabilityProgressState>({
      total: 0,
      current: null,
      probes: [],
      capacityRunning: false,
    });
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
    setCapabilityReport(null);
    setCapabilityProgress({
      total: 0,
      current: null,
      probes: [],
      capacityRunning: false,
    });
    setTestType("connection");
    setAssignments(initialAssignments);
    setPersistedId(config?.id ?? null);
  }, [config, initialAssignments]);

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
      await onSaved(saved, true, assignments);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : t("settings.failedToSave"),
      );
    } finally {
      setSaving(false);
    }
  }, [assignments, draft.name, persist, onSaved, t]);

  const handleTest = React.useCallback(async () => {
    if (!draft.name.trim()) {
      setError(t("aiProvider.nameRequired"));
      return;
    }
    try {
      setTesting(true);
      setError(null);
      setTestResult(null);
      setCapabilityReport(null);
      setCapabilityProgress({
        total: 0,
        current: null,
        probes: [],
        capacityRunning: false,
      });
      const saved = await persist();
      await onSaved(saved, false, assignments);
      if (testType === "harness") {
        const report = await api.streamAiProviderCapabilityTest(
          saved.id,
          (event) => updateCapabilityProgress(event, setCapabilityProgress),
        );
        setCapabilityReport(report);
      } else {
        const result =
          await api.aiProviderConfigs.aiProviderConfigControllerTest({
            id: saved.id,
          });
        setTestResult(result);
      }
    } catch (testError) {
      setTestResult({
        error: await extractApiErrorMessage(
          testError,
          t("aiProvider.connectionFailed"),
        ),
      });
    } finally {
      setTesting(false);
    }
  }, [assignments, draft.name, persist, onSaved, t, testType]);

  const canTest = hasStoredKey || draft.apiKey.length > 0;

  const connectionFailed =
    testResult !== null &&
    ("error" in testResult || testResult.status === "FAIL");
  const completedProbeCount = capabilityProgress.probes.length;
  const progressPercent = capabilityProgress.total
    ? Math.round((completedProbeCount / capabilityProgress.total) * 100)
    : 0;

  return (
    <div className="space-y-6">
      {error ? (
        <div className="rounded-[4px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.75fr)]">
        <div className="space-y-6">
          <Card className="rounded-[6px] border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Server className="h-4 w-4" />
                {t("aiProvider.providerAndModel")}
              </CardTitle>
              <CardDescription>
                {t("aiProvider.providerAndModelDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>{t("aiProvider.name")}</Label>
                <Input
                  className="h-11 rounded-[4px] border-2"
                  placeholder={t("aiProvider.namePlaceholder")}
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  autoFocus={!config}
                />
              </div>
              <div className="space-y-2">
                <Label>{t("aiProvider.provider")}</Label>
                <Select
                  value={draft.provider}
                  onValueChange={(value) =>
                    handleProviderChange(
                      value as AiProviderConfigResponseDtoProviderEnum,
                    )
                  }
                >
                  <SelectTrigger className="h-11 rounded-[4px] border-2">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(
                      Object.values(
                        AiProviderConfigResponseDtoProviderEnum,
                      ) as AiProviderConfigResponseDtoProviderEnum[]
                    ).map((provider) => (
                      <SelectItem key={provider} value={provider}>
                        {t(
                          `aiProvider.providers.${provider}` as TranslationKey,
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t("aiProvider.model")}</Label>
                <Input
                  className="h-11 rounded-[4px] border-2 font-mono"
                  placeholder={DEFAULT_MODELS[draft.provider]}
                  value={draft.model}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                />
              </div>
              {isOpenAiCompatible ? (
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t("aiProvider.baseUrl")}</Label>
                  <Input
                    className="h-11 rounded-[4px] border-2 font-mono"
                    placeholder="https://openrouter.ai/api/v1"
                    value={draft.baseUrl}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        baseUrl: event.target.value,
                      }))
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    {t("aiProvider.baseUrlDesc")}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="rounded-[6px] border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Coins className="h-4 w-4" />
                {t("aiProvider.runtimeAndPricing")}
              </CardTitle>
              <CardDescription>
                {t("aiProvider.runtimeAndPricingDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5 sm:grid-cols-2">
              <div className="space-y-2 sm:col-span-2">
                <Label>{t("aiProvider.contextSize")}</Label>
                <Input
                  className="h-11 rounded-[4px] border-2 font-mono"
                  type="number"
                  min={1}
                  placeholder={t("aiProvider.contextSizePlaceholder")}
                  value={draft.contextSize}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      contextSize: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("aiProvider.inputCost")}</Label>
                <Input
                  className="h-11 rounded-[4px] border-2 font-mono"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={t("aiProvider.inputCostPlaceholder")}
                  value={draft.inputCostPerMTok}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      inputCostPerMTok: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label>{t("aiProvider.outputCost")}</Label>
                <Input
                  className="h-11 rounded-[4px] border-2 font-mono"
                  type="number"
                  min={0}
                  step="0.01"
                  placeholder={t("aiProvider.outputCostPlaceholder")}
                  value={draft.outputCostPerMTok}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      outputCostPerMTok: event.target.value,
                    }))
                  }
                />
              </div>
              <p className="text-xs text-muted-foreground sm:col-span-2">
                {t("aiProvider.tokenCostsDesc")}
              </p>
              <div className="flex items-start justify-between gap-4 rounded-[4px] border-2 border-border bg-muted/20 p-4 sm:col-span-2">
                <div className="space-y-1">
                  <Label htmlFor="ai-provider-supports-vision">
                    {t("aiProvider.supportsVision")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("aiProvider.supportsVisionDesc")}
                  </p>
                </div>
                <Switch
                  id="ai-provider-supports-vision"
                  checked={draft.supportsVision}
                  onCheckedChange={(supportsVision) =>
                    setDraft((current) => ({ ...current, supportsVision }))
                  }
                />
              </div>
              <div className="flex items-start justify-between gap-4 rounded-[4px] border-2 border-border bg-muted/20 p-4 sm:col-span-2">
                <div className="space-y-1">
                  <Label htmlFor="ai-provider-supports-embedding">
                    {t("aiProvider.supportsEmbedding")}
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {t("aiProvider.supportsEmbeddingDesc")}
                  </p>
                </div>
                <Switch
                  id="ai-provider-supports-embedding"
                  checked={draft.supportsEmbedding}
                  onCheckedChange={(supportsEmbedding) =>
                    setDraft((current) => ({ ...current, supportsEmbedding }))
                  }
                />
              </div>
              {draft.supportsEmbedding ? (
                // Captured here rather than in the embedding configuration:
                // these describe the model, so every workspace that selects
                // this provider inherits them instead of restating them.
                <div className="grid gap-4 rounded-[4px] border-2 border-border bg-muted/20 p-4 sm:col-span-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="ai-provider-embedding-dimensions">
                      {t("aiProvider.embeddingDimensions")}
                    </Label>
                    <Input
                      id="ai-provider-embedding-dimensions"
                      type="number"
                      placeholder="1536"
                      value={draft.embeddingDimensions}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          embeddingDimensions: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("aiProvider.embeddingDimensionsDesc")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ai-provider-embedding-pooling">
                      {t("aiProvider.embeddingPooling")}
                    </Label>
                    <Input
                      id="ai-provider-embedding-pooling"
                      placeholder="mean"
                      value={draft.embeddingPooling}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          embeddingPooling: event.target.value,
                        }))
                      }
                    />
                    <p className="text-xs text-muted-foreground">
                      {t("aiProvider.embeddingPoolingDesc")}
                    </p>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6 xl:sticky xl:top-20">
          <Card className="rounded-[6px] border-2">
            <CardHeader>
              <CardTitle className="text-lg">
                {t("aiProvider.featureAssignments")}
              </CardTitle>
              <CardDescription>
                {t("aiProvider.featureAssignmentsDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(["assistant", "harness"] as const).map((role) => (
                <div
                  key={role}
                  className="flex items-start justify-between gap-4 rounded-[4px] border-2 border-border bg-muted/20 p-4"
                >
                  <div className="space-y-1">
                    <Label htmlFor={`ai-provider-${role}-role`}>
                      {t(
                        role === "assistant"
                          ? "aiProvider.useForAssistant"
                          : "aiProvider.useForHarness",
                      )}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t(
                        role === "assistant"
                          ? "aiProvider.useForAssistantDesc"
                          : "aiProvider.useForHarnessDesc",
                      )}
                    </p>
                  </div>
                  <Switch
                    id={`ai-provider-${role}-role`}
                    checked={assignments[role]}
                    onCheckedChange={(checked) =>
                      setAssignments((current) => ({
                        ...current,
                        [role]: checked,
                      }))
                    }
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-[6px] border-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <KeyRound className="h-4 w-4" />
                {t("aiProvider.credential")}
              </CardTitle>
              <CardDescription>
                {t("aiProvider.credentialDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label>{t("aiProvider.apiKey")}</Label>
              {hasStoredKey && !editingKey ? (
                <Input
                  className="h-11 cursor-pointer rounded-[4px] border-2 font-mono text-muted-foreground"
                  type="text"
                  readOnly
                  value="••••••••••••••••••••••••"
                  onFocus={() => setEditingKey(true)}
                  onClick={() => setEditingKey(true)}
                />
              ) : (
                <Input
                  className="h-11 rounded-[4px] border-2 font-mono"
                  type="password"
                  placeholder={
                    hasStoredKey
                      ? t("aiProvider.enterNewKey")
                      : t("aiProvider.enterApiKey")
                  }
                  value={draft.apiKey}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  autoComplete="off"
                />
              )}
              <p className="text-xs text-muted-foreground">
                {hasStoredKey
                  ? t("aiProvider.keyStored")
                  : t("aiProvider.keyNotStored")}
              </p>
            </CardContent>
          </Card>

          <Card className="rounded-[6px] border-2">
            <CardHeader>
              <CardTitle className="text-lg">
                {t("aiProvider.verification")}
              </CardTitle>
              <CardDescription>
                {t("aiProvider.verificationDesc")}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_auto]">
                <Select
                  value={testType}
                  onValueChange={(value) =>
                    setTestType(value as "connection" | "harness")
                  }
                >
                  <SelectTrigger
                    className="h-10 rounded-[4px] border-2"
                    aria-label={t("aiProvider.testType")}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="connection">
                      {t("aiProvider.testConnectionOption")}
                    </SelectItem>
                    <SelectItem value="harness">
                      {t("aiProvider.testHarnessOption")}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  onClick={() => void handleTest()}
                  disabled={saving || testing || !canTest}
                  title={
                    !canTest
                      ? t("aiProvider.needApiKey")
                      : t("aiProvider.testDescription")
                  }
                >
                  {testing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Zap className="mr-2 h-4 w-4" />
                  )}
                  {testType === "harness"
                    ? t("aiProvider.testHarness")
                    : t("aiProvider.testConnection")}
                </Button>
              </div>

              {testResult ? (
                <div
                  className={`space-y-3 rounded-[4px] border p-4 ${
                    connectionFailed
                      ? "border-destructive/40 bg-destructive/5"
                      : "border-emerald-600/30 bg-emerald-600/5"
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {connectionFailed ? (
                      <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                    ) : (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="text-sm font-semibold">
                        {"error" in testResult
                          ? testResult.error
                          : testResult.message}
                      </p>
                      {!("error" in testResult) ? (
                        <p className="font-mono text-xs text-muted-foreground">
                          {testResult.provider} · {testResult.model} ·{" "}
                          {testResult.durationMs}ms
                        </p>
                      ) : null}
                    </div>
                  </div>
                  {!("error" in testResult) ? (
                    <>
                      <ul className="space-y-1 pl-6 text-xs text-muted-foreground">
                        {testResult.details.map((detail) => (
                          <li key={detail} className="list-disc">
                            {detail}
                          </li>
                        ))}
                      </ul>
                      {testResult.inputTokens !== null ||
                      testResult.outputTokens !== null ? (
                        <p className="text-xs text-muted-foreground">
                          {t("aiProvider.tokenUsage")}:{" "}
                          {testResult.inputTokens ?? 0}
                          {" in / "}
                          {testResult.outputTokens ?? 0} out
                        </p>
                      ) : null}
                      {testResult.responsePreview ? (
                        <div className="space-y-1">
                          <p className="text-xs font-medium">
                            {t("aiProvider.responsePreview")}
                          </p>
                          <pre className="overflow-x-auto whitespace-pre-wrap rounded-[4px] bg-muted p-2 text-[11px]">
                            {testResult.responsePreview}
                          </pre>
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}

              {testType === "harness" &&
              !capabilityReport &&
              (testing || capabilityProgress.total > 0) ? (
                <div className="space-y-4 rounded-[4px] border-2 border-border bg-muted/20 p-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3 text-xs">
                      <span className="font-semibold">
                        {t("aiProvider.testProgress")}
                      </span>
                      <span className="text-muted-foreground">
                        {t("aiProvider.probesComplete", {
                          complete: completedProbeCount,
                          total: capabilityProgress.total || "…",
                        })}
                      </span>
                    </div>
                    <Progress value={progressPercent} className="h-2" />
                  </div>
                  {capabilityProgress.current ? (
                    <div className="flex items-start gap-2 text-sm">
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                      <div>
                        <p className="font-medium">
                          {capabilityProgress.current.title}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {capabilityProgress.current.tier}
                        </p>
                      </div>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    {capabilityProgress.probes.map((probe) => (
                      <div
                        key={probe.id}
                        className="flex items-start justify-between gap-3 rounded-[4px] border bg-background p-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-medium">{probe.title}</p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {probe.reason}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className={
                            probe.status === "PASS"
                              ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-400"
                              : probe.status === "SKIPPED"
                                ? "text-muted-foreground"
                                : "border-destructive/40 text-destructive"
                          }
                        >
                          {probe.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                  {capabilityProgress.capacityRunning ? (
                    <div className="flex items-center gap-2 text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("aiProvider.capacityAnalysis")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {capabilityReport ? (
        <AssistantCapabilityReport report={capabilityReport} />
      ) : null}

      <div className="sticky bottom-2 z-10 flex flex-col-reverse gap-2 rounded-[6px] border-2 border-border bg-background/95 p-3 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-end">
        <Button
          variant="ghost"
          onClick={onCancel}
          disabled={saving || testing}
          className="w-full sm:w-auto"
        >
          {t("aiProvider.cancel")}
        </Button>
        <Button
          onClick={() => void handleSave()}
          disabled={saving || testing}
          className="w-full sm:w-auto"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          {config ? t("aiProvider.save") : t("aiProvider.create")}
        </Button>
      </div>
    </div>
  );
}
