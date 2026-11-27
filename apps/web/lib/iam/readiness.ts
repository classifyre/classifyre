import { existsSync } from "node:fs";
import { apiBaseUrls } from "@/lib/api-upstream";
import { upstreamIamBaseUrl } from "@/lib/iam/proxy-target";

/**
 * Startup readiness for the web server: checks whether the API, the identity
 * server's realm, the API's first-tenant bootstrap, and (in the all-in-one
 * Docker image) the first-run bootstrap script have all finished.
 *
 * Used by `proxy.ts`, `/auth/login/`, `/auth/ready/`, and `/auth/starting/`
 * so people who open the app while a fresh deployment is still coming up see
 * an auto-refreshing preparation screen instead of 401/502/404 errors.
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
const CACHE_MS = 1_500;
const DEFAULT_READY_FILE = "/run/classifyre/bootstrap.ready";

let everReady = false;
let cached: { status: ReadinessStatus; at: number } | null = null;
let inflight: Promise<ReadinessStatus> | null = null;

/** Fast synchronous check used by `proxy.ts` once startup has completed. */
export function isDeploymentKnownReady(): boolean {
  return everReady;
}

/**
 * Called when an upstream error (e.g. `IdentityUnavailableError`) signals that
 * a previously ready service is restarting or temporarily away.
 */
export function markDeploymentNotReady(): void {
  everReady = false;
  cached = null;
}

/** Test-only helper to clear module-level readiness state between specs. */
export function resetReadinessForTests(): void {
  everReady = false;
  cached = null;
  inflight = null;
}

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
      let iamReady = true;
      try {
        const body = (await response.json()) as { iamReady?: unknown };
        if (typeof body?.iamReady === "boolean") {
          iamReady = body.iamReady;
        }
      } catch {
        // Older API builds or non-JSON responses still count as API reachable.
      }
      return { api: true, tenant: iamReady };
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
  force?: boolean;
  env?: Record<string, string | undefined>;
  apiUrls?: string[];
  fetchImpl?: typeof fetch;
  existsImpl?: (path: string) => boolean;
}): Promise<ReadinessStatus> {
  const useCache = !options?.env && !options?.apiUrls && !options?.fetchImpl && !options?.existsImpl;
  if (useCache && !options?.force && cached && Date.now() - cached.at < CACHE_MS) {
    return cached.status;
  }
  if (useCache && inflight) {
    return inflight;
  }

  const env = options?.env ?? process.env;
  const urls = options?.apiUrls ?? apiBaseUrls();
  const fetchImpl = options?.fetchImpl ?? fetch;
  const existsImpl = options?.existsImpl ?? existsSync;

  const run = (async (): Promise<ReadinessStatus> => {
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
    const ready = checks.api && checks.iam && checks.tenant && checks.bootstrap;
    const status: ReadinessStatus = { ready, checks };
    if (useCache) {
      cached = { status, at: Date.now() };
      if (ready) everReady = true;
    }
    return status;
  })();

  if (!useCache) return run;

  inflight = run;
  try {
    return await run;
  } finally {
    if (inflight === run) inflight = null;
  }
}
