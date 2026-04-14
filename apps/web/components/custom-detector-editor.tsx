"use client";

import * as React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Ajv, { type ErrorObject } from "ajv";
import type { JSONSchema7 } from "json-schema";
import {
  FileText,
  Loader2,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  api,
  type CustomDetectorExampleDto,
  type CustomDetectorMethod,
  type CustomDetectorResponseDto,
} from "@workspace/api-client";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@workspace/ui/components/alert";
import { Badge } from "@workspace/ui/components/badge";
import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { cn } from "@workspace/ui/lib/utils";
import { toast } from "sonner";
import { getDetectorSchemas } from "@/lib/detector-schema-loader";
import { setValueAtPath } from "@/lib/assistant-form-utils";
import { CustomDetectorTests } from "@/components/custom-detector-tests";
import {
  HorizontalCustomDetectorStepperNav,
  VerticalCustomDetectorStepperNav,
  type CustomDetectorStepId,
} from "@/components/custom-detector-stepper";

export type CustomDetectorEditorSubmit = {
  name: string;
  key: string;
  description?: string;
  method: CustomDetectorMethod;
  isActive: boolean;
  config: Record<string, unknown>;
};

export type CustomDetectorEditorInitialValue = {
  id?: string;
  name?: string;
  key?: string;
  description?: string | null;
  method?: CustomDetectorMethod;
  isActive?: boolean;
  config?: Record<string, unknown>;
};

type CustomDetectorEditorProps = {
  mode: "create" | "edit";
  initialValue?: CustomDetectorEditorInitialValue;
  submitLabel: string;
  isSubmitting?: boolean;
  onSubmit: (payload: CustomDetectorEditorSubmit) => Promise<void> | void;
};

export type CustomDetectorEditorHandle = {
  getAssistantSnapshot: () => {
    name: string;
    key: string;
    description: string;
    method: CustomDetectorMethod;
    isActive: boolean;
    config: Record<string, unknown>;
    editorMode: EditorMode;
    validationErrors: string[];
  };
  applyPatches: (patches: Array<{ path: string; value: unknown }>) => void;
  validate: () => {
    isValid: boolean;
    missingFields: string[];
    errors: string[];
  };
};

type StarterOption = {
  id: string;
  name: string;
  description: string;
  method: CustomDetectorMethod;
  config: Record<string, unknown>;
  isBlank?: boolean;
};

type StepDefinition = {
  id: "method" | "policy" | "tests";
  title: string;
  description: string;
};

type EditorMode = "builder" | "json";

type EditorDrafts = {
  keywordText: string;
  regexText: string;
  labelsText: string;
  trainingExamplesText: string;
  entityLabelsText: string;
  languagesText: string;
  extractorFieldsText: string;
  extractorContentLimit: string;
};

const METHOD_ORDER: CustomDetectorMethod[] = [
  "RULESET",
  "CLASSIFIER",
  "ENTITY",
];
const DETECTOR_KEY_PATTERN = /^[a-z0-9_-]+$/;
const SEVERITY_OPTIONS = ["critical", "high", "medium", "low", "info"] as const;
const EXTRACTOR_FIELD_TYPE_OPTIONS = [
  "string",
  "number",
  "boolean",
  "list[string]",
  "list[number]",
] as const;

const METHOD_META: Record<
  CustomDetectorMethod,
  { label: string; description: string }
> = {
  RULESET: {
    label: "Rulesets",
    description: "Regex and keyword logic for deterministic pattern matching.",
  },
  CLASSIFIER: {
    label: "Classifiers",
    description: "Label-based text classification with training examples.",
  },
  ENTITY: {
    label: "Entity",
    description: "Named entity extraction with custom label vocabularies.",
  },
};

const WIZARD_STEPS: StepDefinition[] = [
  {
    id: "method",
    title: "Method setup",
    description: "Configure method-specific logic and detector identity.",
  },
  {
    id: "policy",
    title: "Pattern & severity",
    description: "Tune severity, confidence, and language coverage.",
  },
  {
    id: "tests",
    title: "Test scenarios",
    description: "Verify your detector works correctly.",
  },
];

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function defaultConfig(
  method: CustomDetectorMethod = "RULESET",
): Record<string, unknown> {
  return {
    custom_detector_key: "cust_detector",
    name: "Custom Detector",
    description: "",
    method,
    languages: ["de", "en"],
    confidence_threshold: 0.7,
    max_findings: 100,
    severity_threshold: "medium",
    ruleset: {
      regex_rules: [],
      keyword_rules: [],
    },
    classifier: {
      labels: [],
      zero_shot_model: "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
      hypothesis_template: "This text contains {}.",
      training_examples: [],
      min_examples_per_label: 8,
      setfit_model:
        "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
    },
    entity: {
      entity_labels: [],
      model: "urchade/gliner_multi-v2.1",
    },
  };
}

function normalizeMethod(value: unknown): CustomDetectorMethod {
  if (value === "RULESET" || value === "CLASSIFIER" || value === "ENTITY") {
    return value;
  }
  return "RULESET";
}

function normalizeSeverity(
  value: unknown,
): (typeof SEVERITY_OPTIONS)[number] | null {
  if (
    value === "critical" ||
    value === "high" ||
    value === "medium" ||
    value === "low" ||
    value === "info"
  ) {
    return value;
  }
  return null;
}

function normalizeName(value: unknown): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "Custom Detector";
}

function normalizeKey(value: unknown, fallbackName: string): string {
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }

  const generated = fallbackName
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return generated ? `cust_${generated}` : "cust_detector";
}

function resolveDescription(input: unknown): string {
  if (typeof input === "string") {
    return input;
  }
  return "";
}

function mergeConfigWithDefaults(
  input: Record<string, unknown>,
  fallbackMethod: CustomDetectorMethod,
): Record<string, unknown> {
  const method = normalizeMethod(input.method ?? fallbackMethod);
  const defaults = defaultConfig(method);
  const rulesetDefaults = asRecord(defaults.ruleset);
  const classifierDefaults = asRecord(defaults.classifier);
  const entityDefaults = asRecord(defaults.entity);

  return {
    ...defaults,
    ...input,
    method,
    ruleset: {
      ...rulesetDefaults,
      ...asRecord(input.ruleset),
    },
    classifier: {
      ...classifierDefaults,
      ...asRecord(input.classifier),
    },
    entity: {
      ...entityDefaults,
      ...asRecord(input.entity),
    },
  };
}

function toEditorState(initialValue?: CustomDetectorEditorInitialValue) {
  const method = normalizeMethod(initialValue?.method);
  const rawConfig = asRecord(initialValue?.config ?? defaultConfig(method));
  const mergedInitialConfig = mergeConfigWithDefaults(rawConfig, method);
  const name = normalizeName(initialValue?.name ?? mergedInitialConfig.name);
  const key = normalizeKey(
    initialValue?.key ?? mergedInitialConfig.custom_detector_key,
    name,
  );
  const description =
    initialValue?.description ??
    resolveDescription(mergedInitialConfig.description);
  const resolvedMethod = normalizeMethod(
    initialValue?.method ?? mergedInitialConfig.method,
  );

  const config: Record<string, unknown> = {
    ...mergedInitialConfig,
    name,
    custom_detector_key: key,
    method: resolvedMethod,
    description,
  };

  return {
    name,
    key,
    description,
    method: resolvedMethod,
    isActive: initialValue?.isActive ?? true,
    config,
  };
}

function formatAjvErrors(errors: ErrorObject[] | null | undefined): string[] {
  if (!errors || errors.length === 0) {
    return [];
  }

  return errors.slice(0, 8).map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message ?? "is invalid"}`;
  });
}

function parseCommaSeparated(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseMultiLine(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function serializeKeywordText(ruleSet: Record<string, unknown>): string {
  const keywordRules = Array.isArray(ruleSet.keyword_rules)
    ? ruleSet.keyword_rules.map((item) => asRecord(item))
    : [];
  const primary = keywordRules[0];
  if (!primary) {
    return "";
  }
  const keywords = Array.isArray(primary.keywords) ? primary.keywords : [];
  return keywords.map((item) => String(item)).join(", ");
}

function serializeRegexText(ruleSet: Record<string, unknown>): string {
  const regexRules = Array.isArray(ruleSet.regex_rules)
    ? ruleSet.regex_rules.map((item) => asRecord(item))
    : [];
  return regexRules
    .map((rule) => String(rule.pattern ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function serializeLabelsText(classifier: Record<string, unknown>): string {
  const labels = Array.isArray(classifier.labels)
    ? classifier.labels.map((item) => asRecord(item))
    : [];
  return labels
    .map((labelItem) => String(labelItem.name ?? ""))
    .filter(Boolean)
    .join("\n");
}

function serializeTrainingExamplesText(
  classifier: Record<string, unknown>,
): string {
  const trainingExamples = Array.isArray(classifier.training_examples)
    ? classifier.training_examples.map((item) => asRecord(item))
    : [];
  return trainingExamples
    .map(
      (example) =>
        `${String(example.label ?? "")}|${String(example.text ?? "")}`,
    )
    .join("\n");
}

function dedupeTrainingExamples(
  examples: Record<string, unknown>[],
): Record<string, unknown>[] {
  const seen = new Set<string>();
  const deduped: Record<string, unknown>[] = [];

  for (const example of examples) {
    const label = String(example.label ?? "").trim();
    const text = String(example.text ?? "").trim();
    if (!label || !text) {
      continue;
    }
    const key = `${label.toLowerCase()}\u0000${text.toLowerCase()}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push({
      ...example,
      label,
      text,
      accepted: example.accepted !== false,
      source: String(example.source ?? "editor"),
    });
  }

  return deduped;
}

function serializeEntityLabelsText(entity: Record<string, unknown>): string {
  return Array.isArray(entity.entity_labels)
    ? entity.entity_labels.map((item) => String(item)).join(", ")
    : "";
}

function serializeLanguagesText(config: Record<string, unknown>): string {
  return Array.isArray(config.languages)
    ? config.languages.join(", ")
    : "de, en";
}

function serializeExtractorFieldsText(
  extractor: Record<string, unknown>,
): string {
  const extractorFields = Array.isArray(extractor.fields)
    ? extractor.fields.map((item) => asRecord(item))
    : [];
  return extractorFields
    .map((field) => {
      const namePart = String(field.name ?? "").trim();
      const typePart =
        typeof field.type === "string" && field.type.trim().length > 0
          ? field.type.trim()
          : "string";
      const labelPart =
        typeof field.entity_label === "string" ? field.entity_label.trim() : "";
      const regexPart =
        typeof field.regex_pattern === "string"
          ? field.regex_pattern.trim()
          : "";
      const requiredPart = field.required === true ? "required" : "optional";
      if (!namePart) {
        return "";
      }
      return `${namePart}|${typePart}|${labelPart}|${regexPart}|${requiredPart}`;
    })
    .filter(Boolean)
    .join("\n");
}

function resolveExtractorContentLimit(
  extractor: Record<string, unknown>,
): number {
  return typeof extractor.content_limit === "number"
    ? extractor.content_limit
    : 4000;
}

function buildEditorDrafts(config: Record<string, unknown>): EditorDrafts {
  const ruleSet = asRecord(config.ruleset);
  const classifier = asRecord(config.classifier);
  const entity = asRecord(config.entity);
  const extractor = asRecord(config.extractor);

  return {
    keywordText: serializeKeywordText(ruleSet),
    regexText: serializeRegexText(ruleSet),
    labelsText: serializeLabelsText(classifier),
    trainingExamplesText: serializeTrainingExamplesText(classifier),
    entityLabelsText: serializeEntityLabelsText(entity),
    languagesText: serializeLanguagesText(config),
    extractorFieldsText: serializeExtractorFieldsText(extractor),
    extractorContentLimit: String(resolveExtractorContentLimit(extractor)),
  };
}

function parseTrainingExamplesDraft(value: string): Record<string, unknown>[] {
  const parsed: Record<string, unknown>[] = [];

  for (const line of parseMultiLine(value)) {
    const [rawLabel, ...textParts] = line.split("|");
    const label = (rawLabel ?? "").trim();
    const text = textParts.join("|").trim();
    if (!label || !text) {
      continue;
    }

    parsed.push({
      label,
      text,
      accepted: true,
      source: "editor",
    });
  }

  return parsed;
}

function parseExtractorFieldsDraft(value: string): Record<string, unknown>[] {
  return parseMultiLine(value)
    .map((line) => {
      const [rawName, rawType, rawEntityLabel, rawRegexPattern, rawRequired] =
        line.split("|");
      const namePart = String(rawName ?? "").trim();
      if (!namePart) {
        return null;
      }

      const typePart = String(rawType ?? "").trim();
      const resolvedType = EXTRACTOR_FIELD_TYPE_OPTIONS.includes(
        typePart as (typeof EXTRACTOR_FIELD_TYPE_OPTIONS)[number],
      )
        ? typePart
        : "string";
      const entityLabel = String(rawEntityLabel ?? "").trim();
      const regexPattern = String(rawRegexPattern ?? "").trim();
      const requiredFlag =
        String(rawRequired ?? "")
          .trim()
          .toLowerCase() === "required";

      const field: Record<string, unknown> = {
        name: namePart,
        type: resolvedType,
        required: requiredFlag,
      };

      if (entityLabel) {
        field.entity_label = entityLabel;
      }
      if (regexPattern) {
        field.regex_pattern = regexPattern;
      }

      return field;
    })
    .filter((field): field is Record<string, unknown> => field !== null);
}

function StarterCard({
  title,
  description,
  badge,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  badge: React.ReactNode;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group cursor-pointer text-left border-2 border-black rounded-[6px] bg-background p-4 shadow-[4px_4px_0_#000] transition-all",
        "hover:-translate-x-[1px] hover:-translate-y-[1px] hover:shadow-[5px_5px_0_#000]",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="inline-flex h-8 w-8 items-center justify-center rounded-[4px] border-2 border-black bg-card">
          {icon}
        </div>
        {badge}
      </div>
      <div className="mt-3">
        <div className="text-sm font-semibold">{title}</div>
        <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {description}
        </div>
      </div>
    </button>
  );
}

export const CustomDetectorEditor = React.forwardRef<
  CustomDetectorEditorHandle,
  CustomDetectorEditorProps
>(function CustomDetectorEditor(
  { mode, initialValue, submitLabel, isSubmitting = false, onSubmit },
  ref,
) {
  const [examples, setExamples] = useState<CustomDetectorExampleDto[]>([]);
  const [existingDetectors, setExistingDetectors] = useState<
    CustomDetectorResponseDto[]
  >([]);
  const [isLoadingExistingDetectors, setIsLoadingExistingDetectors] =
    useState(true);
  const [existingDetectorsError, setExistingDetectorsError] = useState<
    string | null
  >(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeStepId, setActiveStepId] =
    useState<CustomDetectorStepId>("method");
  const [starterName, setStarterName] = useState<string | null>(
    mode === "edit" ? "Current detector" : null,
  );
  const [hasSelectedStarter, setHasSelectedStarter] = useState(mode === "edit");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [hasAttemptedMethodStepAdvance, setHasAttemptedMethodStepAdvance] =
    useState(false);
  const [editorMode, setEditorMode] = useState<EditorMode>("builder");
  const [jsonDraft, setJsonDraft] = useState(() =>
    JSON.stringify(defaultConfig("RULESET"), null, 2),
  );
  const [jsonError, setJsonError] = useState<string | null>(null);
  const trainingFileInputRef = React.useRef<HTMLInputElement | null>(null);
  const [isUploadingTrainingFile, setIsUploadingTrainingFile] = useState(false);

  const [name, setName] = useState("Custom Detector");
  const [key, setKey] = useState("cust_detector");
  const [description, setDescription] = useState("");
  const [method, setMethod] = useState<CustomDetectorMethod>("RULESET");
  const [isActive, setIsActive] = useState(true);
  const [configDraft, setConfigDraft] = useState<Record<string, unknown>>(
    defaultConfig("RULESET"),
  );
  const [editorDrafts, setEditorDrafts] = useState<EditorDrafts>(() =>
    buildEditorDrafts(defaultConfig("RULESET")),
  );

  useEffect(() => {
    const next = toEditorState(initialValue);
    setName(next.name);
    setKey(next.key);
    setDescription(next.description);
    setMethod(next.method);
    setIsActive(next.isActive);
    setConfigDraft(next.config);
    setEditorDrafts(buildEditorDrafts(next.config));
    setHasSelectedStarter(mode === "edit");
    setStarterName(mode === "edit" ? "Current detector" : null);
    setActiveStepId("method");
    setValidationErrors([]);
    setHasAttemptedMethodStepAdvance(false);
    setEditorMode("builder");
    setJsonDraft(JSON.stringify(next.config, null, 2));
    setJsonError(null);
  }, [initialValue, mode]);

  const customSchema = useMemo(() => {
    const detectorSchema = getDetectorSchemas({ includeCustom: true }).find(
      (entry) => entry.type === "CUSTOM",
    );
    return (detectorSchema?.schema ?? null) as JSONSchema7 | null;
  }, []);

  const validator = useMemo(() => {
    if (!customSchema) {
      return null;
    }
    const ajv = new Ajv({ allErrors: true, strict: false });
    return ajv.compile(customSchema as object);
  }, [customSchema]);

  useEffect(() => {
    let cancelled = false;

    async function loadExamples() {
      try {
        const payload = await api.listCustomDetectorExamples();
        if (!cancelled) {
          setExamples(payload ?? []);
        }
      } catch {
        if (!cancelled) {
          setExamples([]);
        }
      }
    }

    if (mode === "create") {
      void loadExamples();
    }

    return () => {
      cancelled = true;
    };
  }, [mode]);

  useEffect(() => {
    let cancelled = false;

    async function loadExistingDetectors() {
      try {
        setIsLoadingExistingDetectors(true);
        setExistingDetectorsError(null);
        const payload = await api.listCustomDetectors({
          includeInactive: true,
        });
        if (!cancelled) {
          setExistingDetectors(payload ?? []);
        }
      } catch (error) {
        if (!cancelled) {
          setExistingDetectors([]);
          setExistingDetectorsError(
            error instanceof Error
              ? error.message
              : "Failed to load existing detectors",
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingExistingDetectors(false);
        }
      }
    }

    void loadExistingDetectors();

    return () => {
      cancelled = true;
    };
  }, []);

  const validateConfig = (config: Record<string, unknown>): boolean => {
    if (!validator) {
      setValidationErrors([]);
      return true;
    }

    const valid = validator(config);
    if (!valid) {
      setValidationErrors(formatAjvErrors(validator.errors));
      return false;
    }

    setValidationErrors([]);
    return true;
  };

  const syncDraftFromConfig = (
    nextConfig: Record<string, unknown>,
    options?: { syncEditorDrafts?: boolean },
  ) => {
    const mergedFromDefaults = mergeConfigWithDefaults(
      nextConfig,
      normalizeMethod(nextConfig.method ?? method),
    );
    const nextMethod = normalizeMethod(mergedFromDefaults.method);
    const nextName = normalizeName(mergedFromDefaults.name);
    const nextKey = normalizeKey(
      mergedFromDefaults.custom_detector_key,
      nextName,
    );
    const nextDescription = resolveDescription(mergedFromDefaults.description);

    const mergedConfig: Record<string, unknown> = {
      ...mergedFromDefaults,
      name: nextName,
      custom_detector_key: nextKey,
      method: nextMethod,
      description: nextDescription,
    };

    setName(nextName);
    setMethod(nextMethod);
    setKey(nextKey);
    setDescription(nextDescription);
    setConfigDraft(mergedConfig);
    setJsonDraft(JSON.stringify(mergedConfig, null, 2));
    setJsonError(null);
    if (options?.syncEditorDrafts) {
      setEditorDrafts(buildEditorDrafts(mergedConfig));
    }
    validateConfig(mergedConfig);
  };

  const updateMeta = (next: {
    name?: string;
    key?: string;
    description?: string;
    method?: CustomDetectorMethod;
    isActive?: boolean;
  }) => {
    const nextName = next.name ?? name;
    const nextMethod = next.method ?? method;
    const nextDescription = next.description ?? description;
    const nextKey = next.key ?? key;

    setName(nextName);
    setMethod(nextMethod);
    setDescription(nextDescription);
    setKey(nextKey);
    if (typeof next.isActive === "boolean") {
      setIsActive(next.isActive);
    }

    const nextConfig = mergeConfigWithDefaults(
      {
        ...configDraft,
        name: nextName,
        custom_detector_key: nextKey,
        method: nextMethod,
        description: nextDescription,
      },
      nextMethod,
    );
    setConfigDraft(nextConfig);
    validateConfig(nextConfig);
  };

  const filteredStartersByMethod = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();
    const grouped = new Map<CustomDetectorMethod, StarterOption[]>();

    for (const methodType of METHOD_ORDER) {
      const starters: StarterOption[] = [
        {
          id: `${methodType}-blank`,
          name: "Start Blank",
          description: `Begin with an empty ${METHOD_META[methodType].label.toLowerCase()} detector.`,
          method: methodType,
          config: defaultConfig(methodType),
          isBlank: true,
        },
      ];

      for (const example of examples) {
        if (example.method !== methodType) {
          continue;
        }

        const searchable =
          `${example.name} ${example.description} ${example.method}`.toLowerCase();
        if (normalizedSearch && !searchable.includes(normalizedSearch)) {
          continue;
        }

        starters.push({
          id: `${methodType}-${example.name}-${searchable.length}`,
          name: example.name,
          description: example.description || "Suggested starter configuration",
          method: example.method,
          config: asRecord(example.config),
        });
      }

      if (normalizedSearch) {
        if (starters.length > 1) {
          grouped.set(methodType, starters);
        }
      } else {
        grouped.set(methodType, starters);
      }
    }

    return grouped;
  }, [examples, searchQuery]);

  const ruleSet = useMemo(
    () => asRecord(configDraft.ruleset),
    [configDraft.ruleset],
  );
  const classifier = useMemo(
    () => asRecord(configDraft.classifier),
    [configDraft.classifier],
  );
  const entity = useMemo(
    () => asRecord(configDraft.entity),
    [configDraft.entity],
  );
  const extractor = useMemo(
    () => asRecord(configDraft.extractor),
    [configDraft.extractor],
  );

  const keywordRules = useMemo(
    () =>
      Array.isArray(ruleSet.keyword_rules)
        ? ruleSet.keyword_rules.map((item) => asRecord(item))
        : [],
    [ruleSet.keyword_rules],
  );
  const regexRules = useMemo(
    () =>
      Array.isArray(ruleSet.regex_rules)
        ? ruleSet.regex_rules.map((item) => asRecord(item))
        : [],
    [ruleSet.regex_rules],
  );

  const keywordText = editorDrafts.keywordText;
  const regexText = editorDrafts.regexText;

  const keywordSeverity =
    normalizeSeverity(keywordRules[0]?.severity) ?? "medium";
  const regexSeverity = normalizeSeverity(regexRules[0]?.severity) ?? "medium";
  const keywordCaseSensitive = Boolean(keywordRules[0]?.case_sensitive);
  const regexFlags =
    typeof regexRules[0]?.flags === "string" ? regexRules[0].flags : "i";

  const labelsText = editorDrafts.labelsText;
  const trainingExamplesText = editorDrafts.trainingExamplesText;
  const entityLabelsText = editorDrafts.entityLabelsText;

  const extractorEnabled =
    typeof extractor.enabled === "boolean"
      ? extractor.enabled
      : Object.keys(extractor).length > 0;
  const extractorFields = useMemo(
    () =>
      Array.isArray(extractor.fields)
        ? extractor.fields.map((item) => asRecord(item))
        : [],
    [extractor.fields],
  );
  const extractorFieldsText = editorDrafts.extractorFieldsText;
  const trimmedName = name.trim();
  const trimmedKey = key.trim();
  const normalizedDraftKey = trimmedKey.toLowerCase();
  const normalizedInitialKey =
    typeof initialValue?.key === "string"
      ? initialValue.key.trim().toLowerCase()
      : "";
  const currentDetectorId = initialValue?.id ?? null;

  const nameError = trimmedName.length === 0 ? "Name is required." : null;
  const keyFormatError =
    trimmedKey.length === 0
      ? "Key is required."
      : DETECTOR_KEY_PATTERN.test(trimmedKey)
        ? null
        : "Use lowercase letters, numbers, underscores, or hyphens only.";
  const requiresUniqueKeyCheck =
    keyFormatError === null && normalizedDraftKey !== normalizedInitialKey;
  const hasDuplicateKey = existingDetectors.some(
    (detector) =>
      detector.id !== currentDetectorId &&
      detector.key.trim().toLowerCase() === normalizedDraftKey,
  );

  const rulesetHasPatterns = keywordRules.length > 0 || regexRules.length > 0;
  const classifierLabels = Array.isArray(classifier.labels)
    ? classifier.labels.map((item) => asRecord(item))
    : [];
  const entityLabels = Array.isArray(entity.entity_labels)
    ? entity.entity_labels.filter(
        (item): item is string => typeof item === "string",
      )
    : [];
  const methodConfigError =
    method === "RULESET"
      ? rulesetHasPatterns
        ? null
        : "Add at least one keyword or regex rule before continuing."
      : method === "CLASSIFIER"
        ? classifierLabels.length > 0
          ? null
          : "Add at least one classifier label before continuing."
        : entityLabels.length > 0
          ? null
          : "Add at least one entity label before continuing.";

  const keyAvailabilityError =
    keyFormatError !== null
      ? null
      : isLoadingExistingDetectors && requiresUniqueKeyCheck
        ? "Checking whether this key is already in use..."
        : existingDetectorsError && requiresUniqueKeyCheck
          ? "Unable to validate key uniqueness right now."
          : hasDuplicateKey
            ? "This key is already used by another custom detector."
            : null;

  const updateConfig = (nextConfig: Record<string, unknown>) => {
    syncDraftFromConfig(nextConfig);
  };

  const updateRuleSet = (nextRuleSet: Record<string, unknown>) => {
    updateConfig({
      ...configDraft,
      ruleset: nextRuleSet,
    });
  };

  const updateClassifier = (nextClassifier: Record<string, unknown>) => {
    updateConfig({
      ...configDraft,
      classifier: nextClassifier,
    });
  };

  const handleTrainingExamplesFileUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }

    setIsUploadingTrainingFile(true);
    try {
      const parsed = await api.parseCustomDetectorTrainingExamples(
        file,
        file.name,
      );
      const existingExamples = Array.isArray(classifier.training_examples)
        ? classifier.training_examples.map((entry) => asRecord(entry))
        : [];
      const uploadedExamples = parsed.examples.map((entry) => ({
        label: entry.label,
        text: entry.text,
        accepted: true,
        source: "upload",
      }));
      const mergedExamples = dedupeTrainingExamples([
        ...existingExamples,
        ...uploadedExamples,
      ]);
      const mergedText = mergedExamples
        .map(
          (example) =>
            `${String(example.label ?? "")}|${String(example.text ?? "")}`,
        )
        .join("\n");

      setEditorDrafts((current) => ({
        ...current,
        trainingExamplesText: mergedText,
      }));
      updateClassifier({
        ...classifier,
        training_examples: mergedExamples,
      });

      const skippedMessage =
        parsed.skippedRows > 0 ? ` (${parsed.skippedRows} skipped)` : "";
      toast.success(
        `Imported ${parsed.importedRows} example${parsed.importedRows === 1 ? "" : "s"} from ${file.name}${skippedMessage}`,
      );
      if (parsed.warnings.length > 0) {
        toast(parsed.warnings[0]);
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to parse training examples file",
      );
    } finally {
      setIsUploadingTrainingFile(false);
    }
  };

  const updateEntity = (nextEntity: Record<string, unknown>) => {
    updateConfig({
      ...configDraft,
      entity: nextEntity,
    });
  };

  const updateExtractor = (nextExtractor: Record<string, unknown> | null) => {
    if (!nextExtractor) {
      const { extractor: _dropExtractor, ...rest } = configDraft;
      updateConfig(rest);
      return;
    }

    updateConfig({
      ...configDraft,
      extractor: nextExtractor,
    });
  };

  const beginFromStarter = (starter: StarterOption) => {
    syncDraftFromConfig(
      {
        ...starter.config,
        method: starter.method,
      },
      { syncEditorDrafts: true },
    );
    setHasSelectedStarter(true);
    setStarterName(starter.name);
    setActiveStepId("method");
    toast.success(
      starter.isBlank
        ? `${METHOD_META[starter.method].label} blank template selected`
        : `Applied example: ${starter.name}`,
    );
  };

  const switchEditorMode = (nextMode: EditorMode) => {
    if (nextMode === editorMode) {
      return;
    }

    if (nextMode === "json") {
      setJsonDraft(JSON.stringify(configDraft, null, 2));
      setJsonError(null);
      setEditorMode("json");
      return;
    }

    try {
      const parsed = JSON.parse(jsonDraft) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setJsonError("JSON root must be an object.");
        return;
      }
      syncDraftFromConfig(parsed as Record<string, unknown>, {
        syncEditorDrafts: true,
      });
      setEditorMode("builder");
    } catch {
      setJsonError(
        "JSON is invalid. Fix syntax before returning to the builder.",
      );
    }
  };

  const handleSubmit = async () => {
    setHasAttemptedMethodStepAdvance(true);
    if (
      nameError !== null ||
      keyFormatError !== null ||
      keyAvailabilityError !== null
    ) {
      return;
    }

    if (editorMode === "json") {
      try {
        const parsed = JSON.parse(jsonDraft) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setJsonError("JSON root must be an object.");
          return;
        }
        syncDraftFromConfig(parsed as Record<string, unknown>, {
          syncEditorDrafts: true,
        });
      } catch {
        setJsonError("JSON is invalid. Fix syntax before saving.");
        return;
      }
    }

    const resolvedMethod = normalizeMethod(method || configDraft.method);
    const resolvedName = normalizeName(name || configDraft.name);
    const resolvedKey = normalizeKey(
      key || configDraft.custom_detector_key,
      resolvedName,
    );
    const resolvedDescription = description.trim();

    const mergedConfig = mergeConfigWithDefaults(
      {
        ...configDraft,
        name: resolvedName,
        custom_detector_key: resolvedKey,
        method: resolvedMethod,
        description: resolvedDescription,
      },
      resolvedMethod,
    );

    if (!validateConfig(mergedConfig)) {
      toast.error("Configuration failed schema validation");
      return;
    }

    await onSubmit({
      name: resolvedName,
      key: resolvedKey,
      method: resolvedMethod,
      description:
        resolvedDescription.length > 0 ? resolvedDescription : undefined,
      isActive,
      config: mergedConfig,
    });
  };

  React.useImperativeHandle(
    ref,
    () => ({
      getAssistantSnapshot: () => ({
        name,
        key,
        description,
        method,
        isActive,
        config: configDraft,
        editorMode,
        validationErrors,
      }),
      applyPatches: (patches) => {
        let nextName = name;
        let nextKey = key;
        let nextDescription = description;
        let nextMethod = method;
        let nextIsActive = isActive;
        let nextConfig = structuredClone(configDraft);

        for (const patch of patches) {
          switch (patch.path) {
            case "name":
              nextName = String(patch.value ?? "");
              break;
            case "key":
              nextKey = String(patch.value ?? "");
              break;
            case "description":
              nextDescription = String(patch.value ?? "");
              break;
            case "method":
              if (
                patch.value === "RULESET" ||
                patch.value === "CLASSIFIER" ||
                patch.value === "ENTITY"
              ) {
                nextMethod = patch.value;
              }
              break;
            case "isActive":
              nextIsActive = Boolean(patch.value);
              break;
            default: {
              const configPath = patch.path.startsWith("config.")
                ? patch.path.slice("config.".length)
                : patch.path;
              nextConfig = setValueAtPath(nextConfig, configPath, patch.value);
              break;
            }
          }
        }

        setIsActive(nextIsActive);
        syncDraftFromConfig(
          {
            ...nextConfig,
            name: nextName,
            custom_detector_key: nextKey,
            method: nextMethod,
            description: nextDescription,
          },
          { syncEditorDrafts: true },
        );
      },
      validate: () => {
        const missingFields: string[] = [];
        const errors: string[] = [...validationErrors];

        if (!name.trim()) {
          missingFields.push("name");
        }

        if (!key.trim()) {
          missingFields.push("key");
        }

        return {
          isValid: missingFields.length === 0 && errors.length === 0,
          missingFields,
          errors,
        };
      },
    }),
    [
      configDraft,
      description,
      editorMode,
      isActive,
      key,
      method,
      name,
      syncDraftFromConfig,
      validationErrors,
    ],
  );

  const stepRefs = {
    method: useRef<HTMLElement>(null),
    policy: useRef<HTMLElement>(null),
    tests: useRef<HTMLElement>(null),
  };
  const stepperSteps = WIZARD_STEPS.map((step) => ({
    id: step.id as CustomDetectorStepId,
    title: step.title,
    description: step.description,
  }));
  const scrollToSection = (id: CustomDetectorStepId) => {
    stepRefs[id].current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  const isJsonMode = editorMode === "json";

  useEffect(() => {
    if (isJsonMode) {
      return;
    }
    const sections = (
      [
        { id: "method" as CustomDetectorStepId, el: stepRefs.method.current },
        { id: "policy" as CustomDetectorStepId, el: stepRefs.policy.current },
        { id: "tests" as CustomDetectorStepId, el: stepRefs.tests.current },
      ] as const
    ).filter(
      (section): section is { id: CustomDetectorStepId; el: HTMLElement } =>
        section.el !== null,
    );
    const map = new Map<Element, CustomDetectorStepId>(
      sections.map(({ id, el }) => [el, id]),
    );

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = map.get(entry.target);
            if (id) setActiveStepId(id);
          }
        }
      },
      { rootMargin: "0px 0px -60% 0px", threshold: 0 },
    );

    sections.forEach(({ el }) => observer.observe(el));
    return () => observer.disconnect();
  }, [isJsonMode]);

  if (mode === "create" && !hasSelectedStarter) {
    const groupEntries = METHOD_ORDER.map(
      (methodType) =>
        [methodType, filteredStartersByMethod.get(methodType) ?? []] as const,
    ).filter(([, starters]) => starters.length > 0);

    return (
      <div className="space-y-4">
        <div className="border-2 border-black rounded-[6px] bg-background p-4 shadow-[4px_4px_0_#000]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted-foreground">
                Detector Catalog
              </div>
              <div className="text-sm font-semibold uppercase tracking-[0.06em]">
                Pick method and starter
              </div>
            </div>
            <Badge className="rounded-[4px] border border-black bg-[#b7ff00] text-black">
              {examples.length} Templates
            </Badge>
          </div>
          <div className="relative mt-3">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search examples by use-case or method"
              className="h-10 rounded-[4px] border-2 border-black pl-9 text-sm shadow-[3px_3px_0_#000] focus-visible:ring-0"
            />
            {searchQuery ? (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSearchQuery("")}
                className="absolute right-1 top-1/2 h-7 -translate-y-1/2 rounded-[4px] px-2 text-xs"
              >
                Clear
              </Button>
            ) : null}
          </div>
        </div>

        {groupEntries.length === 0 ? (
          <div className="border-2 border-dashed border-black rounded-[6px] bg-muted/30 px-6 py-8 text-center shadow-[4px_4px_0_#000]">
            <p className="text-sm font-semibold uppercase tracking-[0.08em]">
              No templates found
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a different keyword or start blank in another method.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {groupEntries.map(([methodType, starters]) => (
              <section
                key={methodType}
                className="border-2 border-border rounded-[6px] bg-card overflow-hidden shadow-[6px_6px_0_var(--color-border)]"
              >
                <div className="flex flex-col gap-2 border-b-2 border-border bg-foreground px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-xs font-mono font-bold uppercase tracking-[0.12em] text-primary-foreground">
                      {METHOD_META[methodType].label}
                    </h3>
                    <p className="text-[10px] font-mono text-primary-foreground/60">
                      {METHOD_META[methodType].description}
                    </p>
                  </div>
                  <Badge className="w-fit rounded-[4px] border-2 border-black bg-[#b7ff00] text-[10px] uppercase tracking-[0.16em] text-black shadow-[3px_3px_0_#000]">
                    {starters.length} Options
                  </Badge>
                </div>

                <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                  {starters.map((starter) => {
                    const isBlank = starter.isBlank === true;
                    return (
                      <StarterCard
                        key={starter.id}
                        title={starter.name}
                        description={starter.description}
                        onClick={() => beginFromStarter(starter)}
                        icon={
                          isBlank ? (
                            <FileText className="h-4 w-4" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )
                        }
                        badge={
                          isBlank ? (
                            <Badge className="rounded-[4px] border border-black bg-[#b7ff00] text-black">
                              Start
                            </Badge>
                          ) : (
                            <Badge
                              variant="outline"
                              className="rounded-[4px] border-black text-[10px]"
                            >
                              Template
                            </Badge>
                          )
                        }
                      />
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="font-mono rounded-[4px] border-black">
          {method}
        </Badge>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={editorMode === "builder" ? "default" : "outline"}
            className="rounded-[4px] border-2 border-black"
            onClick={() => switchEditorMode("builder")}
            disabled={isSubmitting}
          >
            Builder
          </Button>
          <Button
            type="button"
            variant={editorMode === "json" ? "default" : "outline"}
            className="rounded-[4px] border-2 border-black"
            onClick={() => switchEditorMode("json")}
            disabled={isSubmitting}
          >
            JSON
          </Button>
        </div>
      </div>

      {isJsonMode ? (
        <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
          <CardHeader>
            <CardTitle className="uppercase tracking-[0.06em]">
              JSON Editor
            </CardTitle>
            <CardDescription>
              Edit detector configuration directly.
              {starterName ? ` Starter: ${starterName}.` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {jsonError ? (
              <Alert
                variant="destructive"
                className="rounded-[4px] border-2 border-destructive/60"
              >
                <AlertTitle>JSON issues</AlertTitle>
                <AlertDescription>{jsonError}</AlertDescription>
              </Alert>
            ) : null}
            <Textarea
              value={jsonDraft}
              onChange={(event) => {
                setJsonDraft(event.target.value);
                setJsonError(null);
              }}
              className="min-h-[520px] font-mono text-xs"
              placeholder='{"method":"RULESET"}'
            />
            <Card className="sticky bottom-0 z-30 p-4">
              <div className="flex justify-end">
                <Button
                  type="button"
                  className="rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
                  onClick={() => void handleSubmit()}
                  disabled={isSubmitting}
                >
                  {isSubmitting
                    ? `${mode === "create" ? "Creating" : "Saving"}...`
                    : submitLabel}
                </Button>
              </div>
            </Card>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="sticky top-0 z-20 -mx-4 border-b-2 border-black bg-background/95 px-4 py-2 backdrop-blur-sm md:hidden">
            <HorizontalCustomDetectorStepperNav
              steps={stepperSteps}
              activeStepId={activeStepId}
              onNavigate={scrollToSection}
            />
          </div>

          <div className="flex gap-8 lg:gap-12">
            <div className="min-w-0 flex-1 space-y-10 pb-10">
              {validationErrors.length > 0 ? (
                <Alert
                  variant="destructive"
                  className="rounded-[4px] border-2 border-destructive/60"
                >
                  <AlertTitle>Validation issues</AlertTitle>
                  <AlertDescription>
                    <ul className="list-disc space-y-1 pl-4">
                      {validationErrors.map((errorMessage) => (
                        <li key={errorMessage}>{errorMessage}</li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              ) : null}

              <section ref={stepRefs.method}>
                <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
                  <CardHeader>
                    <CardTitle className="uppercase tracking-[0.06em]">
                      Method setup
                    </CardTitle>
                    <CardDescription>
                      Configure method-specific logic and detector identity.
                      {starterName ? ` Starter: ${starterName}.` : ""}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
            <div className="space-y-4">
              <Card className="rounded-[4px] border-2 border-black/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Identity</CardTitle>
                  <CardDescription>
                    Name, key, method, and status.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Name</Label>
                      <Input
                        value={name}
                        onChange={(event) =>
                          updateMeta({ name: event.target.value })
                        }
                        placeholder="Detector name"
                        aria-invalid={
                          hasAttemptedMethodStepAdvance && nameError !== null
                        }
                      />
                      {hasAttemptedMethodStepAdvance && nameError ? (
                        <p className="text-xs text-destructive">{nameError}</p>
                      ) : null}
                    </div>
                    <div className="space-y-2">
                      <Label>Key</Label>
                      <Input
                        value={key}
                        onChange={(event) =>
                          updateMeta({ key: event.target.value })
                        }
                        placeholder="cust_detector_key"
                        aria-invalid={
                          hasAttemptedMethodStepAdvance &&
                          (keyFormatError !== null ||
                            (keyAvailabilityError !== null &&
                              keyAvailabilityError !==
                                "Checking whether this key is already in use..."))
                        }
                      />
                      {hasAttemptedMethodStepAdvance && keyFormatError ? (
                        <p className="text-xs text-destructive">
                          {keyFormatError}
                        </p>
                      ) : null}
                      {hasAttemptedMethodStepAdvance &&
                      !keyFormatError &&
                      keyAvailabilityError ===
                        "Checking whether this key is already in use..." ? (
                        <p className="text-xs text-muted-foreground">
                          {keyAvailabilityError}
                        </p>
                      ) : null}
                      {hasAttemptedMethodStepAdvance &&
                      !keyFormatError &&
                      keyAvailabilityError !== null &&
                      keyAvailabilityError !==
                        "Checking whether this key is already in use..." ? (
                        <p className="text-xs text-destructive">
                          {keyAvailabilityError}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Method</Label>
                      <select
                        value={method}
                        onChange={(event) =>
                          updateMeta({
                            method: normalizeMethod(event.target.value),
                          })
                        }
                        className="h-10 w-full rounded-[6px] border-2 border-black bg-background px-3 text-sm"
                      >
                        <option value="RULESET">Ruleset</option>
                        <option value="CLASSIFIER">Classifier</option>
                        <option value="ENTITY">Entity</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label>Status</Label>
                      <select
                        value={isActive ? "active" : "inactive"}
                        onChange={(event) =>
                          updateMeta({
                            isActive: event.target.value === "active",
                          })
                        }
                        className="h-10 w-full rounded-[6px] border-2 border-black bg-background px-3 text-sm"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Description</Label>
                    <Textarea
                      value={description}
                      onChange={(event) =>
                        updateMeta({ description: event.target.value })
                      }
                      className="min-h-[88px]"
                      placeholder="What this detector should detect"
                    />
                  </div>

                  {hasAttemptedMethodStepAdvance && methodConfigError ? (
                    <p className="text-xs text-destructive">
                      {methodConfigError}
                    </p>
                  ) : null}
                </CardContent>
              </Card>

              {method === "RULESET" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="rounded-[4px] border-2 border-black/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Keyword Rules</CardTitle>
                      <CardDescription>
                        Comma-separated keywords for fast rule matching.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <Label>Keywords</Label>
                        <Textarea
                          value={keywordText}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setEditorDrafts((current) => ({
                              ...current,
                              keywordText: nextValue,
                            }));
                            const keywords = parseCommaSeparated(nextValue);
                            updateRuleSet({
                              ...ruleSet,
                              keyword_rules:
                                keywords.length > 0
                                  ? [
                                      {
                                        id: "kw_main",
                                        name: "Keywords",
                                        keywords,
                                        case_sensitive: keywordCaseSensitive,
                                        severity: keywordSeverity,
                                      },
                                    ]
                                  : [],
                            });
                          }}
                          className="min-h-[140px]"
                          placeholder="iban, social security number, passport"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Keyword severity</Label>
                        <select
                          value={keywordSeverity}
                          onChange={(event) => {
                            const severity =
                              normalizeSeverity(event.target.value) ?? "medium";
                            const keywords = parseCommaSeparated(keywordText);
                            updateRuleSet({
                              ...ruleSet,
                              keyword_rules:
                                keywords.length > 0
                                  ? [
                                      {
                                        id: "kw_main",
                                        name: "Keywords",
                                        keywords,
                                        case_sensitive: keywordCaseSensitive,
                                        severity,
                                      },
                                    ]
                                  : [],
                            });
                          }}
                          className="h-10 w-full rounded-[6px] border-2 border-black bg-background px-3 text-sm"
                        >
                          {SEVERITY_OPTIONS.map((severity) => (
                            <option key={severity} value={severity}>
                              {severity}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <Label>Case sensitive</Label>
                        <select
                          value={keywordCaseSensitive ? "true" : "false"}
                          onChange={(event) => {
                            const nextCaseSensitive =
                              event.target.value === "true";
                            const keywords = parseCommaSeparated(keywordText);
                            updateRuleSet({
                              ...ruleSet,
                              keyword_rules:
                                keywords.length > 0
                                  ? [
                                      {
                                        id: "kw_main",
                                        name: "Keywords",
                                        keywords,
                                        case_sensitive: nextCaseSensitive,
                                        severity: keywordSeverity,
                                      },
                                    ]
                                  : [],
                            });
                          }}
                          className="h-10 w-full rounded-[6px] border-2 border-black bg-background px-3 text-sm"
                        >
                          <option value="false">No</option>
                          <option value="true">Yes</option>
                        </select>
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-[4px] border-2 border-black/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Regex Rules</CardTitle>
                      <CardDescription>
                        One regex pattern per line.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <Label>Regex patterns</Label>
                        <Textarea
                          value={regexText}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setEditorDrafts((current) => ({
                              ...current,
                              regexText: nextValue,
                            }));
                            const patterns = parseMultiLine(nextValue);
                            updateRuleSet({
                              ...ruleSet,
                              regex_rules: patterns.map((pattern, index) => ({
                                id: `regex_${index + 1}`,
                                name: `Pattern ${index + 1}`,
                                pattern,
                                flags: regexFlags,
                                severity: regexSeverity,
                              })),
                            });
                          }}
                          className="min-h-[140px] font-mono"
                          placeholder="\\bDE\\d{20}\\b"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Regex severity</Label>
                        <select
                          value={regexSeverity}
                          onChange={(event) => {
                            const severity =
                              normalizeSeverity(event.target.value) ?? "medium";
                            const patterns = parseMultiLine(regexText);
                            updateRuleSet({
                              ...ruleSet,
                              regex_rules: patterns.map((pattern, index) => ({
                                id: `regex_${index + 1}`,
                                name: `Pattern ${index + 1}`,
                                pattern,
                                flags: regexFlags,
                                severity,
                              })),
                            });
                          }}
                          className="h-10 w-full rounded-[6px] border-2 border-black bg-background px-3 text-sm"
                        >
                          {SEVERITY_OPTIONS.map((severity) => (
                            <option key={severity} value={severity}>
                              {severity}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="space-y-2">
                        <Label>Regex flags</Label>
                        <Input
                          value={regexFlags}
                          onChange={(event) => {
                            const flags = event.target.value;
                            const patterns = parseMultiLine(regexText);
                            updateRuleSet({
                              ...ruleSet,
                              regex_rules: patterns.map((pattern, index) => ({
                                id: `regex_${index + 1}`,
                                name: `Pattern ${index + 1}`,
                                pattern,
                                flags,
                                severity: regexSeverity,
                              })),
                            });
                          }}
                          placeholder="i"
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              {method === "CLASSIFIER" ? (
                <div className="grid gap-4 md:grid-cols-2">
                  <Card className="rounded-[4px] border-2 border-black/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Label Set</CardTitle>
                      <CardDescription>
                        One label name per line.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="space-y-2">
                        <Label>Labels</Label>
                        <Textarea
                          value={labelsText}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setEditorDrafts((current) => ({
                              ...current,
                              labelsText: nextValue,
                            }));
                            const parsed = parseMultiLine(nextValue).map(
                              (labelName) => ({
                                id:
                                  toSlug(labelName) ||
                                  `label_${Math.random().toString(16).slice(2, 6)}`,
                                name: labelName,
                                description: "",
                              }),
                            );

                            updateClassifier({
                              ...classifier,
                              labels: parsed,
                            });
                          }}
                          className="min-h-[180px]"
                          placeholder={"Risk Term\nHate Speech\nMedical Claim"}
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Hypothesis template</Label>
                        <Input
                          value={String(
                            classifier.hypothesis_template ??
                              "This text contains {}.",
                          )}
                          onChange={(event) =>
                            updateClassifier({
                              ...classifier,
                              hypothesis_template: event.target.value,
                            })
                          }
                          placeholder="This text contains {}."
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Zero-shot model</Label>
                        <Input
                          value={String(
                            classifier.zero_shot_model ??
                              "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli",
                          )}
                          onChange={(event) =>
                            updateClassifier({
                              ...classifier,
                              zero_shot_model: event.target.value,
                            })
                          }
                          placeholder="MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>SetFit model</Label>
                        <Input
                          value={String(
                            classifier.setfit_model ??
                              "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",
                          )}
                          onChange={(event) =>
                            updateClassifier({
                              ...classifier,
                              setfit_model: event.target.value,
                            })
                          }
                          placeholder="sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
                        />
                      </div>
                    </CardContent>
                  </Card>

                  <Card className="rounded-[4px] border-2 border-black/20">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">
                        Training Examples
                      </CardTitle>
                      <CardDescription>
                        Format each line as `label|example text`.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          ref={trainingFileInputRef}
                          type="file"
                          accept=".csv,.tsv,.txt,.md,.log,.json,text/csv,text/plain,application/json"
                          className="hidden"
                          onChange={(event) =>
                            void handleTrainingExamplesFileUpload(event)
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="rounded-[4px] border-2 border-border"
                          disabled={isUploadingTrainingFile}
                          onClick={() => trainingFileInputRef.current?.click()}
                        >
                          {isUploadingTrainingFile ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Upload className="mr-2 h-4 w-4" />
                          )}
                          {isUploadingTrainingFile
                            ? "Processing file..."
                            : "Upload file"}
                        </Button>
                        <p className="text-xs text-muted-foreground">
                          CSV/TSV/TXT/MD/LOG/JSON. Backend parses and appends
                          normalized examples.
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Examples</Label>
                        <Textarea
                          value={trainingExamplesText}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setEditorDrafts((current) => ({
                              ...current,
                              trainingExamplesText: nextValue,
                            }));
                            const parsed =
                              parseTrainingExamplesDraft(nextValue);

                            updateClassifier({
                              ...classifier,
                              training_examples: parsed,
                            });
                          }}
                          className="min-h-[180px] font-mono"
                          placeholder={
                            "risk_term|The contract limits liability...\nspam|Buy this now"
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Min examples per label</Label>
                        <Input
                          type="number"
                          min={1}
                          value={Number(classifier.min_examples_per_label ?? 8)}
                          onChange={(event) =>
                            updateClassifier({
                              ...classifier,
                              min_examples_per_label: Math.max(
                                1,
                                Number(event.target.value || 8),
                              ),
                            })
                          }
                        />
                      </div>
                    </CardContent>
                  </Card>
                </div>
              ) : null}

              {method === "ENTITY" ? (
                <Card className="rounded-[4px] border-2 border-black/20">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Entity Labels</CardTitle>
                    <CardDescription>
                      Comma-separated entity labels for GLiNER extraction.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-2">
                      <Label>Entity labels</Label>
                      <Textarea
                        value={entityLabelsText}
                        onChange={(event) => {
                          const nextValue = event.target.value;
                          setEditorDrafts((current) => ({
                            ...current,
                            entityLabelsText: nextValue,
                          }));
                          updateEntity({
                            ...entity,
                            entity_labels: parseCommaSeparated(nextValue),
                          });
                        }}
                        className="min-h-[130px]"
                        placeholder="vendor name, supplier company, contract id"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Model</Label>
                      <Input
                        value={String(
                          entity.model ?? "urchade/gliner_multi-v2.1",
                        )}
                        onChange={(event) =>
                          updateEntity({
                            ...entity,
                            model: event.target.value,
                          })
                        }
                      />
                    </div>
                  </CardContent>
                </Card>
              ) : null}
            </div>
                  </CardContent>
                </Card>
              </section>

              <section ref={stepRefs.policy}>
                <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
                  <CardHeader>
                    <CardTitle className="uppercase tracking-[0.06em]">
                      Pattern & severity
                    </CardTitle>
                    <CardDescription>
                      Tune severity, confidence, and language coverage.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
            <div className="space-y-4">
              <Card className="rounded-[4px] border-2 border-black/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Detection Policy</CardTitle>
                  <CardDescription>
                    Confidence, severity gate, result cap, and language
                    coverage.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Languages (comma separated)</Label>
                    <Input
                      value={editorDrafts.languagesText}
                      onChange={(event) => {
                        const nextValue = event.target.value;
                        setEditorDrafts((current) => ({
                          ...current,
                          languagesText: nextValue,
                        }));
                        updateConfig({
                          ...configDraft,
                          languages: parseCommaSeparated(nextValue),
                        });
                      }}
                      placeholder="de, en"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Confidence threshold</Label>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={Number(configDraft.confidence_threshold ?? 0.7)}
                      onChange={(event) =>
                        updateConfig({
                          ...configDraft,
                          confidence_threshold: Math.max(
                            0,
                            Math.min(1, Number(event.target.value || 0.7)),
                          ),
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Max findings</Label>
                    <Input
                      type="number"
                      min={1}
                      value={Number(configDraft.max_findings ?? 100)}
                      onChange={(event) =>
                        updateConfig({
                          ...configDraft,
                          max_findings: Math.max(
                            1,
                            Number(event.target.value || 100),
                          ),
                        })
                      }
                    />
                  </div>

                  <div className="space-y-2 md:col-span-2">
                    <Label>Severity threshold</Label>
                    <select
                      value={
                        normalizeSeverity(configDraft.severity_threshold) ?? ""
                      }
                      onChange={(event) =>
                        updateConfig({
                          ...configDraft,
                          severity_threshold: normalizeSeverity(
                            event.target.value,
                          ),
                        })
                      }
                      className="h-10 w-full rounded-[6px] border-2 border-black bg-background px-3 text-sm"
                    >
                      <option value="">No minimum severity</option>
                      {SEVERITY_OPTIONS.map((severity) => (
                        <option key={severity} value={severity}>
                          {severity}
                        </option>
                      ))}
                    </select>
                  </div>
                </CardContent>
              </Card>

              <Card className="rounded-[4px] border-2 border-black/20">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Extractor</CardTitle>
                  <CardDescription>
                    Optional structured extraction that runs when detector
                    fires.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label>Extractor enabled</Label>
                    <select
                      value={extractorEnabled ? "true" : "false"}
                      onChange={(event) => {
                        const nextEnabled = event.target.value === "true";
                        if (!nextEnabled) {
                          updateExtractor(null);
                          return;
                        }

                        const extractorFields = parseExtractorFieldsDraft(
                          editorDrafts.extractorFieldsText,
                        );
                        const parsedContentLimit = Number.parseInt(
                          editorDrafts.extractorContentLimit,
                          10,
                        );
                        updateExtractor({
                          ...extractor,
                          enabled: true,
                          fields: extractorFields,
                          gliner_model:
                            typeof extractor.gliner_model === "string"
                              ? extractor.gliner_model
                              : "urchade/gliner_multi-v2.1",
                          content_limit:
                            Number.isFinite(parsedContentLimit) &&
                            parsedContentLimit > 0
                              ? parsedContentLimit
                              : resolveExtractorContentLimit(extractor),
                        });
                      }}
                      className="h-10 w-full rounded-[6px] border-2 border-black bg-background px-3 text-sm"
                    >
                      <option value="false">Disabled</option>
                      <option value="true">Enabled</option>
                    </select>
                  </div>

                  {extractorEnabled ? (
                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2 md:col-span-2">
                        <Label>Extractor fields</Label>
                        <Textarea
                          value={extractorFieldsText}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setEditorDrafts((current) => ({
                              ...current,
                              extractorFieldsText: nextValue,
                            }));
                            const fields = parseExtractorFieldsDraft(nextValue);

                            updateExtractor({
                              ...extractor,
                              enabled: true,
                              fields,
                              gliner_model:
                                typeof extractor.gliner_model === "string"
                                  ? extractor.gliner_model
                                  : "urchade/gliner_multi-v2.1",
                              content_limit:
                                typeof extractor.content_limit === "number"
                                  ? extractor.content_limit
                                  : 4000,
                            });
                          }}
                          className="min-h-[170px] font-mono"
                          placeholder={
                            "vendor_name|string|vendor name||required\ninvoice_id|string||\\bINV-\\d+\\b|optional"
                          }
                        />
                        <p className="text-xs text-muted-foreground">
                          Format:
                          `name|type|entity_label|regex_pattern|required_or_optional`
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Extractor GLiNER model</Label>
                        <Input
                          value={String(
                            extractor.gliner_model ??
                              "urchade/gliner_multi-v2.1",
                          )}
                          onChange={(event) =>
                            updateExtractor({
                              ...extractor,
                              enabled: true,
                              fields: extractorFields,
                              gliner_model: event.target.value,
                              content_limit:
                                typeof extractor.content_limit === "number"
                                  ? extractor.content_limit
                                  : 4000,
                            })
                          }
                        />
                      </div>

                      <div className="space-y-2">
                        <Label>Extractor content limit</Label>
                        <Input
                          type="number"
                          min={320}
                          max={8192}
                          step={1}
                          value={editorDrafts.extractorContentLimit}
                          onChange={(event) => {
                            const nextValue = event.target.value;
                            setEditorDrafts((current) => ({
                              ...current,
                              extractorContentLimit: nextValue,
                            }));

                            if (nextValue === "") {
                              return;
                            }

                            const parsed = Number.parseInt(nextValue, 10);
                            if (!Number.isFinite(parsed)) {
                              return;
                            }

                            updateExtractor({
                              ...extractor,
                              enabled: true,
                              fields: extractorFields,
                              gliner_model:
                                typeof extractor.gliner_model === "string"
                                  ? extractor.gliner_model
                                  : "urchade/gliner_multi-v2.1",
                              content_limit: parsed,
                            });
                          }}
                          onBlur={() => {
                            const parsed = Number.parseInt(
                              editorDrafts.extractorContentLimit,
                              10,
                            );
                            const normalized = Number.isFinite(parsed)
                              ? Math.max(320, Math.min(8192, parsed))
                              : resolveExtractorContentLimit(extractor);

                            setEditorDrafts((current) => ({
                              ...current,
                              extractorContentLimit: String(normalized),
                            }));

                            updateExtractor({
                              ...extractor,
                              enabled: true,
                              fields: extractorFields,
                              gliner_model:
                                typeof extractor.gliner_model === "string"
                                  ? extractor.gliner_model
                                  : "urchade/gliner_multi-v2.1",
                              content_limit: normalized,
                            });
                          }}
                        />
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
                  </CardContent>
                </Card>
              </section>

              <section ref={stepRefs.tests}>
                <Card className="rounded-[6px] border-2 border-black shadow-[6px_6px_0_#000]">
                  <CardHeader>
                    <CardTitle className="uppercase tracking-[0.06em]">
                      Test scenarios
                    </CardTitle>
                    <CardDescription>
                      Verify your detector works correctly.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-6">
            <div className="space-y-2">
              {initialValue?.id ? (
                <CustomDetectorTests
                  detectorId={initialValue.id}
                  method={method as "RULESET" | "CLASSIFIER" | "ENTITY"}
                />
              ) : (
                <div className="rounded-[4px] border border-dashed border-stone-300 py-10 text-center">
                  <p className="text-sm text-muted-foreground">
                    Save the detector first to add test scenarios.
                  </p>
                </div>
              )}
            </div>
                  </CardContent>
                </Card>
              </section>

              <Card className="sticky bottom-0 z-30 p-4">
                <div className="flex justify-end">
                  <Button
                    type="button"
                    className="rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
                    onClick={() => void handleSubmit()}
                    disabled={isSubmitting}
                  >
                    {isSubmitting
                      ? `${mode === "create" ? "Creating" : "Saving"}...`
                      : submitLabel}
                  </Button>
                </div>
              </Card>
            </div>

            <aside className="hidden self-start md:sticky md:top-6 md:block md:w-44 lg:w-52">
              <VerticalCustomDetectorStepperNav
                steps={stepperSteps}
                activeStepId={activeStepId}
                onNavigate={scrollToSection}
              />
            </aside>
          </div>
        </>
      )}
    </div>
  );
});
