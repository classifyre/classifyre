import { BadRequestException } from '@nestjs/common';

/**
 * Decision detectors: the custom-detector pipeline type `DECISION`.
 *
 * A decision model answers typed questions about content with probabilities
 * instead of text. Two wire formats exist for the same idea -- OpenAI's
 * Decisions API and the System One format (TypeSafe Jev, Cloudflare Clef and
 * the open models that follow them) -- and the scan reaches all of them through
 * LiteLLM, which translates between the two. So a detector names a LiteLLM
 * model and nothing here knows a provider list: a provider LiteLLM adds
 * tomorrow works without a change to this file.
 *
 * Unlike an LLM detector it carries its own credential (`secrets.api_key`)
 * rather than pointing at an AI provider; see custom-detector-secrets.ts.
 */
export const DECISION_PIPELINE_TYPE = 'DECISION';

export const DECISION_QUESTION_TYPES = ['yes_no', 'choice', 'score'] as const;

/** The one credential the runner reads. */
export const DECISION_SECRET_KEYS = ['api_key'] as const;

const QUESTION_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const HEADER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,127}$/;
// LiteLLM sets these itself and drops a caller's copy; saying so beats a header
// that is saved, shown, and silently never sent.
const RESERVED_HEADERS = new Set(['authorization', 'content-type']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low', 'info']);

const MAX_QUESTIONS = 64;
const MAX_MODEL_CHARS = 200;
const MAX_URL_CHARS = 2048;
const MAX_INSTRUCTIONS_CHARS = 4000;
const MAX_LABEL_CHARS = 200;
const MAX_DESCRIPTION_CHARS = 2000;
const MAX_HEADERS = 20;
const MAX_HEADER_VALUE_CHARS = 2048;
const MAX_SECRET_CHARS = 8192;
const MAX_CONTENT_LIMIT = 1_000_000;
/** [min, max] answers per question type; yes_no takes none. */
const OPTION_BOUNDS: Record<string, [number, number]> = {
  choice: [2, 255],
  score: [2, 10],
};

const KNOWN_KEYS = new Set([
  'type',
  'model',
  'api_base',
  'extra_headers',
  'secrets',
  'questions',
  'severity',
  'content_limit',
  'scope',
  'budget',
]);
const QUESTION_KEYS = new Set([
  'name',
  'type',
  'instructions',
  'options',
  'severity',
  'threshold',
]);
const OPTION_KEYS = new Set(['label', 'description', 'severity', 'report']);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function isDecisionSchema(schema: unknown): boolean {
  return (
    isRecord(schema) &&
    typeof schema.type === 'string' &&
    schema.type.toUpperCase() === DECISION_PIPELINE_TYPE
  );
}

/**
 * What a stored API key is bound to: the provider and the URL it is sent to.
 *
 * The key is write-only, so nobody who can edit a detector can read it. That
 * would mean little if they could repoint the detector at a server of their
 * own and have the next scan deliver the key there. So the service keeps a
 * stored key only while this value is unchanged; a different provider or
 * endpoint needs its key entered again.
 */
export function decisionEndpointKey(schema: unknown): string {
  const record = isRecord(schema) ? schema : {};
  const model = typeof record.model === 'string' ? record.model : '';
  const base = typeof record.api_base === 'string' ? record.api_base : '';
  const provider = model.trim().split('/', 1)[0]?.toLowerCase() ?? '';
  return `${provider}|${base.trim().replace(/\/+$/, '').toLowerCase()}`;
}

function fail(message: string): never {
  throw new BadRequestException(`DECISION: ${message}`);
}

function checkSeverity(value: unknown, where: string): void {
  if (value === undefined || value === null) return;
  if (typeof value !== 'string' || !SEVERITIES.has(value)) {
    fail(`${where} must be one of ${Array.from(SEVERITIES).join(', ')}`);
  }
}

function checkOptions(question: JsonRecord, name: string): void {
  const type = question.type as string;
  const options = question.options;
  const bounds = OPTION_BOUNDS[type];

  if (!bounds) {
    if (Array.isArray(options) && options.length > 0) {
      fail(
        `question '${name}' is yes_no and takes no options; use choice or score for a list of answers`,
      );
    }
    if (options !== undefined && !Array.isArray(options)) {
      fail(`question '${name}' options must be an array`);
    }
    return;
  }

  const [min, max] = bounds;
  if (!Array.isArray(options) || options.length < min || options.length > max) {
    fail(
      `${type} question '${name}' needs ${min} to ${max} options` +
        (type === 'score' ? ', ordered lowest first' : ''),
    );
  }
  const labels = new Set<string>();
  for (const entry of options as unknown[]) {
    if (!isRecord(entry)) {
      fail(`question '${name}' options must be objects: { label, ... }`);
    }
    const unknown = Object.keys(entry).filter((key) => !OPTION_KEYS.has(key));
    if (unknown.length > 0) {
      fail(
        `question '${name}' option has unknown field(s): ${unknown.join(', ')}`,
      );
    }
    const label = entry.label;
    if (
      typeof label !== 'string' ||
      label.trim().length === 0 ||
      label.length > MAX_LABEL_CHARS
    ) {
      fail(
        `question '${name}' options each need a label of 1 to ${MAX_LABEL_CHARS} characters`,
      );
    }
    if (labels.has(label)) {
      fail(`question '${name}' repeats the option '${label}'`);
    }
    labels.add(label);
    if (
      entry.description !== undefined &&
      (typeof entry.description !== 'string' ||
        entry.description.length > MAX_DESCRIPTION_CHARS)
    ) {
      fail(
        `question '${name}' option '${label}' description must be a string of at most ${MAX_DESCRIPTION_CHARS} characters`,
      );
    }
    checkSeverity(
      entry.severity,
      `question '${name}' option '${label}' severity`,
    );
    if (entry.report !== undefined && typeof entry.report !== 'boolean') {
      fail(`question '${name}' option '${label}' report must be a boolean`);
    }
  }
}

function checkQuestions(questions: unknown): void {
  if (
    !Array.isArray(questions) ||
    questions.length === 0 ||
    questions.length > MAX_QUESTIONS
  ) {
    fail(
      `questions must be an array of 1 to ${MAX_QUESTIONS}: [{ name, type, instructions }]`,
    );
  }
  const names = new Set<string>();
  for (const entry of questions as unknown[]) {
    if (!isRecord(entry)) fail('every question must be an object');
    const unknown = Object.keys(entry).filter((key) => !QUESTION_KEYS.has(key));
    if (unknown.length > 0) {
      fail(`a question has unknown field(s): ${unknown.join(', ')}`);
    }
    const name = entry.name;
    if (typeof name !== 'string' || !QUESTION_NAME_PATTERN.test(name)) {
      fail(
        `question name '${String(name)}' must start with a letter and use only letters, digits, _ and - (at most 64 characters): it becomes the finding type`,
      );
    }
    if (names.has(name)) fail(`duplicate question name '${name}'`);
    names.add(name);

    if (
      typeof entry.type !== 'string' ||
      !(DECISION_QUESTION_TYPES as readonly string[]).includes(entry.type)
    ) {
      fail(
        `question '${name}' type must be one of ${DECISION_QUESTION_TYPES.join(', ')}`,
      );
    }
    if (
      typeof entry.instructions !== 'string' ||
      entry.instructions.trim().length === 0 ||
      entry.instructions.length > MAX_INSTRUCTIONS_CHARS
    ) {
      fail(
        `question '${name}' needs instructions: the question itself, in plain language (at most ${MAX_INSTRUCTIONS_CHARS} characters)`,
      );
    }
    checkOptions(entry, name);
    checkSeverity(entry.severity, `question '${name}' severity`);
    if (entry.threshold !== undefined) {
      const threshold = entry.threshold;
      if (
        typeof threshold !== 'number' ||
        Number.isNaN(threshold) ||
        threshold < 0 ||
        threshold > 1
      ) {
        fail(
          `question '${name}' threshold must be a number from 0 to 1; leave it out for the default`,
        );
      }
    }
  }
}

/**
 * Structural validation of a DECISION pipeline schema. Fails closed on unknown
 * keys (there is no global ValidationPipe), and says where a misplaced key
 * belongs when the mistake is a likely one.
 */
export function validateDecisionSchema(schema: JsonRecord): void {
  const unknown = Object.keys(schema).filter((key) => !KNOWN_KEYS.has(key));
  if (unknown.includes('api_key')) {
    fail(
      'api_key belongs in secrets: { "secrets": { "api_key": "..." } }, where it is encrypted and never returned',
    );
  }
  if (unknown.includes('provider_runtime')) {
    fail(
      'provider_runtime is for LLM detectors; a decision detector names its model and holds its own secrets.api_key',
    );
  }
  if (unknown.length > 0) {
    fail(`unknown field(s): ${unknown.join(', ')}`);
  }

  const model = schema.model;
  if (
    typeof model !== 'string' ||
    model.trim().length === 0 ||
    model.length > MAX_MODEL_CHARS
  ) {
    fail(
      'model is required: a LiteLLM model name such as typesafe/jev-latest, openai/gpt-6-luna or cloudflare/clef',
    );
  }
  // The provider prefix is what picks the API, so a bare model name can never
  // be dispatched. Which prefixes exist is LiteLLM's to say, not this file's.
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1 || /\s/.test(model)) {
    fail(
      `model '${model}' must be <provider>/<model> with no spaces, for example typesafe/jev-latest: the provider prefix decides which API is called`,
    );
  }

  if (schema.api_base !== undefined && schema.api_base !== null) {
    const base = schema.api_base;
    if (
      typeof base !== 'string' ||
      base.length > MAX_URL_CHARS ||
      !/^https?:\/\/[^\s/]+/i.test(base) ||
      /\s/.test(base)
    ) {
      fail('api_base must be an http(s) URL, or null for the provider default');
    }
  }

  if (schema.extra_headers !== undefined) {
    const headers = schema.extra_headers;
    if (!isRecord(headers) || Object.keys(headers).length > MAX_HEADERS) {
      fail(
        `extra_headers must be an object of at most ${MAX_HEADERS} name → string`,
      );
    }
    for (const [name, value] of Object.entries(headers)) {
      if (!HEADER_NAME_PATTERN.test(name)) {
        fail(`extra_headers name '${name}' is not a valid HTTP header name`);
      }
      if (RESERVED_HEADERS.has(name.toLowerCase())) {
        fail(
          `extra_headers may not set ${name}: the API key goes in secrets.api_key and the content type is fixed`,
        );
      }
      if (typeof value !== 'string' || value.length > MAX_HEADER_VALUE_CHARS) {
        fail(
          `extra_headers.${name} must be a string of at most ${MAX_HEADER_VALUE_CHARS} characters`,
        );
      }
    }
  }

  if (schema.secrets !== undefined) {
    const secrets = schema.secrets;
    if (!isRecord(secrets)) {
      fail('secrets must be an object: { "api_key": "..." }');
    }
    for (const [key, value] of Object.entries(secrets)) {
      if (!(DECISION_SECRET_KEYS as readonly string[]).includes(key)) {
        fail(
          `secrets.${key} is not used: the only secret a decision detector reads is api_key`,
        );
      }
      // A null secret is a deletion in a patch; the service resolves it.
      if (value === null) continue;
      if (typeof value !== 'string' || value.length > MAX_SECRET_CHARS) {
        fail(
          `secrets.${key} must be a string of at most ${MAX_SECRET_CHARS} characters`,
        );
      }
    }
  }

  checkQuestions(schema.questions);
  checkSeverity(schema.severity, 'severity');

  if (schema.content_limit !== undefined) {
    const limit = schema.content_limit;
    if (
      typeof limit !== 'number' ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > MAX_CONTENT_LIMIT
    ) {
      fail(`content_limit must be an integer in [1, ${MAX_CONTENT_LIMIT}]`);
    }
  }
  for (const block of ['scope', 'budget'] as const) {
    const value = schema[block];
    if (value !== undefined && value !== null && !isRecord(value)) {
      fail(`${block} must be an object or null`);
    }
  }
}
