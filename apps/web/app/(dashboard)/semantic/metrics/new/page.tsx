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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import type {
  AssistantOperation,
  AssistantUiAction,
} from "@workspace/api-client";
import { useRegisterAssistantBridge } from "@/components/assistant-workflow-provider";
import { semanticApi, type GlossaryTerm } from "@/lib/semantic-api";
import { toast } from "sonner";
import { useTranslation } from "@/hooks/use-translation";

const METRIC_TYPES = ["SIMPLE", "RATIO", "DERIVED", "TREND"] as const;
const AGGREGATIONS = [
  "COUNT",
  "COUNT_DISTINCT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
] as const;
const DIMENSIONS = [
  "severity",
  "detectorType",
  "status",
  "findingType",
  "category",
  "customDetectorKey",
] as const;
const FORMATS = ["number", "percentage", "duration"] as const;

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

type MetricType = (typeof METRIC_TYPES)[number];

interface MetricFormState {
  displayName: string;
  description: string;
  type: MetricType;
  definition: Record<string, unknown>;
  allowedDimensions: string[];
  glossaryTermId: string;
  format: string;
  unit: string;
  owner: string;
}

const initialState: MetricFormState = {
  displayName: "",
  description: "",
  type: "SIMPLE",
  definition: { aggregation: "COUNT", entity: "finding" },
  allowedDimensions: [],
  glossaryTermId: "",
  format: "number",
  unit: "",
  owner: "",
};

export default function NewMetricPage() {
  const router = useRouter();
  const { t } = useTranslation();
  const [form, setForm] = useState<MetricFormState>(initialState);
  const [isSaving, setIsSaving] = useState(false);
  const [createdMetricId, setCreatedMetricId] = useState<string | null>(null);
  const [glossaryTerms, setGlossaryTerms] = useState<GlossaryTerm[]>([]);
  const formRef = useRef(form);
  formRef.current = form;

  useEffect(() => {
    semanticApi.glossary
      .list()
      .then((res) => setGlossaryTerms(res.items))
      .catch(() => {});
  }, []);

  const updateField = useCallback(
    <K extends keyof MetricFormState>(key: K, value: MetricFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const updateDefinitionField = useCallback((key: string, value: unknown) => {
    setForm((prev) => ({
      ...prev,
      definition: { ...prev.definition, [key]: value },
    }));
  }, []);

  const toggleDimension = useCallback((dim: string) => {
    setForm((prev) => {
      const dims = prev.allowedDimensions.includes(dim)
        ? prev.allowedDimensions.filter((d) => d !== dim)
        : [...prev.allowedDimensions, dim];
      return { ...prev, allowedDimensions: dims };
    });
  }, []);

  const validate = useCallback((): {
    isValid: boolean;
    missingFields: string[];
    errors: string[];
  } => {
    const f = formRef.current;
    const missingFields: string[] = [];
    const errors: string[] = [];
    if (!f.displayName) missingFields.push("displayName");
    if (!f.type) missingFields.push("type");
    if (!f.definition || Object.keys(f.definition).length === 0)
      errors.push("Metric definition is required");
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
          } else if (path === "type" && typeof value === "string") {
            next.type = value as MetricType;
          } else if (
            path === "definition" &&
            typeof value === "object" &&
            value
          ) {
            next.definition = value as Record<string, unknown>;
          } else if (path.startsWith("definition.") && value !== undefined) {
            const subKey = path.replace("definition.", "");
            next.definition = { ...next.definition, [subKey]: value };
          } else if (path === "allowedDimensions" && Array.isArray(value)) {
            next.allowedDimensions = value as string[];
          } else if (path === "glossaryTermId" && typeof value === "string") {
            next.glossaryTermId = value;
          } else if (path === "format" && typeof value === "string") {
            next.format = value;
          } else if (path === "unit" && typeof value === "string") {
            next.unit = value;
          } else if (path === "owner" && typeof value === "string") {
            next.owner = value;
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
      const created = await semanticApi.metrics.create({
        displayName: form.displayName,
        description: form.description || undefined,
        type: form.type,
        definition: form.definition,
        allowedDimensions: form.allowedDimensions.length
          ? form.allowedDimensions
          : undefined,
        glossaryTermId: form.glossaryTermId || undefined,
        format: form.format || undefined,
        unit: form.unit || undefined,
        owner: form.owner || undefined,
      });
      setCreatedMetricId(created.id);
      toast.success(t("semantic.metrics.created"));
      router.push(`/semantic/metrics/${created.id}`);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("semantic.metrics.failedToCreate"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const assistantBridge = useMemo(
    () => ({
      contextKey: "semantic.metrics" as const,
      canOpen: true,
      getContext: async () => {
        const f = formRef.current;
        const v = validate();
        return {
          key: "semantic.metrics" as const,
          route: "/semantic/metrics/new",
          title: "Metrics Assistant",
          entityId: createdMetricId,
          values: {
            displayName: f.displayName,
            description: f.description,
            type: f.type,
          },
          schema: null,
          validation: v,
          metadata: {
            displayName: f.displayName,
            description: f.description,
            type: f.type,
            definition: f.definition,
            allowedDimensions: f.allowedDimensions,
            glossaryTermId: f.glossaryTermId,
            format: f.format,
            unit: f.unit,
            owner: f.owner,
          },
          supportedOperations: [
            "create_metric_definition",
          ] satisfies AssistantOperation[],
        };
      },
      applyAction: async (action: AssistantUiAction) => {
        if (action.type === "patch_fields") {
          applyPatches(action.patches);
          return;
        }
        if (action.type === "sync_metric") {
          setCreatedMetricId(action.metricId);
          const patches = Object.entries(action.values).map(
            ([path, value]) => ({ path, value }),
          );
          applyPatches(patches);
          toast.success(t("semantic.metrics.createdByAssistant"));
          router.push("/semantic");
        }
        if (action.type === "show_toast") {
          toast[action.tone ?? "info"](action.title, {
            description: action.description,
          });
        }
      },
    }),
    [createdMetricId, validate, applyPatches, router],
  );

  useRegisterAssistantBridge(assistantBridge);

  return (
    <div className="container max-w-4xl py-8 space-y-6">
      <div>
        <Button
          variant="outline"
          onClick={() => router.push("/semantic")}
          className="mb-4 rounded-[4px] border-2 border-black shadow-[3px_3px_0_#000]"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {t("semantic.metrics.backToSemantic")}
        </Button>
        <h1 className="font-serif text-3xl font-black uppercase tracking-[0.08em]">
          {t("semantic.metrics.newTitle")}
        </h1>
        <p className="text-muted-foreground mt-2">
          {t("semantic.metrics.newDescription")}
        </p>
      </div>

      <Card className="border-2 border-black rounded-[6px] shadow-[6px_6px_0_#000]">
        <CardHeader>
          <CardTitle className="uppercase tracking-[0.06em]">
            {t("semantic.metrics.metricDetails")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="displayName">
              {t("semantic.metrics.displayName")}
            </Label>
            <Input
              id="displayName"
              placeholder={t("semantic.metrics.displayNamePlaceholder")}
              value={form.displayName}
              onChange={(e) => updateField("displayName", e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              {t("semantic.metrics.description")}
            </Label>
            <Textarea
              id="description"
              placeholder={t("semantic.metrics.descriptionPlaceholder")}
              value={form.description}
              onChange={(e) => updateField("description", e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <Label>{t("semantic.metrics.metricType")}</Label>
              <Select
                value={form.type}
                onValueChange={(v) => {
                  const mtype = v as MetricType;
                  updateField("type", mtype);
                  if (mtype === "SIMPLE") {
                    updateField("definition", {
                      aggregation: "COUNT",
                      entity: "finding",
                    });
                  } else if (mtype === "RATIO") {
                    updateField("definition", {
                      numerator: {
                        aggregation: "COUNT",
                        entity: "finding",
                        filters: {},
                      },
                      denominator: {
                        aggregation: "COUNT",
                        entity: "finding",
                      },
                    });
                  } else if (mtype === "DERIVED") {
                    updateField("definition", { formula: "", inputs: [] });
                  } else if (mtype === "TREND") {
                    updateField("definition", {
                      baseMetricId: "",
                      compareWindow: "7d",
                      currentWindow: "7d",
                    });
                  }
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {METRIC_TYPES.map((mt) => (
                    <SelectItem key={mt} value={mt}>
                      {t(
                        `semantic.metrics.type${mt}` as Parameters<typeof t>[0],
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("semantic.metrics.format")}</Label>
              <Select
                value={form.format}
                onValueChange={(v) => updateField("format", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FORMATS.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="unit">{t("semantic.metrics.unit")}</Label>
              <Input
                id="unit"
                placeholder={t("semantic.metrics.unitPlaceholder")}
                value={form.unit}
                onChange={(e) => updateField("unit", e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{t("semantic.metrics.glossaryTerm")}</Label>
              <Select
                value={form.glossaryTermId}
                onValueChange={(v) =>
                  updateField("glossaryTermId", v === "__none__" ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder={t("semantic.metrics.none")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    {t("semantic.metrics.none")}
                  </SelectItem>
                  {glossaryTerms.map((term) => (
                    <SelectItem key={term.id} value={term.id}>
                      {term.displayName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="owner">{t("semantic.metrics.owner")}</Label>
              <Input
                id="owner"
                placeholder={t("semantic.metrics.ownerPlaceholder")}
                value={form.owner}
                onChange={(e) => updateField("owner", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-2 border-black rounded-[6px] shadow-[6px_6px_0_#000]">
        <CardHeader>
          <CardTitle className="uppercase tracking-[0.06em]">
            {t("semantic.metrics.definition")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {form.type === "SIMPLE" && t("semantic.metrics.configHelp")}
            {form.type === "RATIO" && t("semantic.metrics.ratioHelp")}
            {form.type === "DERIVED" && t("semantic.metrics.derivedHelp")}
            {form.type === "TREND" && t("semantic.metrics.trendHelp")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {form.type === "SIMPLE" && (
            <SimpleDefinitionFields
              definition={form.definition}
              onChange={updateDefinitionField}
            />
          )}
          {form.type === "RATIO" && (
            <RatioDefinitionFields
              definition={form.definition}
              onChange={(def) => updateField("definition", def)}
            />
          )}
          {form.type === "DERIVED" && (
            <DerivedDefinitionFields
              definition={form.definition}
              onChange={updateDefinitionField}
            />
          )}
          {form.type === "TREND" && (
            <TrendDefinitionFields
              definition={form.definition}
              onChange={updateDefinitionField}
            />
          )}
        </CardContent>
      </Card>

      <Card className="border-2 border-black rounded-[6px] shadow-[6px_6px_0_#000]">
        <CardHeader>
          <CardTitle className="uppercase tracking-[0.06em]">
            {t("semantic.metrics.allowedDimensions")}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {t("semantic.metrics.allowedDimensionsDesc")}
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-1.5">
            {DIMENSIONS.map((dim) => (
              <Badge
                key={dim}
                variant={
                  form.allowedDimensions.includes(dim) ? "default" : "outline"
                }
                className="cursor-pointer text-[10px] transition-colors"
                onClick={() => toggleDimension(dim)}
              >
                {dim}
              </Badge>
            ))}
          </div>
        </CardContent>
      </Card>

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
            ? t("semantic.metrics.creating")
            : t("semantic.metrics.createMetric")}
        </Button>
      </div>
    </div>
  );
}

function SimpleDefinitionFields({
  definition,
  onChange,
}: {
  definition: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label>Aggregation</Label>
        <Select
          value={(definition.aggregation as string) || "COUNT"}
          onValueChange={(v) => onChange("aggregation", v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {AGGREGATIONS.map((a) => (
              <SelectItem key={a} value={a}>
                {a}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <Label>Entity</Label>
        <Select
          value={(definition.entity as string) || "finding"}
          onValueChange={(v) => onChange("entity", v)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="finding">Finding</SelectItem>
            <SelectItem value="asset">Asset</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {["AVG", "SUM", "MIN", "MAX", "COUNT_DISTINCT"].includes(
        definition.aggregation as string,
      ) && (
        <div className="space-y-2">
          <Label htmlFor="field">Field</Label>
          <Input
            id="field"
            placeholder="e.g. confidence"
            value={(definition.field as string) || ""}
            onChange={(e) => onChange("field", e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

function RatioDefinitionFields({
  definition,
  onChange,
}: {
  definition: Record<string, unknown>;
  onChange: (def: Record<string, unknown>) => void;
}) {
  const numerator = (definition.numerator as Record<string, unknown>) || {
    aggregation: "COUNT",
    entity: "finding",
    filters: {},
  };
  const denominator = (definition.denominator as Record<string, unknown>) || {
    aggregation: "COUNT",
    entity: "finding",
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Numerator
        </Label>
        <div className="mt-2 grid grid-cols-1 gap-3 rounded border p-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Aggregation</Label>
            <Select
              value={(numerator.aggregation as string) || "COUNT"}
              onValueChange={(v) =>
                onChange({
                  ...definition,
                  numerator: { ...numerator, aggregation: v },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Status Filter (comma-sep)</Label>
            <Input
              placeholder="e.g. FALSE_POSITIVE"
              value={
                (
                  (numerator.filters as Record<string, string[]>)?.statuses ||
                  []
                ).join(", ") || ""
              }
              onChange={(e) => {
                const statuses = e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                onChange({
                  ...definition,
                  numerator: {
                    ...numerator,
                    filters: {
                      ...((numerator.filters as Record<string, unknown>) || {}),
                      statuses,
                    },
                  },
                });
              }}
            />
          </div>
        </div>
      </div>
      <div>
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Denominator
        </Label>
        <div className="mt-2 grid grid-cols-1 gap-3 rounded border p-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-xs">Aggregation</Label>
            <Select
              value={(denominator.aggregation as string) || "COUNT"}
              onValueChange={(v) =>
                onChange({
                  ...definition,
                  denominator: { ...denominator, aggregation: v },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AGGREGATIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Entity</Label>
            <Select
              value={(denominator.entity as string) || "finding"}
              onValueChange={(v) =>
                onChange({
                  ...definition,
                  denominator: { ...denominator, entity: v },
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="finding">Finding</SelectItem>
                <SelectItem value="asset">Asset</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  );
}

function DerivedDefinitionFields({
  definition,
  onChange,
}: {
  definition: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="formula">Formula</Label>
        <Input
          id="formula"
          placeholder="e.g. open_findings * 100 / total_findings"
          value={(definition.formula as string) || ""}
          onChange={(e) => onChange("formula", e.target.value)}
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="inputs">Input Metric Slugs (comma-separated)</Label>
        <Input
          id="inputs"
          placeholder="e.g. open-findings, total-findings"
          value={((definition.inputs as string[]) || []).join(", ")}
          onChange={(e) =>
            onChange(
              "inputs",
              e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean),
            )
          }
          className="font-mono text-sm"
        />
      </div>
    </div>
  );
}

function TrendDefinitionFields({
  definition,
  onChange,
}: {
  definition: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="space-y-2">
        <Label htmlFor="baseMetricId">Base Metric ID</Label>
        <Input
          id="baseMetricId"
          placeholder="Paste metric UUID"
          value={(definition.baseMetricId as string) || ""}
          onChange={(e) => onChange("baseMetricId", e.target.value)}
          className="font-mono text-sm"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="currentWindow">Current Window</Label>
        <Input
          id="currentWindow"
          placeholder="e.g. 7d"
          value={(definition.currentWindow as string) || "7d"}
          onChange={(e) => onChange("currentWindow", e.target.value)}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="compareWindow">Compare Window</Label>
        <Input
          id="compareWindow"
          placeholder="e.g. 7d"
          value={(definition.compareWindow as string) || "7d"}
          onChange={(e) => onChange("compareWindow", e.target.value)}
        />
      </div>
    </div>
  );
}
