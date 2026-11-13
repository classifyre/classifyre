/**
 * What a SQL connection narrows its person's access to (docs/prd/DQ §5.7),
 * set in CLS by the SQL gateway for the session's requests. A connection is
 * a channel, not a right: it never widens what the person may read.
 */
export const CLS_CONNECTION_SCOPE = 'classifyre:connectionScope';

/** Sources and tables, by id: what a scope, a block list or an opening names. */
export interface ScopeIds {
  sourceIds: string[];
  assetIds: string[];
}

export interface ConnectionScope {
  /** Empty both = everything the person may read (that is open). */
  sourceIds: string[];
  assetIds: string[];
  /** An owner's or steward's blocks on their source or table. */
  blockedSourceIds: string[];
  blockedAssetIds: string[];
  /**
   * What the workspace opened to SQL connections (opt-in): a table is
   * reachable when it or its source is here.
   */
  openSourceIds: string[];
  openAssetIds: string[];
}

/** Whether a table is open to SQL connections at all (it, or its source, opened). */
export function isOpenToConnections(
  open: { openSourceIds: readonly string[]; openAssetIds: readonly string[] },
  table: { assetId: string; sourceId: string },
): boolean {
  return (
    open.openAssetIds.includes(table.assetId) ||
    open.openSourceIds.includes(table.sourceId)
  );
}

/** Whether a table the person may read is also reachable through the connection. */
export function connectionAllows(
  scope: ConnectionScope | undefined | null,
  table: { assetId: string; sourceId: string },
): boolean {
  if (!scope) return true;
  if (!isOpenToConnections(scope, table)) return false;
  if (
    scope.blockedAssetIds.includes(table.assetId) ||
    scope.blockedSourceIds.includes(table.sourceId)
  ) {
    return false;
  }
  if (!scope.sourceIds.length && !scope.assetIds.length) return true;
  return (
    scope.sourceIds.includes(table.sourceId) ||
    scope.assetIds.includes(table.assetId)
  );
}
