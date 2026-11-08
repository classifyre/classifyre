const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Path of the realm's identity console behind the `/iam` proxy, optionally
 * opened on one organization (a tenant). Null when the console is not
 * reachable through the app (`iam.realmConsole` off).
 */
export function identityConsolePath(
  env: Record<string, string | undefined>,
  organizationId?: string | null,
): string | null {
  if (env.IAM_ENABLED !== "true" || env.IAM_REALM_CONSOLE !== "true")
    return null;
  const realm = env.IAM_REALM?.trim();
  if (!realm || !/^[A-Za-z0-9_-]+$/.test(realm)) return null;
  const view =
    organizationId && UUID.test(organizationId)
      ? `organizations/${organizationId.toLowerCase()}/settings`
      : "organizations";
  return `/iam/admin/${realm}/console/#/${realm}/${view}`;
}
