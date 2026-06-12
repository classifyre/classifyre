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
    const details = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
      .join('; ');
    throw new AiSchemaError(`Schema validation failed: ${details}`);
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
    const details = (validate.errors ?? [])
      .map((e) => `${e.instancePath || '(root)'} ${e.message}`)
      .join('; ');
    throw new AiSchemaError(`Schema validation failed: ${details}`);
  }
  return data;
}
