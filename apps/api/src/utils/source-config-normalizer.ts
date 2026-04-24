const VALID_SAMPLING_STRATEGIES = new Set(['RANDOM', 'LATEST', 'ALL']);

type JsonRecord = Record<string, unknown>;

function asObject(value: unknown): JsonRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as JsonRecord;
}

function asPositiveInteger(value: unknown): number | undefined {
  const numeric =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  if (!Number.isFinite(numeric)) {
    return undefined;
  }
  const intValue = Math.trunc(numeric);
  return intValue > 0 ? intValue : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function normalizeSamplingStrategy(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return VALID_SAMPLING_STRATEGIES.has(normalized) ? normalized : undefined;
}

function ensureNestedObject(parent: JsonRecord, key: string): JsonRecord {
  const existing = asObject(parent[key]);
  if (existing) {
    return existing;
  }
  const next: JsonRecord = {};
  parent[key] = next;
  return next;
}

function removeUndefinedKeys(value: JsonRecord) {
  for (const [key, entry] of Object.entries(value)) {
    if (entry === undefined) {
      delete value[key];
    }
  }
}

function normalizeObjectStorageShape(type: string, config: JsonRecord) {
  const required = ensureNestedObject(config, 'required');
  const optional = ensureNestedObject(config, 'optional');
  const optionalConnection = ensureNestedObject(optional, 'connection');
  const optionalScope = ensureNestedObject(optional, 'scope');

  for (const key of [
    'request_timeout_seconds',
    'max_keys_per_page',
    'max_object_bytes',
  ]) {
    const value = config[key];
    if (value !== undefined && optionalConnection[key] === undefined) {
      optionalConnection[key] = value;
    }
    delete config[key];
  }

  for (const key of [
    'prefix',
    'include_extensions',
    'exclude_extensions',
    'include_empty_objects',
    'include_object_metadata',
    'include_content_preview',
  ]) {
    const value = config[key];
    if (value !== undefined && optionalScope[key] === undefined) {
      optionalScope[key] = value;
    }
    delete config[key];
  }

  if (type === 'S3_COMPATIBLE_STORAGE') {
    if (config.bucket !== undefined && required.bucket === undefined) {
      required.bucket = config.bucket;
    }
    delete config.bucket;

    for (const key of ['endpoint_url', 'region_name', 'verify_ssl']) {
      const value = config[key];
      if (value !== undefined && optionalConnection[key] === undefined) {
        optionalConnection[key] = value;
      }
      delete config[key];
    }
  }

  if (type === 'AZURE_BLOB_STORAGE') {
    if (
      config.account_url !== undefined &&
      required.account_url === undefined
    ) {
      required.account_url = config.account_url;
    }
    if (config.container !== undefined && required.container === undefined) {
      required.container = config.container;
    }
    delete config.account_url;
    delete config.container;
  }

  if (type === 'GOOGLE_CLOUD_STORAGE') {
    if (config.bucket !== undefined && required.bucket === undefined) {
      required.bucket = config.bucket;
    }
    delete config.bucket;

    for (const key of ['project_id', 'gcp_credentials_file']) {
      const value = config[key];
      if (value !== undefined && optionalConnection[key] === undefined) {
        optionalConnection[key] = value;
      }
      delete config[key];
    }
  }

  delete required.provider;
}

function normalizeLegacyShape(type: string, config: JsonRecord) {
  if (type === 'WORDPRESS') {
    if (typeof config.url === 'string') {
      const required = ensureNestedObject(config, 'required');
      if (typeof required.url !== 'string') {
        required.url = config.url;
      }
      delete config.url;
    }

    if (
      typeof config.username === 'string' ||
      typeof config.application_password === 'string'
    ) {
      const masked = ensureNestedObject(config, 'masked');
      if (
        typeof config.username === 'string' &&
        typeof masked.username !== 'string'
      ) {
        masked.username = config.username;
      }
      if (
        typeof config.application_password === 'string' &&
        typeof masked.application_password !== 'string'
      ) {
        masked.application_password = config.application_password;
      }
      delete config.username;
      delete config.application_password;
    }

    if (!asObject(config.masked)) {
      config.masked = {};
    }
  }

  if (type === 'SLACK' && typeof config.workspace === 'string') {
    const required = ensureNestedObject(config, 'required');
    if (typeof required.workspace !== 'string') {
      required.workspace = config.workspace;
    }
    delete config.workspace;
  }

  if (
    type === 'S3_COMPATIBLE_STORAGE' ||
    type === 'AZURE_BLOB_STORAGE' ||
    type === 'GOOGLE_CLOUD_STORAGE'
  ) {
    normalizeObjectStorageShape(type, config);
  }
}

function normalizeSampling(config: JsonRecord) {
  const optional = asObject(config.optional);
  const optionalSampling = optional ? asObject(optional.sampling) : undefined;
  const optionalContent = optional ? asObject(optional.content) : undefined;
  const optionalCrawl = optional ? asObject(optional.crawl) : undefined;
  const optionalIngestion = optional ? asObject(optional.ingestion) : undefined;

  const sampling: JsonRecord = {
    ...(asObject(config.sampling) ?? {}),
  };

  const strategy =
    normalizeSamplingStrategy(sampling.strategy) ??
    normalizeSamplingStrategy(optionalSampling?.strategy) ??
    normalizeSamplingStrategy(optionalSampling?.mode) ??
    'RANDOM';

  sampling.strategy = strategy;
  delete sampling.limit;
  delete sampling.max_columns;

  const orderByColumn =
    typeof sampling.order_by_column === 'string'
      ? sampling.order_by_column
      : typeof optionalSampling?.order_by_column === 'string'
        ? optionalSampling.order_by_column
        : undefined;
  if (orderByColumn) {
    sampling.order_by_column = orderByColumn;
  }

  const fallbackToRandom =
    typeof sampling.fallback_to_random === 'boolean'
      ? sampling.fallback_to_random
      : typeof optionalSampling?.fallback_to_random === 'boolean'
        ? optionalSampling.fallback_to_random
        : undefined;
  if (typeof fallbackToRandom === 'boolean') {
    sampling.fallback_to_random = fallbackToRandom;
  }

  const rowsPerPage =
    asPositiveInteger(sampling.rows_per_page) ??
    asPositiveInteger(optionalSampling?.rows_per_page);
  if (rowsPerPage !== undefined) {
    sampling.rows_per_page = rowsPerPage;
  }

  const includeColumnNames =
    typeof sampling.include_column_names === 'boolean'
      ? sampling.include_column_names
      : typeof optionalSampling?.include_column_names === 'boolean'
        ? optionalSampling.include_column_names
        : undefined;
  if (typeof includeColumnNames === 'boolean') {
    sampling.include_column_names = includeColumnNames;
  }

  const fetchAllUntilFirstSuccess =
    asBoolean(sampling.fetch_all_until_first_success) ??
    asBoolean(optionalSampling?.fetch_all_until_first_success);
  if (typeof fetchAllUntilFirstSuccess === 'boolean') {
    sampling.fetch_all_until_first_success = fetchAllUntilFirstSuccess;
  } else {
    delete sampling.fetch_all_until_first_success;
  }

  removeUndefinedKeys(sampling);
  config.sampling = sampling;

  if (optionalSampling && optional) {
    delete optional.sampling;
  }
  if (optionalContent && 'limit_total_items' in optionalContent) {
    delete optionalContent.limit_total_items;
  }
  if (optionalCrawl && 'max_pages' in optionalCrawl) {
    delete optionalCrawl.max_pages;
  }
  if (optionalIngestion && 'limit_total_messages' in optionalIngestion) {
    delete optionalIngestion.limit_total_messages;
  }
}

function normalizeRequiredBlock(config: JsonRecord) {
  const required = asObject(config.required);
  if (!required) return;

  // Coerce port to integer — HTML number inputs and JSON can deliver it as a string
  if (required.port !== undefined) {
    const port = asPositiveInteger(required.port);
    if (port !== undefined) {
      required.port = port;
    }
  }
}

export function normalizeSourceConfig(
  sourceType: string,
  config: unknown,
): JsonRecord {
  const type = String(sourceType || '').toUpperCase();
  const normalized: JsonRecord = {
    ...(asObject(config) ?? {}),
    type,
  };

  normalizeLegacyShape(type, normalized);
  normalizeSampling(normalized);
  normalizeRequiredBlock(normalized);

  return normalized;
}
