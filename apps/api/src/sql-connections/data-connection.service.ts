import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ClsService } from 'nestjs-cls';
import type { DataConnection } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import {
  AuditTrailService,
  type AuditChange,
} from '../identity/audit-trail.service';
import {
  DATA_RESOURCE,
  assetResource,
  connectionResource,
  sourceResource,
} from '../identity/audit-resources';
import type { Capability } from '../identity/capabilities';
import { CLS_SLUG } from '../namespace/namespace.constants';
import { GovernanceService } from '../governance/governance.service';
import { GovernanceNotifier } from '../governance/governance-notifier';
import type { ScopeIds } from '../data-query/connection-scope';
import { scramVerifier } from './scram';
import { isSqlGatewayTlsEnabled } from '../sql-gateway/tls-config';
import { ConnectionRightsService } from './connection-rights.service';
import { ConnectionExposureService } from './connection-exposure.service';
import {
  type ConnectionRow,
  connectionStatus,
  isEverything,
  parseScope,
  splitScoped,
  usernamePart,
} from './connection-scope-rules';
import type {
  CreateDataConnectionDto,
  DataConnectionDto,
  DataConnectionEndpointDto,
  DataConnectionListDto,
  DataConnectionSecretDto,
  IssueDataConnectionDto,
} from './data-connection.dto';

export const DEFAULT_EXPIRY_DAYS = 90;
const READS_WINDOW_DAYS = 90;

/**
 * SQL connections (docs/prd/DQ-data-query.md §5.7): the credentials BI tools
 * and drivers sign in with over the PostgreSQL protocol. Each belongs to one
 * person and reads only what that person may query right now, narrowed by its
 * scope, to what is open, minus what owners blocked. Its person makes one, or
 * a manager or an owner gives one; only its person ever sees the password, and
 * only a SCRAM verifier is kept. Every change is audited with the connection.
 *
 * Rights live in {@link ConnectionRightsService}, opening and reachability in
 * {@link ConnectionExposureService}, what the gateway needs in
 * `ConnectionSignInService`; this is the connections' own lifecycle.
 */
@Injectable()
export class DataConnectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly actors: ActorContextService,
    private readonly audit: AuditTrailService,
    private readonly governance: GovernanceService,
    private readonly notifier: GovernanceNotifier,
    private readonly rights: ConnectionRightsService,
    private readonly exposures: ConnectionExposureService,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────

  async listMine(): Promise<DataConnectionListDto> {
    const me = this.rights.me();
    const [rows, canCreate, canManage, canConnectAll] = await Promise.all([
      this.prisma.dataConnection.findMany({
        where: { personRef: me },
        include: { blocks: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.rights.canConnect(),
      this.rights.canManage(),
      this.rights.canConnectAll(),
    ]);
    return {
      items: await this.views(rows),
      canCreate,
      canManage,
      canConnectAll,
    };
  }

  async listAll(): Promise<DataConnectionListDto> {
    if (!(await this.rights.canManage())) {
      this.rights.refuse('data.connection.manage');
    }
    const rows = await this.prisma.dataConnection.findMany({
      include: { blocks: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: await this.views(rows),
      canCreate: await this.rights.canConnect(),
      canManage: true,
      canConnectAll: true,
    };
  }

  /**
   * The connections that concern one table or source: those that read it in
   * the last 90 days, name it in their scope, or are blocked on it. For its
   * owners and stewards and for managers (GOV: who accesses it, and how).
   */
  async listFor(scope: {
    type: 'asset' | 'source';
    id: string;
  }): Promise<DataConnectionListDto> {
    const scopeType = scope.type === 'asset' ? 'ASSET' : 'SOURCE';
    const governed = await this.governance.mayGovernScope({
      scopeType,
      scopeId: scope.id,
    });
    const canManage = await this.rights.canManage();
    if (!governed.allowed && !canManage) this.rights.refuse('asset.govern');
    const tag =
      scope.type === 'asset'
        ? assetResource(scope.id)
        : sourceResource(scope.id);
    const since = new Date(Date.now() - READS_WINDOW_DAYS * 86_400_000);
    const reads = await this.prisma.$queryRaw<
      { connection_id: string; count: bigint; last_at: Date }[]
    >`
      SELECT substring(actor from '@sql:([A-Za-z0-9-]+)$') AS connection_id,
             count(*) AS count, max(occurred_at) AS last_at
        FROM audit_events
       WHERE resources @> ARRAY[${tag}]::text[]
         AND channel = 'sql'
         AND occurred_at >= ${since}
       GROUP BY 1`;
    const readBy = new Map(
      reads
        .filter((row) => row.connection_id)
        .map((row) => [
          row.connection_id,
          { count: Number(row.count), lastAt: row.last_at },
        ]),
    );
    const scopeIds =
      scope.type === 'asset' ? [scope.id, governed.sourceId] : [scope.id];
    const rows = await this.prisma.dataConnection.findMany({
      where: {
        OR: [
          { id: { in: [...readBy.keys()] } },
          { scopeAssetIds: { has: scope.type === 'asset' ? scope.id : '-' } },
          { scopeSourceIds: { hasSome: [governed.sourceId] } },
          { blocks: { some: { scopeId: { in: scopeIds } } } },
        ],
      },
      include: { blocks: true },
      orderBy: { createdAt: 'desc' },
    });
    const views = await this.views(rows);
    return {
      items: views.map((view) => ({
        ...view,
        reads: readBy.get(view.id) ?? { count: 0, lastAt: null },
      })),
      canCreate: await this.rights.canConnect(),
      canManage,
      canGovern: governed.allowed,
      canConnectAll: await this.rights.canConnectAll(),
      exposure: await this.exposures.exposureOf(
        scope.type,
        scope.id,
        governed.sourceId,
      ),
    };
  }

  endpoint(): DataConnectionEndpointDto {
    const host = process.env.SQL_GATEWAY_PUBLIC_HOST?.trim() || null;
    const tlsEnabled = isSqlGatewayTlsEnabled();
    const caFile = tlsEnabled
      ? process.env.SQL_GATEWAY_TLS_CA_FILE?.trim()
      : undefined;
    let caCertificate: string | null = null;
    if (caFile) {
      try {
        caCertificate = readFileSync(caFile, 'utf8');
      } catch {
        caCertificate = null;
      }
    }
    const slug = this.cls.isActive()
      ? (this.cls.get<string>(CLS_SLUG) ?? '')
      : '';
    return {
      // On: this deployment runs a gateway (the chart's `sqlGateway.enabled`,
      // the all-in-one image's default). Configured: people also have an
      // address to reach it at. A gateway with no public host is running but
      // cannot be reached from outside: the app says so and links the setup.
      enabled: /^(1|true|yes|on)$/i.test(process.env.SQL_GATEWAY_ENABLED ?? ''),
      configured: Boolean(host),
      host,
      port: Number(process.env.SQL_GATEWAY_PUBLIC_PORT) || 5432,
      database: slug,
      // When TLS is enabled (default), the gateway's certificate names the
      // public host, from a public CA or from the CA shipped here: either way
      // the client can check both (`verify-full`). When TLS is disabled
      // (`SQL_GATEWAY_TLS_ENABLED=false`), clients connect without TLS.
      sslMode: tlsEnabled ? 'verify-full' : 'disable',
      caCertificate,
    };
  }

  // ── Changes ───────────────────────────────────────────────────────────

  /**
   * A connection of one's own; the password is in the answer, once. It names
   * open sources or tables its person may query, or — for admins and people
   * who answer for data — nothing, meaning everything open.
   */
  async create(
    body: CreateDataConnectionDto,
  ): Promise<DataConnectionSecretDto> {
    const me = this.rights.me();
    if (!(await this.rights.canConnect())) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'CAPABILITY_REQUIRED',
        capability: 'data.connect',
        message:
          'A SQL connection needs the right to query tables here (a Data reader role, or tables you own).',
      });
    }
    const scope = parseScope(body.scope);
    if (isEverything(scope)) {
      if (!(await this.rights.canConnectAll())) throw scopeRequired();
    } else {
      await this.exposures.assertNamedScope(scope, { mustQuery: true });
    }
    const password = newPassword();
    const row = await this.prisma.dataConnection.create({
      data: {
        name: body.name.trim(),
        personRef: me,
        username: await this.newUsername(me, body.name),
        ...verifierFields(password),
        scopeSourceIds: scope.sourceIds,
        scopeAssetIds: scope.assetIds,
        revealedAt: new Date(),
        expiresAt: expiry(body.expiresInDays),
      },
      include: { blocks: true },
    });
    this.record(row, 'data-connections.create', 'data.connect', [
      { field: 'connection', from: null, to: `${row.name} (${row.username})` },
      ...(await this.scopeChange(scope)),
    ]);
    return { connection: (await this.views([row]))[0], password };
  }

  /**
   * A connection given to someone (DQ §5.7). An owner or steward gives one
   * for open tables and sources they govern; a manager for any open ones. A
   * connection for everything is given only by a manager, and only to a
   * person who may have one themselves (a manager, or an owner, steward or
   * custodian). It waits until its person reveals the password, and it is a
   * channel: the person still needs the right to read what it names.
   */
  async issue(body: IssueDataConnectionDto): Promise<DataConnectionDto> {
    const me = this.rights.me();
    const scope = parseScope(body.scope);
    const canManage = await this.rights.canManage();
    if (isEverything(scope)) {
      if (!canManage) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'SCOPE_REQUIRED',
          message:
            'Name the tables or sources you govern that this connection is for; only admins give a connection for everything.',
        });
      }
      if (!(await this.rights.personMayConnectAll(body.personRef))) {
        throw new BadRequestException({
          statusCode: 400,
          error: 'Bad Request',
          code: 'SCOPE_REQUIRED',
          message:
            'This person may not have a connection for everything (only admins, owners, stewards and custodians may): name sources or tables.',
        });
      }
    } else {
      if (!canManage) await this.assertGoverns(scope);
      await this.exposures.assertNamedScope(scope, { mustQuery: false });
    }
    const member = await this.governance.tenantMember(body.personRef);
    if (!member)
      throw new BadRequestException('No such person in this tenant.');
    const row = await this.prisma.dataConnection.create({
      data: {
        name: body.name.trim(),
        personRef: body.personRef,
        username: await this.newUsername(
          body.personRef,
          body.name,
          member.username || member.email || undefined,
        ),
        scopeSourceIds: scope.sourceIds,
        scopeAssetIds: scope.assetIds,
        issuedBy: this.actors.current().ref ?? me,
        expiresAt: expiry(body.expiresInDays),
      },
      include: { blocks: true },
    });
    this.record(
      row,
      'data-connections.issue',
      canManage ? 'data.connection.manage' : 'asset.govern',
      [
        {
          field: 'connection',
          from: null,
          to: `${row.name} (${row.username})`,
        },
        { field: 'person', from: null, to: member.email ?? member.username },
        ...(await this.scopeChange(scope)),
      ],
      [
        ...scope.sourceIds.map(sourceResource),
        ...scope.assetIds.map(assetResource),
      ],
    );
    void this.notifier.connectionChanged({
      kind: 'issued',
      connectionId: row.id,
      connectionName: row.name,
      personRef: row.personRef,
      actorRef: me,
    });
    return (await this.views([row]))[0];
  }

  /**
   * A new password for one's own connection: reveals an issued one the first
   * time, replaces it after. Tools signed in with the old one stop at their
   * next sign-in.
   */
  async newPasswordFor(id: string): Promise<DataConnectionSecretDto> {
    const me = this.rights.me();
    const row = await this.find(id);
    if (row.personRef !== me) {
      throw new ForbiddenException(
        'Only the person a connection belongs to sees its password.',
      );
    }
    const status = connectionStatus(row);
    if (status === 'revoked' || status === 'expired') {
      throw new BadRequestException(`This connection is ${status}.`);
    }
    const password = newPassword();
    const updated = await this.prisma.dataConnection.update({
      where: { id },
      data: { ...verifierFields(password), revealedAt: new Date() },
      include: { blocks: true },
    });
    this.record(
      updated,
      status === 'pending'
        ? 'data-connections.reveal'
        : 'data-connections.password',
      'data.connect',
      [
        {
          field: 'password',
          from: row.secretPreview ? `…${row.secretPreview}` : null,
          to: `…${updated.secretPreview}`,
        },
      ],
    );
    return { connection: (await this.views([updated]))[0], password };
  }

  async revoke(id: string, reason?: string): Promise<DataConnectionDto> {
    const me = this.rights.me();
    const row = await this.find(id);
    if (row.personRef !== me && !(await this.rights.canManage())) {
      this.rights.refuse('data.connection.manage');
    }
    if (row.revokedAt) return (await this.views([row]))[0];
    const updated = await this.prisma.dataConnection.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        revokedBy: this.actors.current().ref ?? me,
        revokeReason: reason?.trim() || null,
      },
      include: { blocks: true },
    });
    this.record(
      updated,
      'data-connections.revoke',
      row.personRef === me ? 'data.connect' : 'data.connection.manage',
      [
        { field: 'status', from: connectionStatus(row), to: 'revoked' },
        ...(reason ? [{ field: 'reason', from: null, to: reason }] : []),
      ],
    );
    void this.notifier.connectionChanged({
      kind: 'revoked',
      connectionId: row.id,
      connectionName: row.name,
      personRef: row.personRef,
      actorRef: me,
      reason: reason ?? null,
    });
    return (await this.views([updated]))[0];
  }

  /** An owner or steward closes their table or source to one connection. */
  async block(
    id: string,
    body: { type: 'source' | 'asset'; id: string; reason?: string },
  ): Promise<DataConnectionDto> {
    const me = this.rights.me();
    const row = await this.find(id);
    const scopeType = body.type === 'asset' ? 'ASSET' : 'SOURCE';
    const governed = await this.governance.mayGovernScope({
      scopeType,
      scopeId: body.id,
    });
    if (!governed.allowed && !(await this.rights.canManage())) {
      this.rights.refuse('asset.govern');
    }
    await this.prisma.dataConnectionBlock.upsert({
      where: {
        connectionId_scopeType_scopeId: {
          connectionId: id,
          scopeType,
          scopeId: body.id,
        },
      },
      create: {
        connectionId: id,
        scopeType,
        scopeId: body.id,
        blockedBy: this.actors.current().ref ?? me,
        reason: body.reason?.trim() || null,
      },
      update: { reason: body.reason?.trim() || null },
    });
    const updated = await this.find(id);
    this.record(
      updated,
      'data-connections.block',
      'asset.govern',
      [{ field: 'blocked', from: null, to: governed.name }],
      body.type === 'asset'
        ? [assetResource(body.id), sourceResource(governed.sourceId)]
        : [sourceResource(body.id)],
    );
    void this.notifier.connectionChanged({
      kind: 'blocked',
      connectionId: row.id,
      connectionName: row.name,
      personRef: row.personRef,
      actorRef: me,
      scopeName: governed.name,
      reason: body.reason ?? null,
    });
    return (await this.views([updated]))[0];
  }

  async unblock(id: string, blockId: string): Promise<DataConnectionDto> {
    const me = this.rights.me();
    const row = await this.find(id);
    const block = row.blocks.find((b) => b.id === blockId);
    if (!block) throw new NotFoundException('No such block.');
    const governed = await this.governance.mayGovernScope({
      scopeType: block.scopeType,
      scopeId: block.scopeId,
    });
    if (!governed.allowed && !(await this.rights.canManage())) {
      this.rights.refuse('asset.govern');
    }
    await this.prisma.dataConnectionBlock.delete({ where: { id: blockId } });
    const updated = await this.find(id);
    this.record(
      updated,
      'data-connections.unblock',
      'asset.govern',
      [{ field: 'blocked', from: governed.name, to: null }],
      block.scopeType === 'ASSET'
        ? [assetResource(block.scopeId), sourceResource(governed.sourceId)]
        : [sourceResource(block.scopeId)],
    );
    void this.notifier.connectionChanged({
      kind: 'unblocked',
      connectionId: row.id,
      connectionName: row.name,
      personRef: row.personRef,
      actorRef: me,
      scopeName: governed.name,
    });
    return (await this.views([updated]))[0];
  }

  // ── Helpers ───────────────────────────────────────────────────────────

  /** Every named source and table must be one the caller owns or stewards. */
  private async assertGoverns(scope: ScopeIds): Promise<void> {
    for (const [scopeType, ids] of [
      ['SOURCE', scope.sourceIds],
      ['ASSET', scope.assetIds],
    ] as const) {
      for (const scopeId of ids) {
        const governed = await this.governance.mayGovernScope({
          scopeType,
          scopeId,
        });
        if (!governed.allowed) {
          throw new ForbiddenException({
            statusCode: 403,
            error: 'Forbidden',
            code: 'CAPABILITY_REQUIRED',
            capability: 'asset.govern',
            message: `You can give connections only to what you own or steward; ${governed.name} is not.`,
          });
        }
      }
    }
  }

  private async find(id: string): Promise<ConnectionRow> {
    const row = await this.prisma.dataConnection.findUnique({
      where: { id },
      include: { blocks: true },
    });
    if (!row) throw new NotFoundException('No such SQL connection.');
    return row;
  }

  /** `<person>_<name>`, unique in the workspace: what the tool signs in as. */
  private async newUsername(
    personRef: string,
    name: string,
    login?: string,
  ): Promise<string> {
    const who =
      usernamePart(
        login ??
          (await this.governance.tenantMember(personRef))?.username ??
          personRef.slice(5, 13),
      ) || 'user';
    const base = `${who}_${usernamePart(name) || 'sql'}`.slice(0, 48);
    for (let n = 1; n < 1000; n += 1) {
      const candidate = n === 1 ? base : `${base}_${n}`;
      const taken = await this.prisma.dataConnection.findUnique({
        where: { username: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }
    return `${base}_${randomBytes(3).toString('hex')}`;
  }

  private async scopeChange(scope: ScopeIds): Promise<AuditChange[]> {
    if (isEverything(scope)) {
      return [
        { field: 'scope', from: null, to: 'everything its person may query' },
      ];
    }
    const names = await this.exposures.names(scope);
    return [
      {
        field: 'scope',
        from: null,
        to: [...names.values()].map((item) => item.name).join(', '),
      },
    ];
  }

  private async views(rows: ConnectionRow[]): Promise<DataConnectionDto[]> {
    const me = this.rights.person()?.actorRef;
    const canManage = await this.rights.canManage();
    const named = rows.map((row) => ({
      sourceIds: [...row.scopeSourceIds, ...splitScoped(row.blocks).sourceIds],
      assetIds: [...row.scopeAssetIds, ...splitScoped(row.blocks).assetIds],
    }));
    const names = await this.exposures.names({
      sourceIds: [...new Set(named.flatMap((n) => n.sourceIds))],
      assetIds: [...new Set(named.flatMap((n) => n.assetIds))],
    });
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      personRef: row.personRef,
      username: row.username,
      secretPreview: row.secretPreview,
      status: connectionStatus(row),
      scope: [
        ...row.scopeSourceIds.map((id) => `source:${id}`),
        ...row.scopeAssetIds.map((id) => `asset:${id}`),
      ].flatMap((key) => {
        const item = names.get(key);
        return item ? [item] : [];
      }),
      blocks: row.blocks.map((block) => {
        const type = block.scopeType === 'ASSET' ? 'asset' : 'source';
        return {
          id: block.id,
          type,
          scopeId: block.scopeId,
          name: names.get(`${type}:${block.scopeId}`)?.name ?? 'Removed',
          blockedBy: block.blockedBy,
          reason: block.reason,
          createdAt: block.createdAt,
        };
      }),
      issuedBy: row.issuedBy,
      expiresAt: row.expiresAt,
      lastUsedAt: row.lastUsedAt,
      lastUsedIp: row.lastUsedIp,
      revokedAt: row.revokedAt,
      revokedBy: row.revokedBy,
      revokeReason: row.revokeReason,
      createdAt: row.createdAt,
      canRevoke: !row.revokedAt && (row.personRef === me || canManage),
    }));
  }

  private record(
    row: DataConnection,
    operation: string,
    capability: Capability,
    changes: AuditChange[],
    extraResources: string[] = [],
  ): void {
    void this.audit.record({
      actor: this.actors.current(),
      channel: 'rest',
      capability,
      operation,
      entityType: 'data-connection',
      entityId: row.id,
      entityName: row.name,
      resources: [DATA_RESOURCE, connectionResource(row.id), ...extraResources],
      fields: changes.map((change) => change.field),
      changes,
    });
  }
}

function scopeRequired(): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'SCOPE_REQUIRED',
    message:
      'Choose the sources or tables this connection is for. Only admins, owners, stewards and custodians may make one for everything.',
  });
}

function newPassword(): string {
  return randomBytes(24).toString('base64url');
}

function verifierFields(password: string) {
  const verifier = scramVerifier(password);
  return {
    scramSalt: verifier.salt,
    scramIterations: verifier.iterations,
    scramStoredKey: verifier.storedKey,
    scramServerKey: verifier.serverKey,
    secretPreview: password.slice(-4),
  };
}

function expiry(days?: number): Date {
  const span = Math.min(Math.max(days ?? DEFAULT_EXPIRY_DAYS, 1), 365);
  return new Date(Date.now() + span * 86_400_000);
}
