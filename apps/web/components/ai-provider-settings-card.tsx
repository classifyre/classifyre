"use client";

import * as React from "react";
import {
  api,
  AiProviderConfigResponseDtoProviderEnum,
  type AiProviderConfigResponseDto,
  type UpdateAiProviderConfigDto,
} from "@workspace/api-client";
import {
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components";
import {
  BrainCircuit,
  CheckCircle2,
  KeyRound,
  Loader2,
  Save,
  Server,
  XCircle,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";

const PROVIDER_LABELS: Record<AiProviderConfigResponseDtoProviderEnum, string> =
  {
    OPENAI_COMPATIBLE: "OpenAI-Compatible",
    CLAUDE: "Claude (Anthropic)",
    GEMINI: "Gemini (Google)",
  };

const DEFAULT_MODELS: Record<AiProviderConfigResponseDtoProviderEnum, string> =
  {
    OPENAI_COMPATIBLE: "gpt-4o",
    CLAUDE: "claude-sonnet-4-5",
    GEMINI: "gemini-2.0-flash",
  };

type Draft = {
  provider: AiProviderConfigResponseDtoProviderEnum;
  model: string;
  apiKey: string;
  baseUrl: string;
};

function buildDraft(config: AiProviderConfigResponseDto): Draft {
  return {
    provider: config.provider,
    model: config.model,
    apiKey: "",
    baseUrl: config.baseUrl ?? "",
  };
}

function buildUpdatePayload(draft: Draft): UpdateAiProviderConfigDto {
  return {
    provider: draft.provider,
    model: draft.model.trim() || undefined,
    ...(draft.apiKey.length > 0 ? { apiKey: draft.apiKey } : {}),
    ...(draft.provider ===
    AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible
      ? { baseUrl: draft.baseUrl.trim() || undefined }
      : { baseUrl: "" }),
  };
}

export function AiProviderSettingsCard() {
  const { t } = useTranslation();
  const [config, setConfig] =
    React.useState<AiProviderConfigResponseDto | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Draft>({
    provider: AiProviderConfigResponseDtoProviderEnum.Claude,
    model: DEFAULT_MODELS[AiProviderConfigResponseDtoProviderEnum.Claude],
    apiKey: "",
    baseUrl: "",
  });
  const [editingKey, setEditingKey] = React.useState(false);
  const [testing, setTesting] = React.useState(false);
  const [testResult, setTestResult] = React.useState<
    | {
        model: string;
        provider: string;
      }
    | { error: string }
    | null
  >(null);

  const load = React.useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const result =
        await api.instanceSettings.aiProviderConfigControllerGetConfig();
      setConfig(result);
      setDraft(buildDraft(result));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load AI provider settings",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const handleProviderChange = React.useCallback(
    (value: AiProviderConfigResponseDtoProviderEnum) => {
      setDraft((prev) => ({
        ...prev,
        provider: value,
        model: DEFAULT_MODELS[value],
        baseUrl:
          value !== AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible
            ? ""
            : prev.baseUrl,
      }));
    },
    [],
  );

  const persistDraft = React.useCallback(
    async ({
      showSuccessToast = true,
    }: { showSuccessToast?: boolean } = {}) => {
      try {
        setSaving(true);
        setError(null);

        const updated =
          await api.instanceSettings.aiProviderConfigControllerUpdateConfig({
            updateAiProviderConfigDto: buildUpdatePayload(draft),
          });

        setConfig(updated);
        setDraft(buildDraft(updated));
        setEditingKey(false);

        if (showSuccessToast) {
          toast.success(t("aiProvider.saved"));
        }

        return updated;
      } catch (saveError) {
        const msg =
          saveError instanceof Error
            ? saveError.message
            : "Failed to save settings";
        setError(msg);
        toast.error(msg);
        throw saveError;
      } finally {
        setSaving(false);
      }
    },
    [draft],
  );

  const handleSave = React.useCallback(async () => {
    try {
      await persistDraft();
    } catch {
      // persistDraft already reports the error.
    }
  }, [persistDraft]);

  const handleTest = React.useCallback(async () => {
    try {
      setTesting(true);
      setTestResult(null);
      await persistDraft({ showSuccessToast: false });
      const result = await api.aiComplete([
        {
          role: "system",
          content:
            "You are a helpful assistant. Always respond with raw valid JSON — no markdown, no explanation.",
        },
        {
          role: "user",
          content:
            'Reply with exactly this JSON structure: {"status":"ok","square":49,"language":"TypeScript"}',
        },
      ]);
      let parsed: unknown;
      try {
        const raw = result.content
          .trim()
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/, "")
          .trim();
        parsed = JSON.parse(raw);
      } catch {
        throw new Error(
          `Model responded but returned invalid JSON: ${result.content.slice(0, 120)}`,
        );
      }
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        (parsed as Record<string, unknown>).status !== "ok" ||
        (parsed as Record<string, unknown>).square !== 49 ||
        (parsed as Record<string, unknown>).language !== "TypeScript"
      ) {
        throw new Error(
          `Structured response validation failed: ${JSON.stringify(parsed)}`,
        );
      }
      setTestResult({ model: result.model, provider: result.provider });
    } catch (testError) {
      const msg =
        testError instanceof Error ? testError.message : "Test failed";
      setTestResult({ error: msg });
    } finally {
      setTesting(false);
    }
  }, [persistDraft]);

  const isOpenAiCompatible =
    draft.provider === AiProviderConfigResponseDtoProviderEnum.OpenaiCompatible;
  const canTest = (config?.hasApiKey ?? false) || draft.apiKey.length > 0;

  return (
    <Card className="panel-card rounded-[6px]">
      <CardHeader className="gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              AI Provider
            </p>
          </div>
          <CardTitle>AI provider configuration</CardTitle>
          <CardDescription>
            Configure which AI provider and model the API uses for assistant
            features. The API key is stored encrypted and never returned in
            plaintext.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex min-h-24 items-center justify-center text-sm text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading AI provider settings…
          </div>
        ) : null}

        {!loading && error ? (
          <Alert variant="destructive" className="border-destructive/40">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {!loading && config ? (
          <>
            {/* Provider selector */}
            <div className="space-y-2">
              <Label className="text-xs font-mono uppercase tracking-[0.12em]">
                <Server className="mr-1.5 inline h-3.5 w-3.5" />
                Provider
              </Label>
              <Select
                value={draft.provider}
                onValueChange={(v) =>
                  handleProviderChange(
                    v as AiProviderConfigResponseDtoProviderEnum,
                  )
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
                      {PROVIDER_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Model */}
            <div className="space-y-2">
              <Label className="text-xs font-mono uppercase tracking-[0.12em]">
                Model
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

            {/* Base URL — OpenAI-compatible only */}
            {isOpenAiCompatible ? (
              <div className="space-y-2">
                <Label className="text-xs font-mono uppercase tracking-[0.12em]">
                  Base URL
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
                  Endpoint used for OpenAI-compatible requests (e.g. OpenRouter,
                  Ollama, Azure OpenAI).
                </p>
              </div>
            ) : null}

            {/* API Key */}
            <div className="space-y-2">
              <Label className="text-xs font-mono uppercase tracking-[0.12em]">
                <KeyRound className="mr-1.5 inline h-3.5 w-3.5" />
                API Key
              </Label>
              {config.hasApiKey && !editingKey ? (
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
                    config.hasApiKey
                      ? "Enter new key to replace…"
                      : "Enter API key…"
                  }
                  value={draft.apiKey}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, apiKey: e.target.value }))
                  }
                  autoComplete="off"
                  autoFocus={editingKey}
                />
              )}
              <p className="text-xs text-muted-foreground">
                {config.hasApiKey
                  ? "Key stored. Click the field to replace it."
                  : "The key is encrypted at rest and never returned."}
              </p>
            </div>

            <div className="flex items-center justify-between gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void handleTest()}
                disabled={saving || testing || !canTest}
                title={
                  !canTest
                    ? "Enter or keep an API key to test the provider"
                    : "Send a test code task to the configured AI provider"
                }
              >
                {testing ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Zap className="mr-2 h-3.5 w-3.5" />
                )}
                Test connection
              </Button>
              <Button
                onClick={() => void handleSave()}
                disabled={saving}
                size="sm"
              >
                {saving ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Save className="mr-2 h-3.5 w-3.5" />
                )}
                Save
              </Button>
            </div>

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
                    : `Connection OK · ${testResult.provider} · ${testResult.model}`}
                </span>
              </div>
            ) : null}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
