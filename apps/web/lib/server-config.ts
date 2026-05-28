/**
 * Server-side runtime configuration helpers.
 *
 * These functions read environment variables that are injected by Helm at
 * deployment time. They MUST only be called from server components or server
 * actions — they are not available in client bundles.
 */

/**
 * Returns true when S3-compatible object storage is configured for this
 * instance. Reads the S3_CONFIGURED env var, which Helm sets from
 * objectStorage.enabled in the chart values.
 *
 * When false, runner logs are streamed live but are not persisted after the
 * run completes.
 */
export function isS3Configured(): boolean {
  return process.env.S3_CONFIGURED === "true";
}
