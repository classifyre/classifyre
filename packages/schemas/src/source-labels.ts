import allInputSources from "./schemas/all_input_sources.json";

type SchemaNode = Record<string, unknown>;

function isRecord(value: unknown): value is SchemaNode {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getDefinitionNameFromRef(refValue: unknown): string | null {
  if (typeof refValue !== "string") {
    return null;
  }
  const match = refValue.match(/^#\/definitions\/(.+)$/);
  return match?.[1] ?? null;
}

/**
 * Reads the `type` discriminator const from an Input definition. The const may
 * live directly on `properties.type` or inside one of the `allOf` branches.
 */
function extractTypeConst(definition: SchemaNode): string | null {
  const candidates: SchemaNode[] = [definition];
  if (Array.isArray(definition.allOf)) {
    for (const branch of definition.allOf) {
      if (isRecord(branch)) {
        candidates.push(branch);
      }
    }
  }

  for (const candidate of candidates) {
    const properties = isRecord(candidate.properties) ? candidate.properties : null;
    const typeSchema = properties && isRecord(properties.type) ? properties.type : null;
    if (typeSchema && typeof typeSchema.const === "string") {
      return typeSchema.const;
    }
    if (typeSchema && Array.isArray(typeSchema.enum) && typeSchema.enum.length === 1) {
      const [value] = typeSchema.enum;
      if (typeof value === "string") {
        return value;
      }
    }
  }

  return null;
}

function buildSourceTypeLabels(): Record<string, string> {
  const labels: Record<string, string> = {};
  const root = isRecord(allInputSources) ? (allInputSources as SchemaNode) : {};
  const definitions = isRecord(root.definitions) ? root.definitions : {};
  const oneOf = Array.isArray(root.oneOf) ? root.oneOf : [];

  for (const entry of oneOf) {
    if (!isRecord(entry)) continue;
    const definitionName = getDefinitionNameFromRef(entry.$ref);
    if (!definitionName) continue;

    const definition = definitions[definitionName];
    if (!isRecord(definition)) continue;

    const sourceType = extractTypeConst(definition);
    if (!sourceType) continue;

    if (typeof definition.label === "string" && definition.label.trim().length > 0) {
      labels[sourceType] = definition.label;
    }
  }

  return labels;
}

/**
 * Canonical, constant display name for each source type, sourced from the
 * `label` keyword on each `*Input` definition in `all_input_sources.json`.
 * Single source of truth shared by the web app and the docs site.
 */
export const SOURCE_TYPE_LABELS: Record<string, string> = buildSourceTypeLabels();

function fallbackLabelFromType(sourceType: string): string {
  return sourceType
    .toLowerCase()
    .split("_")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

/**
 * Resolve the friendly label for a source type. Falls back to a title-cased
 * version of the enum (or an explicit `fallback`) when no label is defined,
 * so newly-added source types still render reasonably.
 */
export function getSourceLabel(sourceType: string, fallback?: string): string {
  if (!sourceType) {
    return fallback ?? "";
  }
  const normalized = sourceType.toUpperCase();
  return (
    SOURCE_TYPE_LABELS[normalized] ?? fallback ?? fallbackLabelFromType(normalized)
  );
}
