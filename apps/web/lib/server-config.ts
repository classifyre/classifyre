/**
 * Server-side runtime configuration.
 *
 * All values here come from environment variables set by the deployment (the
 * Helm chart, or the all-in-one image's entrypoint). They MUST only be read
 * from server components or server actions —
 * they are never available in the client bundle.
 *
 * Prefer `getServerConfig()` over reading individual env vars directly so
 * the full set of runtime flags stays in one place.
 */

export interface ServerConfig {
  /**
   * True when scan logs survive the run.
   *
   * Mirrors the backend's own fallback order in
   * apps/api/src/cli-runner/runner-log-storage.service.ts: a local directory
   * when RUNNER_LOG_DIR is set (the all-in-one Docker image), otherwise
   * S3-compatible object storage when S3_BUCKET is (the Helm chart, from
   * objectStorage.enabled via S3_CONFIGURED). When neither is configured, logs
   * stream live and are gone once the run ends — which is what the log viewer
   * warns about.
   */
  logsPersisted: boolean;

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
    logsPersisted:
      !!process.env.RUNNER_LOG_DIR ||
      process.env.S3_CONFIGURED === "true" ||
      (process.env.S3_CONFIGURED !== "false" && !!process.env.S3_BUCKET),
    demoMode: process.env.DEMO_MODE === "true",
  };
}
