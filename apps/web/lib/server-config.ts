/**
 * Server-side runtime configuration.
 *
 * All values here are injected by Helm at deployment time as environment
 * variables. They MUST only be read from server components or server actions —
 * they are never available in the client bundle.
 *
 * Prefer `getServerConfig()` over reading individual env vars directly so
 * the full set of runtime flags stays in one place.
 */

export interface ServerConfig {
  /**
   * True when S3-compatible object storage is configured.
   * Set by Helm from objectStorage.enabled.
   * When false, runner logs are streamed live but not persisted after the run.
   */
  s3Configured: boolean;

  /**
   * True when the instance runs in read-only demo mode.
   * Set by Helm from api.env.DEMO_MODE (shared with the API deployment).
   * When true, all mutating operations should be blocked or hidden in the UI.
   */
  demoMode: boolean;
}

/**
 * Returns runtime configuration derived from environment variables.
 * Call this once in the server layout and pass the result through context.
 */
export function getServerConfig(): ServerConfig {
  return {
    s3Configured: process.env.S3_CONFIGURED === "true",
    demoMode: process.env.DEMO_MODE === "true",
  };
}
