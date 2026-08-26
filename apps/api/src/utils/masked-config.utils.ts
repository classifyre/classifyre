export const MASKED_CONFIG_ENCRYPTED_PREFIX = 'enc::v1::';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function transformMaskedLeafValues(
  value: unknown,
  transformer: (input: string) => string,
): unknown {
  if (typeof value === 'string') {
    return transformer(value);
  }

  if (Array.isArray(value)) {
    return value.map((item) => transformMaskedLeafValues(item, transformer));
  }

  if (isPlainObject(value)) {
    const transformed: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      transformed[key] = transformMaskedLeafValues(nestedValue, transformer);
    }
    return transformed;
  }

  return value;
}

export function transformMaskedConfig(
  config: Record<string, unknown>,
  transformer: (input: string) => string,
): Record<string, unknown> {
  if (!isPlainObject(config)) {
    return config;
  }

  if (!Object.hasOwn(config, 'masked')) {
    return { ...config };
  }

  return {
    ...config,
    masked: transformMaskedLeafValues(config.masked, transformer),
  };
}

/**
 * Merge an incoming `masked` section onto the existing one, leaf by leaf.
 *
 * Secret/credential values are write-only: an API response never sends one
 * back, so a caller resupplying a source's whole config cannot round-trip a
 * leaf it wasn't actually changing -- that leaf simply comes back blank or
 * missing. Treating "blank or missing" as "clear it" means saving anything
 * about a source, for any reason, wipes every credential on it. This treats
 * each leaf independently instead: a non-empty string overwrites (the
 * caller supplied a fresh value, or the leaf is new), `null`/`""` deletes it
 * (an explicit clear), and anything absent from `incoming` keeps whatever
 * was already there.
 *
 * Nests to arbitrary depth so it works for both shapes actually in use --
 * flat (`masked.password`) and one level deeper (`masked.secrets.API_KEY`,
 * the CUSTOM source's per-notebook-secret bag).
 */
export function mergeMaskedConfig(
  existing: unknown,
  incoming: unknown,
): Record<string, unknown> {
  const existingObj = isPlainObject(existing) ? existing : {};
  const incomingObj = isPlainObject(incoming) ? incoming : {};

  const merged: Record<string, unknown> = { ...existingObj };
  for (const [key, value] of Object.entries(incomingObj)) {
    if (value === null || value === '') {
      delete merged[key];
    } else if (isPlainObject(value) || isPlainObject(existingObj[key])) {
      merged[key] = mergeMaskedConfig(existingObj[key], value);
    } else {
      merged[key] = value;
    }
  }
  return merged;
}

export function isEncryptedMaskedValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith(MASKED_CONFIG_ENCRYPTED_PREFIX)
  );
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(
    ([left], [right]) => left.localeCompare(right),
  );
  const body = entries
    .map(
      ([key, nestedValue]) =>
        `${JSON.stringify(key)}:${stableStringify(nestedValue)}`,
    )
    .join(',');
  return `{${body}}`;
}
