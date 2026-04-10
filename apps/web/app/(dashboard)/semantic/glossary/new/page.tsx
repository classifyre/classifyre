"use client";

import { ArrowLeft, Plus, Sparkles, X } from "lucide-react";
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

// ── Auto-detection label suggestions by category ──────────────────────────────

const CATEGORY_LABEL_SUGGESTIONS: Record<string, string[]> = {
  Privacy: [
    "person_name",
    "email_address",
    "phone_number",
    "ssn",
    "date_of_birth",
    "postal_address",
  ],
  Compliance: [
    "contract_id",
    "policy_number",
    "regulatory_reference",
    "license_number",
  ],
  Security: ["api_key", "password_hint", "access_token", "encryption_key"],
  Operations: [
    "order_id",
    "shipment_tracking",
    "employee_id",
    "invoice_number",
    "account_number",
  ],
  Content: ["product_name", "brand_mention", "competitor_name", "campaign_id"],
};

// ── Detector type → group mapping ─────────────────────────────────────────────

const DETECTOR_TYPE_TO_GROUP: Record<string, DetectorUiGroupId> = {
  SECRETS: "secrets_credentials",
  CODE_SECURITY: "secrets_credentials",
  PII: "privacy_pii",
  OCR_PII: "privacy_pii",
  DEID_SCORE: "privacy_pii",
  YARA: "threats_attacks",
  PROMPT_INJECTION: "threats_attacks",
  PHISHING_URL: "threats_attacks",
  TOXIC: "harmful_content",
  NSFW: "harmful_content",
  IMAGE_VIOLENCE: "harmful_content",
  HATE_SPEECH: "harmful_content",
  AI_GENERATED: "harmful_content",
  BIAS: "harmful_content",
  SPAM: "content_quality",
  LANGUAGE: "content_quality",
  PLAGIARISM: "content_quality",
  CONTENT_QUALITY: "content_quality",
  DUPLICATE: "content_quality",
  BROKEN_LINKS: "content_quality",
  DOMAIN_CLASS: "classification",
  CONTENT_TYPE: "classification",
  SENSITIVITY_TIER: "classification",
  JURISDICTION_TAG: "classification",
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

interface RegexPattern {
  id: string;
  name: string;
  pattern: string;
  severity: string;
}

interface AutoDetectState {
  enabled: boolean;
  method: "ENTITY" | "RULESET";
  entityLabels: string[];
  labelInput: string;
  glinerModel: string;
  confidenceThreshold: number;
  regexPatterns: RegexPattern[];
  regexName: string;
  regexPattern: string;
  regexSeverity: string;
}

const initialAutoDetect: AutoDetectState = {
  enabled: false,
  method: "ENTITY",
  entityLabels: [],
  labelInput: "",
  glinerModel: "",
  confidenceThreshold: 0.4,
  regexPatterns: [],
  regexName: "",
  regexPattern: "",
  regexSeverity: "",
};

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
  const [autoDetect, setAutoDetect] = useState<AutoDetectState>(initialAutoDetect);
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

  const autoDetectRef = useRef(autoDetect);
  autoDetectRef.current = autoDetect;

  const validate = useCallback((): {
    isValid: boolean;
    missingFields: string[];
    errors: string[];
  } => {
    const f = formRef.current;
    const ad = autoDetectRef.current;
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
    const hasAutoDetect =
      ad.enabled &&
      ((ad.method === "ENTITY" && ad.entityLabels.length > 0) ||
        (ad.method === "RULESET" && ad.regexPatterns.length > 0));
    if (!hasFilter && !hasAutoDetect)
      errors.push("At least one filter or auto-detection rule must be set");
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

      // Auto-create a custom detector if auto-detection is configured
      let autoDetectorKey: string | null = null;
      const ad = autoDetect;
      const hasAutoDetect =
        ad.enabled &&
        ((ad.method === "ENTITY" && ad.entityLabels.length > 0) ||
          (ad.method === "RULESET" && ad.regexPatterns.length > 0));

      if (hasAutoDetect) {
        const slug = toSlug(form.displayName);
        const detectorConfig: Record<string, unknown> = {
          custom_detector_key: slug,
          name: form.displayName,
          method: ad.method,
          confidence_threshold: ad.confidenceThreshold,
        };
        if (ad.method === "ENTITY") {
          detectorConfig.entity = {
            entity_labels: ad.entityLabels,
            model: ad.glinerModel || "urchade/gliner_multi-v2.1",
          };
        } else {
          detectorConfig.ruleset = {
            regex_rules: ad.regexPatterns.map((r) => ({
              id: r.id,
              name: r.name,
              pattern: r.pattern,
              flags: "i",
              severity: r.severity || null,
            })),
            keyword_rules: [],
          };
        }
        const newDetector = await api.createCustomDetector({
          name: form.displayName,
          key: slug,
          description: form.description || undefined,
          method: ad.method,
          isActive: true,
          config: detectorConfig,
        });
        autoDetectorKey = newDetector.key;
      }

      const fm = form.filterMapping;
      const filterMapping: Record<string, string[]> = {};
      if (fm.detectorTypes.length)
        filterMapping.detectorTypes = fm.detectorTypes;
      if (fm.severities.length) filterMapping.severities = fm.severities;
      if (fm.statuses.length) filterMapping.statuses = fm.statuses;
      if (fm.findingTypes.length) filterMapping.findingTypes = fm.findingTypes;
      const cdKeys = [...fm.customDetectorKeys];
      if (autoDetectorKey && !cdKeys.includes(autoDetectorKey))
        cdKeys.push(autoDetectorKey);
      if (cdKeys.length) filterMapping.customDetectorKeys = cdKeys;

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

      {/* ── Auto-Detection ── */}
      <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="uppercase tracking-[0.06em]">
                Auto-Detection
              </CardTitle>
            </div>
            <button
              type="button"
              onClick={() =>
                setAutoDetect((prev) => ({ ...prev, enabled: !prev.enabled }))
              }
              className={cn(
                "inline-flex h-6 w-11 items-center rounded-full border-2 border-black transition-colors",
                autoDetect.enabled ? "bg-black" : "bg-background",
              )}
            >
              <span
                className={cn(
                  "inline-block h-4 w-4 rounded-full border border-black transition-transform",
                  autoDetect.enabled
                    ? "translate-x-5 bg-white"
                    : "translate-x-0.5 bg-black",
                )}
              />
            </button>
          </div>
          <p className="text-sm text-muted-foreground">
            Automatically detect this concept in scanned assets using GLiNER
            (zero-shot entity extraction) or regex patterns. Creates a linked
            custom detector that runs during scans.
          </p>
        </CardHeader>

        {autoDetect.enabled && (
          <CardContent className="space-y-5">
            {/* Method toggle */}
            <div className="space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                Detection Method
              </p>
              <div className="flex gap-2">
                {(["ENTITY", "RULESET"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() =>
                      setAutoDetect((prev) => ({ ...prev, method: m }))
                    }
                    className={cn(
                      "rounded-[4px] border-2 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors",
                      autoDetect.method === m
                        ? "border-black bg-black text-white"
                        : "border-border bg-background text-foreground hover:border-foreground/50",
                    )}
                  >
                    {m === "ENTITY" ? "Entity / GLiNER" : "Ruleset / Regex"}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-muted-foreground">
                {autoDetect.method === "ENTITY"
                  ? 'GLiNER zero-shot NER — define labels like "customer_name", "invoice_id". No retraining needed.'
                  : "Regex patterns for structured identifiers like employee IDs, contract numbers."}
              </p>
            </div>

            {/* ENTITY method */}
            {autoDetect.method === "ENTITY" && (
              <div className="space-y-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Entity Labels
                </p>

                {/* Existing labels */}
                {autoDetect.entityLabels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {autoDetect.entityLabels.map((label) => (
                      <span
                        key={label}
                        className="inline-flex items-center gap-1 rounded-[4px] border-2 border-black bg-black px-2 py-0.5 font-mono text-[11px] text-white"
                      >
                        {label}
                        <button
                          type="button"
                          onClick={() =>
                            setAutoDetect((prev) => ({
                              ...prev,
                              entityLabels: prev.entityLabels.filter(
                                (l) => l !== label,
                              ),
                            }))
                          }
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                {/* Add label input */}
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. customer_name"
                    value={autoDetect.labelInput}
                    onChange={(e) =>
                      setAutoDetect((prev) => ({
                        ...prev,
                        labelInput: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (
                        (e.key === "Enter" || e.key === ",") &&
                        autoDetect.labelInput.trim()
                      ) {
                        e.preventDefault();
                        const label = autoDetect.labelInput.trim();
                        if (!autoDetect.entityLabels.includes(label)) {
                          setAutoDetect((prev) => ({
                            ...prev,
                            entityLabels: [...prev.entityLabels, label],
                            labelInput: "",
                          }));
                        }
                      }
                    }}
                    className="font-mono text-sm"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0 rounded-[4px] border-2 border-black"
                    onClick={() => {
                      const label = autoDetect.labelInput.trim();
                      if (label && !autoDetect.entityLabels.includes(label)) {
                        setAutoDetect((prev) => ({
                          ...prev,
                          entityLabels: [...prev.entityLabels, label],
                          labelInput: "",
                        }));
                      }
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {/* Category suggestions */}
                {form.category &&
                  CATEGORY_LABEL_SUGGESTIONS[form.category] && (
                    <div>
                      <p className="mb-1.5 font-mono text-[10px] text-muted-foreground">
                        Suggestions for {form.category}:
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {CATEGORY_LABEL_SUGGESTIONS[form.category]!.map(
                          (suggestion) => {
                            const already =
                              autoDetect.entityLabels.includes(suggestion);
                            return (
                              <button
                                key={suggestion}
                                type="button"
                                disabled={already}
                                onClick={() => {
                                  if (!already) {
                                    setAutoDetect((prev) => ({
                                      ...prev,
                                      entityLabels: [
                                        ...prev.entityLabels,
                                        suggestion,
                                      ],
                                    }));
                                  }
                                }}
                                className={cn(
                                  "rounded-[4px] border px-2 py-0.5 font-mono text-[10px] transition-colors",
                                  already
                                    ? "border-border text-muted-foreground/40"
                                    : "border-border text-muted-foreground hover:border-foreground/50 hover:text-foreground",
                                )}
                              >
                                {suggestion}
                              </button>
                            );
                          },
                        )}
                      </div>
                    </div>
                  )}

                {/* GLiNER model override */}
                <div className="space-y-1.5">
                  <Label htmlFor="glinerModel" className="text-[11px]">
                    GLiNER Model{" "}
                    <span className="font-normal text-muted-foreground">
                      (optional override)
                    </span>
                  </Label>
                  <Input
                    id="glinerModel"
                    placeholder="urchade/gliner_multi-v2.1"
                    value={autoDetect.glinerModel}
                    onChange={(e) =>
                      setAutoDetect((prev) => ({
                        ...prev,
                        glinerModel: e.target.value,
                      }))
                    }
                    className="font-mono text-sm"
                  />
                </div>
              </div>
            )}

            {/* RULESET method */}
            {autoDetect.method === "RULESET" && (
              <div className="space-y-3">
                <p className="font-mono text-[11px] uppercase tracking-[0.1em] text-muted-foreground">
                  Regex Patterns
                </p>

                {autoDetect.regexPatterns.length > 0 && (
                  <div className="space-y-1.5">
                    {autoDetect.regexPatterns.map((r) => (
                      <div
                        key={r.id}
                        className="flex items-center gap-2 rounded-[4px] border-2 border-border bg-background px-3 py-2"
                      >
                        <span className="min-w-[100px] text-[11px] font-semibold">
                          {r.name}
                        </span>
                        <code className="flex-1 font-mono text-[11px] text-muted-foreground">
                          {r.pattern}
                        </code>
                        {r.severity && (
                          <Badge variant="outline" className="text-[9px]">
                            {r.severity}
                          </Badge>
                        )}
                        <button
                          type="button"
                          onClick={() =>
                            setAutoDetect((prev) => ({
                              ...prev,
                              regexPatterns: prev.regexPatterns.filter(
                                (p) => p.id !== r.id,
                              ),
                            }))
                          }
                          className="text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add pattern row */}
                <div className="grid grid-cols-[1fr_2fr_auto_auto] gap-2">
                  <Input
                    placeholder="Name"
                    value={autoDetect.regexName}
                    onChange={(e) =>
                      setAutoDetect((prev) => ({
                        ...prev,
                        regexName: e.target.value,
                      }))
                    }
                    className="text-sm"
                  />
                  <Input
                    placeholder="Pattern (e.g. EMP-\d{6})"
                    value={autoDetect.regexPattern}
                    onChange={(e) =>
                      setAutoDetect((prev) => ({
                        ...prev,
                        regexPattern: e.target.value,
                      }))
                    }
                    className="font-mono text-sm"
                  />
                  <Select
                    value={autoDetect.regexSeverity || "__none__"}
                    onValueChange={(v) =>
                      setAutoDetect((prev) => ({
                        ...prev,
                        regexSeverity: v === "__none__" ? "" : v,
                      }))
                    }
                  >
                    <SelectTrigger className="w-28 rounded-[4px] border-2 border-border">
                      <SelectValue placeholder="Severity" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">None</SelectItem>
                      {SEVERITIES.map((s) => (
                        <SelectItem key={s.value} value={s.value}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="rounded-[4px] border-2 border-black"
                    onClick={() => {
                      const name = autoDetect.regexName.trim();
                      const pattern = autoDetect.regexPattern.trim();
                      if (!name || !pattern) return;
                      setAutoDetect((prev) => ({
                        ...prev,
                        regexPatterns: [
                          ...prev.regexPatterns,
                          {
                            id: `${toSlug(name)}-${Date.now()}`,
                            name,
                            pattern,
                            severity: prev.regexSeverity,
                          },
                        ],
                        regexName: "",
                        regexPattern: "",
                        regexSeverity: "",
                      }));
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}

            {/* Confidence threshold (ENTITY only) */}
            {autoDetect.method === "ENTITY" && (
              <div className="space-y-1.5">
                <Label className="text-[11px]">
                  Confidence Threshold{" "}
                  <span className="font-mono text-muted-foreground">
                    {autoDetect.confidenceThreshold.toFixed(2)}
                  </span>
                </Label>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={autoDetect.confidenceThreshold}
                  onChange={(e) =>
                    setAutoDetect((prev) => ({
                      ...prev,
                      confidenceThreshold: parseFloat(e.target.value),
                    }))
                  }
                  className="w-full accent-black"
                />
                <p className="text-[10px] text-muted-foreground">
                  Minimum GLiNER confidence to emit a finding (default 0.40).
                  Lower = more matches, higher = fewer but more accurate.
                </p>
              </div>
            )}
          </CardContent>
        )}
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
