import allInputExamples from "./schemas/all_input_examples.json";
import allInputSources from "./schemas/all_input_sources.json";
import assistantKnowledge from "./schemas/assistant_knowledge.json";

type SchemaNode = Record<string, unknown>;

export type SourceDocFieldRow = {
  path: string;
  section: string;
  required: boolean;
  type: string;
  description?: string;
  defaultValue?: string;
  enumValues?: string;
  constraints?: string;
};

export type SourceDocExample = {
  name: string;
  description: string;
  schedule?: unknown;
  config: unknown;
};

export type SourceDocModel = {
  sourceType: string;
  slug: string;
  label: string;
  definitionName: string;
  schema: SchemaNode;
  fieldRows: SourceDocFieldRow[];
  examples: SourceDocExample[];
  knowledgeSections: SourceKnowledgeSection[];
};

export type SourceKnowledgeSection = {
  key: string;
  title: string;
  summary?: string;
  suggestions: string[];
  questions: string[];
};

type SourceDefinition = {
  sourceType: string;
  definitionName: string;
  schema: SchemaNode;
};

const rootSchema = toSchemaNode(allInputSources);
const definitions = toSchemaNode(rootSchema.definitions);
const allExamples = toSchemaNode(allInputExamples);
const assistantKnowledgeRoot = toSchemaNode(assistantKnowledge);
const assistantKnowledgeSources = toSchemaNode(assistantKnowledgeRoot.sources);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toSchemaNode(value: unknown): SchemaNode {
  return isRecord(value) ? (value as SchemaNode) : {};
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function toNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function getDefinitionNameFromRef(refValue: unknown): string | null {
  if (typeof refValue !== "string") {
    return null;
  }

  const match = refValue.match(/^#\/definitions\/(.+)$/);
  return match?.[1] ?? null;
}

function resolveRef(refValue: string): SchemaNode | null {
  if (!refValue.startsWith("#/")) {
    return null;
  }

  const segments = refValue.slice(2).split("/");
  let current: unknown = rootSchema;

  for (const segment of segments) {
    if (!isRecord(current)) {
      return null;
    }
    current = current[segment];
  }

  return toSchemaNode(current);
}

function mergeSchemaNodes(
  baseSchema: SchemaNode,
  extraSchema: SchemaNode,
): SchemaNode {
  const baseProperties = toSchemaNode(baseSchema.properties);
  const extraProperties = toSchemaNode(extraSchema.properties);
  const baseRequired = toStringArray(baseSchema.required);
  const extraRequired = toStringArray(extraSchema.required);

  const mergedRequired = Array.from(
    new Set([...baseRequired, ...extraRequired]),
  );
  const mergedProperties = {
    ...baseProperties,
    ...extraProperties,
  };

  const mergedSchema: SchemaNode = {
    ...baseSchema,
    ...extraSchema,
  };

  if (Object.keys(mergedProperties).length > 0) {
    mergedSchema.properties = mergedProperties;
  }

  if (mergedRequired.length > 0) {
    mergedSchema.required = mergedRequired;
  }

  return mergedSchema;
}

function resolveSchemaNode(
  schemaLike: unknown,
  refStack: Set<string> = new Set(),
): SchemaNode {
  let schema = toSchemaNode(schemaLike);
  if (Object.keys(schema).length === 0) {
    return {};
  }

  const refValue = typeof schema.$ref === "string" ? schema.$ref : null;
  if (refValue) {
    if (!refStack.has(refValue)) {
      const resolvedTarget = resolveRef(refValue);
      if (resolvedTarget) {
        refStack.add(refValue);
        const resolvedSchema = resolveSchemaNode(resolvedTarget, refStack);
        refStack.delete(refValue);
        const { $ref: _ignoredRef, ...inlineSchema } = schema;
        schema = mergeSchemaNodes(resolvedSchema, inlineSchema);
      }
    }
  }

  if (Array.isArray(schema.allOf)) {
    const mergedAllOf = schema.allOf.reduce<SchemaNode>(
      (accumulator, allOfNode) => {
        const resolvedAllOfNode = resolveSchemaNode(allOfNode, refStack);
        return mergeSchemaNodes(accumulator, resolvedAllOfNode);
      },
      {},
    );

    const { allOf: _ignoredAllOf, ...restSchema } = schema;
    schema = mergeSchemaNodes(mergedAllOf, restSchema);
  }

  const properties = toSchemaNode(schema.properties);
  if (Object.keys(properties).length > 0) {
    const resolvedProperties: SchemaNode = {};
    for (const [key, value] of Object.entries(properties)) {
      resolvedProperties[key] = resolveSchemaNode(value, refStack);
    }
    schema.properties = resolvedProperties;
  }

  const items = schema.items;
  if (Array.isArray(items)) {
    schema.items = items.map((item) => resolveSchemaNode(item, refStack));
  } else if (isRecord(items)) {
    schema.items = resolveSchemaNode(items, refStack);
  }

  if (Array.isArray(schema.oneOf)) {
    schema.oneOf = schema.oneOf.map((oneOfNode) =>
      resolveSchemaNode(oneOfNode, refStack),
    );
  }

  if (Array.isArray(schema.anyOf)) {
    schema.anyOf = schema.anyOf.map((anyOfNode) =>
      resolveSchemaNode(anyOfNode, refStack),
    );
  }

  return schema;
}

function extractSourceTypeConst(schema: SchemaNode): string | null {
  const properties = toSchemaNode(schema.properties);
  const typeSchema = toSchemaNode(properties.type);

  if (typeof typeSchema.const === "string") {
    return typeSchema.const;
  }

  const enumValues = toStringArray(typeSchema.enum);
  if (enumValues.length === 1) {
    return enumValues[0] ?? null;
  }

  return null;
}

function sourceTypeToLabel(
  sourceType: string,
  schema: SchemaNode,
  definitionName: string,
): string {
  const rawTitle =
    typeof schema.title === "string" ? schema.title : definitionName;
  const withoutSuffix = rawTitle.endsWith("Input")
    ? rawTitle.slice(0, -5)
    : rawTitle;
  const candidate = withoutSuffix.length > 0 ? withoutSuffix : sourceType;

  return humanizeIdentifier(candidate);
}

function humanizeIdentifier(value: string): string {
  const acronymWords = new Set([
    "API",
    "BI",
    "DB",
    "ETL",
    "HTTP",
    "HTTPS",
    "JSON",
    "SQL",
    "URL",
    "UUID",
    "XML",
  ]);

  const words = value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return value;
  }

  return words
    .map((word) => {
      const upperWord = word.toUpperCase();
      if (acronymWords.has(upperWord)) {
        return upperWord;
      }

      if (/^[A-Z]+\d+$/.test(upperWord) || /^\d+[A-Z]+$/.test(upperWord)) {
        return upperWord;
      }

      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

export function toSourceDocSlug(sourceType: string): string {
  return sourceType.toLowerCase().replace(/_/g, "-");
}

function orderedPropertyKeys(properties: SchemaNode): string[] {
  const preferredTopLevelOrder = [
    "type",
    "required",
    "masked",
    "optional",
    "sampling",
    "detectors",
    "custom_detectors",
  ];
  const keys = Object.keys(properties);

  return keys.sort((left, right) => {
    const leftOrder = preferredTopLevelOrder.indexOf(left);
    const rightOrder = preferredTopLevelOrder.indexOf(right);

    if (leftOrder >= 0 || rightOrder >= 0) {
      if (leftOrder === -1) return 1;
      if (rightOrder === -1) return -1;
      return leftOrder - rightOrder;
    }

    return left.localeCompare(right);
  });
}

function formatUnknownValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null) {
    return "null";
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function describeSchemaType(schema: SchemaNode): string {
  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    return `const ${formatUnknownValue(schema.const)}`;
  }

  const enumValues = Array.isArray(schema.enum) ? schema.enum : [];
  if (enumValues.length > 0) {
    return "enum";
  }

  if (typeof schema.type === "string") {
    return schema.type;
  }

  if (Array.isArray(schema.type) && schema.type.length > 0) {
    return schema.type
      .map((typePart) => formatUnknownValue(typePart))
      .join(" | ");
  }

  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const variantTypes = schema.oneOf
      .map((variant) => describeSchemaType(resolveSchemaNode(variant)))
      .filter((variantType) => variantType !== "unknown");
    const uniqueVariantTypes = Array.from(new Set(variantTypes));
    return uniqueVariantTypes.length > 0
      ? uniqueVariantTypes.join(" | ")
      : "oneOf";
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const variantTypes = schema.anyOf
      .map((variant) => describeSchemaType(resolveSchemaNode(variant)))
      .filter((variantType) => variantType !== "unknown");
    const uniqueVariantTypes = Array.from(new Set(variantTypes));
    return uniqueVariantTypes.length > 0
      ? uniqueVariantTypes.join(" | ")
      : "anyOf";
  }

  if (Object.keys(toSchemaNode(schema.properties)).length > 0) {
    return "object";
  }

  if (schema.items) {
    return "array";
  }

  return "unknown";
}

function formatSchemaConstraints(schema: SchemaNode): string | undefined {
  const constraints: string[] = [];

  const minValue = toNumber(schema.minimum);
  const maxValue = toNumber(schema.maximum);
  const minLength = toNumber(schema.minLength);
  const maxLength = toNumber(schema.maxLength);
  const minItems = toNumber(schema.minItems);
  const maxItems = toNumber(schema.maxItems);
  const additionalProperties = toBoolean(schema.additionalProperties);

  if (minValue !== null) constraints.push(`min ${minValue}`);
  if (maxValue !== null) constraints.push(`max ${maxValue}`);
  if (minLength !== null) constraints.push(`min length ${minLength}`);
  if (maxLength !== null) constraints.push(`max length ${maxLength}`);
  if (minItems !== null) constraints.push(`min items ${minItems}`);
  if (maxItems !== null) constraints.push(`max items ${maxItems}`);
  if (typeof schema.pattern === "string")
    constraints.push(`pattern ${schema.pattern}`);
  if (typeof schema.format === "string")
    constraints.push(`format ${schema.format}`);
  if (additionalProperties === false) constraints.push("no extra properties");

  return constraints.length > 0 ? constraints.join(", ") : undefined;
}

function extractFieldRows(schema: SchemaNode): SourceDocFieldRow[] {
  const rows: SourceDocFieldRow[] = [];

  function walkProperties(
    currentSchema: SchemaNode,
    prefix: string,
    requiredFields: Set<string>,
  ) {
    const properties = toSchemaNode(currentSchema.properties);

    for (const propertyKey of orderedPropertyKeys(properties)) {
      const propertySchema = resolveSchemaNode(properties[propertyKey]);
      const propertyPath = prefix ? `${prefix}.${propertyKey}` : propertyKey;
      const section = (propertyPath.split(".")[0] ?? propertyPath).replace(
        "[]",
        "",
      );
      const enumValues = Array.isArray(propertySchema.enum)
        ? propertySchema.enum
            .map((enumValue) => formatUnknownValue(enumValue))
            .join(", ")
        : undefined;
      const hasDefault = Object.prototype.hasOwnProperty.call(
        propertySchema,
        "default",
      );

      rows.push({
        path: propertyPath,
        section,
        required: requiredFields.has(propertyKey),
        type: describeSchemaType(propertySchema),
        description:
          typeof propertySchema.description === "string"
            ? propertySchema.description
            : undefined,
        defaultValue: hasDefault
          ? formatUnknownValue(propertySchema.default)
          : undefined,
        enumValues,
        constraints: formatSchemaConstraints(propertySchema),
      });

      const nestedRequiredFields = new Set(
        toStringArray(propertySchema.required),
      );
      const nestedProperties = toSchemaNode(propertySchema.properties);
      if (Object.keys(nestedProperties).length > 0) {
        walkProperties(propertySchema, propertyPath, nestedRequiredFields);
      }

      const items = propertySchema.items;
      const itemSchema = Array.isArray(items)
        ? items[0]
          ? resolveSchemaNode(items[0])
          : null
        : isRecord(items)
          ? resolveSchemaNode(items)
          : null;

      if (itemSchema && Object.keys(itemSchema).length > 0) {
        const itemPath = `${propertyPath}[]`;
        rows.push({
          path: itemPath,
          section,
          required: requiredFields.has(propertyKey),
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
            ? itemSchema.enum
                .map((enumValue) => formatUnknownValue(enumValue))
                .join(", ")
            : undefined,
          constraints: formatSchemaConstraints(itemSchema),
        });

        const itemProperties = toSchemaNode(itemSchema.properties);
        if (Object.keys(itemProperties).length > 0) {
          walkProperties(
            itemSchema,
            itemPath,
            new Set(toStringArray(itemSchema.required)),
          );
        }
      }
    }
  }

  walkProperties(schema, "", new Set(toStringArray(schema.required)));
  return rows;
}

function extractExamplesForSource(sourceType: string): SourceDocExample[] {
  const sourceExamples = allExamples[sourceType];
  if (!Array.isArray(sourceExamples)) {
    return [];
  }

  return sourceExamples.map((sourceExample, index) => {
    const exampleNode = toSchemaNode(sourceExample);
    const fallbackName = `Example ${index + 1}`;
    return {
      name:
        typeof exampleNode.name === "string" &&
        exampleNode.name.trim().length > 0
          ? exampleNode.name
          : fallbackName,
      description:
        typeof exampleNode.description === "string"
          ? exampleNode.description
          : "",
      schedule: exampleNode.schedule,
      config: exampleNode.config ?? {},
    };
  });
}

function extractKnowledgeForSource(
  sourceType: string,
): SourceKnowledgeSection[] {
  const sourceKnowledgeNode = toSchemaNode(
    assistantKnowledgeSources[sourceType],
  );
  const sectionsNode = toSchemaNode(sourceKnowledgeNode.sections);
  const preferredOrder = ["name", "required", "masked", "optional", "sampling"];

  const sections = Object.entries(sectionsNode).map(
    ([sectionKey, sectionValue]) => {
      const section = toSchemaNode(sectionValue);
      const title =
        typeof section.title === "string" && section.title.trim().length > 0
          ? section.title
          : sectionKey;

      const suggestions = Array.isArray(section.suggestions)
        ? section.suggestions.filter(
            (item): item is string => typeof item === "string",
          )
        : [];

      const questions = Array.isArray(section.questions)
        ? section.questions.filter(
            (item): item is string => typeof item === "string",
          )
        : [];

      return {
        key: sectionKey,
        title,
        summary:
          typeof section.summary === "string" ? section.summary : undefined,
        suggestions,
        questions,
      };
    },
  );

  return sections.sort((left, right) => {
    const leftOrder = preferredOrder.indexOf(left.key);
    const rightOrder = preferredOrder.indexOf(right.key);
    if (leftOrder >= 0 || rightOrder >= 0) {
      if (leftOrder === -1) return 1;
      if (rightOrder === -1) return -1;
      return leftOrder - rightOrder;
    }
    return left.title.localeCompare(right.title);
  });
}

function extractSourceDefinitions(): SourceDefinition[] {
  const sourceDefinitions: SourceDefinition[] = [];
  const oneOfEntries = Array.isArray(rootSchema.oneOf) ? rootSchema.oneOf : [];

  for (const oneOfEntry of oneOfEntries) {
    const oneOfNode = toSchemaNode(oneOfEntry);
    const definitionName = getDefinitionNameFromRef(oneOfNode.$ref);

    if (!definitionName) {
      continue;
    }

    const definitionSchema = toSchemaNode(definitions[definitionName]);
    if (Object.keys(definitionSchema).length === 0) {
      continue;
    }

    const resolvedSchema = resolveSchemaNode(definitionSchema);
    const sourceType = extractSourceTypeConst(resolvedSchema);

    if (!sourceType) {
      continue;
    }

    sourceDefinitions.push({
      sourceType,
      definitionName,
      schema: resolvedSchema,
    });
  }

  return sourceDefinitions;
}

function buildSourceDocs(): SourceDocModel[] {
  const sourceDefinitions = extractSourceDefinitions();

  const docs = sourceDefinitions.map((sourceDefinition) => ({
    sourceType: sourceDefinition.sourceType,
    slug: toSourceDocSlug(sourceDefinition.sourceType),
    label: sourceTypeToLabel(
      sourceDefinition.sourceType,
      sourceDefinition.schema,
      sourceDefinition.definitionName,
    ),
    definitionName: sourceDefinition.definitionName,
    schema: sourceDefinition.schema,
    fieldRows: extractFieldRows(sourceDefinition.schema),
    examples: extractExamplesForSource(sourceDefinition.sourceType),
    knowledgeSections: extractKnowledgeForSource(sourceDefinition.sourceType),
  }));

  return docs.sort((left, right) => left.label.localeCompare(right.label));
}

const SOURCE_DOCS = buildSourceDocs();
const SOURCE_DOC_BY_TYPE = new Map(
  SOURCE_DOCS.map((sourceDoc) => [sourceDoc.sourceType, sourceDoc]),
);
const SOURCE_DOC_BY_SLUG = new Map(
  SOURCE_DOCS.map((sourceDoc) => [sourceDoc.slug, sourceDoc]),
);

export function getAllSourceDocs(): SourceDocModel[] {
  return SOURCE_DOCS;
}

export function getSourceDoc(sourceType: string): SourceDocModel | null {
  return SOURCE_DOC_BY_TYPE.get(sourceType) ?? null;
}

export function getSourceDocBySlug(slug: string): SourceDocModel | null {
  return SOURCE_DOC_BY_SLUG.get(slug.toLowerCase()) ?? null;
}

export function getAvailableSourceDocTypes(): string[] {
  return SOURCE_DOCS.map((sourceDoc) => sourceDoc.sourceType);
}
