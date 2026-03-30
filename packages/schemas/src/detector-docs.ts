import allDetectors from "./schemas/all_detectors.json";
import allDetectorExamples from "./schemas/all_detectors_examples.json";

type SchemaNode = Record<string, unknown>;

export type DetectorDocFieldRow = {
  path: string;
  required: boolean;
  type: string;
  description?: string;
  defaultValue?: string;
  enumValues?: string;
  constraints?: string;
};

export type DetectorDocExample = {
  name: string;
  description: string;
  config: unknown;
};

export type DetectorCatalogMeta = {
  lifecycleStatus: "active" | "planned" | "experimental" | "deprecated";
  priority: "P0" | "P1" | "P2" | "P3" | "P4";
  categories: string[];
  supportedAssetTypes: string[];
  supportedSourceTypes: string[];
  recommendedModel: string | null;
  notes: string | null;
};

export type DetectorDocModel = {
  detectorType: string;
  slug: string;
  label: string;
  configDefinitionName: string;
  schema: SchemaNode;
  fieldRows: DetectorDocFieldRow[];
  examples: DetectorDocExample[];
  catalogMeta: DetectorCatalogMeta;
};

// ---------------------------------------------------------------------------
// Schema utilities (scoped to allDetectors root)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSchemaNode(value: unknown): SchemaNode {
  return isRecord(value) ? (value as SchemaNode) : {};
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value === null) return "null";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

const rootSchema = toSchemaNode(allDetectors);
const definitions = toSchemaNode(rootSchema.definitions);
const allExamples = toSchemaNode(allDetectorExamples);

function resolveRef(refValue: string): SchemaNode | null {
  if (!refValue.startsWith("#/")) return null;
  const segments = refValue.slice(2).split("/");
  let current: unknown = rootSchema;
  for (const segment of segments) {
    if (!isRecord(current)) return null;
    current = current[segment];
  }
  return toSchemaNode(current);
}

function mergeSchemaNodes(base: SchemaNode, extra: SchemaNode): SchemaNode {
  const baseProps = toSchemaNode(base.properties);
  const extraProps = toSchemaNode(extra.properties);
  const mergedRequired = Array.from(
    new Set([
      ...toStringArray(base.required),
      ...toStringArray(extra.required),
    ]),
  );
  const merged: SchemaNode = { ...base, ...extra };
  if (Object.keys({ ...baseProps, ...extraProps }).length > 0) {
    merged.properties = { ...baseProps, ...extraProps };
  }
  if (mergedRequired.length > 0) {
    merged.required = mergedRequired;
  }
  return merged;
}

function resolveSchemaNode(
  schemaLike: unknown,
  refStack: Set<string> = new Set(),
): SchemaNode {
  let schema = toSchemaNode(schemaLike);
  if (Object.keys(schema).length === 0) return {};

  const refValue = typeof schema.$ref === "string" ? schema.$ref : null;
  if (refValue && !refStack.has(refValue)) {
    const resolved = resolveRef(refValue);
    if (resolved) {
      refStack.add(refValue);
      const resolvedSchema = resolveSchemaNode(resolved, refStack);
      refStack.delete(refValue);
      const { $ref: _ref, ...inline } = schema;
      schema = mergeSchemaNodes(resolvedSchema, inline);
    }
  }

  if (Array.isArray(schema.allOf)) {
    const merged = schema.allOf.reduce<SchemaNode>((acc, node) => {
      return mergeSchemaNodes(acc, resolveSchemaNode(node, refStack));
    }, {});
    const { allOf: _allOf, ...rest } = schema;
    schema = mergeSchemaNodes(merged, rest);
  }

  const properties = toSchemaNode(schema.properties);
  if (Object.keys(properties).length > 0) {
    const resolved: SchemaNode = {};
    for (const [key, value] of Object.entries(properties)) {
      resolved[key] = resolveSchemaNode(value, refStack);
    }
    schema.properties = resolved;
  }

  const items = schema.items;
  if (Array.isArray(items)) {
    schema.items = items.map((item) => resolveSchemaNode(item, refStack));
  } else if (isRecord(items)) {
    schema.items = resolveSchemaNode(items, refStack);
  }

  if (Array.isArray(schema.oneOf)) {
    schema.oneOf = schema.oneOf.map((node) =>
      resolveSchemaNode(node, refStack),
    );
  }
  if (Array.isArray(schema.anyOf)) {
    schema.anyOf = schema.anyOf.map((node) =>
      resolveSchemaNode(node, refStack),
    );
  }

  return schema;
}

function describeSchemaType(schema: SchemaNode): string {
  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    return `const ${formatUnknownValue(schema.const)}`;
  }
  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
  if (enumValues.length > 0) return "enum";
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return schema.type.map(formatUnknownValue).join(" | ");
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const variants = schema.oneOf
      .map((v) => describeSchemaType(resolveSchemaNode(v)))
      .filter((t) => t !== "unknown");
    const unique = Array.from(new Set(variants));
    return unique.length > 0 ? unique.join(" | ") : "oneOf";
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const variants = schema.anyOf
      .map((v) => describeSchemaType(resolveSchemaNode(v)))
      .filter((t) => t !== "unknown");
    const unique = Array.from(new Set(variants));
    return unique.length > 0 ? unique.join(" | ") : "anyOf";
  }
  if (Object.keys(toSchemaNode(schema.properties)).length > 0) return "object";
  if (schema.items) return "array";
  return "unknown";
}

function formatSchemaConstraints(schema: SchemaNode): string | undefined {
  const constraints: string[] = [];
  const min = toNumber(schema.minimum);
  const max = toNumber(schema.maximum);
  const minLen = toNumber(schema.minLength);
  const maxLen = toNumber(schema.maxLength);
  const minItems = toNumber(schema.minItems);
  const maxItems = toNumber(schema.maxItems);
  const additionalProperties = toBoolean(schema.additionalProperties);
  if (min !== null) constraints.push(`min ${min}`);
  if (max !== null) constraints.push(`max ${max}`);
  if (minLen !== null) constraints.push(`min length ${minLen}`);
  if (maxLen !== null) constraints.push(`max length ${maxLen}`);
  if (minItems !== null) constraints.push(`min items ${minItems}`);
  if (maxItems !== null) constraints.push(`max items ${maxItems}`);
  if (typeof schema.pattern === "string")
    constraints.push(`pattern ${schema.pattern}`);
  if (typeof schema.format === "string")
    constraints.push(`format ${schema.format}`);
  if (additionalProperties === false) constraints.push("no extra properties");
  return constraints.length > 0 ? constraints.join(", ") : undefined;
}

function extractFieldRows(schema: SchemaNode): DetectorDocFieldRow[] {
  const rows: DetectorDocFieldRow[] = [];

  function walk(
    currentSchema: SchemaNode,
    prefix: string,
    requiredFields: Set<string>,
  ) {
    const properties = toSchemaNode(currentSchema.properties);
    for (const key of Object.keys(properties)) {
      const propSchema = resolveSchemaNode(properties[key]);
      const path = prefix ? `${prefix}.${key}` : key;
      const enumValues = Array.isArray(propSchema.enum)
        ? propSchema.enum.map(formatUnknownValue).join(", ")
        : undefined;
      const hasDefault = Object.prototype.hasOwnProperty.call(
        propSchema,
        "default",
      );

      rows.push({
        path,
        required: requiredFields.has(key),
        type: describeSchemaType(propSchema),
        description:
          typeof propSchema.description === "string"
            ? propSchema.description
            : undefined,
        defaultValue: hasDefault
          ? formatUnknownValue(propSchema.default)
          : undefined,
        enumValues,
        constraints: formatSchemaConstraints(propSchema),
      });

      const nestedProps = toSchemaNode(propSchema.properties);
      if (Object.keys(nestedProps).length > 0) {
        walk(propSchema, path, new Set(toStringArray(propSchema.required)));
      }

      const items = propSchema.items;
      const itemSchema = Array.isArray(items)
        ? items[0]
          ? resolveSchemaNode(items[0])
          : null
        : isRecord(items)
          ? resolveSchemaNode(items)
          : null;

      if (itemSchema && Object.keys(itemSchema).length > 0) {
        const itemPath = `${path}[]`;
        rows.push({
          path: itemPath,
          required: requiredFields.has(key),
          type: describeSchemaType(itemSchema),
          description:
            typeof itemSchema.description === "string"
              ? itemSchema.description
              : undefined,
          defaultValue: Object.prototype.hasOwnProperty.call(
            itemSchema,
            "default",
          )
            ? formatUnknownValue(itemSchema.default)
            : undefined,
          enumValues: Array.isArray(itemSchema.enum)
            ? itemSchema.enum.map(formatUnknownValue).join(", ")
            : undefined,
          constraints: formatSchemaConstraints(itemSchema),
        });

        const itemProps = toSchemaNode(itemSchema.properties);
        if (Object.keys(itemProps).length > 0) {
          walk(
            itemSchema,
            itemPath,
            new Set(toStringArray(itemSchema.required)),
          );
        }
      }
    }
  }

  walk(schema, "", new Set(toStringArray(schema.required)));
  return rows;
}

// ---------------------------------------------------------------------------
// Detector type → config definition mapping
// ---------------------------------------------------------------------------

const DETECTOR_TYPE_TO_DEFINITION: Record<string, string> = {
  SECRETS: "SecretsDetectorConfig",
  PII: "PIIDetectorConfig",
  TOXIC: "ContentDetectorConfig",
  NSFW: "ContentDetectorConfig",
  YARA: "ThreatDetectorConfig",
  BROKEN_LINKS: "BrokenLinksDetectorConfig",
  CONTENT_QUALITY: "ContentQualityDetectorConfig",
  DEID_SCORE: "DeidScoreDetectorConfig",
  BIAS: "BiasDetectorConfig",
  CUSTOM: "CustomDetectorConfig",
  DOMAIN_CLASS: "ClassificationDetectorConfig",
  CONTENT_TYPE: "ClassificationDetectorConfig",
  SENSITIVITY_TIER: "ClassificationDetectorConfig",
  JURISDICTION_TAG: "ClassificationDetectorConfig",
  OCR_PII: "PIIDetectorConfig",
};

const DETECTOR_TYPE_LABELS: Record<string, string> = {
  SECRETS: "Secrets",
  PII: "PII",
  TOXIC: "Toxicity",
  NSFW: "NSFW",
  YARA: "YARA",
  BROKEN_LINKS: "Broken Links",
  PROMPT_INJECTION: "Prompt Injection",
  PHISHING_URL: "Phishing URL",
  SPAM: "Spam",
  LANGUAGE: "Language",
  CODE_SECURITY: "Code Security",
  PLAGIARISM: "Plagiarism",
  IMAGE_VIOLENCE: "Image Violence",
  OCR_PII: "OCR PII",
  DEID_SCORE: "De-ID Score",
  HATE_SPEECH: "Hate Speech",
  AI_GENERATED: "AI Generated",
  CONTENT_QUALITY: "Content Quality",
  BIAS: "Bias",
  DUPLICATE: "Duplicate",
  DOMAIN_CLASS: "Domain Class",
  CONTENT_TYPE: "Content Type",
  SENSITIVITY_TIER: "Sensitivity Tier",
  JURISDICTION_TAG: "Jurisdiction Tag",
  CUSTOM: "Custom",
};

export function toDetectorDocSlug(detectorType: string): string {
  return detectorType.toLowerCase().replace(/_/g, "-");
}

function detectorTypeToLabel(detectorType: string): string {
  return DETECTOR_TYPE_LABELS[detectorType] ?? detectorType;
}

function resolveConfigDefinitionName(detectorType: string): string {
  return DETECTOR_TYPE_TO_DEFINITION[detectorType] ?? "GenericDetectorConfig";
}

// ---------------------------------------------------------------------------
// Catalog metadata extraction
// ---------------------------------------------------------------------------

function extractCatalogMeta(detectorType: string): DetectorCatalogMeta {
  const catalogDef = toSchemaNode(definitions["DetectorCatalog"]);
  const catalogDefault = Array.isArray(catalogDef.default)
    ? catalogDef.default
    : [];

  const entry = catalogDefault.find((item) => {
    const node = toSchemaNode(item);
    return node.detector_type === detectorType;
  });

  if (!entry) {
    return {
      lifecycleStatus: "planned",
      priority: "P4",
      categories: [],
      supportedAssetTypes: [],
      supportedSourceTypes: [],
      recommendedModel: null,
      notes: null,
    };
  }

  const node = toSchemaNode(entry);
  const lifecycleStatus =
    typeof node.lifecycle_status === "string"
      ? (node.lifecycle_status as DetectorCatalogMeta["lifecycleStatus"])
      : "planned";
  const priority =
    typeof node.priority === "string"
      ? (node.priority as DetectorCatalogMeta["priority"])
      : "P4";

  return {
    lifecycleStatus,
    priority,
    categories: toStringArray(node.categories),
    supportedAssetTypes: toStringArray(node.supported_asset_types),
    supportedSourceTypes: toStringArray(node.supported_source_types),
    recommendedModel:
      typeof node.recommended_model === "string"
        ? node.recommended_model
        : null,
    notes: typeof node.notes === "string" ? node.notes : null,
  };
}

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

function extractExamplesForDetector(
  detectorType: string,
): DetectorDocExample[] {
  const detectorExamples = allExamples[detectorType];
  if (!Array.isArray(detectorExamples)) return [];

  return detectorExamples.map((item, index) => {
    const node = toSchemaNode(item);
    return {
      name:
        typeof node.name === "string" && node.name.trim()
          ? node.name
          : `Example ${index + 1}`,
      description: typeof node.description === "string" ? node.description : "",
      config: node.config ?? {},
    };
  });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

function buildDetectorDocs(): DetectorDocModel[] {
  const catalogDef = toSchemaNode(definitions["DetectorCatalog"]);
  const catalogDefault = Array.isArray(catalogDef.default)
    ? catalogDef.default
    : [];

  const docs: DetectorDocModel[] = [];

  for (const item of catalogDefault) {
    const entry = toSchemaNode(item);
    const detectorType =
      typeof entry.detector_type === "string" ? entry.detector_type : null;
    if (!detectorType) continue;

    const configDefinitionName = resolveConfigDefinitionName(detectorType);
    const rawDefinition = toSchemaNode(definitions[configDefinitionName]);
    if (Object.keys(rawDefinition).length === 0) continue;

    const schema = resolveSchemaNode(rawDefinition);
    // Remove non-field keys that are resolver artifacts
    const fieldRows = extractFieldRows(schema);

    docs.push({
      detectorType,
      slug: toDetectorDocSlug(detectorType),
      label: detectorTypeToLabel(detectorType),
      configDefinitionName,
      schema,
      fieldRows,
      examples: extractExamplesForDetector(detectorType),
      catalogMeta: extractCatalogMeta(detectorType),
    });
  }

  return docs.sort((a, b) => a.label.localeCompare(b.label));
}

const DETECTOR_DOCS = buildDetectorDocs();
const DETECTOR_DOC_BY_TYPE = new Map(
  DETECTOR_DOCS.map((d) => [d.detectorType, d]),
);
const DETECTOR_DOC_BY_SLUG = new Map(DETECTOR_DOCS.map((d) => [d.slug, d]));

export function getAllDetectorDocs(): DetectorDocModel[] {
  return DETECTOR_DOCS;
}

export function getDetectorDoc(detectorType: string): DetectorDocModel | null {
  return DETECTOR_DOC_BY_TYPE.get(detectorType) ?? null;
}

export function getDetectorDocBySlug(slug: string): DetectorDocModel | null {
  return DETECTOR_DOC_BY_SLUG.get(slug.toLowerCase()) ?? null;
}

export function getAvailableDetectorTypes(): string[] {
  return DETECTOR_DOCS.map((d) => d.detectorType);
}
