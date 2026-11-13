import type { GrantDto, RoleDto } from "@workspace/api-client";

/**
 * The capability that lets a person see a workspace at all. Add-on roles
 * (Data reader, Code author) do not hold it: a group that has only those
 * cannot open the workspace.
 */
export const OPENS_WORKSPACE = "workspace.view";

type GrantRef = Pick<GrantDto, "roleKey" | "scopeType" | "scopeId">;

/**
 * Whether a role opens the workspace. A role the list does not know (removed
 * since the grant was made) counts as opening, so no one is warned about
 * something that cannot be told.
 */
export function roleOpensWorkspace(
  roles: readonly RoleDto[],
  roleKey: string,
): boolean {
  const role = roles.find((candidate) => candidate.key === roleKey);
  return role ? role.capabilities.includes(OPENS_WORKSPACE) : true;
}

/** True when roles were picked and none of them opens the workspace. */
export function lacksOpeningRole(
  roles: readonly RoleDto[],
  roleKeys: readonly string[],
): boolean {
  return (
    roleKeys.length > 0 &&
    roleKeys.every((key) => !roleOpensWorkspace(roles, key))
  );
}

/** The workspace a single-source or single-table grant is in. */
function workspaceOf(scopeId: string): string {
  return scopeId.split("/")[0] ?? "";
}

/**
 * Whether an opening grant reaches what `grant` gives. A group grant opens
 * the workspaces its group owns, which is not known here, so it counts as
 * reaching any workspace or resource: better a missing warning than a wrong
 * one.
 */
function reaches(opener: GrantRef, grant: GrantRef): boolean {
  if (opener.scopeType === "tenant") return true;
  switch (grant.scopeType) {
    case "tenant":
      return false;
    case "group":
      return opener.scopeType === "group" && opener.scopeId === grant.scopeId;
    case "workspace":
      return (
        opener.scopeType === "group" ||
        (opener.scopeType === "workspace" && opener.scopeId === grant.scopeId)
      );
    case "source":
    case "asset":
      return (
        opener.scopeType === "group" ||
        (opener.scopeType === "workspace" &&
          opener.scopeId === workspaceOf(grant.scopeId))
      );
  }
}

/**
 * Ids of the grants that give a group nothing it can see: the role does not
 * open the workspace, and no other grant of the same group that does reaches
 * the same place. The people of such a group cannot find the workspace unless
 * another of their groups opens it.
 */
export function grantsThatCannotOpen(
  grants: readonly GrantDto[],
  roles: readonly RoleDto[],
): Set<string> {
  const openersByGroup = new Map<string, GrantDto[]>();
  for (const grant of grants) {
    if (
      grant.scopeType !== "source" &&
      grant.scopeType !== "asset" &&
      roleOpensWorkspace(roles, grant.roleKey)
    ) {
      const list = openersByGroup.get(grant.subjectId) ?? [];
      list.push(grant);
      openersByGroup.set(grant.subjectId, list);
    }
  }
  const stuck = new Set<string>();
  for (const grant of grants) {
    if (roleOpensWorkspace(roles, grant.roleKey)) continue;
    const openers = openersByGroup.get(grant.subjectId) ?? [];
    if (!openers.some((opener) => reaches(opener, grant))) stuck.add(grant.id);
  }
  return stuck;
}
