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
