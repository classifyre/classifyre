import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AiSchemaError } from './errors';
import type { JsonSchema } from './types';

let _ajv: Ajv | null = null;
let _ajvLenient: Ajv | null = null;

function getAjv(): Ajv {
  if (!_ajv) {
    _ajv = new Ajv({ allErrors: true, strict: false });

    addFormats(_ajv);
  }
  return _ajv;
}

function getLenientAjv(): Ajv {
  if (!_ajvLenient) {
    // Forgiving mode for LLM output: silently strip unknown properties,
    // fill defaults and coerce scalar types instead of failing the whole
    // response over cosmetic deviations.
    _ajvLenient = new Ajv({
      allErrors: true,
      strict: false,
      removeAdditional: 'all',
      useDefaults: true,
      coerceTypes: true,
    });
    addFormats(_ajvLenient);
  }
  return _ajvLenient;
}

/**
 * Validates `data` against `schema`.
 * Throws AiSchemaError with a descriptive message on failure.
 */
export function validateAgainstSchema(data: unknown, schema: JsonSchema): void {
  const ajv = getAjv();
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    throw new AiSchemaError(
      `Schema validation failed: ${describeErrors(validate.errors)}`,
    );
  }
}

/**
 * Validates `data` against `schema` in lenient mode: unknown properties are
 * REMOVED (mutating `data`), defaults applied, scalar types coerced. Only
 * genuine structural problems (missing required fields, bad enum values)
 * still throw AiSchemaError.
 */
export function normalizeAgainstSchema<T>(data: T, schema: JsonSchema): T {
  const ajv = getLenientAjv();
  const validate = ajv.compile(schema);
  const valid = validate(data);
  if (!valid) {
    throw new AiSchemaError(
      `Schema validation failed: ${describeErrors(validate.errors)}`,
    );
  }
  return data;
}

/**
 * Render Ajv errors so the reader can act on them.
 *
 * Ajv's `message` alone is frequently useless to a caller that has to fix its
 * own payload: `additionalProperties` renders as "must NOT have additional
 * properties" without naming the property, and `enum` as "must be equal to one
 * of the allowed values" without listing them. The offending key and the
 * allowed set are both sitting in `error.params`.
 *
 * This is not cosmetic. The detector-authoring agent hit the anonymous form
 * five times in a row and, unable to tell which key was rejected, spent its
 * whole iteration budget guessing — "remove case_sensitive", "try just the
 * pipeline_schema", "try absolute minimal REGEX schema" — and authored
 * nothing. An error a caller cannot act on reads to it as an error that cannot
 * be fixed.
 */
function describeErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return 'unknown error';
  return errors
    .map((raw) => {
      const e = raw as {
        instancePath?: string;
        message?: string;
        params?: Record<string, unknown>;
      };
      const where = e.instancePath || '(root)';
      const params = e.params ?? {};

      const offending = params.additionalProperty;
      if (typeof offending === 'string') {
        return `${where} has unsupported property "${offending}" — remove it`;
      }

      const allowed = params.allowedValues;
      if (Array.isArray(allowed)) {
        return `${where} ${e.message} (allowed: ${allowed.join(', ')})`;
      }

      const missing = params.missingProperty;
      if (typeof missing === 'string') {
        return `${where} is missing required property "${missing}"`;
      }

      return `${where} ${e.message ?? 'is invalid'}`;
    })
    .join('; ');
}
