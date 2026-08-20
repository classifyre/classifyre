/**
 * The environment a notebook execution is launched with.
 *
 * Notebook code is already confined to a child process with a scrubbed
 * environment (apps/cli/src/sources/custom/env.py). This is the outer layer:
 * the CLI process running a notebook execution has no reason to hold the
 * tenant database URL, the callback key that authenticates scan results, or the
 * key that decrypts every source's credentials -- a notebook execution only
 * runs cells and prints a JSON result.
 *
 * A scan is different: there the CLI legitimately needs those to write results
 * back, and the process boundary inside the CLI is what keeps user code away
 * from them. So this allowlist applies to notebook executions only, and is
 * defence in depth rather than the primary control.
 */

/** Enough to start Python, find the venv, and reach the network. */
const ALLOWED_ENV_KEYS = new Set([
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TZ',
  'TMPDIR',
  'TEMP',
  'TMP',
  'TEMP_DIR',
  // Where the CLI and its interpreter live.
  'CLI_PATH',
  'VENV_PATH',
  'PYTHONPATH',
  'PYTHONHOME',
  'PYTHONIOENCODING',
  'PYTHONUNBUFFERED',
  'VIRTUAL_ENV',
  'UV_CACHE_DIR',
  'UV_PYTHON',
  'UV_PROJECT_ENVIRONMENT',
  'CLASSIFYRE_CLI_AUTO_INSTALL_OPTIONAL_DEPS',
  'CLASSIFYRE_UV_SYNC_STATE_DIR',
  'CLASSIFYRE_UV_SYNC_TIMEOUT_SECONDS',
  // TLS trust and egress: dropping these looks to the author like a broken
  // connector rather than a policy decision.
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'NODE_EXTRA_CA_CERTS',
  'HTTP_PROXY',
  'HTTPS_PROXY',
  'NO_PROXY',
  'http_proxy',
  'https_proxy',
  'no_proxy',
  // Windows cannot spawn a process without these.
  'SYSTEMROOT',
  'COMSPEC',
  'PATHEXT',
  'APPDATA',
  'LOCALAPPDATA',
  'USERPROFILE',
  'NUMBER_OF_PROCESSORS',
]);

/**
 * Names that must never reach a notebook execution, whatever else changes.
 *
 * The allowlist above already excludes them; this list exists so the intent is
 * testable and so a future widening of the allowlist cannot quietly let one
 * through.
 */
export const FORBIDDEN_NOTEBOOK_ENV_KEYS = [
  'DATABASE_URL',
  'DIRECT_DATABASE_URL',
  'CLASSIFYRE_INTERNAL_KEY',
  'CLASSIFYRE_MASKED_CONFIG_KEY',
  'CLASSIFYRE_MASKED_CONFIG_PASSPHRASE',
  'CLASSIFYRE_MASKED_CONFIG_SALT',
] as const;

export function buildNotebookEnvironment(
  base: NodeJS.ProcessEnv = process.env,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (value !== undefined && ALLOWED_ENV_KEYS.has(key)) {
      env[key] = value;
    }
  }
  Object.assign(env, extra);

  // Belt and braces: an `extra` built from a wider source cannot smuggle one in.
  for (const key of FORBIDDEN_NOTEBOOK_ENV_KEYS) {
    delete env[key];
  }
  return env;
}

export function isEnvKeyAllowedForNotebooks(key: string): boolean {
  return ALLOWED_ENV_KEYS.has(key);
}
