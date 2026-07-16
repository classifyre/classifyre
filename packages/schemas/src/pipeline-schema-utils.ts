import allDetectors from "./schemas/all_detectors.json";
import type { DetectorDocFieldRow } from "./detector-docs";

type SchemaNode = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Internal utilities (mirror the helpers in detector-docs.ts)
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
      const baseProps = toSchemaNode(resolvedSchema.properties);
      const inlineProps = toSchemaNode((inline as SchemaNode).properties);
      const merged: SchemaNode = { ...resolvedSchema, ...inline };
      if (Object.keys({ ...baseProps, ...inlineProps }).length > 0) {
        merged.properties = { ...baseProps, ...inlineProps };
      }
      schema = merged;
    }
  }

  if (Array.isArray(schema.anyOf)) {
    schema.anyOf = schema.anyOf.map((node) =>
      resolveSchemaNode(node, refStack),
    );
  }

  return schema;
}

function describeSchemaType(schema: SchemaNode): string {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return schema.type.map(formatUnknownValue).join(" | ");
  }
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const variants = schema.anyOf
      .map((v) => {
        const s = toSchemaNode(v);
        return typeof s.type === "string" ? s.type : null;
      })
      .filter((t): t is string => t !== null && t !== "null");
    const unique = Array.from(new Set(variants));
    return unique.length > 0 ? unique.join(" | ") : "anyOf";
  }
  if (Array.isArray(schema.enum) && schema.enum.length > 0) return "enum";
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
  if (min !== null) constraints.push(`min ${min}`);
  if (max !== null) constraints.push(`max ${max}`);
  if (minLen !== null) constraints.push(`min length ${minLen}`);
  if (maxLen !== null) constraints.push(`max length ${maxLen}`);
  if (typeof schema.pattern === "string")
    constraints.push(`pattern ${schema.pattern}`);
  if (typeof schema.format === "string")
    constraints.push(`format ${schema.format}`);
  return constraints.length > 0 ? constraints.join(", ") : undefined;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extracts flat field rows from a named definition in all_detectors.json.
 * Skips the discriminator `type` field (always a fixed enum).
 */
export function getPipelineSchemaFieldRows(
  definitionName: string,
): DetectorDocFieldRow[] {
  const definitions = toSchemaNode(rootSchema.definitions);
  const rawDef = definitions[definitionName];
  if (!rawDef) return [];

  const schema = resolveSchemaNode(rawDef);
  const properties = toSchemaNode(schema.properties);
  const requiredFields = new Set(toStringArray(schema.required));
  const rows: DetectorDocFieldRow[] = [];

  for (const [key, value] of Object.entries(properties)) {
    if (key === "type") continue; // skip the discriminator field

    const propSchema = resolveSchemaNode(value);
    const enumValues = Array.isArray(propSchema.enum)
      ? propSchema.enum.map(formatUnknownValue).join(", ")
      : undefined;
    const hasDefault = Object.prototype.hasOwnProperty.call(
      propSchema,
      "default",
    );

    rows.push({
      path: key,
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
  }

  return rows;
}

export const PIPELINE_SCHEMA_DEFINITION_NAMES = {
  gliner2: "GLiNER2PipelineSchema",
  regex: "RegexPipelineSchema",
  llm: "LLMPipelineSchema",
  text_classification: "TextClassificationPipelineSchema",
  image_classification: "ImageClassificationPipelineSchema",
  object_detection: "ObjectDetectionPipelineSchema",
} as const;

export type PipelineSchemaKind = keyof typeof PIPELINE_SCHEMA_DEFINITION_NAMES;
