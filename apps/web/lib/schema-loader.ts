import type { JSONSchema7 } from "json-schema";
import allInputSources from "@workspace/schemas/all_input_sources";
import {
  isIngestionSourceType,
  type IngestionSourceType,
} from "@workspace/ui/components/source-icon";

export type SourceType = IngestionSourceType;

const mergedSchema = allInputSources as unknown as JSONSchema7;
const definitions = mergedSchema.definitions || {};

/**
 * Resolve $ref references in JSON schema
 * All references in merged schema use #/definitions/... format
 */
function resolveRef(
  schema: JSONSchema7,
  ref: string,
  rootSchema: JSONSchema7 = mergedSchema,
): JSONSchema7 | undefined {
  if (!ref.startsWith("#/")) {
    // External references are no longer used in merged schema
    return undefined;
  }

  const path = ref.slice(2).split("/");
  let current: unknown = rootSchema;

  for (const segment of path) {
    if (current && typeof current === "object" && segment) {
      current = (current as Record<string, unknown>)[segment];
    } else {
      return undefined;
    }
  }

  return current as JSONSchema7;
}

/**
 * Resolve allOf by merging properties
 */
function resolveAllOf(
  schema: JSONSchema7,
  rootSchema: JSONSchema7 = mergedSchema,
): JSONSchema7 {
  if (!schema.allOf || !Array.isArray(schema.allOf)) {
    return schema;
  }

  const merged: JSONSchema7 = {
    type: schema.type,
    properties: {},
    required: [],
  };

  for (const item of schema.allOf) {
    let resolved: JSONSchema7;

    if (typeof item === "object" && "$ref" in item && item.$ref) {
      resolved = resolveRef(schema, item.$ref, rootSchema) || item;
    } else {
      resolved = item as JSONSchema7;
    }

    // Merge properties
    if (resolved.properties) {
      merged.properties = {
        ...merged.properties,
        ...resolved.properties,
      };
    }

    // Merge required fields
    if (resolved.required && Array.isArray(resolved.required)) {
      merged.required = [
        ...(merged.required || []),
        ...resolved.required,
      ] as string[];
    }

    // Merge other properties
    if (resolved.type && !merged.type) {
      merged.type = resolved.type;
    }
  }

  return { ...schema, ...merged, allOf: undefined };
}

/**
 * Resolve $ref in schema properties recursively
 */
function resolveSchemaRefs(
  schema: JSONSchema7,
  rootSchema: JSONSchema7 = mergedSchema,
): JSONSchema7 {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  // Handle allOf
  if (schema.allOf) {
    schema = resolveAllOf(schema, rootSchema);
  }

  // Handle direct $ref
  if (schema.$ref) {
    const resolved = resolveRef(schema, schema.$ref, rootSchema);
    if (resolved) {
      return resolveSchemaRefs(resolved, rootSchema);
    }
  }

  // Resolve properties
  if (schema.properties) {
    const resolvedProperties: Record<string, JSONSchema7> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      if (value && typeof value === "object") {
        resolvedProperties[key] = resolveSchemaRefs(
          value as JSONSchema7,
          rootSchema,
        );
      }
    }
    schema = { ...schema, properties: resolvedProperties };
  }

  // Resolve items for arrays
  if (schema.items) {
    if (Array.isArray(schema.items)) {
      schema.items = schema.items.map((item) =>
        resolveSchemaRefs(item as JSONSchema7, rootSchema),
      );
    } else {
      schema.items = resolveSchemaRefs(schema.items as JSONSchema7, rootSchema);
    }
  }

  // Resolve oneOf
  if (schema.oneOf) {
    schema.oneOf = schema.oneOf.map((item) =>
      resolveSchemaRefs(item as JSONSchema7, rootSchema),
    );
  }

  return schema;
}

function extractTypeConst(schema: JSONSchema7): string | null {
  const typeSchema = schema.properties?.type as JSONSchema7 | undefined;
  if (!typeSchema) {
    return null;
  }

  if (typeof typeSchema.const === "string") {
    return typeSchema.const;
  }

  if (Array.isArray(typeSchema.enum) && typeSchema.enum.length === 1) {
    const [value] = typeSchema.enum;
    return typeof value === "string" ? value : null;
  }

  return null;
}

const SCHEMA_MAP: Partial<Record<SourceType, JSONSchema7>> = {};
for (const [, definition] of Object.entries(definitions)) {
  if (!definition || typeof definition !== "object") {
    continue;
  }

  const resolved = resolveSchemaRefs(definition as JSONSchema7, mergedSchema);
  const typeConst = extractTypeConst(resolved);
  if (typeConst && isIngestionSourceType(typeConst)) {
    SCHEMA_MAP[typeConst] = resolved;
  }
}

/**
 * Get resolved schema for a source type
 */
export function getSourceSchema(sourceType: SourceType): JSONSchema7 | null {
  const schema = SCHEMA_MAP[sourceType];
  if (!schema) {
    return null;
  }

  return schema;
}

/**
 * Get available source types
 */
export function getAvailableSourceTypes(): SourceType[] {
  return Object.keys(SCHEMA_MAP) as SourceType[];
}

/**
 * Get schema properties for a source type
 */
export function getSourceSchemaProperties(
  sourceType: SourceType,
): Record<string, JSONSchema7> | null {
  const schema = getSourceSchema(sourceType);
  if (!schema || !schema.properties) {
    return null;
  }

  return schema.properties as Record<string, JSONSchema7>;
}
