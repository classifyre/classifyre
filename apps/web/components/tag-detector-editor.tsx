"use client";

import * as React from "react";
import { useState } from "react";
import { Check, Copy, Tag as TagIcon } from "lucide-react";
import {
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
import { useTranslation } from "@/hooks/use-translation";
import { TAG_PIPELINE_TYPE } from "@/lib/custom-detector-badge";

// ── Types ──────────────────────────────────────────────────────────────────

type SeverityLevel = "critical" | "high" | "medium" | "low" | "info";

const SEVERITY_LEVELS: SeverityLevel[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];

interface TagFormState {
  name: string;
  key: string;
  description: string;
  isActive: boolean;
  label: string;
  severity: SeverityLevel;
}

// ── Props ──────────────────────────────────────────────────────────────────

export interface TagDetectorEditorProps {
  mode: "create" | "edit";
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

export interface TagDetectorEditorHandle {
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

function notebookSnippet(key: string): string {
  const effective = key.trim() || "your_tag_key";
  return `yield Asset(\n    id="record-1",\n    tags={"${effective}": "the value you are asserting"},\n)`;
}

// ── Component ──────────────────────────────────────────────────────────────

/**
 * A Tag detector has no pipeline to configure — it runs nothing. The whole form
 * is its identity plus the two things a finding needs that identity does not
 * carry: the label every finding is called, and the severity every finding
 * gets. There is no stepper because there is only one step.
 */
export const TagDetectorEditor = React.forwardRef<
  TagDetectorEditorHandle,
  TagDetectorEditorProps
>(function TagDetectorEditor(
  {
    mode,
    submitLabel,
    isSubmitting,
    initialName,
    initialKey,
    initialDescription,
    initialIsActive,
    initialPipelineSchema,
    embedded,
    onSubmit,
  },
  ref,
) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const [form, setForm] = useState<TagFormState>(() => {
    const schema = initialPipelineSchema ?? {};
    return {
      name: initialName ?? "",
      key: initialKey ?? "",
      description: initialDescription ?? "",
      isActive: initialIsActive ?? true,
      label: typeof schema.label === "string" ? schema.label : "",
      severity: SEVERITY_LEVELS.includes(schema.severity as SeverityLevel)
        ? (schema.severity as SeverityLevel)
        : "medium",
    };
  });

  function patch(delta: Partial<TagFormState>) {
    setForm((prev) => ({ ...prev, ...delta }));
  }

  const effectiveKey = form.key || toSlug(form.name);
  const canSubmit = !isSubmitting && form.name.trim().length > 0;

  async function handleSubmit() {
    if (!canSubmit) {
      throw new Error("Validation failed");
    }
    const pipelineSchema: Record<string, unknown> = {
      type: TAG_PIPELINE_TYPE,
      severity: form.severity,
    };
    // Left off when blank so the label falls back to the detector's name at
    // scan time, rather than being frozen to whatever the name was today.
    if (form.label.trim()) pipelineSchema.label = form.label.trim();

    await onSubmit({
      name: form.name,
      key: effectiveKey,
      description: form.description,
      isActive: form.isActive,
      pipelineSchema,
    });
  }

  React.useImperativeHandle(ref, () => ({ submit: handleSubmit }));

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(notebookSnippet(effectiveKey));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the snippet is on screen either way.
    }
  }

  return (
    <div className="space-y-6">
      {/* ── Identity ── */}
      <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
        <h2 className="font-serif font-black uppercase tracking-wide text-base">
          {t("detectors.tag.identityTitle")}
        </h2>
        <div className="space-y-1.5">
          <Label htmlFor="tag-name">{t("detectors.tag.name")} *</Label>
          <Input
            id="tag-name"
            value={form.name}
            onChange={(e) =>
              patch({
                name: e.target.value,
                key: mode === "create" ? toSlug(e.target.value) : form.key,
              })
            }
            placeholder={t("detectors.tag.namePlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tag-key">{t("detectors.tag.keyLabel")}</Label>
          <Input
            id="tag-key"
            value={form.key}
            onChange={(e) => patch({ key: e.target.value })}
            placeholder="e.g. cardholder_data"
            className="font-mono text-sm"
          />
          <p className="text-xs text-muted-foreground">
            {t("detectors.tag.keyHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tag-description">
            {t("detectors.tag.descriptionLabel")}
          </Label>
          <Textarea
            id="tag-description"
            value={form.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder={t("detectors.tag.descriptionPlaceholder")}
            rows={3}
          />
        </div>
        <div className="flex items-center gap-3">
          <Switch
            id="tag-active"
            checked={form.isActive}
            onCheckedChange={(v) => patch({ isActive: v })}
          />
          <Label htmlFor="tag-active">{t("detectors.tag.activeLabel")}</Label>
        </div>
      </Card>

      {/* ── What the tag records ── */}
      <Card className="p-6 space-y-4 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
        <h2 className="font-serif font-black uppercase tracking-wide text-base">
          {t("detectors.tag.tagTitle")}
        </h2>
        <div className="space-y-1.5">
          <Label htmlFor="tag-label">{t("detectors.tag.labelLabel")}</Label>
          <Input
            id="tag-label"
            value={form.label}
            onChange={(e) => patch({ label: e.target.value })}
            placeholder={form.name || t("detectors.tag.labelPlaceholder")}
          />
          <p className="text-xs text-muted-foreground">
            {t("detectors.tag.labelHint")}
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tag-severity">
            {t("detectors.tag.severityLabel")}
          </Label>
          <Select
            value={form.severity}
            onValueChange={(v) => patch({ severity: v as SeverityLevel })}
          >
            <SelectTrigger id="tag-severity" className="w-full sm:w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SEVERITY_LEVELS.map((level) => (
                <SelectItem key={level} value={level}>
                  {level}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t("detectors.tag.severityHint")}
          </p>
        </div>
      </Card>

      {/* ── How to use it ── */}
      <Card className="p-6 space-y-3 border-2 border-border shadow-[4px_4px_0_var(--color-border)]">
        <div className="flex items-center gap-2">
          <TagIcon className="h-4 w-4 text-muted-foreground" />
          <h2 className="font-serif font-black uppercase tracking-wide text-base">
            {t("detectors.tag.usageTitle")}
          </h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {t("detectors.tag.usageHint")}
        </p>
        <div className="relative">
          <pre className="overflow-x-auto rounded-[4px] border-2 border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
            {notebookSnippet(effectiveKey)}
          </pre>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void copySnippet()}
            className="absolute right-2 top-2 gap-1.5"
          >
            {copied ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
            {copied
              ? t("detectors.tag.usageCopied")
              : t("detectors.tag.usageCopy")}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {t("detectors.tag.notSelectable")}
        </p>
      </Card>

      {!embedded && (
        <Card className="sticky bottom-0 z-30 p-4 border-t-2 border-border">
          <div className="flex items-center justify-end gap-3">
            <Button
              onClick={() => void handleSubmit()}
              disabled={!canSubmit}
              className="rounded-[4px] border-2 border-border bg-accent text-accent-foreground shadow-[3px_3px_0_var(--color-border)] hover:bg-accent/90"
            >
              {submitLabel}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
});
