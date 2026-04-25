"use client";

import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { Badge } from "@workspace/ui/components/badge";
import { SeverityBadge } from "@workspace/ui/components/severity-badge";
import { StatusBadge } from "@workspace/ui/components/status-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { cn } from "@workspace/ui/lib/utils";
import type {
  AssistantOperation,
  AssistantUiAction,
} from "@workspace/api-client";
import { api, type CustomDetectorResponseDto } from "@workspace/api-client";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { semanticApi } from "@/lib/semantic-api";
import {
  detectorUiGroups,
  type DetectorUiGroupId,
} from "@/lib/detector-ui-config";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";

// ── Detector type → group mapping ─────────────────────────────────────────────

const DETECTOR_TYPE_TO_GROUP: Record<string, DetectorUiGroupId> = {
  SECRETS: "secrets_credentials",
  CODE_SECURITY: "secrets_credentials",
  PII: "privacy_pii",
  YARA: "threats_attacks",
  PROMPT_INJECTION: "threats_attacks",
  PHISHING_URL: "threats_attacks",
  TOXIC: "harmful_content",
  NSFW: "harmful_content",
  SPAM: "content_quality",
  LANGUAGE: "content_quality",
  BROKEN_LINKS: "content_quality",
  CUSTOM: "classification",
};

// All detector types grouped
const DETECTOR_TYPES_BY_GROUP: Record<DetectorUiGroupId, string[]> = {
  secrets_credentials: [],
  privacy_pii: [],
  threats_attacks: [],
  harmful_content: [],
  content_quality: [],
  classification: [],
};
for (const [dt, group] of Object.entries(DETECTOR_TYPE_TO_GROUP)) {
  DETECTOR_TYPES_BY_GROUP[group].push(dt);
}

// ── Severity / status options ─────────────────────────────────────────────────

const SEVERITIES = [
  { value: "CRITICAL", label: "Critical", badgeValue: "critical" as const },
  { value: "HIGH", label: "High", badgeValue: "high" as const },
  { value: "MEDIUM", label: "Medium", badgeValue: "medium" as const },
  { value: "LOW", label: "Low", badgeValue: "low" as const },
  { value: "INFO", label: "Info", badgeValue: "info" as const },
];

const STATUSES = [
  { value: "OPEN", label: "Open", badgeValue: "open" as const },
  {
    value: "FALSE_POSITIVE",
    label: "False Positive",
    badgeValue: "false_positive" as const,
  },
  { value: "RESOLVED", label: "Resolved", badgeValue: "resolved" as const },
  { value: "IGNORED", label: "Ignored", badgeValue: "ignored" as const },
];

const CATEGORIES = [
  "Security",
  "Privacy",
  "Compliance",
  "Content",
  "Operations",
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function formatDetectorLabel(dt: string): string {
  return dt
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface GlossaryFormState {
  displayName: string;
  description: string;
  category: string;
  filterMapping: {
    detectorTypes: string[];
    severities: string[];
    statuses: string[];
    findingTypes: string[];
    customDetectorKeys: string[];
  };
  color: string;
  icon: string;
}

const initialState: GlossaryFormState = {
  displayName: "",
  description: "",
  category: "",
  filterMapping: {
    detectorTypes: [],
    severities: [],
    statuses: [],
    findingTypes: [],
    customDetectorKeys: [],
  },
  color: "",
  icon: "",
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function NewGlossaryTermPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [form, setForm] = useState<GlossaryFormState>(initialState);
  const [isSaving, setIsSaving] = useState(false);
  const [createdTermId, setCreatedTermId] = useState<string | null>(null);
  const [customDetectors, setCustomDetectors] = useState<
    CustomDetectorResponseDto[]
  >([]);
  const formRef = useRef(form);
  formRef.current = form;

  // Load custom detectors for filter mapping
  useEffect(() => {
    api
      .listCustomDetectors({ includeInactive: false })
      .then((rows) => setCustomDetectors(rows ?? []))
      .catch(() => {});
  }, []);

  const updateField = useCallback(
    <K extends keyof GlossaryFormState>(
      key: K,
      value: GlossaryFormState[K],
    ) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const toggleArrayItem = useCallback(
    (field: keyof GlossaryFormState["filterMapping"], value: string) => {
      setForm((prev) => {
        const arr = prev.filterMapping[field];
        const next = arr.includes(value)
          ? arr.filter((v) => v !== value)
          : [...arr, value];
        return {
          ...prev,
          filterMapping: { ...prev.filterMapping, [field]: next },
        };
      });
    },
    [],
  );

  const validate = useCallback((): {
    isValid: boolean;
    missingFields: string[];
    errors: string[];
  } => {
    const f = formRef.current;
    const missingFields: string[] = [];
    const errors: string[] = [];
    if (!f.displayName) missingFields.push("displayName");
    const fm = f.filterMapping;
    const hasFilter =
      fm.detectorTypes.length > 0 ||
      fm.severities.length > 0 ||
      fm.statuses.length > 0 ||
      fm.findingTypes.length > 0 ||
      fm.customDetectorKeys.length > 0;
    if (!hasFilter) errors.push("At least one filter must be set");
    return {
      isValid: missingFields.length === 0 && errors.length === 0,
      missingFields,
      errors,
    };
  }, []);

  const applyPatches = useCallback(
    (patches: Array<{ path: string; value: unknown }>) => {
      setForm((prev) => {
        let next = { ...prev };
        for (const patch of patches) {
          const { path, value } = patch;
          if (path === "displayName" && typeof value === "string") {
            next.displayName = value;
          } else if (path === "description" && typeof value === "string") {
            next.description = value;
          } else if (path === "category" && typeof value === "string") {
            next.category = value;
          } else if (path === "color" && typeof value === "string") {
            next.color = value;
          } else if (path === "icon" && typeof value === "string") {
            next.icon = value;
          } else if (path.startsWith("filterMapping.")) {
            const subKey = path.replace(
              "filterMapping.",
              "",
            ) as keyof GlossaryFormState["filterMapping"];
            if (Array.isArray(value)) {
              next = {
                ...next,
                filterMapping: { ...next.filterMapping, [subKey]: value },
              };
            }
          } else if (
            path === "filterMapping" &&
            typeof value === "object" &&
            value
          ) {
            next.filterMapping = {
              ...next.filterMapping,
              ...(value as Partial<GlossaryFormState["filterMapping"]>),
            };
          }
        }
        return next;
      });
    },
    [],
  );

  const handleSubmit = async () => {
    const v = validate();
    if (!v.isValid) {
      toast.error(
        v.errors[0] || `Missing fields: ${v.missingFields.join(", ")}`,
      );
      return;
    }
    try {
      setIsSaving(true);
      const fm = form.filterMapping;
      const filterMapping: Record<string, string[]> = {};
      if (fm.detectorTypes.length)
        filterMapping.detectorTypes = fm.detectorTypes;
      if (fm.severities.length) filterMapping.severities = fm.severities;
      if (fm.statuses.length) filterMapping.statuses = fm.statuses;
      if (fm.findingTypes.length) filterMapping.findingTypes = fm.findingTypes;
      if (fm.customDetectorKeys.length)
        filterMapping.customDetectorKeys = fm.customDetectorKeys;

      const created = await semanticApi.glossary.create({
        displayName: form.displayName,
        description: form.description || undefined,
        category: form.category || undefined,
        filterMapping,
        color: form.color || undefined,
        icon: form.icon || undefined,
      });
      setCreatedTermId(created.id);
      toast.success(t("semantic.glossary.created"));
      router.push(`/semantic/glossary/${created.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to create glossary term",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const assistantBridge = useMemo(
    () => ({
      contextKey: "semantic.glossary" as const,
      canOpen: true,
      getContext: async () => {
        const f = formRef.current;
        const v = validate();
        return {
          key: "semantic.glossary" as const,
          route: "/semantic/glossary/new",
          title: "Glossary Assistant",
          entityId: createdTermId,
          values: {
            displayName: f.displayName,
            description: f.description,
            category: f.category,
          },
          schema: null,
          validation: v,
          metadata: {
            displayName: f.displayName,
            description: f.description,
            category: f.category,
            filterMapping: f.filterMapping,
            color: f.color,
            icon: f.icon,
          },
          supportedOperations: [
            "create_glossary_term",
          ] satisfies AssistantOperation[],
        };
      },
      applyAction: async (action: AssistantUiAction) => {
        if (action.type === "patch_fields") {
          applyPatches(action.patches);
          return;
        }
        if (action.type === "sync_glossary_term") {
          setCreatedTermId(action.termId);
          const patches = Object.entries(action.values).map(
            ([path, value]) => ({ path, value }),
          );
          applyPatches(patches);
          toast.success(t("semantic.glossary.createdByAssistant"));
          router.push("/semantic");
        }
        if (action.type === "show_toast") {
          toast[action.tone ?? "info"](action.title, {
            description: action.description,
          });
        }
      },
    }),
    [createdTermId, validate, applyPatches, router],
  );

  useRegisterAssistantBridge(assistantBridge);

  const totalFilters =
    form.filterMapping.detectorTypes.length +
    form.filterMapping.severities.length +
    form.filterMapping.statuses.length +
    form.filterMapping.customDetectorKeys.length;

  return (
    <div className="container max-w-4xl space-y-6 py-8">
      {/* Back + title */}
      <div>
        <Button
          variant="outline"
          onClick={() => router.push("/semantic")}
          className="mb-4 rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("semantic.glossary.backToSemantic")}
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("semantic.glossary.newTitle")}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {t("semantic.glossary.newDescription")}
        </p>
      </div>

      {/* ── Term Details ── */}
      <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
        <CardHeader>
          <CardTitle className="uppercase tracking-[0.06em]">
            {t("semantic.glossary.termDetails")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">
              {t("semantic.glossary.displayName")}
            </Label>
            <Input
              id="displayName"
              placeholder={t("semantic.glossary.displayNamePlaceholder")}
              value={form.displayName}
              onChange={(e) => updateField("displayName", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              {t("semantic.glossary.description")}
            </Label>
            <Textarea
              id="description"
              placeholder={t("semantic.glossary.descriptionPlaceholder")}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("semantic.glossary.category")}</Label>
              <Select
                value={form.category}
                onValueChange={(v) => updateField("category", v)}
              >
                <SelectTrigger>
                  <SelectValue
                    placeholder={t("semantic.glossary.selectCategory")}
                  />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {t(
                        `semantic.categories.${cat}` as Parameters<typeof t>[0],
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="color">{t("semantic.glossary.color")}</Label>
              <Input
                id="color"
                type="color"
                value={form.color || "#3b82f6"}
                onChange={(e) => updateField("color", e.target.value)}
                className="h-10 p-1"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="icon">{t("semantic.glossary.iconLabel")}</Label>
              <Input
                id="icon"
                placeholder={t("semantic.glossary.iconPlaceholder")}
                value={form.icon}
                onChange={(e) => updateField("icon", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Filter Mapping ── */}
      <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="uppercase tracking-[0.06em]">
              {t("semantic.glossary.filterMapping")}
            </CardTitle>
            {totalFilters > 0 && (
              <Badge variant="secondary" className="font-mono text-[10px]">
                {totalFilters} filter{totalFilters !== 1 ? "s" : ""} selected
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            {t("semantic.glossary.filterMappingDesc")}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* ── Detector Types (grouped) ── */}
          <div className="space-y-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              {t("semantic.glossary.detectorTypes")}
            </p>
            {detectorUiGroups.map((group) => {
              const types = DETECTOR_TYPES_BY_GROUP[group.id];
              const selectedInGroup = types.filter((dt) =>
                form.filterMapping.detectorTypes.includes(dt),
              );
              return (
                <div
                  key={group.id}
                  className="rounded-[4px] border-2 border-border p-3"
                >
                  <div className="mb-2 flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">{group.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {group.description}
                      </p>
                    </div>
                    {selectedInGroup.length > 0 && (
                      <Badge
                        variant="default"
                        className="shrink-0 font-mono text-[9px]"
                      >
                        {selectedInGroup.length} selected
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {types.map((dt) => {
                      const isSelected =
                        form.filterMapping.detectorTypes.includes(dt);
                      return (
                        <Badge
                          key={dt}
                          variant={isSelected ? "default" : "outline"}
                          className="cursor-pointer text-[10px] transition-colors"
                          onClick={() => toggleArrayItem("detectorTypes", dt)}
                        >
                          {formatDetectorLabel(dt)}
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Severity ── */}
          <div className="space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              {t("semantic.glossary.severities")}
            </p>
            <div className="flex flex-wrap gap-2">
              {SEVERITIES.map((s) => {
                const isSelected = form.filterMapping.severities.includes(
                  s.value,
                );
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => toggleArrayItem("severities", s.value)}
                    className={cn(
                      "rounded-sm transition-all",
                      isSelected
                        ? "ring-2 ring-foreground ring-offset-1"
                        : "opacity-50 hover:opacity-80",
                    )}
                  >
                    <SeverityBadge severity={s.badgeValue}>
                      {s.label}
                    </SeverityBadge>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Status ── */}
          <div className="space-y-3">
            <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
              {t("semantic.glossary.statuses")}
            </p>
            <div className="flex flex-wrap gap-2">
              {STATUSES.map((s) => {
                const isSelected = form.filterMapping.statuses.includes(
                  s.value,
                );
                return (
                  <button
                    key={s.value}
                    type="button"
                    onClick={() => toggleArrayItem("statuses", s.value)}
                    className={cn(
                      "rounded-sm transition-all",
                      isSelected
                        ? "ring-2 ring-foreground ring-offset-1"
                        : "opacity-50 hover:opacity-80",
                    )}
                  >
                    <StatusBadge status={s.badgeValue} showIcon>
                      {s.label}
                    </StatusBadge>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Custom Detectors ── */}
          {customDetectors.length > 0 && (
            <div className="space-y-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                {t("semantic.glossary.customDetectors")}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {customDetectors.map((cd) => {
                  const key = cd.key;
                  const isSelected =
                    form.filterMapping.customDetectorKeys.includes(key);
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => toggleArrayItem("customDetectorKeys", key)}
                      title={cd.description ?? cd.name}
                      className={cn(
                        "inline-flex flex-col items-start rounded-[4px] border-2 px-2.5 py-1.5 transition-all",
                        isSelected
                          ? "border-foreground bg-foreground text-background"
                          : "border-border bg-background text-foreground hover:border-foreground/50",
                      )}
                    >
                      <span className="text-[11px] font-semibold leading-none">
                        {cd.name}
                      </span>
                      <span
                        className={cn(
                          "mt-0.5 font-mono text-[9px]",
                          isSelected
                            ? "text-background/70"
                            : "text-muted-foreground",
                        )}
                      >
                        {key}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Extra custom detector keys (manual) ── */}
          <div className="space-y-2">
            <Label htmlFor="customDetectorKeys">
              {t("semantic.glossary.additionalKeys")}
              <span className="ml-1 font-normal text-muted-foreground">
                {t("semantic.glossary.commaSeparated")}
              </span>
            </Label>
            <Input
              id="customDetectorKeys"
              placeholder={t("semantic.glossary.keysPlaceholder")}
              value={form.filterMapping.customDetectorKeys
                .filter((k) => !customDetectors.some((cd) => cd.key === k))
                .join(", ")}
              onChange={(e) => {
                const manualKeys = e.target.value
                  .split(",")
                  .map((k) => k.trim())
                  .filter(Boolean);
                const apiKeys = customDetectors
                  .filter((cd) =>
                    form.filterMapping.customDetectorKeys.includes(cd.key),
                  )
                  .map((cd) => cd.key);
                setForm((prev) => ({
                  ...prev,
                  filterMapping: {
                    ...prev.filterMapping,
                    customDetectorKeys: [...apiKeys, ...manualKeys],
                  },
                }));
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Actions */}
      <div className="flex justify-end gap-3">
        <Button
          variant="outline"
          onClick={() => router.push("/semantic")}
          className="rounded-[4px] border-2 border-black"
        >
          {t("common.cancel")}
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={isSaving}
          className="rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
        >
          {isSaving
            ? t("semantic.glossary.creating")
            : t("semantic.glossary.createTerm")}
        </Button>
      </div>
    </div>
  );
}
