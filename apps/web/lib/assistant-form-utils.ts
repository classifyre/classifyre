import type { JSONSchema7 } from "json-schema";

export type AssistantValidationSnapshot = {
  isValid: boolean;
  missingFields: string[];
  errors: string[];
};

export function getValueAtPath(
  input: Record<string, unknown>,
  path: string,
): unknown {
  if (!path) {
    return input;
  }

  return path.split(".").reduce<unknown>((value, segment) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }

    return (value as Record<string, unknown>)[segment];
  }, input);
}

export function setValueAtPath<T extends Record<string, unknown>>(
  input: T,
  path: string,
  value: unknown,
): T {
  const segments = path.split(".").filter(Boolean);
  if (segments.length === 0) {
    return input;
  }

  const nextRoot = structuredClone(input) as T;
  let cursor: Record<string, unknown> = nextRoot;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]!;
    const current = cursor[segment];
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      cursor[segment] = {};
    }
    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]!] = value;
  return nextRoot;
}

export function flattenObjectToPatches(
  input: Record<string, unknown>,
  prefix = "",
): Array<{ path: string; value: unknown }> {
  return Object.entries(input).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return flattenObjectToPatches(value as Record<string, unknown>, path);
    }

    return [{ path, value }];
  });
}

export function collectMissingRequiredFields(
  schema: JSONSchema7,
  values: Record<string, unknown>,
  path = "",
): string[] {
  if (!schema.properties || !schema.required?.length) {
    return [];
  }

  const missing: string[] = [];

  for (const key of schema.required) {
    const nextPath = path ? `${path}.${key}` : key;
    const fieldSchema = schema.properties[key] as JSONSchema7 | undefined;
    const value = values[key];

    if (isEmptyValue(value)) {
      missing.push(nextPath);
      continue;
    }

    if (
      fieldSchema?.type === "object" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      missing.push(
        ...collectMissingRequiredFields(
          fieldSchema,
          value as Record<string, unknown>,
          nextPath,
        ),
      );
    }
  }

  return missing;
}

function isEmptyValue(value: unknown) {
  if (value === null || value === undefined) {
    return true;
  }

  if (typeof value === "string") {
    return value.trim().length === 0;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === "object") {
    return Object.keys(value as Record<string, unknown>).length === 0;
  }

  return false;
}
