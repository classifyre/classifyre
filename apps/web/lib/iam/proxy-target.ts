/**
 * Which identity-server paths the web app's `/iam/[...path]` proxy forwards
 * (docs/prd/IAM-access-management.md §9). The chart keeps Keycloak a
 * ClusterIP service; browsers reach it only here. The allow-list mirrors what
 * the old dedicated ingress did: the Classifyre realm and the theme's static
 * files, plus the admin console and the master realm when the operator turned
 * `iam.exposeAdminConsole` on.
 */

/** In-cluster base of the identity server, e.g. `http://classifyre-iam:8080/iam`. */
export function upstreamIamBaseUrl(
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.IAM_ENABLED !== "true") return null;
  const internal = env.IAM_INTERNAL_URL?.trim().replace(/\/+$/, "");
  if (internal) return internal;
  const service = env.IAM_SERVICE_URL?.trim().replace(/\/+$/, "");
  if (service) return service;
  return null;
}

/**
 * The upstream URL for a proxied browser path. Transparent: query pairs stay
 * in order (forEach passes value first) and the trailing slash is preserved —
 * Keycloak's endpoints are slash-sensitive, so normalizing either breaks them
 * (auth rejected `client_id`; slashless console redirects doubled the prefix).
 */
export function upstreamIamUrl(
  base: string,
  path: string[],
  search: URLSearchParams,
  hadTrailingSlash: boolean,
): URL {
  const joined = path.join("/");
  const targetUrl = new URL(
    `${base}/${joined}${hadTrailingSlash && joined ? "/" : ""}`,
  );
  search.forEach((value, key) => {
    targetUrl.searchParams.append(key, value);
  });
  return targetUrl;
}

export function allowedIamPath(
  path: string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  // The bare `/iam/` root is Keycloak's own welcome redirect (to the admin
  // console). Forward it only when the operator exposed the console —
  // otherwise it would advertise a path that 404s here.
  if (path.length === 0) return env.IAM_EXPOSE_ADMIN_CONSOLE === "true";
  const [first, second, ...rest] = path;
  if (env.IAM_EXPOSE_ADMIN_CONSOLE === "true") {
    return first === "realms" || first === "resources" || first === "admin";
  }
  if (first !== "realms" && first !== "resources") return false;
  // The master realm is the identity server's own administration; the realm
  // Classifyre uses is the only one browsers may touch.
  const realm = env.IAM_REALM?.trim() || undefined;
  if (first === "realms" && (!realm || second !== realm || rest.length === 0)) {
    return false;
  }
  return true;
}
