/**
 * What a SQL connection narrows its person's access to (docs/prd/DQ §5.7),
 * set in CLS by the SQL gateway for the session's requests. A connection is
 * a channel, not a right: it never widens what the person may read.
 */
export const CLS_CONNECTION_SCOPE = 'classifyre:connectionScope';

export interface ConnectionScope {
  /** Empty both = everything the person may read. */
  sourceIds: string[];
  assetIds: string[];
  /** An owner's or steward's blocks on their source or table. */
  blockedSourceIds: string[];
  blockedAssetIds: string[];
}

/** Whether a table the person may read is also open through the connection. */
export function connectionAllows(
  scope: ConnectionScope | undefined | null,
  table: { assetId: string; sourceId: string },
): boolean {
  if (!scope) return true;
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
