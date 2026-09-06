export const MASKED_CONFIG_ENCRYPTED_PREFIX = 'enc::v1::';

/**
 * Recipe paths whose leaf strings are secrets, in dotted form.
 *
 * `masked` is every source's credential bag; `augmentation.secrets` is the
 * augmentation notebook's, kept at the top level (rather than under `masked`)
 * so the 38 `*Masked` schema definitions do not all need the field. Every
 * consumer — encrypt/decrypt at rest, write-only secret merge, export
 * redaction, the CLI redactor — drives off this one list so the path
 * knowledge does not scatter.
 */
export const ENCRYPTED_CONFIG_PATHS = [
  'masked',
  'augmentation.secrets',
] as const;

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

function getAtPath(root: Record<string, unknown>, path: string): unknown {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (!isPlainObject(node)) return undefined;
    node = node[key];
  }
  return node;
}

function setAtPath(
  root: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const [head, ...rest] = path.split('.');
  if (rest.length === 0) {
    return { ...root, [head]: value };
  }
  const nested = isPlainObject(root[head]) ? root[head] : {};
  return { ...root, [head]: setAtPath(nested, rest.join('.'), value) };
}

function hasPath(root: Record<string, unknown>, path: string): boolean {
  let node: unknown = root;
  for (const key of path.split('.')) {
    if (!isPlainObject(node) || !Object.hasOwn(node, key)) return false;
    node = node[key];
  }
  return true;
}

export function transformMaskedConfig(
  config: Record<string, unknown>,
  transformer: (input: string) => string,
): Record<string, unknown> {
  if (!isPlainObject(config)) {
    return config;
  }

  let result = { ...config };
  for (const path of ENCRYPTED_CONFIG_PATHS) {
    if (!hasPath(result, path)) continue;
    result = setAtPath(
      result,
      path,
      transformMaskedLeafValues(getAtPath(result, path), transformer),
    );
  }
  return result;
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

/**
 * Merge an incoming full source config onto the stored one, leaf by leaf,
 * for every encrypted path.
 *
 * Same write-only rule as {@link mergeMaskedConfig}, applied at each path in
 * {@link ENCRYPTED_CONFIG_PATHS}: a non-empty string overwrites, `null`/`""`
 * deletes, absence keeps. Paths neither side mentions are left alone, so a
 * source without augmentation gains no empty `augmentation` key.
 */
export function mergeEncryptedConfigs(
  existing: Record<string, unknown> | undefined,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  let merged = { ...incoming };
  for (const path of ENCRYPTED_CONFIG_PATHS) {
    const existingValue = existing ? getAtPath(existing, path) : undefined;
    const incomingValue = getAtPath(merged, path);
    if (
      path !== 'masked' &&
      existingValue === undefined &&
      incomingValue === undefined
    ) {
      continue;
    }
    // `masked` keeps its historical always-present shape (merged even when
    // both sides lack it); other paths stay absent when both sides lack them.
    merged = setAtPath(
      merged,
      path,
      mergeMaskedConfig(existingValue, incomingValue),
    );
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
