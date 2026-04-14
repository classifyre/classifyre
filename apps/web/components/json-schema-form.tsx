"use client";

import * as React from "react";
import Editor from "@monaco-editor/react";
import {
  useForm,
  type Control,
  type FieldPath,
  type FieldValues,
  type PathValue,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { JSONSchema7 } from "json-schema";
import { cn } from "@workspace/ui/lib/utils";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@workspace/ui/components/form";
import { Input } from "@workspace/ui/components/input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Checkbox } from "@workspace/ui/components/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@workspace/ui/components/select";
import { Button } from "@workspace/ui/components/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@workspace/ui/components/accordion";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@workspace/ui/components/toggle-group";
import { Plus, X } from "lucide-react";
import { AiAssistedCard } from "@/components/ai-assisted-card";
import {
  buildSourcePrompt,
  getSourceSectionKnowledge,
} from "@/lib/assistant-knowledge";
import { collectMissingRequiredFields } from "@/lib/assistant-form-utils";
import {
  isIngestionSourceType,
  type IngestionSourceType,
} from "@workspace/ui/components/source-icon";
import { ScheduleCard, type ScheduleValue } from "@/components/schedule-card";
import { SamplingCard, type SamplingValue } from "@/components/sampling-card";

const LONG_TEXT_THRESHOLD = 120;

function formatLabel(name: string, schema: JSONSchema7): string {
  const base = schema.title ?? name;
  return base.replace(/_/g, " ").replace(/-/g, " ");
}

function flattenFormErrors(
  errors: Record<string, unknown>,
  prefix = "",
): string[] {
  return Object.entries(errors).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return [];
    }

    const currentMessage =
      typeof (value as { message?: unknown }).message === "string"
        ? [`${path}: ${String((value as { message?: string }).message)}`]
        : [];

    return [
      ...currentMessage,
      ...flattenFormErrors(value as Record<string, unknown>, path),
    ];
  });
}

function formatPlaceholder(name: string, schema: JSONSchema7): string {
  return (
    schema.description || `Enter ${formatLabel(name, schema).toLowerCase()}`
  );
}

function hasNullType(schema: JSONSchema7): boolean {
  if (schema.type === "null") return true;
  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    return schema.anyOf.some(
      (option) => (option as JSONSchema7).type === "null",
    );
  }
  return false;
}

function normalizeAnyOfSchema(schema: JSONSchema7): JSONSchema7 {
  if (!schema.anyOf || !Array.isArray(schema.anyOf)) {
    return schema;
  }

  const nonNull = schema.anyOf.filter(
    (option) => (option as JSONSchema7).type !== "null",
  ) as JSONSchema7[];

  if (nonNull.length === 1) {
    const first = nonNull[0]!;
    return {
      ...schema,
      ...first,
      title: schema.title ?? first.title,
      description: schema.description ?? first.description,
      default: schema.default ?? first.default,
      anyOf: undefined,
    };
  }

  return {
    ...schema,
    oneOf: schema.anyOf as JSONSchema7[],
    anyOf: undefined,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasConfiguredValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }

  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasConfiguredValue(entry));
  }

  if (isPlainObject(value)) {
    return Object.values(value).some((entry) => hasConfiguredValue(entry));
  }

  return true;
}

function isObjectSchema(schema: JSONSchema7): boolean {
  return (
    schema.type === "object" || (!!schema.properties && schema.type !== "array")
  );
}

function isStructuredObjectSchema(schema: JSONSchema7): boolean {
  return isObjectSchema(schema) && Boolean(schema.properties);
}

function shouldRenderObjectAsJsonEditor(schema: JSONSchema7): boolean {
  return isObjectSchema(schema) && !schema.properties;
}

function isArraySchema(schema: JSONSchema7): boolean {
  return (
    schema.type === "array" || (!!schema.items && schema.type !== "object")
  );
}

function isComplexSchema(schema: JSONSchema7): boolean {
  return (
    Boolean(schema.oneOf) ||
    Boolean(schema.anyOf) ||
    isObjectSchema(schema) ||
    isArraySchema(schema)
  );
}

function isConstField(schema: JSONSchema7): boolean {
  return (
    schema.const !== undefined ||
    (Array.isArray(schema.enum) && schema.enum.length === 1)
  );
}

function isLongText(schema: JSONSchema7): boolean {
  return (
    (schema.description?.length ?? 0) > LONG_TEXT_THRESHOLD ||
    (typeof schema.maxLength === "number" &&
      schema.maxLength > LONG_TEXT_THRESHOLD)
  );
}

function shouldSpanFull(schema: JSONSchema7): boolean {
  if (isComplexSchema(schema)) return true;
  if (schema.enum && schema.enum.length > 6) return true;
  return isLongText(schema);
}

function hasRequiredFields(schema: JSONSchema7): boolean {
  const normalized = normalizeAnyOfSchema(schema);

  if (Array.isArray(normalized.required) && normalized.required.length > 0) {
    return true;
  }

  if (normalized.oneOf && Array.isArray(normalized.oneOf)) {
    return normalized.oneOf.some((option) =>
      hasRequiredFields(option as JSONSchema7),
    );
  }

  if (normalized.anyOf && Array.isArray(normalized.anyOf)) {
    return normalized.anyOf.some((option) =>
      hasRequiredFields(option as JSONSchema7),
    );
  }

  if (isObjectSchema(normalized) && normalized.properties) {
    return Object.values(normalized.properties).some((value) =>
      hasRequiredFields(value as JSONSchema7),
    );
  }

  if (isArraySchema(normalized) && normalized.items) {
    return hasRequiredFields(normalized.items as JSONSchema7);
  }

  return false;
}

function hasValidationErrors(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.message === "string" || typeof record.type === "string") {
    return true;
  }

  return Object.values(record).some((entry) => hasValidationErrors(entry));
}

function buildEnumSchema(schema: JSONSchema7): z.ZodTypeAny {
  const values = schema.enum || [];
  if (values.length === 0) {
    return z.any();
  }
  const allStrings = values.every((value) => typeof value === "string");
  if (allStrings) {
    const stringValues = values as string[];
    if (stringValues.length === 1) {
      return z.literal(stringValues[0]);
    }
    return z.enum(stringValues as [string, ...string[]]);
  }

  // For non-string mixed enums, fall back to string coercion for runtime compatibility
  const stringValues = values.map((value) => String(value));
  if (stringValues.length === 1) {
    return z.literal(stringValues[0]!);
  }
  return z.enum(stringValues as [string, ...string[]]);
}

function coerceNumberInput(value: unknown): unknown {
  if (value === "" || value === null) {
    return undefined;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") {
      return undefined;
    }
    const parsed = Number(trimmed);
    return Number.isNaN(parsed) ? value : parsed;
  }

  return value;
}

function isNumberSchema(schema: JSONSchema7): boolean {
  const normalized = normalizeAnyOfSchema(schema);
  return normalized.type === "number" || normalized.type === "integer";
}

function applyOptionalSchema(
  schema: JSONSchema7,
  zodSchema: z.ZodTypeAny,
  isRequired: boolean,
): z.ZodTypeAny {
  if (isRequired) {
    return zodSchema;
  }

  if (isNumberSchema(schema)) {
    return z.preprocess(coerceNumberInput, zodSchema.optional());
  }

  return z.preprocess(
    (value) => (value === null ? undefined : value),
    zodSchema.optional(),
  );
}

function jsonSchemaToZod(schema: JSONSchema7): z.ZodTypeAny {
  if (schema.$ref) {
    return z.any();
  }

  if (schema.const !== undefined) {
    return z.literal(schema.const as string | number | boolean | null);
  }

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    const options = schema.anyOf.map((item) =>
      jsonSchemaToZod(item as JSONSchema7),
    );
    if (options.length === 0) {
      return z.any();
    }
    if (options.length === 1) {
      return options[0]!;
    }
    return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  if (schema.oneOf && Array.isArray(schema.oneOf)) {
    const options = schema.oneOf.map((item) =>
      jsonSchemaToZod(item as JSONSchema7),
    );
    if (options.length === 0) {
      return z.any();
    }
    if (options.length === 1) {
      return options[0]!;
    }
    return z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]);
  }

  if (schema.enum) {
    return buildEnumSchema(schema);
  }

  if (isStructuredObjectSchema(schema) && schema.properties) {
    const shape: Record<string, z.ZodTypeAny> = {};
    const required = schema.required || [];

    for (const [key, value] of Object.entries(schema.properties)) {
      const propSchema = value as JSONSchema7;
      const zodSchema = jsonSchemaToZod(propSchema);
      shape[key] = applyOptionalSchema(
        propSchema,
        zodSchema,
        required.includes(key),
      );
    }
    let zodObject = z.object(shape);

    if (typeof schema.minProperties === "number") {
      const minProperties = schema.minProperties;
      zodObject = zodObject.refine(
        (value) =>
          Object.values(value).filter((entry) => entry !== undefined).length >=
          minProperties,
        {
          message: `Must include at least ${minProperties} field${minProperties === 1 ? "" : "s"}.`,
        },
      );
    }

    if (typeof schema.maxProperties === "number") {
      const maxProperties = schema.maxProperties;
      zodObject = zodObject.refine(
        (value) =>
          Object.values(value).filter((entry) => entry !== undefined).length <=
          maxProperties,
        {
          message: `Must include no more than ${maxProperties} field${maxProperties === 1 ? "" : "s"}.`,
        },
      );
    }

    return zodObject;
  }

  if (isObjectSchema(schema)) {
    const additionalProperties = schema.additionalProperties;
    const catchallSchema =
      additionalProperties &&
      typeof additionalProperties === "object" &&
      !Array.isArray(additionalProperties)
        ? jsonSchemaToZod(additionalProperties as JSONSchema7)
        : z.unknown();

    let zodObject = z.record(z.string(), catchallSchema);

    if (typeof schema.minProperties === "number") {
      const minProperties = schema.minProperties;
      zodObject = zodObject.refine(
        (value) => Object.keys(value).length >= minProperties,
        {
          message: `Must include at least ${minProperties} field${minProperties === 1 ? "" : "s"}.`,
        },
      );
    }

    if (typeof schema.maxProperties === "number") {
      const maxProperties = schema.maxProperties;
      zodObject = zodObject.refine(
        (value) => Object.keys(value).length <= maxProperties,
        {
          message: `Must include no more than ${maxProperties} field${maxProperties === 1 ? "" : "s"}.`,
        },
      );
    }

    return zodObject;
  }

  if (isArraySchema(schema) && schema.items) {
    const itemSchema = jsonSchemaToZod(schema.items as JSONSchema7);
    let zodArray = z.array(itemSchema);
    if (typeof schema.minItems === "number") {
      zodArray = zodArray.min(schema.minItems);
    }
    if (typeof schema.maxItems === "number") {
      zodArray = zodArray.max(schema.maxItems);
    }
    return zodArray;
  }

  if (schema.type === "string") {
    let zodString = z.string();

    if (schema.format === "uri") {
      zodString = zodString.url();
    }

    if (typeof schema.minLength === "number") {
      zodString = zodString.min(schema.minLength);
    }

    if (typeof schema.maxLength === "number") {
      zodString = zodString.max(schema.maxLength);
    }

    return zodString;
  }

  if (schema.type === "number" || schema.type === "integer") {
    let zodNumber = schema.type === "integer" ? z.number().int() : z.number();

    if (typeof schema.minimum === "number") {
      zodNumber = zodNumber.min(schema.minimum);
    }

    if (typeof schema.maximum === "number") {
      zodNumber = zodNumber.max(schema.maximum);
    }

    return z.preprocess(coerceNumberInput, zodNumber);
  }

  if (schema.type === "boolean") {
    return z.boolean();
  }

  if (schema.type === "null") {
    return z.null();
  }

  return z.any();
}

function collectDefaults(schema: JSONSchema7): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;

  if (schema.anyOf && Array.isArray(schema.anyOf)) {
    for (const option of schema.anyOf) {
      const defaults = collectDefaults(option as JSONSchema7);
      if (defaults !== undefined) return defaults;
    }
  }

  // Do NOT collect defaults for oneOf schemas. oneOf represents a discriminated
  // union where the user must explicitly choose an option. Pre-populating from
  // const discriminators (e.g. {deployment: "ATLAS"}) causes the first option to
  // be auto-selected on initial render, which mounts child <FormField>s before
  // the parent oneOf <FormField> runs its registration effect — triggering a
  // react-hook-form crash (Cannot read properties of undefined (reading 'mount')).

  if (isObjectSchema(schema) && schema.properties) {
    const obj: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(schema.properties)) {
      const defaults = collectDefaults(value as JSONSchema7);
      if (defaults !== undefined) {
        obj[key] = defaults;
      }
    }
    return Object.keys(obj).length > 0 ? obj : undefined;
  }

  return undefined;
}

function mergeDefaults(
  base: Record<string, unknown>,
  overrides: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (isPlainObject(value) && isPlainObject(merged[key])) {
      merged[key] = mergeDefaults(
        merged[key] as Record<string, unknown>,
        value,
      );
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export function buildFormDefaults(
  schema: JSONSchema7,
  overrides: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const schemaDefaults = collectDefaults(schema);
  const base = isPlainObject(schemaDefaults) ? schemaDefaults : {};
  return mergeDefaults(base, overrides || {});
}

function getInitialValue(schema: JSONSchema7): unknown {
  if (schema.default !== undefined) return schema.default;
  if (schema.const !== undefined) return schema.const;

  if (schema.anyOf && Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    return getInitialValue(schema.anyOf[0] as JSONSchema7);
  }

  if (schema.enum && schema.enum.length > 0) {
    return schema.enum[0];
  }

  if (schema.oneOf && Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    return getInitialValue(schema.oneOf[0] as JSONSchema7);
  }

  if (isObjectSchema(schema)) {
    const defaults = collectDefaults(schema);
    if (isPlainObject(defaults)) {
      return defaults;
    }
    return {};
  }

  if (isArraySchema(schema)) {
    return [];
  }

  if (schema.type === "boolean") {
    return false;
  }

  if (schema.type === "number" || schema.type === "integer") {
    return 0;
  }

  return "";
}

function formatJsonObjectValue(schema: JSONSchema7, value: unknown): string {
  if (isPlainObject(value)) {
    return JSON.stringify(value, null, 2);
  }

  if (isPlainObject(schema.default)) {
    return JSON.stringify(schema.default, null, 2);
  }

  return "";
}

function createOneOfValue(schema: JSONSchema7): Record<string, unknown> {
  const defaults = collectDefaults(schema);
  if (isPlainObject(defaults) && Object.keys(defaults).length > 0) {
    return defaults;
  }

  const props = schema.properties || {};
  const [firstKey] = Object.keys(props);
  if (!firstKey) return {};

  return { [firstKey]: getInitialValue(props[firstKey] as JSONSchema7) };
}

function getOneOfDiscriminator(
  option: JSONSchema7,
): { key: string; value: unknown } | null {
  const properties = option.properties || {};
  for (const [key, rawSchema] of Object.entries(properties)) {
    const propSchema = rawSchema as JSONSchema7;
    if (propSchema.const !== undefined) {
      return { key, value: propSchema.const };
    }
    if (Array.isArray(propSchema.enum) && propSchema.enum.length === 1) {
      return { key, value: propSchema.enum[0] };
    }
  }
  return null;
}

function getOneOfOptionIdentity(option: JSONSchema7, index: number): string {
  const discriminator = getOneOfDiscriminator(option);
  if (discriminator) {
    return `${discriminator.key}:${String(discriminator.value)}`;
  }
  return `option_${index}`;
}

function getOneOfOptionLabel(option: JSONSchema7, index: number): string {
  const discriminator = getOneOfDiscriminator(option);
  if (option.title) {
    return option.title;
  }
  if (discriminator) {
    return `${formatLabel(discriminator.key, option)}: ${String(discriminator.value)}`;
  }
  return `Option ${index + 1}`;
}

function getOneOfOptionMatchScore(
  option: JSONSchema7,
  value: Record<string, unknown>,
): number {
  const discriminator = getOneOfDiscriminator(option);
  if (discriminator && value[discriminator.key] !== undefined) {
    return Object.is(value[discriminator.key], discriminator.value)
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;
  }

  const properties = option.properties || {};
  const optionKeys = Object.keys(properties);
  if (optionKeys.length === 0) {
    return Object.keys(value).length === 0 ? 0 : -1;
  }

  const matchedKeys = optionKeys.filter(
    (key) => value[key] !== undefined,
  ).length;
  if (matchedKeys === 0) {
    return -1;
  }

  const extraKeys = Object.keys(value).filter(
    (key) => !(key in properties),
  ).length;
  return matchedKeys - extraKeys * 0.5;
}

function findSelectedOneOfOption(
  options: JSONSchema7[],
  value: Record<string, unknown>,
): JSONSchema7 | null {
  let selected: JSONSchema7 | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const option of options) {
    const score = getOneOfOptionMatchScore(option, value);
    if (score > bestScore) {
      bestScore = score;
      selected = option;
    }
  }

  if (bestScore < 0) {
    return null;
  }

  return selected;
}

interface SchemaFieldProps {
  name: string;
  schema: JSONSchema7;
  control: Control<FieldValues>;
  path?: string;
  required?: boolean;
  hideLabel?: boolean;
  disabled?: boolean;
  forceMasked?: boolean;
  autoDetectSensitiveFields?: boolean;
}

function OneOfFieldInner({
  field,
  fieldPath,
  label,
  required,
  hideLabel,
  disabled,
  normalizedSchema,
  control,
  forceMasked,
  autoDetectSensitiveFields,
}: {
  field: {
    value: unknown;
    onChange: (value: unknown) => void;
  };
  fieldPath: string;
  label: string;
  required: boolean;
  hideLabel: boolean;
  disabled: boolean;
  normalizedSchema: JSONSchema7;
  control: Control<FieldValues>;
  forceMasked: boolean;
  autoDetectSensitiveFields: boolean;
}) {
  const oneOfOptions = React.useMemo(
    () => (normalizedSchema.oneOf || []) as JSONSchema7[],
    [normalizedSchema.oneOf],
  );
  const [hasMounted, setHasMounted] = React.useState(false);
  const hasInitializedRequiredDefault = React.useRef(false);

  React.useEffect(() => {
    setHasMounted(true);
  }, []);

  React.useEffect(() => {
    if (!required || !hasMounted || hasInitializedRequiredDefault.current) {
      return;
    }
    if (field.value !== undefined || oneOfOptions.length === 0) {
      return;
    }

    // Initialize required oneOf fields after mount to avoid react-hook-form
    // registration timing issues during the initial render pass.
    field.onChange(createOneOfValue(oneOfOptions[0]!));
    hasInitializedRequiredDefault.current = true;
  }, [field, hasMounted, oneOfOptions, required]);

  // Only attempt auto-selection when the field has an explicit value.
  // Treating undefined as {} would cause empty-property options to score 0 and
  // appear "selected" even though the real form value is still undefined.
  const currentValue =
    field.value !== undefined && isPlainObject(field.value) ? field.value : null;
  const selectedOption =
    currentValue !== null ? findSelectedOneOfOption(oneOfOptions, currentValue) : null;
  const fallbackOption = required && hasMounted ? oneOfOptions[0] || null : null;
  const activeOption = selectedOption ?? fallbackOption;
  const selectedKey = selectedOption
    ? getOneOfOptionIdentity(
        selectedOption as JSONSchema7,
        oneOfOptions.indexOf(selectedOption) ?? 0,
      )
    : fallbackOption
      ? getOneOfOptionIdentity(fallbackOption, oneOfOptions.indexOf(fallbackOption))
      : "";

  return (
    <FormItem>
      {!hideLabel && (
        <FormLabel className="capitalize">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </FormLabel>
      )}
      <div className="space-y-4">
        <Select
          onValueChange={(value) => {
            if (value === "__none__") {
              field.onChange(null);
              return;
            }
            const option = oneOfOptions.find((opt, index) => {
              return getOneOfOptionIdentity(opt as JSONSchema7, index) === value;
            });

            if (option) {
              field.onChange(createOneOfValue(option as JSONSchema7));
            } else {
              field.onChange(null);
            }
          }}
          value={selectedKey || (!required ? "__none__" : "")}
          disabled={disabled}
        >
          <FormControl>
            <SelectTrigger>
              <SelectValue placeholder="Select option" />
            </SelectTrigger>
          </FormControl>
          <SelectContent>
            {!required && <SelectItem value="__none__">Not set</SelectItem>}
            {oneOfOptions.map((option, idx) => {
              const opt = option as JSONSchema7;
              const optionValue = getOneOfOptionIdentity(opt, idx);
              const optionLabel = getOneOfOptionLabel(opt, idx);
              const optionDescription = opt.description || "";
              return (
                <SelectItem key={idx} value={optionValue}>
                  <div>
                    <div className="font-medium">{optionLabel}</div>
                    {optionDescription && (
                      <div className="text-xs text-muted-foreground">
                        {optionDescription}
                      </div>
                    )}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>

        {activeOption && (activeOption as JSONSchema7).properties && (
          <div className="rounded-md border border-muted/40 bg-muted/10 p-4">
            <SchemaObjectFields
              schema={activeOption as JSONSchema7}
              control={control}
              path={fieldPath}
              disabled={disabled}
              forceMasked={forceMasked}
              autoDetectSensitiveFields={autoDetectSensitiveFields}
            />
          </div>
        )}
      </div>
      <FormMessage />
    </FormItem>
  );
}

function ObjectJsonEditorControl({
  fieldName,
  label,
  schema,
  value,
  onChange,
  required,
  hideLabel,
  disabled,
}: {
  fieldName: FieldPath<FieldValues>;
  label: string;
  schema: JSONSchema7;
  value: unknown;
  onChange: (value: unknown) => void;
  required: boolean;
  hideLabel: boolean;
  disabled: boolean;
}) {
  const serializedFieldValue = React.useMemo(
    () => formatJsonObjectValue(schema, value),
    [schema, value],
  );
  const [editorValue, setEditorValue] = React.useState(serializedFieldValue);
  const [parseError, setParseError] = React.useState<string | null>(null);
  const lastSyncedValueRef = React.useRef(serializedFieldValue);

  React.useEffect(() => {
    if (serializedFieldValue !== lastSyncedValueRef.current) {
      setEditorValue(serializedFieldValue);
      setParseError(null);
      lastSyncedValueRef.current = serializedFieldValue;
    }
  }, [serializedFieldValue]);

  const handleEditorChange = (nextValue: string | undefined) => {
    const rawValue = nextValue ?? "";
    setEditorValue(rawValue);

    if (rawValue.trim() === "") {
      lastSyncedValueRef.current = "";
      setParseError(required ? "Enter a JSON object." : null);
      onChange(undefined);
      return;
    }

    try {
      const parsed = JSON.parse(rawValue);

      if (!isPlainObject(parsed)) {
        setParseError("Value must be a JSON object.");
        onChange(undefined);
        return;
      }

      lastSyncedValueRef.current = formatJsonObjectValue(schema, parsed);
      setParseError(null);
      onChange(parsed);
    } catch {
      setParseError("Enter valid JSON.");
      onChange(undefined);
    }
  };

  return (
    <FormItem>
      {!hideLabel && (
        <FormLabel className="capitalize">
          {label}
          {required && <span className="text-destructive"> *</span>}
        </FormLabel>
      )}
      {schema.description && (
        <p className="text-xs text-muted-foreground">{schema.description}</p>
      )}
      <FormControl>
        <div
          className="overflow-hidden rounded-md border border-input bg-background"
          data-testid={`${String(fieldName)}-json-editor`}
        >
          <Editor
            height="240px"
            defaultLanguage="json"
            value={editorValue}
            onChange={handleEditorChange}
            loading={
              <Textarea
                value={editorValue}
                onChange={(event) => handleEditorChange(event.target.value)}
                className="min-h-[240px] rounded-none border-0"
                disabled={disabled}
              />
            }
            options={{
              automaticLayout: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              wordWrap: "on",
              tabSize: 2,
              formatOnPaste: true,
              formatOnType: true,
              lineNumbers: "off",
              glyphMargin: false,
              folding: false,
              overviewRulerBorder: false,
              hideCursorInOverviewRuler: true,
              padding: { top: 12, bottom: 12 },
              readOnly: disabled,
            }}
          />
        </div>
      </FormControl>
      {parseError ? (
        <p className="text-sm font-medium text-destructive">{parseError}</p>
      ) : (
        <FormMessage />
      )}
    </FormItem>
  );
}

function ObjectJsonEditorField({
  fieldName,
  label,
  schema,
  control,
  required,
  hideLabel,
  disabled,
}: {
  fieldName: FieldPath<FieldValues>;
  label: string;
  schema: JSONSchema7;
  control: Control<FieldValues>;
  required: boolean;
  hideLabel: boolean;
  disabled: boolean;
}) {
  return (
    <FormField
      control={control}
      name={fieldName}
      render={({ field }) => (
        <ObjectJsonEditorControl
          fieldName={fieldName}
          label={label}
          schema={schema}
          value={field.value}
          onChange={field.onChange}
          required={required}
          hideLabel={hideLabel}
          disabled={disabled}
        />
      )}
    />
  );
}

function SchemaObjectFields({
  schema,
  control,
  path = "",
  disabled = false,
  forceMasked = false,
  autoDetectSensitiveFields = true,
}: {
  schema: JSONSchema7;
  control: Control<FieldValues>;
  path?: string;
  disabled?: boolean;
  forceMasked?: boolean;
  autoDetectSensitiveFields?: boolean;
}) {
  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const entries = Object.entries(properties).filter(
    ([, value]) => !isConstField(value as JSONSchema7),
  );

  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground">
        No configurable fields available.
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {entries.map(([key, value]) => {
        const prop = value as JSONSchema7;
        const spanFull = shouldSpanFull(prop);
        return (
          <div key={key} className={cn(spanFull && "md:col-span-2")}>
            <SchemaField
              name={key}
              schema={prop}
              control={control}
              path={path}
              required={required.has(key)}
              disabled={disabled}
              forceMasked={forceMasked}
              autoDetectSensitiveFields={autoDetectSensitiveFields}
            />
          </div>
        );
      })}
    </div>
  );
}

function SchemaField({
  name,
  schema,
  control,
  path = "",
  required = false,
  hideLabel = false,
  disabled = false,
  forceMasked = false,
  autoDetectSensitiveFields = true,
}: SchemaFieldProps) {
  const nullable = hasNullType(schema);
  const normalizedSchema = normalizeAnyOfSchema(schema);
  const fieldPath = path ? `${path}.${name}` : name;
  const fieldName = fieldPath as FieldPath<FieldValues>;
  const label = formatLabel(name, normalizedSchema);
  const description = normalizedSchema.description;

  if (normalizedSchema.oneOf && Array.isArray(normalizedSchema.oneOf)) {
    return (
      <FormField
        control={control}
        name={fieldName}
        render={({ field }) => {
          return (
            <OneOfFieldInner
              field={field}
              fieldPath={fieldPath}
              label={label}
              required={required}
              hideLabel={hideLabel}
              disabled={disabled}
              normalizedSchema={normalizedSchema}
              control={control}
              forceMasked={forceMasked}
              autoDetectSensitiveFields={autoDetectSensitiveFields}
            />
          );
        }}
      />
    );
  }

  if (shouldRenderObjectAsJsonEditor(normalizedSchema)) {
    return (
      <ObjectJsonEditorField
        fieldName={fieldName}
        label={label}
        schema={normalizedSchema}
        control={control}
        required={required}
        hideLabel={hideLabel}
        disabled={disabled}
      />
    );
  }

  if (
    isStructuredObjectSchema(normalizedSchema) &&
    normalizedSchema.properties
  ) {
    const content = (
      <SchemaObjectFields
        schema={normalizedSchema}
        control={control}
        path={fieldPath}
        disabled={disabled}
        forceMasked={forceMasked}
        autoDetectSensitiveFields={autoDetectSensitiveFields}
      />
    );

    if (hideLabel) {
      return content;
    }

    return (
      <div className="space-y-3 rounded-md border border-muted/40 bg-muted/10 p-4">
        <div>
          <h4 className="text-sm font-semibold">{label}</h4>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
        </div>
        {content}
      </div>
    );
  }

  if (isArraySchema(normalizedSchema) && normalizedSchema.items) {
    const itemsSchema = normalizeAnyOfSchema(
      normalizedSchema.items as JSONSchema7,
    );
    const hasEnumItems =
      Array.isArray(itemsSchema.enum) && itemsSchema.enum.length > 0;

    return (
      <FormField
        control={control}
        name={fieldName}
        render={({ field }) => {
          const items = Array.isArray(field.value) ? field.value : [];
          const addItem = () => {
            field.onChange([...items, getInitialValue(itemsSchema)]);
          };
          const removeItem = (index: number) => {
            const next = [...items];
            next.splice(index, 1);
            field.onChange(next);
          };

          return (
            <FormItem>
              {!hideLabel && (
                <FormLabel className="capitalize">
                  {label}
                  {required && <span className="text-destructive"> *</span>}
                </FormLabel>
              )}
              <div className="space-y-3">
                {items.length === 0 && !hasEnumItems && (
                  <div className="text-sm text-muted-foreground">
                    No {label.toLowerCase()} added yet.
                  </div>
                )}
                {hasEnumItems && (
                  <FormControl>
                    <ToggleGroup
                      type="multiple"
                      value={items.map((item) => String(item))}
                      onValueChange={(values) => {
                        const optionMap = new Map(
                          (itemsSchema.enum || []).map((option) => [
                            String(option),
                            option,
                          ]),
                        );
                        const next = values.map(
                          (value) => optionMap.get(value) ?? value,
                        );
                        field.onChange(next);
                      }}
                      className="flex flex-wrap gap-2 justify-start"
                      variant="outline"
                      size="sm"
                      spacing={8}
                      disabled={disabled}
                    >
                      {(itemsSchema.enum || []).map((option) => (
                        <ToggleGroupItem
                          key={String(option)}
                          value={String(option)}
                        >
                          {String(option).replace(/_/g, " ")}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </FormControl>
                )}
                {!hasEnumItems && (
                  <>
                    {items.map((item, index) => {
                      const isComplexItem =
                        Boolean(itemsSchema.oneOf) ||
                        isObjectSchema(itemsSchema) ||
                        isArraySchema(itemsSchema);

                      if (isComplexItem) {
                        return (
                          <Card key={index} className="shadow-none">
                            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                              <CardTitle className="text-sm font-medium">
                                Item {index + 1}
                              </CardTitle>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => removeItem(index)}
                                disabled={disabled}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </CardHeader>
                            <CardContent className="space-y-4">
                              {isObjectSchema(itemsSchema) &&
                              itemsSchema.properties ? (
                                <SchemaObjectFields
                                  schema={itemsSchema}
                                  control={control}
                                  path={`${fieldPath}.${index}`}
                                  disabled={disabled}
                                  forceMasked={forceMasked}
                                  autoDetectSensitiveFields={
                                    autoDetectSensitiveFields
                                  }
                                />
                              ) : (
                                <SchemaField
                                  name={String(index)}
                                  schema={itemsSchema}
                                  control={control}
                                  path={fieldPath}
                                  hideLabel
                                  disabled={disabled}
                                  forceMasked={forceMasked}
                                  autoDetectSensitiveFields={
                                    autoDetectSensitiveFields
                                  }
                                />
                              )}
                            </CardContent>
                          </Card>
                        );
                      }

                      const handleValueChange = (value: unknown) => {
                        const next = [...items];
                        next[index] = value;
                        field.onChange(next);
                      };

                      if (itemsSchema.enum && Array.isArray(itemsSchema.enum)) {
                        const options = itemsSchema.enum;
                        const current = options.find(
                          (option) => option === item,
                        );

                        return (
                          <div key={index} className="flex gap-2">
                            <FormControl>
                              <Select
                                value={
                                  current !== undefined ? String(current) : ""
                                }
                                onValueChange={(value) => {
                                  const raw = options.find(
                                    (option) => String(option) === value,
                                  );
                                  handleValueChange(raw ?? value);
                                }}
                                disabled={disabled}
                              >
                                <SelectTrigger>
                                  <SelectValue placeholder="Select option" />
                                </SelectTrigger>
                                <SelectContent>
                                  {options.map((option) => (
                                    <SelectItem
                                      key={String(option)}
                                      value={String(option)}
                                    >
                                      {String(option)}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </FormControl>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(index)}
                              disabled={disabled}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      }

                      if (itemsSchema.type === "boolean") {
                        return (
                          <div key={index} className="flex items-center gap-2">
                            <FormControl>
                              <Checkbox
                                checked={Boolean(item)}
                                onCheckedChange={(checked) =>
                                  handleValueChange(checked === true)
                                }
                                disabled={disabled}
                              />
                            </FormControl>
                            <span className="text-sm text-muted-foreground">
                              Item {index + 1}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(index)}
                              disabled={disabled}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      }

                      if (
                        itemsSchema.type === "number" ||
                        itemsSchema.type === "integer"
                      ) {
                        return (
                          <div key={index} className="flex gap-2">
                            <FormControl>
                              <Input
                                type="number"
                                value={item ?? ""}
                                onChange={(event) => {
                                  const nextValue = event.target.value;
                                  handleValueChange(nextValue);
                                }}
                                autoComplete="off"
                                disabled={disabled}
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeItem(index)}
                              disabled={disabled}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        );
                      }

                      return (
                        <div key={index} className="flex gap-2">
                          <FormControl>
                            <Input
                              value={item ?? ""}
                              onChange={(event) =>
                                handleValueChange(event.target.value)
                              }
                              placeholder={
                                itemsSchema.description || "Enter value"
                              }
                              autoComplete="off"
                              disabled={disabled}
                            />
                          </FormControl>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeItem(index)}
                            disabled={disabled}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      );
                    })}

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addItem}
                      disabled={disabled}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add {label}
                    </Button>
                  </>
                )}
              </div>
              <FormMessage />
            </FormItem>
          );
        }}
      />
    );
  }

  if (normalizedSchema.enum && Array.isArray(normalizedSchema.enum)) {
    const options = normalizedSchema.enum;
    return (
      <FormField
        control={control}
        name={fieldName}
        render={({ field }) => (
          <FormItem>
            {!hideLabel && (
              <FormLabel className="capitalize">
                {label}
                {required && <span className="text-destructive"> *</span>}
              </FormLabel>
            )}
            <Select
              onValueChange={(value) => {
                if (value === "__none__") {
                  field.onChange(null);
                  return;
                }
                const raw = options.find((option) => String(option) === value);
                field.onChange(raw ?? value);
              }}
              value={
                field.value === null
                  ? "__none__"
                  : field.value !== undefined
                    ? String(field.value)
                    : !required
                      ? "__none__"
                      : normalizedSchema.default !== undefined
                        ? String(normalizedSchema.default)
                        : ""
              }
              disabled={disabled}
            >
              <FormControl>
                <SelectTrigger>
                  <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                {(nullable || !required) && (
                  <SelectItem value="__none__">
                    {nullable ? "None" : "Not set"}
                  </SelectItem>
                )}
                {options.map((option) => (
                  <SelectItem key={String(option)} value={String(option)}>
                    {String(option)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  if (normalizedSchema.type === "boolean") {
    return (
      <FormField
        control={control}
        name={fieldName}
        render={({ field }) => (
          <FormItem className="flex flex-row items-start space-x-3 space-y-0">
            <FormControl>
              <Checkbox
                checked={field.value ?? normalizedSchema.default ?? false}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                disabled={disabled}
              />
            </FormControl>
            <div className="space-y-1 leading-none">
              {!hideLabel && (
                <FormLabel className="capitalize">
                  {label}
                  {required && <span className="text-destructive"> *</span>}
                </FormLabel>
              )}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  if (
    normalizedSchema.type === "number" ||
    normalizedSchema.type === "integer"
  ) {
    return (
      <FormField
        control={control}
        name={fieldName}
        render={({ field }) => (
          <FormItem>
            {!hideLabel && (
              <FormLabel className="capitalize">
                {label}
                {required && <span className="text-destructive"> *</span>}
              </FormLabel>
            )}
            <FormControl>
              <Input
                type="number"
                {...field}
                value={field.value ?? ""}
                onChange={(event) => {
                  field.onChange(event.target.value);
                }}
                autoComplete="off"
                disabled={disabled}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    );
  }

  const isPassword =
    forceMasked ||
    (autoDetectSensitiveFields &&
      (name.toLowerCase().includes("password") ||
        name.toLowerCase().includes("token") ||
        name.toLowerCase().includes("secret") ||
        name.toLowerCase().includes("key")));
  const isUrl =
    normalizedSchema.format === "uri" || name.toLowerCase().includes("url");
  const isLongField = isLongText(normalizedSchema);

  return (
    <FormField
      control={control}
      name={fieldName}
      render={({ field }) => (
        <FormItem>
          {!hideLabel && (
            <FormLabel className="capitalize">
              {label}
              {required && <span className="text-destructive"> *</span>}
            </FormLabel>
          )}
          <FormControl>
            {isPassword ? (
              <Input
                type="password"
                placeholder={formatPlaceholder(name, normalizedSchema)}
                {...field}
                value={field.value ?? ""}
                autoComplete="new-password"
                disabled={disabled}
              />
            ) : isLongField ? (
              <Textarea
                placeholder={formatPlaceholder(name, normalizedSchema)}
                {...field}
                value={field.value ?? ""}
                autoComplete="off"
                disabled={disabled}
              />
            ) : (
              <Input
                type={isUrl ? "url" : "text"}
                placeholder={formatPlaceholder(name, normalizedSchema)}
                {...field}
                value={field.value ?? ""}
                autoComplete="off"
                disabled={disabled}
              />
            )}
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export interface JsonSchemaFormProps {
  schema: JSONSchema7;
  defaultValues?: Record<string, unknown>;
  includeSchemaDefaults?: boolean;
  autoDetectSensitiveFields?: boolean;
  onSubmit: (data: Record<string, unknown>) => void;
  onSecondarySubmit?: (data: Record<string, unknown>) => void;
  onCancel?: () => void;
  submitLabel?: string;
  secondarySubmitLabel?: string;
  cancelLabel?: string;
  showCancel?: boolean;
  disabled?: boolean;
  assistantSourceType?: string;
  schedule?: ScheduleValue;
  onScheduleChange?: (value: ScheduleValue) => void;
  showActions?: boolean;
}

export interface JsonSchemaFormHandle {
  getValues: () => Record<string, unknown>;
  applyPatches: (
    patches: Array<{ path: string; value: unknown }>,
  ) => Promise<void>;
  validate: () => Promise<{
    isValid: boolean;
    missingFields: string[];
    errors: string[];
  }>;
}

export interface JsonSchemaFieldsProps {
  schema: JSONSchema7;
  control: Control<FieldValues>;
  path?: string;
  disabled?: boolean;
}

export function JsonSchemaFields({
  schema,
  control,
  path = "",
  disabled = false,
}: JsonSchemaFieldsProps) {
  if (isStructuredObjectSchema(schema) && schema.properties) {
    return (
      <SchemaObjectFields
        schema={schema}
        control={control}
        path={path}
        disabled={disabled}
      />
    );
  }

  const fallbackName =
    schema.title?.toLowerCase().replace(/\s+/g, "_") || "value";
  return (
    <SchemaField
      name={fallbackName}
      schema={schema}
      control={control}
      path={path}
      hideLabel
      disabled={disabled}
    />
  );
}

export const JsonSchemaForm = React.forwardRef<
  JsonSchemaFormHandle,
  JsonSchemaFormProps
>(function JsonSchemaForm(
  {
    schema,
    defaultValues = {},
    includeSchemaDefaults = true,
    autoDetectSensitiveFields = true,
    onSubmit,
    onSecondarySubmit,
    onCancel,
    submitLabel = "Submit",
    secondarySubmitLabel,
    cancelLabel = "Cancel",
    showCancel = true,
    disabled = false,
    assistantSourceType,
    schedule,
    onScheduleChange,
    showActions = true,
  },
  ref,
) {
  const zodSchema = React.useMemo(() => {
    const shape: Record<string, z.ZodTypeAny> = {};
    const required = schema.required || [];

    if (schema.properties) {
      for (const [key, value] of Object.entries(schema.properties)) {
        const propSchema = value as JSONSchema7;
        const zodProp = jsonSchemaToZod(propSchema);
        shape[key] = applyOptionalSchema(
          propSchema,
          zodProp,
          required.includes(key),
        );
      }
    }

    return z.object(shape);
  }, [schema]);

  type FormValues = z.infer<typeof zodSchema>;

  const mergedDefaults = React.useMemo(() => {
    if (!includeSchemaDefaults) {
      return { ...(defaultValues || {}) };
    }

    return buildFormDefaults(schema, defaultValues);
  }, [schema, defaultValues, includeSchemaDefaults]);

  const form = useForm<FormValues>({
    resolver: zodResolver(zodSchema),
    defaultValues: mergedDefaults as FormValues,
  });
  const hasInitializedResetRef = React.useRef(false);

  React.useEffect(() => {
    if (!hasInitializedResetRef.current) {
      hasInitializedResetRef.current = true;
      return;
    }

    form.reset(mergedDefaults as FormValues);
  }, [form, mergedDefaults]);

  React.useImperativeHandle(
    ref,
    () => ({
      getValues: () => form.getValues() as Record<string, unknown>,
      applyPatches: async (patches) => {
        for (const patch of patches) {
          form.setValue(
            patch.path as FieldPath<FormValues>,
            patch.value as PathValue<FormValues, FieldPath<FormValues>>,
            {
              shouldDirty: true,
              shouldTouch: true,
              shouldValidate: true,
            },
          );
        }
        await form.trigger();
      },
      validate: async () => {
        const isValid = await form.trigger();
        const values = form.getValues() as Record<string, unknown>;
        return {
          isValid,
          missingFields: collectMissingRequiredFields(schema, values),
          errors: flattenFormErrors(
            form.formState.errors as Record<string, unknown>,
          ),
        };
      },
    }),
    [form, schema],
  );

  const handleSubmit = (data: FormValues) => {
    onSubmit(data);
  };

  const handleSecondarySubmit = onSecondarySubmit
    ? form.handleSubmit((data) =>
        onSecondarySubmit(data as Record<string, unknown>),
      )
    : undefined;

  const properties = schema.properties || {};
  const required = new Set(schema.required || []);
  const nameSchema = properties.name as JSONSchema7 | undefined;
  const getBlockEntry = (aliases: string[]) => {
    for (const key of aliases) {
      const candidate = properties[key] as JSONSchema7 | undefined;
      if (candidate) {
        return { key, schema: candidate };
      }
    }
    return null;
  };

  const resolveKnowledge = (...keys: string[]) => {
    if (!assistantSourceType) {
      return { sectionKey: keys[0], knowledge: null };
    }
    for (const key of keys) {
      const knowledge = getSourceSectionKnowledge(assistantSourceType, key);
      if (knowledge) {
        return { sectionKey: key, knowledge };
      }
    }
    return { sectionKey: keys[0], knowledge: null };
  };

  const requiredBlock = getBlockEntry(["required", "required_fields"]);
  const maskedBlock = getBlockEntry(["masked", "masked_fields"]);
  const optionalBlock = getBlockEntry(["optional", "optional_fields"]);
  const samplingBlock = getBlockEntry(["sampling"]);

  const TABULAR_SOURCE_TYPE_MAP: Record<IngestionSourceType, boolean> = {
    WORDPRESS: false,
    SLACK: false,
    S3_COMPATIBLE_STORAGE: false,
    AZURE_BLOB_STORAGE: false,
    GOOGLE_CLOUD_STORAGE: false,
    POSTGRESQL: true,
    MYSQL: true,
    MSSQL: true,
    ORACLE: true,
    HIVE: true,
    DATABRICKS: true,
    SNOWFLAKE: true,
    MONGODB: false,
    POWERBI: false,
    TABLEAU: false,
    CONFLUENCE: false,
    JIRA: false,
    SERVICEDESK: false,
  };
  const isTabular =
    assistantSourceType && isIngestionSourceType(assistantSourceType)
      ? TABULAR_SOURCE_TYPE_MAP[assistantSourceType]
      : false;

  const reservedBlockKeys = new Set(
    [
      requiredBlock?.key,
      maskedBlock?.key,
      optionalBlock?.key,
      samplingBlock?.key,
    ].filter(Boolean) as string[],
  );

  const legacyEntries = Object.entries(properties)
    .filter(
      ([key, value]) =>
        key !== "name" &&
        !reservedBlockKeys.has(key) &&
        !isConstField(value as JSONSchema7),
    )
    .map(([key, value]) => {
      const prop = value as JSONSchema7;
      return {
        key,
        schema: prop,
        isComplex: isComplexSchema(prop),
        isRequired: required.has(key) || hasRequiredFields(prop),
      };
    });

  const legacyRequiredEntries = legacyEntries.filter(
    (entry) => entry.isRequired,
  );
  const legacyOptionalEntries = legacyEntries.filter(
    (entry) => !entry.isRequired,
  );
  const legacyRequiredSimpleEntries = legacyRequiredEntries.filter(
    (entry) => !entry.isComplex,
  );
  const legacyRequiredComplexEntries = legacyRequiredEntries.filter(
    (entry) => entry.isComplex,
  );
  const legacyOptionalSimpleEntries = legacyOptionalEntries.filter(
    (entry) => !entry.isComplex,
  );
  const legacyOptionalComplexEntries = legacyOptionalEntries.filter(
    (entry) => entry.isComplex,
  );

  const optionalBlockEntries = optionalBlock?.schema.properties
    ? Object.entries(optionalBlock.schema.properties).filter(
        ([, value]) => !isConstField(value as JSONSchema7),
      )
    : [];
  const optionalRequiredKeys = new Set(optionalBlock?.schema.required || []);
  const hasOptionalParameters =
    optionalBlockEntries.length > 0 || legacyOptionalEntries.length > 0;
  const shouldExpandOptionalParametersByDefault = React.useMemo(() => {
    const rawDefaults = defaultValues || {};

    const hasOptionalBlockValues =
      optionalBlock && hasConfiguredValue(rawDefaults[optionalBlock.key]);

    const hasLegacyOptionalValues = legacyOptionalEntries.some(({ key }) =>
      hasConfiguredValue(rawDefaults[key]),
    );

    return Boolean(hasOptionalBlockValues || hasLegacyOptionalValues);
  }, [defaultValues, legacyOptionalEntries, optionalBlock]);
  const shouldShowValidationBanner =
    form.formState.submitCount > 0 &&
    hasValidationErrors(form.formState.errors);

  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit(handleSubmit)}
        className="space-y-6"
        autoComplete="off"
      >
        {nameSchema &&
          (() => {
            const knowledge = assistantSourceType
              ? getSourceSectionKnowledge(assistantSourceType, "name")
              : null;
            return (
              <AiAssistedCard
                title="Source Name"
                description="Give this source a clear, unique name so it stands out later."
                knowledge={knowledge}
                promptContext={
                  assistantSourceType && knowledge
                    ? buildSourcePrompt({
                        sourceType: assistantSourceType,
                        sectionKey: "name",
                        schema: nameSchema as unknown as Record<
                          string,
                          unknown
                        >,
                        summary: knowledge.summary,
                        suggestions: knowledge.suggestions ?? [],
                        questions: knowledge.questions ?? [],
                      })
                    : undefined
                }
              >
                <SchemaField
                  name="name"
                  schema={nameSchema}
                  control={form.control}
                  required={required.has("name")}
                  disabled={disabled}
                  autoDetectSensitiveFields={autoDetectSensitiveFields}
                />
              </AiAssistedCard>
            );
          })()}

        {requiredBlock &&
          (() => {
            const section = resolveKnowledge(
              requiredBlock.key,
              "required",
              "required_fields",
            );
            return (
              <AiAssistedCard
                title="Required fields"
                description={undefined}
                knowledge={section.knowledge}
                promptContext={
                  assistantSourceType && section.knowledge
                    ? buildSourcePrompt({
                        sourceType: assistantSourceType,
                        sectionKey: section.sectionKey,
                        schema: requiredBlock.schema as unknown as Record<
                          string,
                          unknown
                        >,
                        summary: section.knowledge.summary,
                        suggestions: section.knowledge.suggestions ?? [],
                        questions: section.knowledge.questions ?? [],
                      })
                    : undefined
                }
              >
                <SchemaField
                  name={requiredBlock.key}
                  schema={requiredBlock.schema}
                  control={form.control}
                  required={required.has(requiredBlock.key)}
                  hideLabel
                  disabled={disabled}
                  autoDetectSensitiveFields={autoDetectSensitiveFields}
                />
              </AiAssistedCard>
            );
          })()}

        {maskedBlock &&
          (() => {
            const section = resolveKnowledge(
              maskedBlock.key,
              "masked",
              "masked_fields",
            );
            return (
              <AiAssistedCard
                title="Authentication"
                description={undefined}
                knowledge={section.knowledge}
                promptContext={
                  assistantSourceType && section.knowledge
                    ? buildSourcePrompt({
                        sourceType: assistantSourceType,
                        sectionKey: section.sectionKey,
                        schema: maskedBlock.schema as unknown as Record<
                          string,
                          unknown
                        >,
                        summary: section.knowledge.summary,
                        suggestions: section.knowledge.suggestions ?? [],
                        questions: section.knowledge.questions ?? [],
                      })
                    : undefined
                }
              >
                <SchemaField
                  name={maskedBlock.key}
                  schema={maskedBlock.schema}
                  control={form.control}
                  required={required.has(maskedBlock.key)}
                  hideLabel
                  forceMasked
                  disabled={disabled}
                  autoDetectSensitiveFields={autoDetectSensitiveFields}
                />
              </AiAssistedCard>
            );
          })()}

        {hasOptionalParameters && (
          <Accordion
            type="multiple"
            defaultValue={
              shouldExpandOptionalParametersByDefault
                ? ["optional-parameters"]
                : undefined
            }
          >
            <AccordionItem
              value="optional-parameters"
              className="border-black/70 shadow-[6px_6px_0_#000]"
            >
              <AccordionTrigger
                className="hover:no-underline"
                caption="Additional settings you can configure when the default connection setup is not enough."
              >
                Optional Parameters
              </AccordionTrigger>
              <AccordionContent className="space-y-4">
                {optionalBlockEntries.map(([key, value]) => {
                  const prop = value as JSONSchema7;
                  const isEntryRequired =
                    optionalRequiredKeys.has(key) || hasRequiredFields(prop);
                  const section = resolveKnowledge(
                    `optional.${key}`,
                    `${optionalBlock?.key}.${key}`,
                    key,
                    "optional",
                  );
                  const heading = formatLabel(key, prop);

                  return (
                    <AiAssistedCard
                      key={key}
                      title={heading}
                      description={prop.description}
                      withShadow={false}
                      knowledge={section.knowledge}
                      promptContext={
                        assistantSourceType && section.knowledge
                          ? buildSourcePrompt({
                              sourceType: assistantSourceType,
                              sectionKey: section.sectionKey,
                              schema: prop as unknown as Record<
                                string,
                                unknown
                              >,
                              summary: section.knowledge.summary,
                              suggestions: section.knowledge.suggestions ?? [],
                              questions: section.knowledge.questions ?? [],
                            })
                          : undefined
                      }
                    >
                      <SchemaField
                        name={key}
                        schema={prop}
                        control={form.control}
                        path={optionalBlock?.key}
                        required={isEntryRequired}
                        hideLabel
                        disabled={disabled}
                        autoDetectSensitiveFields={autoDetectSensitiveFields}
                      />
                    </AiAssistedCard>
                  );
                })}

                {legacyOptionalSimpleEntries.length > 0 && (
                  <AiAssistedCard
                    title="Additional Configuration"
                    description="General optional fields that fine-tune this source."
                    withShadow={false}
                  >
                    <div className="grid gap-4 md:grid-cols-2">
                      {legacyOptionalSimpleEntries.map(
                        ({ key, schema: prop }) => {
                          const spanFull = shouldSpanFull(prop);
                          return (
                            <div
                              key={key}
                              className={cn(spanFull && "md:col-span-2")}
                            >
                              <SchemaField
                                name={key}
                                schema={prop}
                                control={form.control}
                                required={false}
                                disabled={disabled}
                                autoDetectSensitiveFields={
                                  autoDetectSensitiveFields
                                }
                              />
                            </div>
                          );
                        },
                      )}
                    </div>
                  </AiAssistedCard>
                )}

                {legacyOptionalComplexEntries.map(({ key, schema: prop }) => {
                  const section = resolveKnowledge(
                    `optional.${key}`,
                    key,
                    "optional",
                  );
                  return (
                    <AiAssistedCard
                      key={key}
                      title={formatLabel(key, prop)}
                      description={prop.description}
                      withShadow={false}
                      knowledge={section.knowledge}
                      promptContext={
                        assistantSourceType && section.knowledge
                          ? buildSourcePrompt({
                              sourceType: assistantSourceType,
                              sectionKey: section.sectionKey,
                              schema: prop as unknown as Record<
                                string,
                                unknown
                              >,
                              summary: section.knowledge.summary,
                              suggestions: section.knowledge.suggestions ?? [],
                              questions: section.knowledge.questions ?? [],
                            })
                          : undefined
                      }
                    >
                      <div className="space-y-4">
                        <SchemaField
                          name={key}
                          schema={prop}
                          control={form.control}
                          required={false}
                          hideLabel
                          disabled={disabled}
                          autoDetectSensitiveFields={autoDetectSensitiveFields}
                        />
                      </div>
                    </AiAssistedCard>
                  );
                })}
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        )}

        {legacyRequiredSimpleEntries.length > 0 &&
          (() => {
            const section = resolveKnowledge("required", "configuration");
            return (
              <AiAssistedCard
                title="Required Configuration"
                description={
                  schema.description || "Complete these fields to finish setup."
                }
                knowledge={section.knowledge}
                promptContext={
                  assistantSourceType && section.knowledge
                    ? buildSourcePrompt({
                        sourceType: assistantSourceType,
                        sectionKey: section.sectionKey,
                        schema: schema as unknown as Record<string, unknown>,
                        summary: section.knowledge.summary,
                        suggestions: section.knowledge.suggestions ?? [],
                        questions: section.knowledge.questions ?? [],
                      })
                    : undefined
                }
              >
                <div className="grid gap-4 md:grid-cols-2">
                  {legacyRequiredSimpleEntries.map(({ key, schema: prop }) => {
                    const spanFull = shouldSpanFull(prop);
                    return (
                      <div
                        key={key}
                        className={cn(spanFull && "md:col-span-2")}
                      >
                        <SchemaField
                          name={key}
                          schema={prop}
                          control={form.control}
                          required={true}
                          disabled={disabled}
                          autoDetectSensitiveFields={autoDetectSensitiveFields}
                        />
                      </div>
                    );
                  })}
                </div>
              </AiAssistedCard>
            );
          })()}

        {legacyRequiredComplexEntries.map(({ key, schema: prop }) => {
          const section = resolveKnowledge(key, "required");
          return (
            <AiAssistedCard
              key={key}
              title={formatLabel(key, prop)}
              description={prop.description}
              knowledge={section.knowledge}
              promptContext={
                assistantSourceType && section.knowledge
                  ? buildSourcePrompt({
                      sourceType: assistantSourceType,
                      sectionKey: section.sectionKey,
                      schema: prop as unknown as Record<string, unknown>,
                      summary: section.knowledge.summary,
                      suggestions: section.knowledge.suggestions ?? [],
                      questions: section.knowledge.questions ?? [],
                    })
                  : undefined
              }
            >
              <div className="space-y-4">
                <SchemaField
                  name={key}
                  schema={prop}
                  control={form.control}
                  required={true}
                  hideLabel
                  disabled={disabled}
                  autoDetectSensitiveFields={autoDetectSensitiveFields}
                />
              </div>
            </AiAssistedCard>
          );
        })}

        {samplingBlock && (
          <FormField
            control={form.control}
            name={samplingBlock.key as never}
            render={({ field }) => (
              <SamplingCard
                value={field.value as SamplingValue}
                onChange={field.onChange}
                isTabular={isTabular}
                disabled={disabled}
              />
            )}
          />
        )}

        {schedule !== undefined && onScheduleChange && (
          <ScheduleCard
            value={schedule}
            onChange={onScheduleChange}
            disabled={disabled}
          />
        )}

        {shouldShowValidationBanner && (
          <div className="rounded-[4px] border-2 border-destructive/70 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            Validation failed. Complete all required fields before testing or
            saving.
          </div>
        )}

        {showActions && (
          <div className="flex flex-col justify-end gap-2 border-t pt-4 sm:flex-row">
            {showCancel && onCancel && (
              <Button
                type="button"
                variant="outline"
                onClick={onCancel}
                disabled={disabled}
                className="rounded-[4px] border-2 border-black"
              >
                {cancelLabel}
              </Button>
            )}
            {onSecondarySubmit && secondarySubmitLabel && (
              <Button
                type="button"
                variant="outline"
                onClick={handleSecondarySubmit}
                disabled={disabled}
                className="rounded-[4px] border-2 border-black"
                data-testid="btn-test-source"
              >
                {secondarySubmitLabel}
              </Button>
            )}
            <Button
              type="submit"
              disabled={disabled}
              className="rounded-[4px] border-2 border-black bg-black text-white hover:bg-black/90"
              data-testid="btn-save-source"
            >
              {submitLabel}
            </Button>
          </div>
        )}
      </form>
    </Form>
  );
});
