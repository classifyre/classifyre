import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ClsService } from 'nestjs-cls';
import type { DataConnection, DataConnectionBlock } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
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
import { CLS_PERSON, type ClsPerson } from '../identity/iam-access-policy';
import { CLS_SLUG } from '../namespace/namespace.constants';
import { GovernanceService } from '../governance/governance.service';
import { GovernanceNotifier } from '../governance/governance-notifier';
import { ownerDataScope } from '../governance/governance-filter';
import { QueryCatalogService } from '../data-query/query-catalog.service';
import type { ConnectionScope } from '../data-query/connection-scope';
import { scramVerifier } from './scram';
import type {
  ConnectionStatus,
  CreateDataConnectionDto,
  DataConnectionDto,
  DataConnectionEndpointDto,
  DataConnectionListDto,
  DataConnectionScopeItemDto,
  DataConnectionSecretDto,
  IssueDataConnectionDto,
} from './data-connection.dto';

export const DEFAULT_EXPIRY_DAYS = 90;
const READS_WINDOW_DAYS = 90;

type ConnectionRow = DataConnection & { blocks: DataConnectionBlock[] };

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

export function connectionStatus(
  row: Pick<DataConnection, 'revokedAt' | 'expiresAt' | 'scramStoredKey'>,
  now = new Date(),
): ConnectionStatus {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt <= now) return 'expired';
  if (!row.scramStoredKey) return 'pending';
  return 'active';
}

function parseScope(items: readonly string[] | undefined) {
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

/**
 * SQL connections (docs/prd/DQ-data-query.md §5.7): the credentials BI tools
 * and drivers sign in with over the PostgreSQL protocol. Each belongs to one
 * person and reads only what that person may query right now, narrowed by its
 * scope and minus what owners blocked. Its person makes one (`data.connect`),
 * or a manager or an owner gives one; only its person ever sees the password,
 * and only a SCRAM verifier is kept. Every change is audited with the
 * connection, and its reads carry the connection too.
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
    private readonly catalog: QueryCatalogService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  // ── Who is asking ─────────────────────────────────────────────────────

  private me(): string {
    const person = this.cls.isActive()
      ? this.cls.get<ClsPerson | undefined>(CLS_PERSON)
      : undefined;
    if (!person?.actorRef) {
      throw new UnauthorizedException({
        statusCode: 401,
        error: 'Unauthorized',
        code: 'SIGN_IN_REQUIRED',
        message: 'SQL connections belong to people: sign in.',
      });
    }
    return person.actorRef;
  }

  private async allows(capability: Capability): Promise<boolean> {
    return (await this.policy.check(this.actors.current(), capability)).allow;
  }

  async canManage(): Promise<boolean> {
    return this.allows('data.connection.manage');
  }

  /**
   * Whether the caller may have a connection at all: `data.connect` on the
   * workspace, a Data reader grant on a source or table, or tables they own
   * (GOV R3: owners query their tables).
   */
  async canConnect(): Promise<boolean> {
    if (await this.allows('data.connect')) return true;
    const grants = this.policy.resourceGrants?.('data.connect');
    if (grants && (grants.sourceIds.length || grants.assetIds.length)) {
      return true;
    }
    const owned = await ownerDataScope(this.prisma, this.me());
    return owned.sourceIds.length > 0 || owned.assetIds.length > 0;
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  async listMine(): Promise<DataConnectionListDto> {
    const me = this.me();
    const [rows, canCreate, canManage] = await Promise.all([
      this.prisma.dataConnection.findMany({
        where: { personRef: me },
        include: { blocks: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.canConnect(),
      this.canManage(),
    ]);
    return { items: await this.views(rows), canCreate, canManage };
  }

  async listAll(): Promise<DataConnectionListDto> {
    if (!(await this.canManage())) this.refuse('data.connection.manage');
    const rows = await this.prisma.dataConnection.findMany({
      include: { blocks: true },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: await this.views(rows),
      canCreate: await this.canConnect(),
      canManage: true,
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
    const canManage = await this.canManage();
    if (!governed.allowed && !canManage) this.refuse('asset.govern');
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
      canCreate: await this.canConnect(),
      canManage,
      canGovern: governed.allowed,
    };
  }

  endpoint(): DataConnectionEndpointDto {
    const host = process.env.SQL_GATEWAY_PUBLIC_HOST?.trim() || null;
    const caFile = process.env.SQL_GATEWAY_TLS_CA_FILE?.trim();
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
      enabled: Boolean(host),
      host,
      port: Number(process.env.SQL_GATEWAY_PUBLIC_PORT) || 5432,
      database: slug,
      // The gateway's certificate names the public host, from a public CA or
      // from the CA shipped here: either way the client can check both.
      sslMode: 'verify-full',
      caCertificate,
    };
  }

  // ── Changes ───────────────────────────────────────────────────────────

  /** A connection of one's own; the password is in the answer, once. */
  async create(
    body: CreateDataConnectionDto,
  ): Promise<DataConnectionSecretDto> {
    const me = this.me();
    if (!(await this.canConnect())) {
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
    await this.assertScopeExists(scope);
    const password = this.newPassword();
    const row = await this.prisma.dataConnection.create({
      data: {
        name: body.name.trim(),
        personRef: me,
        username: await this.newUsername(me, body.name),
        ...this.verifierFields(password),
        scopeSourceIds: scope.sourceIds,
        scopeAssetIds: scope.assetIds,
        revealedAt: new Date(),
        expiresAt: this.expiry(body.expiresInDays),
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
   * A connection given to someone (DQ §5.7): by a manager, on anything; by an
   * owner or steward, on the tables and sources they govern. It waits until
   * its person reveals the password. It is a channel: the person still needs
   * the right to read what it names.
   */
  async issue(body: IssueDataConnectionDto): Promise<DataConnectionDto> {
    const me = this.me();
    const scope = parseScope(body.scope);
    await this.assertScopeExists(scope);
    const canManage = await this.canManage();
    if (!canManage) {
      if (!scope.sourceIds.length && !scope.assetIds.length) {
        throw new BadRequestException(
          'Name the tables or sources you govern that this connection is for.',
        );
      }
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
        expiresAt: this.expiry(body.expiresInDays),
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
      this.scopeResources(scope),
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
    const me = this.me();
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
    const password = this.newPassword();
    const updated = await this.prisma.dataConnection.update({
      where: { id },
      data: { ...this.verifierFields(password), revealedAt: new Date() },
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
    const me = this.me();
    const row = await this.find(id);
    const canManage = await this.canManage();
    if (row.personRef !== me && !canManage) {
      this.refuse('data.connection.manage');
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
    const me = this.me();
    const row = await this.find(id);
    const scopeType = body.type === 'asset' ? 'ASSET' : 'SOURCE';
    const governed = await this.governance.mayGovernScope({
      scopeType,
      scopeId: body.id,
    });
    if (!governed.allowed && !(await this.canManage())) {
      this.refuse('asset.govern');
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
    const me = this.me();
    const row = await this.find(id);
    const block = row.blocks.find((b) => b.id === blockId);
    if (!block) throw new NotFoundException('No such block.');
    const governed = await this.governance.mayGovernScope({
      scopeType: block.scopeType,
      scopeId: block.scopeId,
    });
    if (!governed.allowed && !(await this.canManage())) {
      this.refuse('asset.govern');
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

  // ── For the SQL gateway ───────────────────────────────────────────────

  /** What signing in needs: the verifier and whether it may sign in at all. */
  async forSignIn(username: string) {
    const row = await this.prisma.dataConnection.findUnique({
      where: { username: username.toLowerCase() },
      include: { blocks: true },
    });
    if (!row) return null;
    return { row, status: connectionStatus(row) };
  }

  /** Still good: not revoked, not expired, with its current blocks. */
  async current(id: string) {
    const row = await this.prisma.dataConnection.findUnique({
      where: { id },
      include: { blocks: true },
    });
    if (!row || connectionStatus(row) !== 'active') return null;
    return row;
  }

  static scopeOf(row: ConnectionRow): ConnectionScope {
    return {
      sourceIds: row.scopeSourceIds,
      assetIds: row.scopeAssetIds,
      blockedSourceIds: row.blocks
        .filter((b) => b.scopeType === 'SOURCE')
        .map((b) => b.scopeId),
      blockedAssetIds: row.blocks
        .filter((b) => b.scopeType === 'ASSET')
        .map((b) => b.scopeId),
    };
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
    if (!row || (previous && Date.now() - previous.getTime() < 3_600_000)) {
      return;
    }
    void this.audit.record({
      actor: {
        id: row.personRef,
        displayName: null,
        kind: 'person',
        via: 'sql-connection',
        ref: `${row.personRef}@sql:${row.id}`,
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

  /** A sign-in that failed, for the trail (never the password). */
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
        ref: row ? `${row.personRef}@sql:${row.id}` : undefined,
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

  // ── Helpers ───────────────────────────────────────────────────────────

  private refuse(capability: Capability): never {
    throw new ForbiddenException({
      statusCode: 403,
      error: 'Forbidden',
      code: 'CAPABILITY_REQUIRED',
      capability,
      message:
        capability === 'asset.govern'
          ? 'This needs asset.govern, or the owner or steward role on this table or its source.'
          : 'This needs the right to manage everyone’s SQL connections (data.connection.manage).',
    });
  }

  private async find(id: string): Promise<ConnectionRow> {
    const row = await this.prisma.dataConnection.findUnique({
      where: { id },
      include: { blocks: true },
    });
    if (!row) throw new NotFoundException('No such SQL connection.');
    return row;
  }

  private newPassword(): string {
    return randomBytes(24).toString('base64url');
  }

  private verifierFields(password: string) {
    const verifier = scramVerifier(password);
    return {
      scramSalt: verifier.salt,
      scramIterations: verifier.iterations,
      scramStoredKey: verifier.storedKey,
      scramServerKey: verifier.serverKey,
      secretPreview: password.slice(-4),
    };
  }

  private expiry(days?: number): Date {
    const span = Math.min(Math.max(days ?? DEFAULT_EXPIRY_DAYS, 1), 365);
    return new Date(Date.now() + span * 86_400_000);
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

  private async assertScopeExists(scope: {
    sourceIds: string[];
    assetIds: string[];
  }): Promise<void> {
    const [sources, assets] = await Promise.all([
      scope.sourceIds.length
        ? this.prisma.source.count({ where: { id: { in: scope.sourceIds } } })
        : 0,
      scope.assetIds.length
        ? this.prisma.asset.count({ where: { id: { in: scope.assetIds } } })
        : 0,
    ]);
    if (
      sources !== scope.sourceIds.length ||
      assets !== scope.assetIds.length
    ) {
      throw new BadRequestException(
        'A source or table in the scope does not exist.',
      );
    }
  }

  private scopeResources(scope: { sourceIds: string[]; assetIds: string[] }) {
    return [
      ...scope.sourceIds.map(sourceResource),
      ...scope.assetIds.map(assetResource),
    ];
  }

  private async scopeChange(scope: {
    sourceIds: string[];
    assetIds: string[];
  }): Promise<AuditChange[]> {
    if (!scope.sourceIds.length && !scope.assetIds.length) {
      return [
        { field: 'scope', from: null, to: 'everything its person may query' },
      ];
    }
    const names = await this.scopeNames(scope);
    return [
      {
        field: 'scope',
        from: null,
        to: [...names.values()].map((item) => item.name).join(', '),
      },
    ];
  }

  private async scopeNames(scope: {
    sourceIds: string[];
    assetIds: string[];
  }): Promise<Map<string, DataConnectionScopeItemDto>> {
    const [sources, assets, tables] = await Promise.all([
      scope.sourceIds.length
        ? this.prisma.source.findMany({
            where: { id: { in: scope.sourceIds } },
            select: { id: true, name: true },
          })
        : [],
      scope.assetIds.length
        ? this.prisma.asset.findMany({
            where: { id: { in: scope.assetIds } },
            select: { id: true, name: true },
          })
        : [],
      scope.assetIds.length
        ? this.catalog.tables().then((cached) => cached.tables)
        : Promise.resolve([] as { assetId: string; sqlName: string }[]),
    ]);
    const sqlNames = new Map<string, string>(
      tables.map((t) => [t.assetId, t.sqlName]),
    );
    const out = new Map<string, DataConnectionScopeItemDto>();
    for (const source of sources) {
      out.set(`source:${source.id}`, {
        type: 'source',
        id: source.id,
        name: source.name,
      });
    }
    for (const asset of assets) {
      out.set(`asset:${asset.id}`, {
        type: 'asset',
        id: asset.id,
        name: asset.name,
        ...(sqlNames.get(asset.id) ? { sqlName: sqlNames.get(asset.id) } : {}),
      });
    }
    return out;
  }

  private async views(rows: ConnectionRow[]): Promise<DataConnectionDto[]> {
    const me = this.cls.isActive()
      ? this.cls.get<ClsPerson | undefined>(CLS_PERSON)?.actorRef
      : undefined;
    const canManage = await this.canManage();
    const names = await this.scopeNames({
      sourceIds: [
        ...new Set(
          rows.flatMap((row) => [
            ...row.scopeSourceIds,
            ...row.blocks
              .filter((b) => b.scopeType === 'SOURCE')
              .map((b) => b.scopeId),
          ]),
        ),
      ],
      assetIds: [
        ...new Set(
          rows.flatMap((row) => [
            ...row.scopeAssetIds,
            ...row.blocks
              .filter((b) => b.scopeType === 'ASSET')
              .map((b) => b.scopeId),
          ]),
        ),
      ],
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
