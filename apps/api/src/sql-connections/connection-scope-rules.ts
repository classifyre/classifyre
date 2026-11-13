import type { DataConnection, DataConnectionBlock } from '@prisma/client';
import type { ConnectionStatus } from './data-connection.dto';
import type { ConnectionScope, ScopeIds } from '../data-query/connection-scope';

export type ConnectionRow = DataConnection & { blocks: DataConnectionBlock[] };

/** Exposure or block rows, as stored: what a scope type and id point at. */
interface ScopedRow {
  scopeType: 'SOURCE' | 'ASSET';
  scopeId: string;
}

/** `source:<id>` / `asset:<id>` items as source and table ids, deduplicated. */
export function parseScope(items: readonly string[] | undefined): ScopeIds {
  const sourceIds: string[] = [];
  const assetIds: string[] = [];
  for (const item of items ?? []) {
    const [type, id] = item.split(':');
    if (type === 'source') sourceIds.push(id.toLowerCase());
    if (type === 'asset') assetIds.push(id.toLowerCase());
  }
  return {
    sourceIds: [...new Set(sourceIds)],
    assetIds: [...new Set(assetIds)],
  };
}

/** A scope that names nothing: everything its person may query (that is open). */
export function isEverything(scope: ScopeIds): boolean {
  return scope.sourceIds.length === 0 && scope.assetIds.length === 0;
}

/** Rows of one kind, split into source ids and table ids. */
export function splitScoped(rows: readonly ScopedRow[]): ScopeIds {
  return {
    sourceIds: rows
      .filter((r) => r.scopeType === 'SOURCE')
      .map((r) => r.scopeId),
    assetIds: rows.filter((r) => r.scopeType === 'ASSET').map((r) => r.scopeId),
  };
}

/** A connection's whole scope: what it names, its blocks, and what is open. */
export function connectionScopeOf(
  row: Pick<ConnectionRow, 'scopeSourceIds' | 'scopeAssetIds' | 'blocks'>,
  exposures: readonly ScopedRow[],
): ConnectionScope {
  const blocked = splitScoped(row.blocks);
  const open = splitScoped(exposures);
  return {
    sourceIds: row.scopeSourceIds,
    assetIds: row.scopeAssetIds,
    blockedSourceIds: blocked.sourceIds,
    blockedAssetIds: blocked.assetIds,
    openSourceIds: open.sourceIds,
    openAssetIds: open.assetIds,
  };
}

export function connectionStatus(
  row: Pick<DataConnection, 'revokedAt' | 'expiresAt' | 'scramStoredKey'>,
  now = new Date(),
): ConnectionStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt <= now) return 'expired';
  if (!row.scramStoredKey) return 'pending';
  return 'active';
}

/** Lower-case letters, digits and `_`: a name every tool takes unquoted. */
export function usernamePart(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24);
}
