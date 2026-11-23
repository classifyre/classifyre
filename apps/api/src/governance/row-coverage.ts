import { EVERYONE } from '../data-query/row-filters';
import { BUILT_IN_ROLES } from '../identity/roles';

/** A group that may query a filtered table and that no rule gives a row. */
export interface ReaderWithoutRows {
  groupId: string;
  path: string;
  /** The role that lets it query the table. */
  roleKey: string;
}

const QUERYING_ROLES: ReadonlySet<string> = new Set(
  BUILT_IN_ROLES.filter((role) =>
    (role.capabilities as readonly string[]).includes('data.query'),
  ).map((role) => role.key),
);

/**
 * Who would read no row of a filtered table (DQ §5.10): the groups whose
 * grants let them query it — on the tenant, the workspace, its source or the
 * table itself — that no rule covers. A rule for a group covers its
 * subgroups (members hold their parents' groups), a rule for everyone covers
 * all, and stewards see every row anyway. Filters fail closed on purpose;
 * this is so whoever sets them sees that admins and a shared dataset's
 * owning group are bound too.
 */
export function readersWithoutRows(input: {
  table: { assetId: string; sourceId: string; namespaceId: string };
  grants: readonly {
    subjectId: string;
    subjectLabel: string;
    roleKey: string;
    scopeType: string;
    scopeId: string;
  }[];
  ruleRefs: readonly string[];
  /** Group id → path, for the groups the rules name. */
  groupPaths: ReadonlyMap<string, string>;
  stewardGroupIds: readonly string[];
}): ReaderWithoutRows[] {
  if (input.ruleRefs.includes(EVERYONE)) return [];
  const rulePaths = input.ruleRefs
    .filter((ref) => ref.startsWith('group:'))
    .map((ref) => input.groupPaths.get(ref.slice('group:'.length)))
    .filter((path): path is string => Boolean(path));
  const ruleIds = new Set(
    input.ruleRefs
      .filter((ref) => ref.startsWith('group:'))
      .map((ref) => ref.slice('group:'.length)),
  );
  const covered = (groupId: string, path: string) =>
    ruleIds.has(groupId) ||
    rulePaths.some((rule) => path === rule || path.startsWith(`${rule}/`));
  const reaches = (scopeType: string, scopeId: string) => {
    if (scopeType === 'asset') {
      return scopeId === `${input.table.namespaceId}/${input.table.assetId}`;
    }
    if (scopeType === 'source') {
      return scopeId === `${input.table.namespaceId}/${input.table.sourceId}`;
    }
    // Tenant, group and workspace grants listed for this workspace apply to it.
    return true;
  };
  const out = new Map<string, ReaderWithoutRows>();
  for (const grant of input.grants) {
    if (!QUERYING_ROLES.has(grant.roleKey)) continue;
    if (!reaches(grant.scopeType, grant.scopeId)) continue;
    if (input.stewardGroupIds.includes(grant.subjectId)) continue;
    if (covered(grant.subjectId, grant.subjectLabel)) continue;
    if (!out.has(grant.subjectId)) {
      out.set(grant.subjectId, {
        groupId: grant.subjectId,
        path: grant.subjectLabel,
        roleKey: grant.roleKey,
      });
    }
  }
  return [...out.values()].sort((a, b) => a.path.localeCompare(b.path));
}
