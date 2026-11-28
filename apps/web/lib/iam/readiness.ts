import { existsSync } from "node:fs";
import { apiBaseUrls } from "@/lib/api-upstream";
import { upstreamIamBaseUrl } from "@/lib/iam/proxy-target";

/**
 * Stateless startup readiness check: probes whether the API, the identity
 * server's realm, the API's first-tenant bootstrap, and (in the all-in-one
 * Docker image) the first-run bootstrap script are all ready.
 *
 * Deliberately holds no module-level cache or latch: Next.js 16 executes
 * `proxy.ts` separately from route handlers, so module globals cannot be
 * assumed to be shared across them — and a stateless probe also notices
 * restarts or outages immediately without a stale latch.
 */

export interface ReadinessChecks {
  api: boolean;
  iam: boolean;
  tenant: boolean;
  bootstrap: boolean;
}

export interface ReadinessStatus {
  ready: boolean;
  checks: ReadinessChecks;
}

const PROBE_TIMEOUT_MS = 1_500;
const DEFAULT_READY_FILE = "/run/classifyre/bootstrap.ready";

async function probeApi(
  urls: string[],
  fetchImpl: typeof fetch,
): Promise<{ api: boolean; tenant: boolean }> {
  for (const base of urls) {
    try {
      const response = await fetchImpl(`${base}/`, {
        cache: "no-store",
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (!response.ok) continue;
      let tenantReady = true;
      try {
        const body = (await response.json()) as { tenantReady?: unknown };
        if (typeof body?.tenantReady === "boolean") {
          tenantReady = body.tenantReady;
        }
      } catch {
        // Older API builds or non-JSON responses still count as API reachable.
      }
      return { api: true, tenant: tenantReady };
    } catch {
      // Try the next configured upstream candidate.
    }
  }
  return { api: false, tenant: false };
}

function iamDiscoveryUrl(
  env: Record<string, string | undefined>,
): string | null {
  const realm = env.IAM_REALM?.trim();
  const internal = upstreamIamBaseUrl(env);
  if (internal && realm) {
    return `${internal}/realms/${realm}/.well-known/openid-configuration`;
  }
  const issuer = env.IAM_ISSUER_URL?.trim().replace(/\/+$/, "");
  if (issuer) {
    return `${issuer}/.well-known/openid-configuration`;
  }
  return null;
}

async function probeIam(
  env: Record<string, string | undefined>,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const url = iamDiscoveryUrl(env);
  if (!url) return false;
  try {
    const response = await fetchImpl(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function probeBootstrap(
  env: Record<string, string | undefined>,
  existsImpl: (path: string) => boolean,
): boolean {
  if (env.CLASSIFYRE_ALLINONE !== "1") return true;
  const readyFile = env.CLASSIFYRE_READY_FILE?.trim() || DEFAULT_READY_FILE;
  return existsImpl(readyFile);
}

export async function checkDeploymentReadiness(options?: {
  env?: Record<string, string | undefined>;
  apiUrls?: string[];
  fetchImpl?: typeof fetch;
  existsImpl?: (path: string) => boolean;
}): Promise<ReadinessStatus> {
  const env = options?.env ?? process.env;
  const urls = options?.apiUrls ?? apiBaseUrls();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const existsImpl = options?.existsImpl ?? existsSync;

  const [apiResult, iam] = await Promise.all([
    probeApi(urls, fetchImpl),
    probeIam(env, fetchImpl),
  ]);
  const bootstrap = probeBootstrap(env, existsImpl);
  const checks: ReadinessChecks = {
    api: apiResult.api,
    iam,
    tenant: apiResult.tenant,
    bootstrap,
  };
  return {
    ready: checks.api && checks.iam && checks.tenant && checks.bootstrap,
    checks,
  };
}
