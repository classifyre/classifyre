"use client";

import * as React from "react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  Card,
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
import { VerticalCustomDetectorStepperNav } from "@/components/custom-detector-stepper";
import { useTranslation } from "@/hooks/use-translation";

// ── Types ──────────────────────────────────────────────────────────────────

export type TransformerPipelineType =
  | "TEXT_CLASSIFICATION"
  | "IMAGE_CLASSIFICATION"
  | "FEATURE_EXTRACTION"
  | "OBJECT_DETECTION";

type TransformerStepId = "identity" | "model" | "severity";

type SeverityLevel = "critical" | "high" | "medium" | "low" | "info";

interface SeverityRule {
  pattern: string;
  severity: SeverityLevel;
}

interface TransformerFormState {
  name: string;
  key: string;
  description: string;
  isActive: boolean;
  model: string;
  modelRevision: string;
  device: string;
  confidenceThreshold: string;
  topK: string;
  functionToApply: string;
  chunkSize: string;
  chunkOverlap: string;
  maxLength: string;
  poolingStrategy: string;
  normalizeEmbeddings: boolean;
  truncation: boolean;
  batchSize: string;
  nmsThreshold: string;
  minBoxArea: string;
  severityRules: SeverityRule[];
}

const DEVICE_OPTIONS = ["cpu", "cuda", "mps", "cuda:0", "cuda:1"];
const SEVERITY_LEVELS: SeverityLevel[] = ["critical", "high", "medium", "low", "info"];
const POOLING_OPTIONS = ["mean", "cls", "max", "none"];
const FUNCTION_TO_APPLY_OPTIONS = ["sigmoid", "softmax", "none"];

// ── Props ──────────────────────────────────────────────────────────────────

export interface TransformerDetectorEditorProps {
  pipelineType: TransformerPipelineType;
  mode: "create" | "edit";
  detectorId?: string;
  submitLabel: string;
  isSubmitting?: boolean;
  initialName?: string;
  initialKey?: string;
  initialDescription?: string;
  initialIsActive?: boolean;
  initialPipelineSchema?: Record<string, unknown>;
  embedded?: boolean;
  onSubmit: (payload: {
    name: string;
    key?: string;
    description?: string;
    isActive?: boolean;
    pipelineSchema: Record<string, unknown>;
  }) => void | Promise<void>;
}

export interface TransformerDetectorEditorHandle {
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

function hasSeverityMap(type: TransformerPipelineType): boolean {
  return (
    type === "TEXT_CLASSIFICATION" ||
    type === "IMAGE_CLASSIFICATION" ||
    type === "OBJECT_DETECTION"
  );
}

function defaultModelPlaceholder(type: TransformerPipelineType): string {
  if (type === "TEXT_CLASSIFICATION")
    return "e.g. mrm8488/bert-tiny-finetuned-sms-spam-detection";
  if (type === "IMAGE_CLASSIFICATION")
    return "e.g. Falconsai/nsfw_image_detection (leave blank for ViT default)";
  if (type === "FEATURE_EXTRACTION") return "e.g. BAAI/bge-base-en-v1.5";
  return "e.g. facebook/detr-resnet-50";
}

function buildPipelineSchema(
  type: TransformerPipelineType,
  s: TransformerFormState,
): Record<string, unknown> {
  const base: Record<string, unknown> = { type };

  if (type !== "IMAGE_CLASSIFICATION" || s.model.trim()) {
    base.model = s.model.trim() || null;
  }
  if (s.modelRevision.trim()) base.model_revision = s.modelRevision.trim();
  if (s.device && s.device !== "cpu") base.device = s.device;

  if (type === "TEXT_CLASSIFICATION") {
    if (s.confidenceThreshold) base.confidence_threshold = parseFloat(s.confidenceThreshold);
    if (s.topK) base.top_k = parseInt(s.topK, 10);
    if (s.functionToApply && s.functionToApply !== "none")
      base.function_to_apply = s.functionToApply;
    if (s.maxLength) base.max_length = parseInt(s.maxLength, 10);
    if (s.chunkSize) base.chunk_size = parseInt(s.chunkSize, 10);
    if (s.chunkOverlap) base.chunk_overlap = parseInt(s.chunkOverlap, 10);
  }

  if (type === "IMAGE_CLASSIFICATION") {
    if (s.confidenceThreshold) base.confidence_threshold = parseFloat(s.confidenceThreshold);
    if (s.topK) base.top_k = parseInt(s.topK, 10);
    if (s.functionToApply && s.functionToApply !== "none")
      base.function_to_apply = s.functionToApply;
  }

  if (type === "FEATURE_EXTRACTION") {
    if (s.poolingStrategy && s.poolingStrategy !== "mean")
      base.pooling_strategy = s.poolingStrategy;
    base.normalize_embeddings = s.normalizeEmbeddings;
    base.truncation = s.truncation;
    if (s.maxLength) base.max_length = parseInt(s.maxLength, 10);
    if (s.batchSize) base.batch_size = parseInt(s.batchSize, 10);
    if (s.chunkSize) base.chunk_size = parseInt(s.chunkSize, 10);
    if (s.chunkOverlap) base.chunk_overlap = parseInt(s.chunkOverlap, 10);
  }

  if (type === "OBJECT_DETECTION") {
    if (s.confidenceThreshold) base.confidence_threshold = parseFloat(s.confidenceThreshold);
    if (s.topK) base.top_k = parseInt(s.topK, 10);
    if (s.nmsThreshold) base.nms_threshold = parseFloat(s.nmsThreshold);
    if (s.minBoxArea) base.min_box_area = parseInt(s.minBoxArea, 10);
  }

  if (hasSeverityMap(type) && s.severityRules.length > 0) {
    base.severity_map = s.severityRules
      .filter((r) => r.pattern.trim())
      .map((r) => ({ pattern: r.pattern, severity: r.severity }));
  }

  return base;
}

function initFromSchema(schema: Record<string, unknown> | undefined): Partial<TransformerFormState> {
  if (!schema) return {};
  const r = schema as Record<string, unknown>;
  const rules = Array.isArray(r.severity_map)
    ? (r.severity_map as Array<{ pattern: string; severity: SeverityLevel }>)
    : [];
  return {
    model: typeof r.model === "string" ? r.model : "",
    modelRevision: typeof r.model_revision === "string" ? r.model_revision : "",
    device: typeof r.device === "string" ? r.device : "cpu",
    confidenceThreshold: r.confidence_threshold != null ? String(r.confidence_threshold) : "",
    topK: r.top_k != null ? String(r.top_k) : "",
    functionToApply: typeof r.function_to_apply === "string" ? r.function_to_apply : "",
    chunkSize: r.chunk_size != null ? String(r.chunk_size) : "",
    chunkOverlap: r.chunk_overlap != null ? String(r.chunk_overlap) : "",
    maxLength: r.max_length != null ? String(r.max_length) : "",
    poolingStrategy: typeof r.pooling_strategy === "string" ? r.pooling_strategy : "mean",
    normalizeEmbeddings: r.normalize_embeddings !== false,
    truncation: r.truncation !== false,
    batchSize: r.batch_size != null ? String(r.batch_size) : "",
    nmsThreshold: r.nms_threshold != null ? String(r.nms_threshold) : "",
    minBoxArea: r.min_box_area != null ? String(r.min_box_area) : "",
    severityRules: rules,
  };
}

// ── Component ──────────────────────────────────────────────────────────────

export const TransformerDetectorEditor = React.forwardRef<
  TransformerDetectorEditorHandle,
  TransformerDetectorEditorProps
>(function TransformerDetectorEditor({
  pipelineType,
  mode,
  submitLabel,
  isSubmitting,
  initialName = "",
  initialKey = "",
  initialDescription = "",
  initialIsActive = true,
  initialPipelineSchema,
  embedded,
  onSubmit,
}, ref) {
  const { t } = useTranslation();

  const steps: Array<{ id: TransformerStepId; title: string; description: string }> = [
    {
      id: "identity",
      title: t("detectors.transformer.stepIdentity"),
      description: t("detectors.transformer.stepIdentityDesc"),
    },
    {
      id: "model",
      title: t("detectors.transformer.stepModel"),
      description: t("detectors.transformer.stepModelDesc"),
    },
    ...(hasSeverityMap(pipelineType)
      ? [
          {
            id: "severity" as TransformerStepId,
            title: t("detectors.transformer.stepSeverity"),
            description: t("detectors.transformer.stepSeverityDesc"),
          },
        ]
      : []),
  ];

  const schemaDefaults = initFromSchema(initialPipelineSchema);
  const [form, setForm] = useState<TransformerFormState>({
    name: initialName,
    key: initialKey,
    description: initialDescription,
    isActive: initialIsActive,
    model: schemaDefaults.model ?? "",
    modelRevision: schemaDefaults.modelRevision ?? "",
    device: schemaDefaults.device ?? "cpu",
    confidenceThreshold: schemaDefaults.confidenceThreshold ?? "",
    topK: schemaDefaults.topK ?? "",
    functionToApply: schemaDefaults.functionToApply ?? "",
    chunkSize: schemaDefaults.chunkSize ?? "",
    chunkOverlap: schemaDefaults.chunkOverlap ?? "",
    maxLength: schemaDefaults.maxLength ?? "",
    poolingStrategy: schemaDefaults.poolingStrategy ?? "mean",
    normalizeEmbeddings: schemaDefaults.normalizeEmbeddings ?? true,
    truncation: schemaDefaults.truncation ?? true,
    batchSize: schemaDefaults.batchSize ?? "",
    nmsThreshold: schemaDefaults.nmsThreshold ?? "",
    minBoxArea: schemaDefaults.minBoxArea ?? "",
    severityRules: schemaDefaults.severityRules ?? [],
  });

  const [activeStep, setActiveStep] = useState<TransformerStepId>(steps[0]!.id);

  // Refs for scroll-spy
  const identityRef = useRef<HTMLDivElement>(null);
  const modelRef = useRef<HTMLDivElement>(null);
  const severityRef = useRef<HTMLDivElement>(null);
  const sectionRefs: Record<TransformerStepId, RefObject<HTMLDivElement | null>> = {
    identity: identityRef,
    model: modelRef,
    severity: severityRef,
  };

  useEffect(() => {
    const stepIds = steps.map((s) => s.id);
    const elements = stepIds
      .map((id) => ({ id, el: sectionRefs[id].current }))
      .filter((x): x is { id: TransformerStepId; el: HTMLDivElement } => x.el !== null);

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
  }, [pipelineType]);

  const scrollToSection = useCallback((id: TransformerStepId) => {
    sectionRefs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function patch(delta: Partial<TransformerFormState>) {
    setForm((prev) => ({ ...prev, ...delta }));
  }

  async function handleSubmit() {
    const isValid =
      form.name.trim().length > 0 &&
      (pipelineType === "IMAGE_CLASSIFICATION" || form.model.trim().length > 0);
    if (!isValid) {
      throw new Error("Validation failed");
    }
    const pipelineSchema = buildPipelineSchema(pipelineType, form);
    await onSubmit({
      name: form.name,
      key: form.key || toSlug(form.name),
      description: form.description,
      isActive: form.isActive,
      pipelineSchema,
    });
  }

  React.useImperativeHandle(ref, () => ({
    submit: handleSubmit,
  }));

  const canSubmit =
    !isSubmitting &&
    form.name.trim().length > 0 &&
    (pipelineType === "IMAGE_CLASSIFICATION" || form.model.trim().length > 0);

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_200px]">
      {/* ── Left: all sections ── */}
      <div className="space-y-6 min-w-0">

        {/* ── Section: identity ── */}
        <div ref={identityRef} id="section-identity">
          <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
            <h2 className="font-serif font-black uppercase tracking-wide text-base">
              {t("detectors.transformer.identityTitle")}
            </h2>

            <div className="space-y-1.5">
              <Label htmlFor="tx-name">{t("detectors.transformer.name")} *</Label>
              <Input
                id="tx-name"
                value={form.name}
                onChange={(e) =>
                  patch({
                    name: e.target.value,
                    key: mode === "create" ? toSlug(e.target.value) : form.key,
                  })
                }
                placeholder={t("detectors.transformer.namePlaceholder")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-key">{t("detectors.transformer.keyLabel")}</Label>
              <Input
                id="tx-key"
                value={form.key}
                onChange={(e) => patch({ key: e.target.value })}
                placeholder="e.g. spam_classifier"
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground">
                {t("detectors.transformer.keyHint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tx-description">{t("detectors.transformer.descriptionLabel")}</Label>
              <Textarea
                id="tx-description"
                value={form.description}
                onChange={(e) => patch({ description: e.target.value })}
                placeholder={t("detectors.transformer.descriptionPlaceholder")}
                rows={3}
              />
            </div>

            <div className="flex items-center gap-3">
              <Switch
                id="tx-active"
                checked={form.isActive}
                onCheckedChange={(v) => patch({ isActive: v })}
              />
              <Label htmlFor="tx-active">{t("detectors.transformer.activeLabel")}</Label>
            </div>
          </Card>
        </div>

        {/* ── Section: model ── */}
        <div ref={modelRef} id="section-model">
          <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
            <h2 className="font-serif font-black uppercase tracking-wide text-base">
              {t("detectors.transformer.modelTitle")}
            </h2>

            <div className="space-y-1.5">
              <Label htmlFor="tx-model">
                {t("detectors.transformer.modelLabel")}
                {pipelineType !== "IMAGE_CLASSIFICATION" ? " *" : ""}
              </Label>
              <Input
                id="tx-model"
                value={form.model}
                onChange={(e) => patch({ model: e.target.value })}
                placeholder={defaultModelPlaceholder(pipelineType)}
                className="font-mono text-sm"
              />
              {pipelineType === "IMAGE_CLASSIFICATION" && (
                <p className="text-xs text-muted-foreground">
                  {t("detectors.transformer.imageClassificationModelHint")}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tx-revision">
                  {t("detectors.transformer.modelRevisionLabel")}{" "}
                  <span className="text-muted-foreground text-xs">
                    {t("detectors.transformer.modelRevisionOptional")}
                  </span>
                </Label>
                <Input
                  id="tx-revision"
                  value={form.modelRevision}
                  onChange={(e) => patch({ modelRevision: e.target.value })}
                  placeholder={t("detectors.transformer.modelRevisionPlaceholder")}
                  className="font-mono text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label>{t("detectors.transformer.deviceLabel")}</Label>
                <Select value={form.device} onValueChange={(v) => patch({ device: v })}>
                  <SelectTrigger className="font-mono text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DEVICE_OPTIONS.map((d) => (
                      <SelectItem key={d} value={d} className="font-mono text-sm">
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Classification-specific fields */}
            {(pipelineType === "TEXT_CLASSIFICATION" ||
              pipelineType === "IMAGE_CLASSIFICATION") && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="tx-conf">
                      {t("detectors.transformer.confidenceThreshold")}
                    </Label>
                    <Input
                      id="tx-conf"
                      type="number"
                      min="0"
                      max="1"
                      step="0.05"
                      value={form.confidenceThreshold}
                      onChange={(e) => patch({ confidenceThreshold: e.target.value })}
                      placeholder={pipelineType === "TEXT_CLASSIFICATION" ? "0.7" : "0.0"}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="tx-topk">{t("detectors.transformer.topK")}</Label>
                    <Input
                      id="tx-topk"
                      type="number"
                      min="1"
                      value={form.topK}
                      onChange={(e) => patch({ topK: e.target.value })}
                      placeholder="all"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>{t("detectors.transformer.scoreNormalization")}</Label>
                  <Select
                    value={form.functionToApply || "default"}
                    onValueChange={(v) => patch({ functionToApply: v === "default" ? "" : v })}
                  >
                    <SelectTrigger className="font-mono text-sm">
                      <SelectValue
                        placeholder={t("detectors.transformer.scoreNormalizationDefault")}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default" className="font-mono text-sm">
                        {t("detectors.transformer.scoreNormalizationDefault")}
                      </SelectItem>
                      {FUNCTION_TO_APPLY_OPTIONS.map((o) => (
                        <SelectItem key={o} value={o} className="font-mono text-sm">
                          {o}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            {/* Text-classification chunking */}
            {pipelineType === "TEXT_CLASSIFICATION" && (
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="tx-chunk">{t("detectors.transformer.chunkSize")}</Label>
                  <Input
                    id="tx-chunk"
                    type="number"
                    min="1"
                    value={form.chunkSize}
                    onChange={(e) => patch({ chunkSize: e.target.value })}
                    placeholder={t("detectors.transformer.chunkSizeNoChunking")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tx-overlap">{t("detectors.transformer.chunkOverlap")}</Label>
                  <Input
                    id="tx-overlap"
                    type="number"
                    min="0"
                    value={form.chunkOverlap}
                    onChange={(e) => patch({ chunkOverlap: e.target.value })}
                    placeholder="0"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tx-maxlen">{t("detectors.transformer.maxTokenLength")}</Label>
                  <Input
                    id="tx-maxlen"
                    type="number"
                    min="1"
                    value={form.maxLength}
                    onChange={(e) => patch({ maxLength: e.target.value })}
                    placeholder={t("detectors.transformer.maxTokenLengthDefault")}
                  />
                </div>
              </div>
            )}

            {/* Feature extraction fields */}
            {pipelineType === "FEATURE_EXTRACTION" && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <Label>{t("detectors.transformer.poolingStrategy")}</Label>
                    <Select
                      value={form.poolingStrategy}
                      onValueChange={(v) => patch({ poolingStrategy: v })}
                    >
                      <SelectTrigger className="font-mono text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {POOLING_OPTIONS.map((p) => (
                          <SelectItem key={p} value={p} className="font-mono text-sm">
                            {p}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fe-batch">{t("detectors.transformer.batchSize")}</Label>
                    <Input
                      id="fe-batch"
                      type="number"
                      min="1"
                      value={form.batchSize}
                      onChange={(e) => patch({ batchSize: e.target.value })}
                      placeholder="8"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-6">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="fe-normalize"
                      checked={form.normalizeEmbeddings}
                      onCheckedChange={(v) => patch({ normalizeEmbeddings: v })}
                    />
                    <Label htmlFor="fe-normalize">
                      {t("detectors.transformer.normalizeEmbeddings")}
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="fe-trunc"
                      checked={form.truncation}
                      onCheckedChange={(v) => patch({ truncation: v })}
                    />
                    <Label htmlFor="fe-trunc">{t("detectors.transformer.truncation")}</Label>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="fe-maxlen">{t("detectors.transformer.maxTokenLength")}</Label>
                    <Input
                      id="fe-maxlen"
                      type="number"
                      min="1"
                      value={form.maxLength}
                      onChange={(e) => patch({ maxLength: e.target.value })}
                      placeholder={t("detectors.transformer.maxTokenLengthDefault")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fe-chunk">{t("detectors.transformer.chunkSize")}</Label>
                    <Input
                      id="fe-chunk"
                      type="number"
                      min="1"
                      value={form.chunkSize}
                      onChange={(e) => patch({ chunkSize: e.target.value })}
                      placeholder={t("detectors.transformer.chunkSizeNoChunking")}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="fe-overlap">{t("detectors.transformer.chunkOverlap")}</Label>
                    <Input
                      id="fe-overlap"
                      type="number"
                      min="0"
                      value={form.chunkOverlap}
                      onChange={(e) => patch({ chunkOverlap: e.target.value })}
                      placeholder="0"
                    />
                  </div>
                </div>
              </>
            )}

            {/* Object detection fields */}
            {pipelineType === "OBJECT_DETECTION" && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="od-conf">{t("detectors.transformer.confidenceThreshold")}</Label>
                  <Input
                    id="od-conf"
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
                  <Label htmlFor="od-topk">{t("detectors.transformer.topK")}</Label>
                  <Input
                    id="od-topk"
                    type="number"
                    min="1"
                    value={form.topK}
                    onChange={(e) => patch({ topK: e.target.value })}
                    placeholder="all"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="od-nms">{t("detectors.transformer.nmsThreshold")}</Label>
                  <Input
                    id="od-nms"
                    type="number"
                    min="0"
                    max="1"
                    step="0.05"
                    value={form.nmsThreshold}
                    onChange={(e) => patch({ nmsThreshold: e.target.value })}
                    placeholder={t("detectors.transformer.nmsThresholdDefault")}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="od-box">{t("detectors.transformer.minBoxArea")}</Label>
                  <Input
                    id="od-box"
                    type="number"
                    min="0"
                    value={form.minBoxArea}
                    onChange={(e) => patch({ minBoxArea: e.target.value })}
                    placeholder={t("detectors.transformer.minBoxAreaNoMin")}
                  />
                </div>
              </div>
            )}
          </Card>
        </div>

        {/* ── Section: severity map ── */}
        {hasSeverityMap(pipelineType) && (
          <div ref={severityRef} id="section-severity">
            <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
              <h2 className="font-serif font-black uppercase tracking-wide text-base">
                {t("detectors.transformer.severityTitle")}
              </h2>
              <p className="text-sm text-muted-foreground">
                {t("detectors.transformer.severityMapHint")}{" "}
                <Badge variant="secondary" className="font-mono text-xs">
                  info
                </Badge>{" "}
                by default.
              </p>

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
                    placeholder={t("detectors.transformer.labelPattern")}
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
                    aria-label={t("detectors.transformer.removeRule")}
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
                    severityRules: [
                      ...form.severityRules,
                      { pattern: "", severity: "medium" },
                    ],
                  })
                }
                className="rounded-[4px] border-2 border-border shadow-[2px_2px_0_var(--color-border)]"
              >
                <Plus className="mr-2 h-3.5 w-3.5" />
                {t("detectors.transformer.addRule")}
              </Button>
            </Card>
          </div>
        )}

        {/* ── Sticky toolbar ── */}
        {!embedded && (
          <Card className="sticky bottom-0 z-30 p-4 border-t-2 border-border">
            <div className="flex items-center justify-end">
              <Button
                onClick={() => void handleSubmit()}
                disabled={!canSubmit}
                className="rounded-[4px] border-2 border-border bg-accent text-accent-foreground shadow-[3px_3px_0_var(--color-border)] hover:bg-accent/90"
              >
                {isSubmitting ? t("detectors.transformer.saving") : submitLabel}
              </Button>
            </div>
          </Card>
        )}
      </div>

      {/* ── Right: stepper nav ── */}
      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <VerticalCustomDetectorStepperNav
            activeStepId={activeStep}
            onNavigate={(id) => scrollToSection(id as TransformerStepId)}
            steps={steps}
          />
        </div>
      </aside>
    </div>
  );
});
