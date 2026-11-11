/**
 * What an audit event touched beyond its one entity, as plain strings the
 * trail can be filtered on (`audit_events.resources`, GIN-indexed):
 *
 * - `data`: anything about SQL over tables — a table read or export, a
 *   Data reader grant. The SQL page's Activity filters on it.
 * - `source:<id>`: reads of the source's tables, access given on the source
 *   or on one of its tables. The source's Data tab filters on it.
 * - `asset:<id>`: reads of that table, access given on it. The table's Data
 *   tab filters on it.
 *
 * One vocabulary for both writers (the per-table reads in query-run.service
 * and the grant changes in audit.interceptor) and the one reader (the
 * `resource` filter of GET /audit-events).
 */
export const DATA_RESOURCE = 'data';

export function sourceResource(sourceId: string): string {
  return `source:${sourceId}`;
}

export function assetResource(assetId: string): string {
  return `asset:${assetId}`;
}

/** A table read or export: the data area, the table, and its source. */
export function tableReadResources(table: {
  assetId: string;
  sourceId?: string | null;
}): string[] {
  return [
    DATA_RESOURCE,
    assetResource(table.assetId),
    ...(table.sourceId ? [sourceResource(table.sourceId)] : []),
  ];
}

/**
 * A grant given or removed. Resource scopes carry `<workspaceId>/<id>`; a
 * table grant also names the table's source (`sourceId` on the grant view),
 * so the source's Activity shows access given on any of its tables.
 */
export function grantResources(grant: {
  roleKey?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
  sourceId?: unknown;
}): string[] {
  const out: string[] = [];
  if (grant.roleKey === 'data-reader') out.push(DATA_RESOURCE);
  const resourceId =
    typeof grant.scopeId === 'string'
      ? grant.scopeId.split('/').slice(1).join('/')
      : '';
  if (resourceId && grant.scopeType === 'source') {
    out.push(sourceResource(resourceId));
  }
  if (resourceId && grant.scopeType === 'asset') {
    out.push(assetResource(resourceId));
    if (typeof grant.sourceId === 'string' && grant.sourceId) {
      out.push(sourceResource(grant.sourceId));
    }
  }
  return out;
}
