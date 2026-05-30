"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@workspace/ui/components";
import { api, type AiProviderConfigResponseDto } from "@workspace/api-client";
import { AiProviderForm } from "@/components/ai-provider-form";
import { VerticalCustomDetectorStepperNav } from "@/components/custom-detector-stepper";
import { useTranslation } from "@/hooks/use-translation";

// ── Types ──────────────────────────────────────────────────────────────────

type LLMStepId = "identity" | "provider" | "prompt" | "labels" | "severity" | "output";

type SeverityLevel = "critical" | "high" | "medium" | "low" | "info";
type FieldType = "string" | "number" | "boolean" | "list[string]" | "list[number]";

interface SeverityRule {
  pattern: string;
  severity: SeverityLevel;
}

interface LabelRow {
  name: string;
  description: string;
}

interface OutputFieldRow {
  name: string;
  description: string;
  type: FieldType;
}

interface LLMFormState {
  name: string;
  key: string;
  description: string;
  isActive: boolean;
  aiProviderConfigId: string;
  systemPrompt: string;
  responseExample: string;
  temperature: string;
  maxTokens: string;
  multiLabel: boolean;
  confidenceThreshold: string;
  defaultSeverity: SeverityLevel;
  labels: LabelRow[];
  severityRules: SeverityRule[];
  outputFields: OutputFieldRow[];
}

const SEVERITY_LEVELS: SeverityLevel[] = ["critical", "high", "medium", "low", "info"];
const FIELD_TYPES: FieldType[] = [
  "string",
  "number",
  "boolean",
  "list[string]",
  "list[number]",
];

// ── Props ──────────────────────────────────────────────────────────────────

export interface LLMDetectorEditorProps {
  mode: "create" | "edit";
  detectorId?: string;
  submitLabel: string;
  isSubmitting?: boolean;
  initialName?: string;
  initialKey?: string;
  initialDescription?: string;
  initialIsActive?: boolean;
  initialAiProviderConfigId?: string | null;
  initialPipelineSchema?: Record<string, unknown>;
  embedded?: boolean;
  onSubmit: (payload: {
    name: string;
    key?: string;
    description?: string;
    isActive?: boolean;
    aiProviderConfigId?: string;
    pipelineSchema: Record<string, unknown>;
  }) => void | Promise<void>;
}

export interface LLMDetectorEditorHandle {
  submit: () => Promise<void>;
}

// ── Helpers ────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function initFromSchema(
  schema: Record<string, unknown> | undefined,
): Partial<LLMFormState> {
  if (!schema) return {};
  const r = schema as Record<string, unknown>;
  const labels = Array.isArray(r.labels)
    ? (r.labels as Array<{ name?: string; description?: string }>).map((l) => ({
        name: typeof l.name === "string" ? l.name : "",
        description: typeof l.description === "string" ? l.description : "",
      }))
    : [];
  const rules = Array.isArray(r.severity_map)
    ? (r.severity_map as Array<{ pattern?: string; severity?: SeverityLevel }>).map(
        (rule) => ({
          pattern: typeof rule.pattern === "string" ? rule.pattern : "",
          severity: (rule.severity ?? "medium") as SeverityLevel,
        }),
      )
    : [];
  const fields = Array.isArray(r.output_fields)
    ? (r.output_fields as Array<{ name?: string; description?: string; type?: FieldType }>).map(
        (f) => ({
          name: typeof f.name === "string" ? f.name : "",
          description: typeof f.description === "string" ? f.description : "",
          type: (f.type ?? "string") as FieldType,
        }),
      )
    : [];
  return {
    systemPrompt: typeof r.system_prompt === "string" ? r.system_prompt : "",
    responseExample: typeof r.response_example === "string" ? r.response_example : "",
    temperature: r.temperature != null ? String(r.temperature) : "",
    maxTokens: r.max_tokens != null ? String(r.max_tokens) : "",
    multiLabel: r.multi_label === true,
    confidenceThreshold:
      r.confidence_threshold != null ? String(r.confidence_threshold) : "",
    defaultSeverity: (typeof r.severity === "string" ? r.severity : "info") as SeverityLevel,
    labels,
    severityRules: rules,
    outputFields: fields,
  };
}

function buildPipelineSchema(s: LLMFormState): Record<string, unknown> {
  const schema: Record<string, unknown> = {
    type: "LLM",
    system_prompt: s.systemPrompt.trim(),
  };
  if (s.responseExample.trim()) schema.response_example = s.responseExample.trim();
  if (s.temperature) schema.temperature = parseFloat(s.temperature);
  if (s.maxTokens) schema.max_tokens = parseInt(s.maxTokens, 10);
  if (s.confidenceThreshold)
    schema.confidence_threshold = parseFloat(s.confidenceThreshold);
  schema.multi_label = s.multiLabel;
  schema.severity = s.defaultSeverity;

  const labels = s.labels
    .filter((l) => l.name.trim())
    .map((l) => ({
      name: l.name.trim(),
      ...(l.description.trim() ? { description: l.description.trim() } : {}),
    }));
  if (labels.length > 0) schema.labels = labels;

  const rules = s.severityRules
    .filter((r) => r.pattern.trim())
    .map((r) => ({ pattern: r.pattern.trim(), severity: r.severity }));
  if (rules.length > 0) schema.severity_map = rules;

  const fields = s.outputFields
    .filter((f) => f.name.trim())
    .map((f) => ({
      name: f.name.trim(),
      type: f.type,
      ...(f.description.trim() ? { description: f.description.trim() } : {}),
    }));
  if (fields.length > 0) schema.output_fields = fields;

  return schema;
}

// ── Component ──────────────────────────────────────────────────────────────

export const LLMDetectorEditor = React.forwardRef<
  LLMDetectorEditorHandle,
  LLMDetectorEditorProps
>(function LLMDetectorEditor(
  {
    mode,
    submitLabel,
    isSubmitting,
    initialName = "",
    initialKey = "",
    initialDescription = "",
    initialIsActive = true,
    initialAiProviderConfigId = null,
    initialPipelineSchema,
    embedded,
    onSubmit,
  },
  ref,
) {
  const { t } = useTranslation();

  const steps: Array<{ id: LLMStepId; title: string; description: string }> = [
    { id: "identity", title: t("detectors.llm.stepIdentity"), description: t("detectors.llm.stepIdentityDesc") },
    { id: "provider", title: t("detectors.llm.stepProvider"), description: t("detectors.llm.stepProviderDesc") },
    { id: "prompt", title: t("detectors.llm.stepPrompt"), description: t("detectors.llm.stepPromptDesc") },
    { id: "labels", title: t("detectors.llm.stepLabels"), description: t("detectors.llm.stepLabelsDesc") },
    { id: "severity", title: t("detectors.llm.stepSeverity"), description: t("detectors.llm.stepSeverityDesc") },
    { id: "output", title: t("detectors.llm.stepOutput"), description: t("detectors.llm.stepOutputDesc") },
  ];

  const schemaDefaults = initFromSchema(initialPipelineSchema);
  const [form, setForm] = useState<LLMFormState>({
    name: initialName,
    key: initialKey,
    description: initialDescription,
    isActive: initialIsActive,
    aiProviderConfigId: initialAiProviderConfigId ?? "",
    systemPrompt: schemaDefaults.systemPrompt ?? "",
    responseExample: schemaDefaults.responseExample ?? "",
    temperature: schemaDefaults.temperature ?? "",
    maxTokens: schemaDefaults.maxTokens ?? "",
    multiLabel: schemaDefaults.multiLabel ?? false,
    confidenceThreshold: schemaDefaults.confidenceThreshold ?? "",
    defaultSeverity: schemaDefaults.defaultSeverity ?? "info",
    labels: schemaDefaults.labels ?? [],
    severityRules: schemaDefaults.severityRules ?? [],
    outputFields: schemaDefaults.outputFields ?? [],
  });

  const [providers, setProviders] = useState<AiProviderConfigResponseDto[]>([]);
  const [providersLoading, setProvidersLoading] = useState(true);
  const [activeStep, setActiveStep] = useState<LLMStepId>(steps[0]!.id);
  const [providerFormOpen, setProviderFormOpen] = useState(false);
  const [editingProvider, setEditingProvider] =
    useState<AiProviderConfigResponseDto | null>(null);

  const reloadProviders = useCallback(async () => {
    try {
      const list = await api.aiProviderConfigs.aiProviderConfigControllerList();
      setProviders(list);
      return list;
    } catch {
      setProviders([]);
      return [];
    } finally {
      setProvidersLoading(false);
    }
  }, []);

  useEffect(() => {
    void reloadProviders();
  }, [reloadProviders]);

  const selectedProvider = providers.find((p) => p.id === form.aiProviderConfigId) ?? null;

  const handleProviderSaved = useCallback(
    async (saved: AiProviderConfigResponseDto, close: boolean) => {
      await reloadProviders();
      patch({ aiProviderConfigId: saved.id });
      if (close) {
        setProviderFormOpen(false);
        setEditingProvider(null);
      }
    },
    [reloadProviders],
  );

  const identityRef = useRef<HTMLDivElement>(null);
  const providerRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const severityRef = useRef<HTMLDivElement>(null);
  const outputRef = useRef<HTMLDivElement>(null);
  const sectionRefs: Record<LLMStepId, RefObject<HTMLDivElement | null>> = {
    identity: identityRef,
    provider: providerRef,
    prompt: promptRef,
    labels: labelsRef,
    severity: severityRef,
    output: outputRef,
  };

  useEffect(() => {
    const elements = steps
      .map((s) => ({ id: s.id, el: sectionRefs[s.id].current }))
      .filter((x): x is { id: LLMStepId; el: HTMLDivElement } => x.el !== null);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const matched = elements.find((x) => x.el === entry.target);
            if (matched) setActiveStep(matched.id);
          }
        }
      },
      { threshold: 0.4 },
    );
    for (const { el } of elements) observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const scrollToSection = useCallback((id: LLMStepId) => {
    sectionRefs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(delta: Partial<LLMFormState>) {
    setForm((prev) => ({ ...prev, ...delta }));
  }

  const canSubmit =
    !isSubmitting &&
    form.name.trim().length > 0 &&
    form.aiProviderConfigId.length > 0 &&
    form.systemPrompt.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      throw new Error("Validation failed");
    }
    await onSubmit({
      name: form.name,
      key: form.key || toSlug(form.name),
      description: form.description,
      isActive: form.isActive,
      aiProviderConfigId: form.aiProviderConfigId,
      pipelineSchema: buildPipelineSchema(form),
    });
  }

  React.useImperativeHandle(ref, () => ({ submit: handleSubmit }));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_200px]">
      <div className="space-y-6 min-w-0">
        {/* ── Identity ── */}
        <div ref={identityRef} id="section-identity">
          <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
            <h2 className="font-serif font-black uppercase tracking-wide text-base">
              {t("detectors.llm.identityTitle")}
            </h2>
            <div className="space-y-1.5">
              <Label htmlFor="llm-name">{t("detectors.llm.name")} *</Label>
              <Input
                id="llm-name"
                value={form.name}
                onChange={(e) =>
                  patch({
                    name: e.target.value,
                    key: mode === "create" ? toSlug(e.target.value) : form.key,
                  })
                }
                placeholder={t("detectors.llm.namePlaceholder")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-key">{t("detectors.llm.keyLabel")}</Label>
              <Input
                id="llm-key"
                value={form.key}
                onChange={(e) => patch({ key: e.target.value })}
                placeholder="e.g. sentiment_detector"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">{t("detectors.llm.keyHint")}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-description">{t("detectors.llm.descriptionLabel")}</Label>
              <Textarea
                id="llm-description"
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder={t("detectors.llm.descriptionPlaceholder")}
                rows={3}
              />
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="llm-active"
                checked={form.isActive}
                onCheckedChange={(v) => patch({ isActive: v })}
              />
              <Label htmlFor="llm-active">{t("detectors.llm.activeLabel")}</Label>
            </div>
          </Card>
        </div>

        {/* ── Provider ── */}
        <div ref={providerRef} id="section-provider">
          <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
            <h2 className="font-serif font-black uppercase tracking-wide text-base">
              {t("detectors.llm.providerTitle")}
            </h2>
            <div className="space-y-1.5">
              <Label>{t("detectors.llm.providerLabel")} *</Label>
              <div className="flex items-center gap-2">
                <Select
                  value={form.aiProviderConfigId}
                  onValueChange={(v) => patch({ aiProviderConfigId: v })}
                  disabled={providersLoading || providers.length === 0}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue
                      placeholder={
                        providersLoading
                          ? t("detectors.llm.providerLoading")
                          : providers.length === 0
                            ? t("detectors.llm.providerEmpty")
                            : t("detectors.llm.providerPlaceholder")
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {providers.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name} — {p.provider} / {p.model}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={t("detectors.llm.editProvider")}
                  title={t("detectors.llm.editProvider")}
                  disabled={!selectedProvider}
                  onClick={() => {
                    setEditingProvider(selectedProvider);
                    setProviderFormOpen(true);
                  }}
                  className="rounded-[4px] border-2 border-border shadow-[2px_2px_0_var(--color-border)]"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setEditingProvider(null);
                    setProviderFormOpen(true);
                  }}
                  className="rounded-[4px] border-2 border-border shadow-[2px_2px_0_var(--color-border)]"
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  {t("detectors.llm.newProvider")}
                </Button>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Prompt ── */}
        <div ref={promptRef} id="section-prompt">
          <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
            <h2 className="font-serif font-black uppercase tracking-wide text-base">
              {t("detectors.llm.promptTitle")}
            </h2>
            <div className="space-y-1.5">
              <Label htmlFor="llm-prompt">{t("detectors.llm.systemPromptLabel")} *</Label>
              <Textarea
                id="llm-prompt"
                value={form.systemPrompt}
                onChange={(e) => patch({ systemPrompt: e.target.value })}
                placeholder={t("detectors.llm.systemPromptPlaceholder")}
                rows={6}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="llm-temp">{t("detectors.llm.temperatureLabel")}</Label>
                <Input
                  id="llm-temp"
                  type="number"
                  min="0"
                  max="2"
                  step="0.1"
                  value={form.temperature}
                  onChange={(e) => patch({ temperature: e.target.value })}
                  placeholder="0.0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="llm-maxtok">{t("detectors.llm.maxTokensLabel")}</Label>
                <Input
                  id="llm-maxtok"
                  type="number"
                  min="1"
                  value={form.maxTokens}
                  onChange={(e) => patch({ maxTokens: e.target.value })}
                  placeholder={t("detectors.llm.maxTokensDefault")}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="llm-example">{t("detectors.llm.responseExampleLabel")}</Label>
              <Textarea
                id="llm-example"
                value={form.responseExample}
                onChange={(e) => patch({ responseExample: e.target.value })}
                placeholder={t("detectors.llm.responseExamplePlaceholder")}
                rows={4}
                className="font-mono text-sm"
              />
            </div>
          </Card>
        </div>

        {/* ── Labels ── */}
        <div ref={labelsRef} id="section-labels">
          <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
            <h2 className="font-serif font-black uppercase tracking-wide text-base">
              {t("detectors.llm.labelsTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("detectors.llm.labelsHint")}</p>
            {form.labels.map((label, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-[4px] border border-border p-3"
              >
                <Input
                  value={label.name}
                  onChange={(e) => {
                    const labels = [...form.labels];
                    labels[idx] = { ...labels[idx]!, name: e.target.value };
                    patch({ labels });
                  }}
                  placeholder={t("detectors.llm.labelNamePlaceholder")}
                  className="font-mono text-sm w-40"
                />
                <Input
                  value={label.description}
                  onChange={(e) => {
                    const labels = [...form.labels];
                    labels[idx] = { ...labels[idx]!, description: e.target.value };
                    patch({ labels });
                  }}
                  placeholder={t("detectors.llm.labelDescriptionPlaceholder")}
                  className="flex-1"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("detectors.llm.removeLabel")}
                  onClick={() => patch({ labels: form.labels.filter((_, i) => i !== idx) })}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <Button
                variant="outline"
                size="sm"
                onClick={() => patch({ labels: [...form.labels, { name: "", description: "" }] })}
                className="rounded-[4px] border-2 border-border shadow-[2px_2px_0_var(--color-border)]"
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                {t("detectors.llm.addLabel")}
              </Button>
              <div className="flex items-center gap-2">
                <Switch
                  id="llm-multilabel"
                  checked={form.multiLabel}
                  onCheckedChange={(v) => patch({ multiLabel: v })}
                />
                <Label htmlFor="llm-multilabel">{t("detectors.llm.multiLabel")}</Label>
              </div>
            </div>
          </Card>
        </div>

        {/* ── Severity ── */}
        <div ref={severityRef} id="section-severity">
          <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
            <h2 className="font-serif font-black uppercase tracking-wide text-base">
              {t("detectors.llm.severityTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t("detectors.llm.severityMapHint")}
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="llm-conf">{t("detectors.llm.confidenceThreshold")}</Label>
                <Input
                  id="llm-conf"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={form.confidenceThreshold}
                  onChange={(e) => patch({ confidenceThreshold: e.target.value })}
                  placeholder="0.5"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("detectors.llm.defaultSeverity")}</Label>
                <Select
                  value={form.defaultSeverity}
                  onValueChange={(v) => patch({ defaultSeverity: v as SeverityLevel })}
                >
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_LEVELS.map((s) => (
                      <SelectItem key={s} value={s} className="font-mono text-sm">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {form.severityRules.map((rule, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-[4px] border border-border p-3"
              >
                <Input
                  value={rule.pattern}
                  onChange={(e) => {
                    const rules = [...form.severityRules];
                    rules[idx] = { ...rules[idx]!, pattern: e.target.value };
                    patch({ severityRules: rules });
                  }}
                  placeholder={t("detectors.llm.labelPattern")}
                  className="font-mono text-sm flex-1"
                />
                <Select
                  value={rule.severity}
                  onValueChange={(v) => {
                    const rules = [...form.severityRules];
                    rules[idx] = { ...rules[idx]!, severity: v as SeverityLevel };
                    patch({ severityRules: rules });
                  }}
                >
                  <SelectTrigger className="w-[110px] font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SEVERITY_LEVELS.map((s) => (
                      <SelectItem key={s} value={s} className="font-mono text-sm">
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("detectors.llm.removeRule")}
                  onClick={() =>
                    patch({ severityRules: form.severityRules.filter((_, i) => i !== idx) })
                  }
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  severityRules: [...form.severityRules, { pattern: "", severity: "medium" }],
                })
              }
              className="rounded-[4px] border-2 border-border shadow-[2px_2px_0_var(--color-border)]"
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              {t("detectors.llm.addRule")}
            </Button>
          </Card>
        </div>

        {/* ── Output fields ── */}
        <div ref={outputRef} id="section-output">
          <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
            <h2 className="font-serif font-black uppercase tracking-wide text-base">
              {t("detectors.llm.outputTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("detectors.llm.outputHint")}</p>
            {form.outputFields.map((field, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 rounded-[4px] border border-border p-3"
              >
                <Input
                  value={field.name}
                  onChange={(e) => {
                    const fields = [...form.outputFields];
                    fields[idx] = { ...fields[idx]!, name: e.target.value };
                    patch({ outputFields: fields });
                  }}
                  placeholder={t("detectors.llm.fieldNamePlaceholder")}
                  className="font-mono text-sm w-40"
                />
                <Input
                  value={field.description}
                  onChange={(e) => {
                    const fields = [...form.outputFields];
                    fields[idx] = { ...fields[idx]!, description: e.target.value };
                    patch({ outputFields: fields });
                  }}
                  placeholder={t("detectors.llm.fieldDescriptionPlaceholder")}
                  className="flex-1"
                />
                <Select
                  value={field.type}
                  onValueChange={(v) => {
                    const fields = [...form.outputFields];
                    fields[idx] = { ...fields[idx]!, type: v as FieldType };
                    patch({ outputFields: fields });
                  }}
                >
                  <SelectTrigger className="w-[130px] font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_TYPES.map((ft) => (
                      <SelectItem key={ft} value={ft} className="font-mono text-sm">
                        {ft}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("detectors.llm.removeField")}
                  onClick={() =>
                    patch({ outputFields: form.outputFields.filter((_, i) => i !== idx) })
                  }
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            ))}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  outputFields: [
                    ...form.outputFields,
                    { name: "", description: "", type: "string" },
                  ],
                })
              }
              className="rounded-[4px] border-2 border-border shadow-[2px_2px_0_var(--color-border)]"
            >
              <Plus className="mr-2 h-3.5 w-3.5" />
              {t("detectors.llm.addField")}
            </Button>
          </Card>
        </div>

        {/* ── Sticky toolbar ── */}
        {!embedded && (
          <Card className="sticky bottom-0 z-30 p-4 border-t-2 border-border">
            <div className="flex items-center justify-end gap-3">
              {!canSubmit && form.aiProviderConfigId.length === 0 && (
                <Badge variant="secondary" className="font-mono text-xs">
                  {t("detectors.llm.validationProviderRequired")}
                </Badge>
              )}
              <Button
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                className="rounded-[4px] border-2 border-border bg-accent text-accent-foreground shadow-[3px_3px_0_var(--color-border)] hover:bg-accent/90"
              >
                {isSubmitting ? t("detectors.llm.saving") : submitLabel}
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* ── Stepper nav ── */}
      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <VerticalCustomDetectorStepperNav
            activeStepId={activeStep}
            onNavigate={(id) => scrollToSection(id as LLMStepId)}
            steps={steps}
          />
        </div>
      </aside>

      {/* ── Provider create/edit dialog (reuses the settings AI-provider form) ── */}
      <Dialog open={providerFormOpen} onOpenChange={setProviderFormOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingProvider
                ? t("detectors.llm.editProvider")
                : t("detectors.llm.newProvider")}
            </DialogTitle>
            <DialogDescription>{t("detectors.llm.providerHint")}</DialogDescription>
          </DialogHeader>
          <AiProviderForm
            config={editingProvider}
            onSaved={(saved, close) => void handleProviderSaved(saved, close)}
            onCancel={() => setProviderFormOpen(false)}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
});
