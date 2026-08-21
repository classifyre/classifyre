"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Boxes,
  Cpu,
  Database,
  Gauge,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  api,
  type EmbeddingSettingsResponseDto,
  type EmbeddingStatusResponseDto,
  type UpdateEmbeddingSettingsDto,
} from "@workspace/api-client";
import {
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
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Spinner,
  Switch,
} from "@workspace/ui/components";
import Link from "next/link";
import type { TranslationKey } from "@/i18n";
import { useTranslation } from "@/hooks/use-translation";
import { useNsPath } from "@/lib/ns-path";
import { formatDate } from "@/lib/date";

const PREFIX = "harness.embedding" as const;
function key(suffix: string): TranslationKey {
  return `${PREFIX}.${suffix}` as TranslationKey;
}

/** Poll cadence while something is actually running. */
const POLL_MS = 4000;

/**
 * Curated Transformers.js models with the dimensions they actually output.
 *
 * The dimension is not a preference — it is a property of the model, and
 * getting it wrong fails every batch at the provider's dimension check rather
 * than producing bad vectors. Pairing them here means picking a model fills in
 * the number that must go with it, and the field stays editable for models not
 * on this list.
 */
const LOCAL_MODELS: Array<{ id: string; dimensions: number; label: string }> = [
  { id: "Xenova/all-MiniLM-L6-v2", dimensions: 384, label: "all-MiniLM-L6-v2 — fastest, general purpose" },
  { id: "Xenova/all-MiniLM-L12-v2", dimensions: 384, label: "all-MiniLM-L12-v2 — slower, a little sharper" },
  { id: "Xenova/bge-small-en-v1.5", dimensions: 384, label: "bge-small-en-v1.5 — strong English retrieval" },
  { id: "Xenova/bge-base-en-v1.5", dimensions: 768, label: "bge-base-en-v1.5 — best English quality, heaviest" },
  { id: "Xenova/gte-small", dimensions: 384, label: "gte-small — balanced retrieval" },
  { id: "Xenova/multilingual-e5-small", dimensions: 384, label: "multilingual-e5-small — non-English corpora" },
];

const CUSTOM_MODEL = "__custom__";
const POOLING_OPTIONS = ["mean", "cls", "none"];
const DTYPE_OPTIONS = ["q8", "fp32", "fp16", "q4"];
const DEVICE_OPTIONS = ["cpu", "gpu", "webgpu", "wasm", "auto"];

type Draft = UpdateEmbeddingSettingsDto;

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

function formatCount(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString();
}

/** A figure in the corpus panel: big serif number, small mono caption. */
function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="font-serif text-xl font-black tabular-nums leading-none">
        {value}
      </p>
      <p className="text-[10px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      {hint ? (
        <p className="text-[10px] text-muted-foreground/80">{hint}</p>
      ) : null}
    </div>
  );
}

/**
 * A labelled control that also says what the deployment configured.
 *
 * The default matters here in a way it does not elsewhere in settings: these
 * values arrive from Helm values or the desktop bundle, an operator cannot see
 * them from the browser otherwise, and "reset" is meaningless without knowing
 * where it lands.
 */
function Field({
  label,
  hint,
  defaultLabel,
  overridden,
  onReset,
  children,
}: {
  label: string;
  hint?: string;
  defaultLabel?: string;
  overridden?: boolean;
  onReset?: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </Label>
        {overridden && onReset ? (
          <button
            type="button"
            onClick={onReset}
            className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-[0.1em] text-amber-600 transition-colors hover:text-amber-700 dark:text-amber-500 dark:hover:text-amber-400"
          >
            <RotateCcw className="h-2.5 w-2.5" />
            {t(key("resetToDefault"))}
          </button>
        ) : null}
      </div>
      {children}
      {defaultLabel ? (
        <p className="text-[10px] font-mono text-muted-foreground/70">
          {defaultLabel}
        </p>
      ) : null}
      {hint ? (
        <p className="text-[10px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

export function EmbeddingSettingsCard() {
  const { t } = useTranslation();
  const [settings, setSettings] =
    React.useState<EmbeddingSettingsResponseDto | null>(null);
  const [status, setStatus] =
    React.useState<EmbeddingStatusResponseDto | null>(null);
  const [draft, setDraft] = React.useState<Draft>({});
  const [loadError, setLoadError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [customModel, setCustomModel] = React.useState(false);
  const nsPath = useNsPath();

  const refresh = React.useCallback(async () => {
    try {
      const [next, queue] = await Promise.all([
        api.embeddings.embeddingControllerGetSettings(),
        api.embeddings.embeddingControllerStatus().catch(() => null),
      ]);
      setSettings(next);
      setStatus(queue);
      setLoadError(null);
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : t(key("loadFailed")),
      );
    }
  }, [t]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const busy = Boolean(
    settings?.rebuildRunning ||
      status?.backfillRunning ||
      status?.recalibrationRunning ||
      (status?.pendingEmbedJobs ?? 0) > 0,
  );

  React.useEffect(() => {
    if (!busy) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [busy, refresh]);

  // The effective value of a field: the unsaved edit if there is one, the
  // saved value otherwise. Kept in one place so every control reads the same
  // way and "dirty" stays a simple comparison.
  const value = React.useCallback(
    <K extends keyof EmbeddingSettingsResponseDto>(field: K) => {
      const pending = (draft as Record<string, unknown>)[field as string];
      if (pending !== undefined && pending !== null) return pending;
      // An explicit null in the draft means "back to the deployment default",
      // which is what the saved response will hold after the next save.
      if (pending === null && settings) {
        return settings.fields[field as string]?.deploymentDefault;
      }
      return settings?.[field];
    },
    [draft, settings],
  );

  const set = React.useCallback((patch: Draft) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const reset = React.useCallback((field: keyof Draft) => {
    setDraft((current) => ({ ...current, [field]: null }));
  }, []);

  const dirtyFields = React.useMemo(() => {
    if (!settings) return [];
    return (Object.keys(draft) as Array<keyof EmbeddingSettingsResponseDto>)
      .filter((field) => {
        const next = value(field);
        return next !== settings[field];
      })
      .map(String);
  }, [draft, settings, value]);

  const rebuildFields = React.useMemo(
    () =>
      dirtyFields.filter((field) =>
        settings?.rebuildTriggerFields.includes(field),
      ),
    [dirtyFields, settings],
  );

  const save = React.useCallback(async () => {
    if (!settings) return;
    setSaving(true);
    try {
      const result =
        await api.embeddings.embeddingControllerUpdateSettings({
          updateEmbeddingSettingsDto: draft,
        });
      setSettings(result.settings);
      setDraft({});
      toast.success(
        result.rebuildStarted
          ? t(key("rebuildStartedToast"))
          : t(key("savedToast")),
      );
      void refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t(key("saveFailedToast")),
      );
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }, [draft, refresh, settings, t]);

  const rebuildNow = React.useCallback(async () => {
    try {
      await api.embeddings.embeddingControllerRebuild();
      toast.success(t(key("rebuildStartedToast")));
      void refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : t(key("saveFailedToast")),
      );
    }
  }, [refresh, t]);

  if (loadError) {
    return (
      <Card className="panel-card rounded-[6px]">
        <CardContent className="p-5">
          <p className="text-xs text-destructive">{loadError}</p>
        </CardContent>
      </Card>
    );
  }

  if (!settings) {
    return (
      <Card className="panel-card rounded-[6px]">
        <CardContent className="flex items-center gap-2 p-5">
          <Spinner size="sm" label={t(key("heading"))} />
          <span className="text-xs text-muted-foreground">
            {t(key("heading"))}
          </span>
        </CardContent>
      </Card>
    );
  }

  const enabled = Boolean(value("enabled"));
  const provider = String(value("provider"));
  const isRemote = provider === "openai-compatible";
  const model = String(value("model") ?? "");
  const knownModel = LOCAL_MODELS.some((entry) => entry.id === model);
  const stats = settings.stats;
  const coverage =
    stats.embeddableFindings > 0
      ? Math.min(
          100,
          Math.round((stats.rankedFindings / stats.embeddableFindings) * 100),
        )
      : 0;

  const defaultLabelFor = (field: string) => {
    const entry = settings.fields[field];
    if (!entry || !entry.overridden) return undefined;
    return t(key("defaultLabel"), { value: String(entry.deploymentDefault) });
  };

  const numberField = (
    field: keyof Draft,
    label: string,
    hint?: string,
  ) => (
    <Field
      label={label}
      hint={hint}
      defaultLabel={defaultLabelFor(field as string)}
      overridden={settings.fields[field as string]?.overridden}
      onReset={() => reset(field)}
    >
      <Input
        type="number"
        value={String(value(field as keyof EmbeddingSettingsResponseDto) ?? "")}
        onChange={(event) =>
          set({
            [field]:
              event.target.value === ""
                ? null
                : Number(event.target.value),
          } as Draft)
        }
        className="h-9 rounded-[4px] border-2 border-border font-mono text-xs"
      />
    </Field>
  );

  return (
    <div className="space-y-6">
      <Card className="panel-card rounded-[6px]">
        <CardContent className="space-y-5 p-5">
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t(key("heading"))}
            </p>
            <Badge
              variant="outline"
              className={`ml-auto gap-1 text-[10px] uppercase tracking-[0.1em] ${
                enabled
                  ? "border-emerald-600/40 text-emerald-700 dark:text-emerald-500"
                  : "border-border text-muted-foreground"
              }`}
            >
              {enabled ? t(key("on")) : t(key("off"))}
            </Badge>
          </div>
          <p className="-mt-2 text-xs text-muted-foreground">
            {t(key("desc"))}
          </p>

          <div className="flex items-start justify-between gap-4 rounded-[4px] border-2 border-border bg-muted/20 p-3">
            <div className="space-y-1">
              <p className="text-[11px] font-mono uppercase tracking-[0.12em]">
                {t(key("enableLabel"))}
              </p>
              <p className="max-w-prose text-[11px] text-muted-foreground">
                {t(key("enableDesc"))}
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={(checked) => set({ enabled: checked })}
            />
          </div>

          {!enabled ? (
            <div className="flex items-start gap-2 rounded-[4px] border border-amber-600/30 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{t(key("disabledNotice"))}</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {enabled ? (
        <>
          <Card className="panel-card rounded-[6px]">
            <CardContent className="space-y-5 p-5">
              <div className="flex items-center gap-2">
                <Boxes className="h-4 w-4" />
                <p className="text-xs font-mono uppercase tracking-[0.14em]">
                  {t(key("providerHeading"))}
                </p>
              </div>
              <p className="-mt-3 text-xs text-muted-foreground">
                {t(key("providerDesc"))}
              </p>

              <div className="grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["transformers-js", "providerLocal", "providerLocalDesc"],
                    ["openai-compatible", "providerRemote", "providerRemoteDesc"],
                  ] as const
                ).map(([id, labelKey, descKey]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => set({ provider: id })}
                    className={`rounded-[4px] border-2 p-3 text-left transition-colors ${
                      provider === id
                        ? "border-amber-600/60 bg-amber-500/5"
                        : "border-border hover:border-muted-foreground/40"
                    }`}
                  >
                    <p className="text-[11px] font-mono uppercase tracking-[0.12em]">
                      {t(key(labelKey))}
                    </p>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {t(key(descKey))}
                    </p>
                  </button>
                ))}
              </div>

              {isRemote ? (
                <div className="space-y-4">
                  <Field
                    label={t(key("aiProviderLabel"))}
                    hint={t(key("aiProviderHint"))}
                  >
                    {settings.aiProviders.length === 0 ? (
                      // Nowhere to go from here otherwise: the picker is empty
                      // precisely because no provider is marked as serving
                      // embeddings, and the place to fix that is another page.
                      <div className="space-y-2 rounded-[4px] border-2 border-dashed border-border bg-muted/20 px-3 py-3">
                        <p className="text-[11px] text-muted-foreground">
                          {t(key("aiProviderEmpty"))}
                        </p>
                        <Button
                          asChild
                          size="sm"
                          variant="outline"
                          className="h-8 gap-1 rounded-[4px] text-[11px]"
                        >
                          <Link href={nsPath("/harness/providers/new")}>
                            <Plus className="h-3 w-3" />
                            {t(key("aiProviderCreate"))}
                          </Link>
                        </Button>
                        <p className="text-[10px] text-muted-foreground/80">
                          {t(key("aiProviderCreateHint"))}
                        </p>
                      </div>
                    ) : (
                      <Select
                        value={String(value("aiProviderConfigId") ?? "")}
                        onValueChange={(next) =>
                          set({ aiProviderConfigId: next })
                        }
                      >
                        <SelectTrigger className="h-9 rounded-[4px] border-2 border-border text-xs">
                          <SelectValue
                            placeholder={t(key("aiProviderPlaceholder"))}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {settings.aiProviders.map((option) => (
                            <SelectItem key={option.id} value={option.id}>
                              {option.name}
                              {option.baseUrl ? ` — ${option.baseUrl}` : ""}
                              {option.supportsEmbedding ? "" : " ⚠"}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </Field>
                  <Field
                    label={t(key("modelLabel"))}
                    defaultLabel={defaultLabelFor("model")}
                    overridden={settings.fields.model?.overridden}
                    onReset={() => reset("model")}
                  >
                    <Input
                      value={model}
                      onChange={(event) => set({ model: event.target.value })}
                      placeholder="text-embedding-3-small"
                      className="h-9 rounded-[4px] border-2 border-border font-mono text-xs"
                    />
                  </Field>
                </div>
              ) : (
                <div className="space-y-4">
                  {!settings.allowRemoteModels ? (
                    <div className="flex items-start gap-2 rounded-[4px] border border-amber-600/30 bg-amber-500/10 p-3 text-[11px] text-amber-800 dark:text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{t(key("offlineWarning"))}</span>
                    </div>
                  ) : null}

                  <Field
                    label={t(key("modelLabel"))}
                    defaultLabel={defaultLabelFor("model")}
                    overridden={settings.fields.model?.overridden}
                    onReset={() => {
                      setCustomModel(false);
                      reset("model");
                    }}
                  >
                    <Select
                      value={customModel || !knownModel ? CUSTOM_MODEL : model}
                      onValueChange={(next) => {
                        if (next === CUSTOM_MODEL) {
                          setCustomModel(true);
                          return;
                        }
                        setCustomModel(false);
                        const entry = LOCAL_MODELS.find((m) => m.id === next);
                        // Dimensions travel with the model: picking one and
                        // leaving the old dimension behind fails every batch.
                        set({
                          model: next,
                          dimensions: entry?.dimensions ?? null,
                          revision: "main",
                        });
                      }}
                    >
                      <SelectTrigger className="h-9 rounded-[4px] border-2 border-border text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {LOCAL_MODELS.map((entry) => (
                          <SelectItem key={entry.id} value={entry.id}>
                            {entry.label}
                          </SelectItem>
                        ))}
                        <SelectItem value={CUSTOM_MODEL}>
                          {t(key("modelCustom"))}
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>

                  {customModel || !knownModel ? (
                    <Input
                      value={model}
                      onChange={(event) => set({ model: event.target.value })}
                      placeholder={t(key("modelCustomPlaceholder"))}
                      className="h-9 rounded-[4px] border-2 border-border font-mono text-xs"
                    />
                  ) : null}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label={t(key("revisionLabel"))}
                      hint={t(key("revisionHint"))}
                      defaultLabel={defaultLabelFor("revision")}
                      overridden={settings.fields.revision?.overridden}
                      onReset={() => reset("revision")}
                    >
                      <Input
                        value={String(value("revision") ?? "")}
                        onChange={(event) =>
                          set({ revision: event.target.value })
                        }
                        className="h-9 rounded-[4px] border-2 border-border font-mono text-xs"
                      />
                    </Field>
                    <Field
                      label={t(key("dtypeLabel"))}
                      defaultLabel={defaultLabelFor("dtype")}
                      overridden={settings.fields.dtype?.overridden}
                      onReset={() => reset("dtype")}
                    >
                      <Select
                        value={String(value("dtype"))}
                        onValueChange={(next) => set({ dtype: next })}
                      >
                        <SelectTrigger className="h-9 rounded-[4px] border-2 border-border font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DTYPE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field
                      label={t(key("deviceLabel"))}
                      defaultLabel={defaultLabelFor("device")}
                      overridden={settings.fields.device?.overridden}
                      onReset={() => reset("device")}
                    >
                      <Select
                        value={String(value("device"))}
                        onValueChange={(next) => set({ device: next })}
                      >
                        <SelectTrigger className="h-9 rounded-[4px] border-2 border-border font-mono text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DEVICE_OPTIONS.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                </div>
              )}

              <Separator className="bg-border" />

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label={t(key("dimensionsLabel"))}
                  hint={t(key("dimensionsHint"))}
                  defaultLabel={defaultLabelFor("dimensions")}
                  overridden={settings.fields.dimensions?.overridden}
                  onReset={() => reset("dimensions")}
                >
                  <Input
                    type="number"
                    value={String(value("dimensions") ?? "")}
                    onChange={(event) =>
                      set({
                        dimensions:
                          event.target.value === ""
                            ? null
                            : Number(event.target.value),
                      })
                    }
                    className="h-9 rounded-[4px] border-2 border-border font-mono text-xs"
                  />
                </Field>
                <Field
                  label={t(key("poolingLabel"))}
                  defaultLabel={defaultLabelFor("pooling")}
                  overridden={settings.fields.pooling?.overridden}
                  onReset={() => reset("pooling")}
                >
                  <Select
                    value={String(value("pooling"))}
                    onValueChange={(next) =>
                      set({
                        pooling: next as UpdateEmbeddingSettingsDto["pooling"],
                      })
                    }
                  >
                    <SelectTrigger className="h-9 rounded-[4px] border-2 border-border font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {POOLING_OPTIONS.map((option) => (
                        <SelectItem key={option} value={option}>
                          {option}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </div>

              <div className="flex items-center justify-between gap-4 rounded-[4px] border border-border p-3">
                <Label className="text-[11px] font-mono uppercase tracking-[0.12em]">
                  {t(key("normalizeLabel"))}
                </Label>
                <Switch
                  checked={Boolean(value("normalize"))}
                  onCheckedChange={(checked) => set({ normalize: checked })}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="panel-card rounded-[6px]">
            <CardContent className="space-y-5 p-5">
              <div className="flex items-center gap-2">
                <Gauge className="h-4 w-4" />
                <p className="text-xs font-mono uppercase tracking-[0.14em]">
                  {t(key("performanceHeading"))}
                </p>
              </div>
              <p className="-mt-3 text-xs text-muted-foreground">
                {t(key("performanceDesc"))}
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                {numberField(
                  "batchSize",
                  t(key("batchSizeLabel")),
                  `${t(key("batchSizeHint"))} ${t(key("appliesAtRestart"))}`,
                )}
                {numberField(
                  "workerConcurrency",
                  t(key("workerConcurrencyLabel")),
                  t(key("appliesAtRestart")),
                )}
                {isRemote
                  ? numberField(
                      "maxParallelCalls",
                      t(key("maxParallelCallsLabel")),
                      t(key("appliesNow")),
                    )
                  : numberField(
                      "intraOpThreads",
                      t(key("intraOpThreadsLabel")),
                      t(key("appliesNow")),
                    )}
              </div>

              <div className="flex items-center justify-between gap-4 rounded-[4px] border border-border p-3">
                <div>
                  <Label className="text-[11px] font-mono uppercase tracking-[0.12em]">
                    {t(key("autoBackfillLabel"))}
                  </Label>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {t(key("autoBackfillHint"))} {t(key("appliesAtRestart"))}
                  </p>
                </div>
                <Switch
                  checked={Boolean(value("autoBackfill"))}
                  onCheckedChange={(checked) => set({ autoBackfill: checked })}
                />
              </div>
            </CardContent>
          </Card>

          <Card className="panel-card rounded-[6px]">
            <CardContent className="space-y-5 p-5">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4" />
                <p className="text-xs font-mono uppercase tracking-[0.14em]">
                  {t(key("indexHeading"))}
                </p>
              </div>
              <p className="-mt-3 text-xs text-muted-foreground">
                {t(key("indexDesc"))}
              </p>
              <div className="grid gap-4 sm:grid-cols-3">
                {numberField("hnswM", t(key("hnswMLabel")))}
                {numberField(
                  "hnswEfConstruction",
                  t(key("hnswEfConstructionLabel")),
                )}
                {numberField(
                  "hnswEfSearch",
                  t(key("hnswEfSearchLabel")),
                  t(key("appliesNow")),
                )}
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Card className="panel-card rounded-[6px]">
        <CardContent className="space-y-5 p-5">
          <div className="flex items-center gap-2">
            <Database className="h-4 w-4" />
            <p className="text-xs font-mono uppercase tracking-[0.14em]">
              {t(key("corpusHeading"))}
            </p>
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">
            {t(key("corpusDesc"))}
          </p>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Stat
              label={t(key("statVectors"))}
              value={formatCount(stats.vectors)}
            />
            <Stat
              label={t(key("statStorage"))}
              value={formatBytes(stats.storageBytes)}
            />
            <Stat
              label={t(key("statChunks"))}
              value={formatCount(stats.chunks)}
            />
            <Stat
              label={t(key("statFindings"))}
              value={formatCount(stats.embeddableFindings)}
            />
            <Stat
              label={t(key("statRanked"))}
              value={formatCount(stats.rankedFindings)}
              hint={t(key("coverage"), { percent: String(coverage) })}
            />
          </div>

          <Separator className="bg-border" />

          <div className="space-y-2">
            <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
              {t(key("queueHeading"))}
            </p>
            {busy ? (
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <Loader2 className="h-3 w-3 animate-spin text-amber-600" />
                {settings.rebuildRunning ? (
                  <span>{t(key("rebuildRunning"))}</span>
                ) : status?.backfillRunning ? (
                  <span>{t(key("queueBackfill"))}</span>
                ) : status?.recalibrationRunning ? (
                  <span>{t(key("queueRecalibrating"))}</span>
                ) : null}
                <Badge
                  variant="outline"
                  className="gap-1 font-mono text-[10px] uppercase"
                >
                  {t(key("queuePending"))}:{" "}
                  {formatCount(status?.pendingEmbedJobs)}
                </Badge>
              </div>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {t(key("queueIdle"))}
              </p>
            )}
            {status?.providerHealth?.workerDisabled ? (
              <p className="text-[11px] text-amber-700 dark:text-amber-500">
                {t(key("queueWorkerPaused"))}
              </p>
            ) : null}
            {status?.lastEmbedJobError ? (
              <p className="text-[11px] text-destructive">
                {t(key("queueLastError"), {
                  error: status.lastEmbedJobError,
                })}
              </p>
            ) : null}
          </div>

          {stats.spaces.length > 0 ? (
            <>
              <Separator className="bg-border" />
              <div className="space-y-2">
                <p className="text-[11px] font-mono uppercase tracking-[0.12em] text-muted-foreground">
                  {t(key("spacesHeading"))}
                </p>
                <div className="space-y-1.5">
                  {stats.spaces.map((space) => (
                    <div
                      key={space.id}
                      className="flex flex-wrap items-center gap-2 rounded-[4px] border border-border px-3 py-2 text-[11px]"
                    >
                      <span className="font-mono">{space.model}</span>
                      <span className="text-muted-foreground">
                        {space.dimensions}d · {space.pooling}
                      </span>
                      {space.isActive ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-600/40 text-[9px] uppercase text-emerald-700 dark:text-emerald-500"
                        >
                          {t(key("spaceActive"))}
                        </Badge>
                      ) : null}
                      <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                        {formatCount(space.vectors)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {t(key("spaceEmpty"))}
            </p>
          )}

          <Separator className="bg-border" />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <p className="text-[11px] font-mono uppercase tracking-[0.12em]">
                {t(key("rebuildHeading"))}
              </p>
              <p className="max-w-prose text-[11px] text-muted-foreground">
                {t(key("rebuildDesc"))}
              </p>
              {settings.rebuildError ? (
                <p className="text-[11px] text-destructive">
                  {t(key("rebuildFailed"), { error: settings.rebuildError })}
                </p>
              ) : settings.rebuildCompletedAt ? (
                <p className="text-[11px] text-muted-foreground">
                  {t(key("rebuildLast"), {
                    when: formatDate(settings.rebuildCompletedAt),
                  })}
                </p>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {t(key("rebuildNever"))}
                </p>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={settings.rebuildRunning || !settings.enabled}
              onClick={() => void rebuildNow()}
              className="h-8 gap-1 rounded-[4px] text-[11px]"
            >
              {settings.rebuildRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Cpu className="h-3 w-3" />
              )}
              {t(key("rebuildNow"))}
            </Button>
          </div>
        </CardContent>
      </Card>

      {dirtyFields.length > 0 ? (
        // Sticky rather than inline: the destructive changes live at the top
        // of a long card, and an Apply button scrolled out of view is how a
        // half-configured workspace happens.
        <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-3 rounded-[6px] border-2 border-amber-600/50 bg-background/95 p-3 shadow-[0_1px_3px_rgba(28,25,23,0.12)] backdrop-blur">
          <span className="text-[11px] font-mono uppercase tracking-[0.12em]">
            {t(key("unsaved"), { count: String(dirtyFields.length) })}
          </span>
          {rebuildFields.length > 0 ? (
            <Badge
              variant="outline"
              className="gap-1 border-amber-600/50 text-[10px] uppercase text-amber-700 dark:text-amber-500"
            >
              <Trash2 className="h-3 w-3" />
              {t(key("confirmTitle"))}
            </Badge>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDraft({})}
              className="h-8 text-[11px]"
            >
              {t(key("discard"))}
            </Button>
            <Button
              size="sm"
              disabled={saving}
              onClick={() => {
                if (rebuildFields.length > 0) setConfirmOpen(true);
                else void save();
              }}
              className="h-8 gap-1 rounded-[4px] text-[11px]"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
              {saving ? t(key("applying")) : t(key("apply"))}
            </Button>
          </div>
        </div>
      ) : null}

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="rounded-[6px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-serif text-lg font-black uppercase tracking-[0.06em]">
              {t(key("confirmTitle"))}
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-xs">
              <span className="block">{t(key("confirmBody"))}</span>
              <span className="block font-mono text-[11px] text-amber-700 dark:text-amber-500">
                {t(key("confirmDeletes"), {
                  vectors: formatCount(stats.vectorsAllSpaces),
                  size: formatBytes(stats.storageBytes),
                })}
              </span>
              <span className="block">{t(key("confirmKeeps"))}</span>
              <span className="block font-mono text-[11px] text-muted-foreground">
                {t(key("confirmChanges"), {
                  fields: rebuildFields.join(", "),
                })}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-[4px] text-xs">
              {t(key("confirmCancel"))}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void save()}
              className="rounded-[4px] text-xs"
            >
              {t(key("confirmProceed"))}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
