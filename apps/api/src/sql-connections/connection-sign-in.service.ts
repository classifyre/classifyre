import { Injectable } from '@nestjs/common';
import type { DataConnection } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AuditTrailService } from '../identity/audit-trail.service';
import { DATA_RESOURCE, connectionResource } from '../identity/audit-resources';
import { sqlConnectionRef } from '../identity/actor-ref';
import type { ConnectionScope } from '../data-query/connection-scope';
import {
  type ConnectionRow,
  connectionScopeOf,
  connectionStatus,
} from './connection-scope-rules';
import { ConnectionRightsService } from './connection-rights.service';

const SIGN_IN_AUDIT_EVERY_MS = 3_600_000;

/**
 * What the SQL gateway needs from connections (docs/prd/DQ §5.7): the row a
 * user name signs in with, whether a connection is still good, its whole
 * scope, and the trail of sign-ins and refusals.
 */
@Injectable()
export class ConnectionSignInService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditTrailService,
    private readonly rights: ConnectionRightsService,
  ) {}

  /**
   * A connection for everything open is allowed only while its person may
   * have one (§5.7: an admin, or someone holding an owner, steward or
   * custodian role). Checked at sign-in and before every statement, so a
   * steward who steps down loses the wide connection with the role.
   */
  async stillAllowed(
    row: Pick<ConnectionRow, 'scopeSourceIds' | 'scopeAssetIds' | 'personRef'>,
  ): Promise<boolean> {
    if (row.scopeSourceIds.length || row.scopeAssetIds.length) return true;
    return this.rights.personMayConnectAll(row.personRef);
  }

  /** The connection a user name signs in as, and its state. */
  async forSignIn(username: string) {
    const row = await this.prisma.dataConnection.findUnique({
      where: { username: username.toLowerCase() },
      include: { blocks: true },
    });
    if (!row) return null;
    return { row, status: connectionStatus(row) };
  }

  /** Still good: not revoked, not expired, with its current blocks. */
  async current(id: string): Promise<ConnectionRow | null> {
    const row = await this.prisma.dataConnection.findUnique({
      where: { id },
      include: { blocks: true },
    });
    if (!row || connectionStatus(row) !== 'active') return null;
    if (!(await this.stillAllowed(row))) return null;
    return row;
  }

  /** The connection's scope, with its blocks and what is open now. */
  async scopeFor(row: ConnectionRow): Promise<ConnectionScope> {
    const exposures = await this.prisma.dataConnectionExposure.findMany({
      select: { scopeType: true, scopeId: true },
    });
    return connectionScopeOf(row, exposures);
  }

  /**
   * A sign-in that worked: last used, from where; on the trail at most once
   * an hour per connection (BI tools sign in often).
   */
  async markUsed(
    id: string,
    ip: string | null,
    previous: Date | null,
  ): Promise<void> {
    const row = await this.prisma.dataConnection
      .update({
        where: { id },
        data: { lastUsedAt: new Date(), lastUsedIp: ip },
      })
      .catch(() => null);
    if (
      !row ||
      (previous && Date.now() - previous.getTime() < SIGN_IN_AUDIT_EVERY_MS)
    ) {
      return;
    }
    void this.audit.record({
      actor: {
        id: row.personRef,
        displayName: null,
        kind: 'person',
        via: 'sql-connection',
        ref: sqlConnectionRef(row.personRef.replace(/^user:/, ''), row.id),
      },
      channel: 'sql',
      capability: 'data.connect',
      operation: 'data-connections.sign-in',
      entityType: 'data-connection',
      entityId: row.id,
      entityName: row.name,
      resources: [DATA_RESOURCE, connectionResource(row.id)],
      fields: [],
      ...(ip ? { changes: [{ field: 'client', from: null, to: ip }] } : {}),
    });
  }

  /** A refused sign-in, for the trail (never the password). */
  recordSignInFailure(
    row: DataConnection | null,
    username: string,
    ip: string | null,
    why: string,
  ): void {
    void this.audit.record({
      actor: {
        id: null,
        displayName: null,
        kind: 'person',
        via: 'sql-connection',
        ref: row
          ? sqlConnectionRef(row.personRef.replace(/^user:/, ''), row.id)
          : undefined,
      },
      channel: 'sql',
      capability: 'data.connect',
      operation: 'data-connections.sign-in-refused',
      entityType: 'data-connection',
      entityId: row?.id ?? null,
      entityName: row?.name ?? username.slice(0, 80),
      resources: [DATA_RESOURCE, ...(row ? [connectionResource(row.id)] : [])],
      fields: [],
      changes: [
        { field: 'reason', from: null, to: why },
        ...(ip ? [{ field: 'client', from: null, to: ip }] : []),
      ],
      status: 401,
    });
  }
}
