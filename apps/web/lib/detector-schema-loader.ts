import type { JSONSchema7 } from "json-schema";
import allDetectors from "@workspace/schemas/all_detectors";

export interface DetectorSchemaInfo {
  id: string;
  type: string;
  title: string;
  description?: string;
  schema: JSONSchema7;
  categories: string[];
  lifecycleStatus?: string;
  priority?: string;
  supportedAssetTypes: string[];
  recommendedModel?: string;
  notes?: string;
}

interface DetectorCatalogEntry {
  detector_type: string;
  lifecycle_status?: string;
  priority?: string;
  categories?: string[];
  supported_asset_types?: string[];
  recommended_model?: string | null;
  notes?: string | null;
}

const mergedSchema = allDetectors as unknown as JSONSchema7;
const detectorTypeEnum =
  (mergedSchema.definitions?.DetectorType as JSONSchema7 | undefined)?.enum ||
  [];
const detectorCatalogDefault =
  (mergedSchema.definitions?.DetectorCatalog as JSONSchema7 | undefined)
    ?.default || [];

const detectorTypeList = Array.isArray(detectorTypeEnum)
  ? (detectorTypeEnum.filter((value) => typeof value === "string") as string[])
  : [];

function isDetectorCatalogEntry(value: unknown): value is DetectorCatalogEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "detector_type" in value &&
    typeof (value as { detector_type?: unknown }).detector_type === "string"
  );
}

const detectorCatalogList: DetectorCatalogEntry[] = Array.isArray(
  detectorCatalogDefault,
)
  ? (detectorCatalogDefault as unknown[]).filter(isDetectorCatalogEntry)
  : [];

const detectorCatalogByType = new Map(
  detectorCatalogList
    .filter((entry) => typeof entry.detector_type === "string")
    .map((entry) => [entry.detector_type.toUpperCase(), entry]),
);

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

function resolveRef(
  ref: string,
  rootSchema: JSONSchema7 = mergedSchema,
): JSONSchema7 | undefined {
  if (!ref.startsWith("#/")) {
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
      resolved = resolveRef(item.$ref, rootSchema) || (item as JSONSchema7);
    } else {
      resolved = item as JSONSchema7;
    }

    if (resolved.properties) {
      merged.properties = {
        ...merged.properties,
        ...resolved.properties,
      };
    }

    if (resolved.required && Array.isArray(resolved.required)) {
      merged.required = [
        ...(merged.required || []),
        ...resolved.required,
      ] as string[];
    }

    if (resolved.type && !merged.type) {
      merged.type = resolved.type;
    }
  }

  return { ...schema, ...merged, allOf: undefined };
}

function resolveSchemaRefs(
  schema: JSONSchema7,
  rootSchema: JSONSchema7 = mergedSchema,
): JSONSchema7 {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  if (schema.allOf) {
    schema = resolveAllOf(schema, rootSchema);
  }

  if (schema.$ref) {
    const resolved = resolveRef(schema.$ref, rootSchema);
    if (resolved) {
      return resolveSchemaRefs(resolved, rootSchema);
    }
  }

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

  if (schema.items) {
    if (Array.isArray(schema.items)) {
      schema.items = schema.items.map((item) =>
        resolveSchemaRefs(item as JSONSchema7, rootSchema),
      );
    } else {
      schema.items = resolveSchemaRefs(schema.items as JSONSchema7, rootSchema);
    }
  }

  if (schema.oneOf) {
    schema.oneOf = schema.oneOf.map((item) =>
      resolveSchemaRefs(item as JSONSchema7, rootSchema),
    );
  }

  if (schema.anyOf) {
    schema.anyOf = schema.anyOf.map((item) =>
      resolveSchemaRefs(item as JSONSchema7, rootSchema),
    );
  }

  return schema;
}

const configSchemaByDetectorType: Record<string, string> = {
  SECRETS: "SecretsDetectorConfig",
  PII: "PIIDetectorConfig",
  TOXIC: "ContentDetectorConfig",
  NSFW: "ContentDetectorConfig",
  YARA: "ThreatDetectorConfig",
  BROKEN_LINKS: "BrokenLinksDetectorConfig",
  CUSTOM: "CustomDetectorConfig",
};

const upperAcronyms = new Set([
  "AI",
  "OCR",
  "PII",
  "NSFW",
  "URL",
  "DEID",
  "YARA",
]);

function toDetectorLabel(detectorType: string): string {
  const words = detectorType
    .split("_")
    .filter(Boolean)
    .map((chunk) => {
      const upper = chunk.toUpperCase();
      if (upperAcronyms.has(upper)) {
        return upper;
      }
      return upper.charAt(0) + upper.slice(1).toLowerCase();
    });

  return words.join(" ") || detectorType;
}

export function getDetectorSchemas(options?: {
  includeCustom?: boolean;
}): DetectorSchemaInfo[] {
  const includeCustom = options?.includeCustom ?? true;
  const definitions = mergedSchema.definitions as
    | Record<string, JSONSchema7>
    | undefined;
  const resolvedDefinitions = new Map<string, JSONSchema7>();
  if (definitions) {
    for (const [key, definition] of Object.entries(definitions)) {
      resolvedDefinitions.set(key, resolveSchemaRefs(definition, mergedSchema));
    }
  }

  // Fallback base config schema for detectors with no dedicated config definition
  const baseConfigSchema = resolveSchemaRefs(
    (mergedSchema.definitions?.DetectorConfig as JSONSchema7 | undefined) ?? {
      type: "object",
    },
    mergedSchema,
  );

  const schemas: DetectorSchemaInfo[] = [];

  detectorTypeList.forEach((type) => {
    const upper = String(type).toUpperCase();
    if (!includeCustom && upper === "CUSTOM") {
      return;
    }
    const definitionKey = configSchemaByDetectorType[upper] ?? "DetectorConfig";
    const schema = resolvedDefinitions.get(definitionKey) ?? baseConfigSchema;
    const title = `${toDetectorLabel(upper)} Detector`;
    const catalog = detectorCatalogByType.get(upper);
    const description = catalog?.notes ?? undefined;
    const categories = asStringArray(catalog?.categories).map((category) =>
      category.toUpperCase(),
    );
    const supportedAssetTypes = asStringArray(
      catalog?.supported_asset_types,
    ).map((assetType) => assetType.toUpperCase());
    const lifecycleStatus =
      typeof catalog?.lifecycle_status === "string"
        ? catalog.lifecycle_status
        : undefined;
    const priority =
      typeof catalog?.priority === "string" ? catalog.priority : undefined;
    const recommendedModel =
      typeof catalog?.recommended_model === "string"
        ? catalog.recommended_model
        : undefined;
    const notes =
      typeof catalog?.notes === "string" ? catalog.notes : undefined;

    schemas.push({
      id: upper,
      type: upper,
      title,
      description,
      schema,
      categories,
      lifecycleStatus,
      priority,
      supportedAssetTypes,
      recommendedModel,
      notes,
    });
  });

  return schemas;
}
