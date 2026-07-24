/**
 * Resolve the URL this API gives to child processes and Kubernetes Jobs when
 * they need to call back into the same API instance.
 *
 * The configured URL may contain an ingress/service path prefix. Callers get a
 * complete namespace base URL and must only append their endpoint path.
 */
export function resolveInternalApiBaseUrl(
  environment: string,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    env.CLASSIFYRE_INTERNAL_API_URL ||
    env.CLI_OUTPUT_REST_URL ||
    env.CLASSIFYRE_OUTPUT_REST_URL;

  if (configured?.trim()) {
    return normalizeAbsoluteBaseUrl(configured);
  }

  if (environment === 'desktop') {
    return `http://127.0.0.1:${env.PORT || '8000'}`;
  }
  if (environment === 'development' || environment === 'test') {
    return 'http://localhost:8000';
  }

  throw new Error(
    'CLASSIFYRE_INTERNAL_API_URL is required to launch CLI jobs in this environment',
  );
}

/** Build `<host>/<optional-prefix>/<namespace-id>` exactly once. */
export function buildNamespaceApiBaseUrl(
  internalApiBaseUrl: string,
  namespaceId: string | undefined,
): string {
  const base = normalizeAbsoluteBaseUrl(internalApiBaseUrl);
  const id = namespaceId?.trim();
  if (!id) {
    throw new Error(
      'Cannot launch a CLI process without a namespace ID in the API context',
    );
  }

  const encodedId = encodeURIComponent(id);
  if (base.endsWith(`/${encodedId}`)) {
    return base;
  }
  return `${base}/${encodedId}`;
}

/** Append an endpoint to a complete API base URL without discarding its path. */
export function appendApiPath(
  apiBaseUrl: string,
  endpointPath: string,
): string {
  const base = normalizeAbsoluteBaseUrl(apiBaseUrl);
  const path = endpointPath.replace(/^\/+/, '');
  return path ? `${base}/${path}` : base;
}

function normalizeAbsoluteBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new Error(
      `Internal API URL must be absolute (received ${JSON.stringify(value)})`,
    );
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(
      `Internal API URL must use http or https (received ${JSON.stringify(value)})`,
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error('Internal API URL must not contain a query string or hash');
  }
  return normalized;
}
