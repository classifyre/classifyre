import { gzipSync } from 'zlib';

// MAX_ARG_STRLEN: Linux allows one environment variable to be at most 32
// pages. Over it, execve fails with E2BIG and the kernel's message —
// "argument list too long" — mentions neither the variable nor its size.
export const MAX_ENV_VALUE_BYTES = 128 * 1024;

/**
 * A source's saved cursor as the CLI receives it in CLASSIFYRE_SAMPLING_CURSOR:
 * gzip, then base64. Returns undefined when there is nothing to pass (first
 * run, or a source that keeps no cursor).
 *
 * A notebook connector decides what goes into its cursor, so its size is not
 * ours to bound. Sent as plain base64, a 100 KB cursor (one connector carried
 * a person → companies map in it) crossed the 128 KiB limit for a single
 * environment variable: the Job was created, the pod started and died with
 * `exec /bin/sh: argument list too long`, on every retry, and the notebook
 * that could have shrunk the cursor never ran again. JSON compresses about
 * 3x, and a cursor that still does not fit is refused here, by name and size,
 * before a pod is spent on it.
 */
export function encodeSamplingCursor(cursor: unknown): string | undefined {
  if (!cursor || typeof cursor !== 'object') {
    return undefined;
  }
  if (Object.keys(cursor).length === 0) {
    return undefined;
  }
  const json = JSON.stringify(cursor);
  const encoded = gzipSync(Buffer.from(json, 'utf8')).toString('base64');
  if (encoded.length > MAX_ENV_VALUE_BYTES) {
    throw new Error(
      `The cursor this source saved on its last run is ${encoded.length} bytes ` +
        `compressed (${Buffer.byteLength(json, 'utf8')} bytes of JSON), over the ` +
        `${MAX_ENV_VALUE_BYTES}-byte limit for handing it to a scan. A cursor ` +
        'records where a run stopped; keep bulk state in assets and read it ' +
        'back with ctx.query_assets(). Reset the cursor to run this source again.',
    );
  }
  return encoded;
}
