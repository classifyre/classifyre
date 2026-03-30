import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { AiSchemaError } from './errors';
import type { JsonSchema } from './types';

let _ajv: Ajv | null = null;

function getAjv(): Ajv {
  if (!_ajv) {
    _ajv = new Ajv({ allErrors: true, strict: false });

    addFormats(_ajv as any);
  }
  return _ajv;
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
