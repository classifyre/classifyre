const MASK_KEYS = ["masked", "mask", "masked_fields"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function setAllNestedValuesUndefined(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => setAllNestedValuesUndefined(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, nestedValue]) => [
        key,
        setAllNestedValuesUndefined(nestedValue),
      ]),
    );
  }
  return undefined;
}

export function sanitizeTemplateConfig(
  configData: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...configData };

  for (const key of MASK_KEYS) {
    if (key in next && isRecord(next[key])) {
      next[key] = setAllNestedValuesUndefined(next[key]);
    }
  }

  return next;
}
