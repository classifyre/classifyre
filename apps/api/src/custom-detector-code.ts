import { BadRequestException } from '@nestjs/common';

/**
 * Code detectors: the custom-detector pipeline type `CUSTOM_DETECTOR` (PRD G1).
 *
 * A notebook that defines `detect(asset, ctx)` and yields findings. Unlike
 * every other engine it carries code, secrets and uploaded files, so it has
 * rules no other pipeline type needs; they live here as plain functions so the
 * service, the MCP tools and the specs share one copy.
 */
export const CUSTOM_DETECTOR_PIPELINE_TYPE = 'CUSTOM_DETECTOR';

/** Fields the server injects at dispatch; a client that sends one is refused. */
export const CODE_DETECTOR_RUNTIME_FIELDS = [
  'files_runtime',
  'custom_detector_id',
] as const;

const CELL_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const CONFIG_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const PACKAGE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const FIELD_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'date',
  'list[string]',
  'list[number]',
]);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);
const CATEGORIES = new Set([
  'SECURITY',
  'PRIVACY',
  'THREAT',
  'CONTENT',
  'QUALITY',
  'FAIRNESS',
  'COMPLIANCE',
  'CLASSIFICATION',
]);
const LIMIT_BOUNDS: Record<string, [number, number]> = {
  per_asset_timeout_seconds: [1, 3600],
  setup_timeout_seconds: [1, 3600],
  max_findings_per_asset: [1, 10000],
  max_output_bytes: [1024, 67108864],
  max_payload_bytes: [1024, 1073741824],
  max_workers: [1, 8],
  max_consecutive_failures: [1, 10000],
};
const MAX_CELLS = 50;
const MAX_CELL_CHARS = 100_000;
const MAX_VARIABLE_CHARS = 8192;
const KNOWN_KEYS = new Set([
  'type',
  'notebook',
  'packages',
  'variables',
  'secrets',
  'fields',
  'severity',
  'category',
  'deterministic',
  'needs_findings',
  'limits',
  'scope',
  'budget',
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isCodeDetectorSchema(schema: unknown): boolean {
  return (
    isRecord(schema) &&
    typeof schema.type === 'string' &&
    schema.type.toUpperCase() === CUSTOM_DETECTOR_PIPELINE_TYPE
  );
}

export function codeCells(schema: JsonRecord): Array<{
  id: string;
  type: string;
  source: string;
}> {
  const notebook = isRecord(schema.notebook) ? schema.notebook : {};
  return Array.isArray(notebook.cells)
    ? (notebook.cells as Array<{ id: string; type: string; source: string }>)
    : [];
}

/**
 * Whether the code cells define a top-level `detect` function.
 *
 * The API cannot parse Python, and asking the CLI on every save would start a
 * process (a Kubernetes Job, in a cluster) per keystroke-debounced save. A
 * notebook without `def detect(` at column 0 is certainly wrong, and that is
 * the mistake worth refusing here; the CLI's AST check before every preview
 * and every scan catches the rest (syntax errors, a `detect` that is not a
 * function).
 */
export function definesDetect(schema: JsonRecord): boolean {
  return codeCells(schema).some(
    (cell) =>
      cell?.type === 'code' &&
      typeof cell.source === 'string' &&
      /^(async\s+)?def\s+detect\s*\(/m.test(cell.source),
  );
}

function fail(message: string): never {
  throw new BadRequestException(`CUSTOM_DETECTOR: ${message}`);
}

/**
 * Structural validation of a CUSTOM_DETECTOR pipeline schema. Fails closed on
 * unknown keys (there is no global ValidationPipe).
 */
export function validateCodeDetectorSchema(schema: JsonRecord): void {
  const unknown = Object.keys(schema).filter((key) => !KNOWN_KEYS.has(key));
  const runtime = unknown.filter((key) =>
    (CODE_DETECTOR_RUNTIME_FIELDS as readonly string[]).includes(key),
  );
  if (runtime.length > 0) {
    fail(
      `${runtime.join(', ')} ${runtime.length === 1 ? 'is' : 'are'} injected by the server at dispatch and must not be supplied by clients`,
    );
  }
  if (unknown.length > 0) {
    fail(`unknown field(s): ${unknown.join(', ')}`);
  }

  if (!isRecord(schema.notebook)) {
    fail('notebook is required: { cells: [{ id, type: "code", source }] }');
  }
  const notebook = schema.notebook;
  for (const key of Object.keys(notebook)) {
    if (key !== 'cells' && key !== 'revision') {
      fail(`notebook has an unknown field '${key}'`);
    }
  }
  if (!Array.isArray(notebook.cells) || notebook.cells.length === 0) {
    fail('notebook.cells must be a non-empty array');
  }
  if (notebook.cells.length > MAX_CELLS) {
    fail(`a notebook may have at most ${MAX_CELLS} cells`);
  }
  const seen = new Set<string>();
  for (const cell of notebook.cells as unknown[]) {
    if (!isRecord(cell)) fail('every cell must be an object');
    const id = cell.id;
    if (typeof id !== 'string' || !CELL_ID_PATTERN.test(id)) {
      fail(`cell id '${String(id)}' must match ${CELL_ID_PATTERN.source}`);
    }
    if (seen.has(id)) fail(`duplicate cell id '${id}'`);
    seen.add(id);
    if (cell.type !== 'code' && cell.type !== 'markdown') {
      fail(`cell '${id}' must have type "code" or "markdown"`);
    }
    if (typeof cell.source !== 'string') {
      fail(`cell '${id}' needs a string source`);
    }
    if (cell.source.length > MAX_CELL_CHARS) {
      fail(`cell '${id}' is longer than ${MAX_CELL_CHARS} characters`);
    }
  }
  if (!definesDetect(schema)) {
    fail(
      'the notebook must define a top-level function detect(asset, ctx) that yields Finding(...) objects',
    );
  }

  if (schema.packages !== undefined) {
    if (!Array.isArray(schema.packages) || schema.packages.length > 50) {
      fail('packages must be an array of at most 50 { name, version? }');
    }
    for (const entry of schema.packages as unknown[]) {
      if (
        !isRecord(entry) ||
        typeof entry.name !== 'string' ||
        !PACKAGE_NAME_PATTERN.test(entry.name)
      ) {
        fail(`invalid package entry ${JSON.stringify(entry)}`);
      }
      if (entry.version !== undefined && typeof entry.version !== 'string') {
        fail(`package '${entry.name}' version must be a string`);
      }
    }
  }

  for (const bag of ['variables', 'secrets'] as const) {
    const value = schema[bag];
    if (value === undefined) continue;
    if (!isRecord(value)) fail(`${bag} must be an object of name → string`);
    if (Object.keys(value).length > 64) fail(`${bag} may hold at most 64 keys`);
    for (const [key, item] of Object.entries(value)) {
      if (!CONFIG_KEY_PATTERN.test(key)) {
        fail(
          `${bag} key '${key}' must be a valid Python identifier, because the notebook reads it by name`,
        );
      }
      // A null secret is a deletion in a patch; the service resolves it.
      if (bag === 'secrets' && item === null) continue;
      if (typeof item !== 'string') fail(`${bag}.${key} must be a string`);
      if (bag === 'variables' && item.length > MAX_VARIABLE_CHARS) {
        fail(
          `variables.${key} is longer than ${MAX_VARIABLE_CHARS} characters`,
        );
      }
    }
  }

  if (schema.fields !== undefined) {
    if (!Array.isArray(schema.fields) || schema.fields.length > 50) {
      fail('fields must be an array of at most 50 { name, type, description }');
    }
    const names = new Set<string>();
    for (const entry of schema.fields as unknown[]) {
      if (
        !isRecord(entry) ||
        typeof entry.name !== 'string' ||
        !CONFIG_KEY_PATTERN.test(entry.name)
      ) {
        fail(`invalid field entry ${JSON.stringify(entry)}`);
      }
      if (names.has(entry.name)) fail(`duplicate field '${entry.name}'`);
      names.add(entry.name);
      if (
        entry.type !== undefined &&
        (typeof entry.type !== 'string' || !FIELD_TYPES.has(entry.type))
      ) {
        fail(
          `field '${entry.name}' type must be one of ${Array.from(FIELD_TYPES).join(', ')}`,
        );
      }
      for (const key of Object.keys(entry)) {
        if (!['name', 'type', 'description'].includes(key)) {
          fail(`field '${entry.name}' has an unknown key '${key}'`);
        }
      }
    }
  }

  if (
    schema.severity !== undefined &&
    (typeof schema.severity !== 'string' || !SEVERITIES.has(schema.severity))
  ) {
    fail(`severity must be one of ${Array.from(SEVERITIES).join(', ')}`);
  }
  if (
    schema.category !== undefined &&
    (typeof schema.category !== 'string' || !CATEGORIES.has(schema.category))
  ) {
    fail(`category must be one of ${Array.from(CATEGORIES).join(', ')}`);
  }
  for (const flag of ['deterministic', 'needs_findings'] as const) {
    if (schema[flag] !== undefined && typeof schema[flag] !== 'boolean') {
      fail(`${flag} must be a boolean`);
    }
  }
  if (schema.limits !== undefined) {
    if (!isRecord(schema.limits)) fail('limits must be an object');
    for (const [key, value] of Object.entries(schema.limits)) {
      const bounds = LIMIT_BOUNDS[key];
      if (!bounds) fail(`limits has an unknown key '${key}'`);
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < bounds[0] ||
        value > bounds[1]
      ) {
        fail(
          `limits.${key} must be an integer in [${bounds[0]}, ${bounds[1]}]`,
        );
      }
    }
  }
}

/** The schema without its secrets, plus the names of the secrets it holds. */
export function maskCodeDetectorSchema(schema: JsonRecord): {
  schema: JsonRecord;
  secretKeys: string[];
} {
  if (!isCodeDetectorSchema(schema)) {
    return { schema, secretKeys: [] };
  }
  const { secrets, ...rest } = schema;
  return {
    schema: rest,
    secretKeys: isRecord(secrets) ? Object.keys(secrets).sort() : [],
  };
}

/**
 * Apply a secrets patch: a non-empty string sets a key, null or "" deletes it,
 * an absent key keeps what is stored. The editor never receives secret values,
 * so replacing the bag wholesale would wipe every credential it did not retype.
 */
export function mergeCodeDetectorSecrets(
  existing: unknown,
  incoming: unknown,
  encrypt: (value: string) => string,
): Record<string, string> {
  const merged: Record<string, string> = isRecord(existing)
    ? Object.fromEntries(
        Object.entries(existing).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string',
        ),
      )
    : {};
  if (!isRecord(incoming)) return merged;
  for (const [key, value] of Object.entries(incoming)) {
    if (value === null || value === '') {
      delete merged[key];
    } else if (typeof value === 'string') {
      merged[key] = encrypt(value);
    }
  }
  return merged;
}

/** What decides a new detector version: everything but the secrets. */
export function versionedShape(schema: unknown): unknown {
  if (!isCodeDetectorSchema(schema)) return schema;
  const { secrets: _secrets, ...rest } = schema as JsonRecord;
  return rest;
}

/**
 * Set a code detector's notebook revision: the server owns it. It starts at 1
 * and moves by one whenever the cells change, so an execution that names a
 * revision always ran exactly the cells stored under it -- and a client can
 * neither skip ahead nor re-use an old number.
 */
export function withNotebookRevision(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!isCodeDetectorSchema(incoming) || !isRecord(incoming.notebook)) {
    return incoming;
  }
  const previous =
    isCodeDetectorSchema(existing) && isRecord(existing?.notebook)
      ? existing.notebook
      : null;
  const previousRevision =
    previous && Number.isInteger(previous.revision)
      ? (previous.revision as number)
      : 0;
  const changed =
    !previous ||
    JSON.stringify(previous.cells ?? []) !==
      JSON.stringify(incoming.notebook.cells ?? []);
  const revision = changed
    ? previousRevision + 1
    : Math.max(previousRevision, 1);
  return { ...incoming, notebook: { ...incoming.notebook, revision } };
}
