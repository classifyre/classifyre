import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { AssetType, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import { ActorDirectoryService } from '../identity/actor-directory.service';
import {
  AuditTrailService,
  type AuditChange,
} from '../identity/audit-trail.service';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import { AccessManagementService } from '../identity/access-management.service';
import type { Principal } from '../identity/identity.service';
import { CLS_PERSON, type ClsPerson } from '../identity/iam-access-policy';
import type { Capability } from '../identity/capabilities';
import { resourceScopeId } from '../identity/tenancy.service';
import {
  DATA_RESOURCE,
  assetResource,
  governanceResources,
  sourceResource,
} from '../identity/audit-resources';
import { governedDataScope } from '../governance/governance-filter';
import {
  effectiveRoles,
  holdsRole,
  type Classification,
} from '../governance/governance-rules';
import { GovernanceNotifier } from '../governance/governance-notifier';
import {
  QueryCatalogService,
  type CatalogTable,
  type QueryCatalog,
} from '../data-query/query-catalog.service';
import { QueryRunService } from '../data-query/query-run.service';
import { SharedDatasetResolver } from '../data-query/shared-dataset-resolver';
import {
  SHARED_DATASET_SQL_NAME,
  sqlIdentifier,
} from '../data-query/sql-names';
import {
  columnFloors,
  datasetColumns,
  parseDatasetColumns,
  stricterClassification,
  type DatasetColumn,
  type DescribedLineage,
} from '../data-query/dataset-floor';

const NAME_MAX = 63;
const DESCRIPTION_MAX = 4000;
const SQL_MAX = 100_000;
/** Roles an audience can get on a dataset: the two Data reader roles. */
const AUDIENCE_ROLES = ['data-reader', 'data-reader-unmasked'] as const;

export interface DatasetColumnView {
  name: string;
  type: string;
  /** The strictest classification of the input columns it comes from. */
  floor: Classification | null;
  /** The input columns that set the floor (empty when untraced). */
  from: { assetId: string; table: string; column: string }[];
  /** Every input column it comes from. */
  upstreams: { assetId: string; table: string; column: string }[];
  traced: boolean;
  transform: string | null;
}

export interface DatasetInputView {
  assetId: string;
  sqlName: string;
  name: string;
  sourceId: string;
  sourceName: string;
  /** Owners, else stewards: who is told and who may block. */
  answeredBy: { ref: string; name: string }[];
  /** Whether the owning group may query it now (null when no group given). */
  groupCanQuery: boolean | null;
  /** Whether you own or steward it (or its source). */
  youGovern: boolean;
  /** Open blocks on the dataset from this input (or its source). */
  blocked: boolean;
}

export interface SharedDatasetSummary {
  assetId: string;
  sqlName: string;
  domain: string;
  name: string;
  description: string | null;
  owningGroup: { id: string; name: string };
  owner: { ref: string; name: string } | null;
  lifecycle: string;
  promoted: boolean;
  state: 'live' | 'blocked' | 'unavailable' | 'retired';
  stateReason: string | null;
  inputCount: number;
  canQuery: boolean;
  version: number;
  updatedAt: Date;
}

export interface SharedDatasetView extends SharedDatasetSummary {
  sql: string;
  kind: string;
  sourceId: string;
  promotedAt: Date | null;
  promotedBy: { ref: string; name: string } | null;
  inputs: DatasetInputView[];
  columns: DatasetColumnView[];
  createdBy: { ref: string; name: string } | null;
  createdAt: Date;
  /** May change the SQL, description and owning group. */
  canEdit: boolean;
  /** May mark it promoted. */
  canPromote: boolean;
}

export interface DescribeResult {
  columns: DatasetColumnView[];
  inputs: DatasetInputView[];
  /** Output columns lineage could not trace (they take the strictest input). */
  untraced: string[];
  /** Whether you may share it as it stands (and why not). */
  canShare: boolean;
  problems: string[];
}

export interface DatasetVersionView {
  version: number;
  sql: string;
  description: string | null;
  owningGroup: { id: string; name: string };
  inputs: string[];
  changedBy: { ref: string; name: string } | null;
  createdAt: Date;
}

export interface DatasetUseView {
  datasetId: string;
  sqlName: string;
  name: string;
  owner: { ref: string; name: string } | null;
  owningGroup: { id: string; name: string };
  /** The open block this input (or its source) put on it, if any. */
  block: {
    id: string;
    scopeType: string;
    reason: string | null;
    blockedBy: { ref: string; name: string } | null;
    blockedAt: Date;
  } | null;
  reads30d: number;
  canBlock: boolean;
}

interface ShareInput {
  name?: unknown;
  domain?: unknown;
  description?: unknown;
  sql?: unknown;
  owningGroupId?: unknown;
  audience?: unknown;
}

/**
 * Shared datasets (docs/prd/DQ-data-query.md §5.12): saved queries a
 * publisher shares with audience groups. Each is an asset of the workspace's
 * built-in source, so governance, grants, access requests, activity and
 * lineage work on it as on any table; this service keeps its definition and
 * decides who may share, change, promote and block it.
 */
@Injectable()
export class SharedDatasetsService implements OnModuleInit {
  private readonly logger = new Logger(SharedDatasetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly actors: ActorContextService,
    private readonly directory: ActorDirectoryService,
    private readonly audit: AuditTrailService,
    private readonly catalog: QueryCatalogService,
    private readonly runs: QueryRunService,
    private readonly resolver: SharedDatasetResolver,
    private readonly access: AccessManagementService,
    private readonly notifier: GovernanceNotifier,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  onModuleInit(): void {
    this.resolver.onUnavailable(async ({ assetId, reason }) => {
      const row = await this.prisma.sharedDataset.findUnique({
        where: { assetId },
        select: { domain: true, name: true },
      });
      if (!row) return;
      await this.notifier.datasetUnavailable({
        datasetId: assetId,
        datasetName: `shared.${row.domain}.${row.name}`,
        reason,
      });
    });
  }

  // ── Who ─────────────────────────────────────────────────────────────────

  private person(): ClsPerson {
    const person = this.cls.isActive()
      ? this.cls.get<ClsPerson | undefined>(CLS_PERSON)
      : undefined;
    if (!person) {
      throw new ForbiddenException('Sign in to share datasets.');
    }
    return person;
  }

  private workspaceId(): string {
    const id = this.actors.workspaceId();
    if (!id) throw new BadRequestException('No workspace.');
    return id;
  }

  private async can(capability: Capability): Promise<boolean> {
    return (await this.policy.check(this.actors.current(), capability)).allow;
  }

  private async names(refs: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(refs.filter(Boolean))];
    if (!unique.length) return new Map();
    try {
      const resolved = await this.directory.resolve(unique);
      return new Map(
        resolved.map((actor) => [actor.ref, actor.path ?? actor.displayName]),
      );
    } catch {
      return new Map();
    }
  }

  // ── The built-in source ─────────────────────────────────────────────────

  /**
   * The workspace's built-in source (made by the migration; made again here
   * if it is ever missing).
   */
  async systemSource(): Promise<{ id: string; sqlName: string }> {
    const found = await this.prisma.source.findFirst({
      where: { type: AssetType.SHARED_DATASET },
      select: { id: true, sqlName: true },
    });
    if (found) return { id: found.id, sqlName: found.sqlName ?? 'shared' };
    try {
      const created = await this.prisma.source.create({
        data: {
          name: 'Shared datasets',
          description:
            'Saved queries shared with groups of people. Built in: never scanned, never deleted.',
          type: AssetType.SHARED_DATASET,
          config: { type: 'SHARED_DATASET' },
          sqlName: SHARED_DATASET_SQL_NAME,
        },
        select: { id: true, sqlName: true },
      });
      this.catalog.invalidate();
      return { id: created.id, sqlName: created.sqlName ?? 'shared' };
    } catch {
      const again = await this.prisma.source.findFirstOrThrow({
        where: { type: AssetType.SHARED_DATASET },
        select: { id: true, sqlName: true },
      });
      return { id: again.id, sqlName: again.sqlName ?? 'shared' };
    }
  }

  // ── Reads ───────────────────────────────────────────────────────────────

  async list(): Promise<SharedDatasetSummary[]> {
    const [rows, catalog] = await Promise.all([
      this.prisma.sharedDataset.findMany({
        include: this.include(),
        orderBy: [{ domain: 'asc' }, { name: 'asc' }],
      }),
      this.catalog.catalog(),
    ]);
    const roles = await this.ownerRoles(rows.map((row) => row.assetId));
    const names = await this.names([
      ...rows.map((row) => `group:${row.owningGroupId}`),
      ...[...roles.values()].flat(),
    ]);
    return rows.map((row) => this.summary(row, catalog, roles, names));
  }

  async get(assetId: string): Promise<SharedDatasetView> {
    const row = await this.prisma.sharedDataset.findUnique({
      where: { assetId },
      include: this.include(),
    });
    if (!row) throw new NotFoundException('No shared dataset has this id.');
    const [catalog, tables, floors, roles] = await Promise.all([
      this.catalog.catalog(),
      this.catalog.tables(),
      this.catalog.datasetFloors(assetId),
      this.ownerRoles([assetId]),
    ]);
    const person = this.person();
    const inputs = await this.inputViews(row.inputs, {
      tables: tables.tables,
      sources: tables.sources,
      groupCatalog: null,
      blocks: row.blocks,
      person,
    });
    const names = await this.names([
      `group:${row.owningGroupId}`,
      ...(roles.get(assetId) ?? []),
      row.createdBy ?? '',
      row.promotedBy ?? '',
    ]);
    const sqlOf = new Map(tables.tables.map((t) => [t.assetId, t.sqlName]));
    const columns = parseDatasetColumns(row.columns).map((column) =>
      this.columnView(column, floors.get(column.name), sqlOf),
    );
    const governs = await this.governsDataset(assetId, person);
    const summary = this.summary(row, catalog, roles, names);
    return {
      ...summary,
      sql: row.sql,
      kind: row.kind,
      sourceId: row.asset.sourceId,
      promotedAt: row.promotedAt,
      promotedBy: row.promotedBy
        ? {
            ref: row.promotedBy,
            name: names.get(row.promotedBy) ?? row.promotedBy,
          }
        : null,
      inputs,
      columns,
      createdBy: row.createdBy
        ? {
            ref: row.createdBy,
            name: names.get(row.createdBy) ?? row.createdBy,
          }
        : null,
      createdAt: row.createdAt,
      canEdit: governs,
      canPromote: governs,
    };
  }

  async versions(assetId: string): Promise<DatasetVersionView[]> {
    await this.exists(assetId);
    const rows = await this.prisma.sharedDatasetVersion.findMany({
      where: { assetId },
      orderBy: { version: 'desc' },
    });
    const names = await this.names([
      ...rows.map((row) => `group:${row.owningGroupId}`),
      ...rows.map((row) => row.changedBy ?? ''),
    ]);
    return rows.map((row) => ({
      version: row.version,
      sql: row.sql,
      description: row.description,
      owningGroup: {
        id: row.owningGroupId,
        name: names.get(`group:${row.owningGroupId}`) ?? row.owningGroupId,
      },
      inputs: row.inputs,
      changedBy: row.changedBy
        ? {
            ref: row.changedBy,
            name: names.get(row.changedBy) ?? row.changedBy,
          }
        : null,
      createdAt: row.createdAt,
    }));
  }

  /**
   * What a query would be as a shared dataset: its columns with their
   * inherited floor, its inputs with who answers for them, and whether you
   * (and the owning group, when given) may share it.
   */
  async describe(input: {
    sql?: unknown;
    owningGroupId?: unknown;
  }): Promise<DescribeResult> {
    const sql = this.sql(input.sql);
    const person = this.person();
    const described = await this.runs.describe(sql);
    if ('error' in described) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: described.error.code,
        message: described.error.message,
      });
    }
    const tables = await this.catalog.tables();
    const { inputIds, problems } = this.inputsOf(
      described.description.tables,
      tables.tables,
    );
    const groupId =
      typeof input.owningGroupId === 'string' && input.owningGroupId
        ? input.owningGroupId
        : null;
    const groupCatalog = groupId
      ? await this.resolver.catalogForGroup(groupId)
      : null;
    if (groupId && !groupCatalog) {
      problems.push(
        'The owning group is not a group of this workspace’s tenant.',
      );
    }
    const inputs = await this.inputViews(inputIds, {
      tables: tables.tables,
      sources: tables.sources,
      groupCatalog: groupId ? (groupCatalog ?? emptyCatalog()) : null,
      blocks: [],
      person,
    });
    const columns = this.describedColumns(
      described.description.columns,
      described.description.lineage,
      tables.tables,
    );
    const floors = await this.floorsFor(columns, inputIds);
    const sqlOf = new Map(tables.tables.map((t) => [t.assetId, t.sqlName]));
    problems.push(...(await this.shareProblems(inputIds, inputs, groupId)));
    return {
      columns: columns.map((column) =>
        this.columnView(column, floors.get(column.name), sqlOf),
      ),
      inputs,
      untraced: columns.filter((c) => !c.traced).map((c) => c.name),
      canShare: problems.length === 0,
      problems,
    };
  }

  // ── Changes ─────────────────────────────────────────────────────────────

  async create(
    principal: Principal,
    input: ShareInput,
  ): Promise<SharedDatasetView> {
    const person = this.person();
    const name = this.identifier(input.name, 'name');
    const domain = this.identifier(input.domain, 'domain');
    const description = this.description(input.description);
    const sql = this.sql(input.sql);
    const owningGroupId = this.groupId(input.owningGroupId);
    const audience = this.audience(input.audience);
    if (
      await this.prisma.sharedDataset.findUnique({
        where: { domain_name: { domain, name } },
        select: { assetId: true },
      })
    ) {
      throw new ConflictException(
        `shared.${domain}.${name} exists already: pick another name.`,
      );
    }
    const prepared = await this.prepare(sql, owningGroupId, person);
    const source = await this.systemSource();
    const assetId = randomUUID();
    const actorRef = this.actors.current().ref ?? person.actorRef;
    await this.prisma.$transaction(async (tx) => {
      await tx.asset.create({
        data: {
          id: assetId,
          hash: assetId,
          checksum: checksum(sql),
          name,
          externalUrl: `classifyre://shared-datasets/${assetId}`,
          urn: `classifyre://shared/${domain}/${name}`,
          assetType: 'table',
          sourceType: AssetType.SHARED_DATASET,
          sourceId: source.id,
          status: 'NEW',
          metadata: this.assetMetadata(assetId, domain, name, prepared.columns),
        },
      });
      await tx.sharedDataset.create({
        data: {
          assetId,
          domain,
          name,
          description,
          sql,
          owningGroupId,
          inputs: prepared.inputIds,
          columns: prepared.columns as unknown as Prisma.InputJsonValue,
          lineage: prepared.lineage as unknown as Prisma.InputJsonValue,
          createdBy: actorRef,
          updatedBy: actorRef,
        },
      });
      await tx.sharedDatasetVersion.create({
        data: {
          assetId,
          version: 1,
          sql,
          owningGroupId,
          description,
          inputs: prepared.inputIds,
          changedBy: actorRef,
        },
      });
      // Born governed: the publisher answers for it (GOV owner, a person).
      await tx.governanceRole.create({
        data: {
          scopeType: 'ASSET',
          scopeId: assetId,
          role: 'OWNER',
          principalRef: person.actorRef,
          assignedBy: actorRef,
        },
      });
      if (description) {
        await tx.assetGovernance.create({
          data: { assetId, description, updatedBy: actorRef },
        });
      }
    });
    await this.writeLineage(assetId, source.id, sql, prepared);
    this.catalog.invalidate();

    const granted: string[] = [];
    for (const entry of audience) {
      try {
        await this.access.addGrant(
          principal,
          {
            subjectType: 'group',
            subjectId: entry.groupId,
            roleKey: entry.roleKey,
            scopeType: 'asset',
            scopeId: resourceScopeId(this.workspaceId(), assetId),
          },
          await this.ownerHoldings(),
        );
        granted.push(`${entry.groupId}:${entry.roleKey}`);
      } catch (error) {
        this.logger.warn(
          `Audience grant for ${entry.groupId} on ${assetId} not given: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const sqlName = `shared.${domain}.${name}`;
    this.record(
      'shared-datasets.create',
      assetId,
      sqlName,
      source.id,
      [
        { field: 'sql', to: sql },
        { field: 'owningGroup', to: owningGroupId },
        { field: 'inputs', to: prepared.inputNames.join(', ') },
        ...(granted.length
          ? [{ field: 'audience', to: granted.join(', ') }]
          : []),
      ],
      prepared.inputIds,
    );
    await this.tellInputOwners(
      prepared.inputIds,
      assetId,
      sqlName,
      audience.length
        ? await this.names(audience.map((a) => `group:${a.groupId}`))
        : new Map(),
    );
    return this.get(assetId);
  }

  async update(assetId: string, input: ShareInput): Promise<SharedDatasetView> {
    const row = await this.exists(assetId);
    const person = this.person();
    if (!(await this.governsDataset(assetId, person))) {
      throw new ForbiddenException(
        'Only its owner, a steward, or someone who governs assets here changes a shared dataset.',
      );
    }
    const sql = input.sql === undefined ? row.sql : this.sql(input.sql);
    const description =
      input.description === undefined
        ? row.description
        : this.description(input.description);
    const owningGroupId =
      input.owningGroupId === undefined
        ? row.owningGroupId
        : this.groupId(input.owningGroupId);
    const definitionChanged =
      sql !== row.sql || owningGroupId !== row.owningGroupId;
    const changes: AuditChange[] = [];
    if (sql !== row.sql) changes.push({ field: 'sql', from: row.sql, to: sql });
    if (owningGroupId !== row.owningGroupId) {
      changes.push({
        field: 'owningGroup',
        from: row.owningGroupId,
        to: owningGroupId,
      });
    }
    if (description !== row.description) {
      changes.push({
        field: 'description',
        from: row.description,
        to: description,
      });
    }
    if (!changes.length) return this.get(assetId);

    const prepared = definitionChanged
      ? await this.prepare(sql, owningGroupId, person)
      : null;
    const actorRef = this.actors.current().ref ?? person.actorRef;
    const version = row.version + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.sharedDataset.update({
        where: { assetId },
        data: {
          sql,
          description,
          owningGroupId,
          version,
          updatedBy: actorRef,
          ...(prepared
            ? {
                inputs: prepared.inputIds,
                columns: prepared.columns as unknown as Prisma.InputJsonValue,
                lineage: prepared.lineage as unknown as Prisma.InputJsonValue,
                unavailableAt: null,
                unavailableWhy: null,
              }
            : {}),
        },
      });
      await tx.sharedDatasetVersion.create({
        data: {
          assetId,
          version,
          sql,
          owningGroupId,
          description,
          inputs: prepared?.inputIds ?? row.inputs,
          changedBy: actorRef,
        },
      });
      if (prepared) {
        await tx.asset.update({
          where: { id: assetId },
          data: {
            checksum: checksum(sql),
            status: 'UPDATED',
            metadata: this.assetMetadata(
              assetId,
              row.domain,
              row.name,
              prepared.columns,
            ),
          },
        });
      }
    });
    const sqlName = `shared.${row.domain}.${row.name}`;
    if (prepared) {
      await this.writeLineage(assetId, row.asset.sourceId, sql, prepared);
      if (prepared.inputIds.some((id) => !row.inputs.includes(id))) {
        changes.push({
          field: 'inputs',
          from: row.inputs.length.toString(),
          to: prepared.inputNames.join(', '),
        });
      }
      this.catalog.invalidate();
      // A table it reads for the first time: its owners hear, as on share.
      const added = prepared.inputIds.filter((id) => !row.inputs.includes(id));
      if (added.length) {
        await this.tellInputOwners(added, assetId, sqlName, new Map());
      }
    }
    this.record(
      'shared-datasets.update',
      assetId,
      sqlName,
      row.asset.sourceId,
      [
        { field: 'version', from: String(row.version), to: String(version) },
        ...changes,
      ],
      prepared?.inputIds ?? row.inputs,
    );
    return this.get(assetId);
  }

  async promote(
    assetId: string,
    promoted: boolean,
  ): Promise<SharedDatasetView> {
    const row = await this.exists(assetId);
    const person = this.person();
    if (!(await this.governsDataset(assetId, person))) {
      throw new ForbiddenException(
        'Only its owner or a steward says a shared dataset is ready.',
      );
    }
    if (Boolean(row.promotedAt) === promoted) return this.get(assetId);
    const actorRef = this.actors.current().ref ?? person.actorRef;
    await this.prisma.sharedDataset.update({
      where: { assetId },
      data: promoted
        ? { promotedAt: new Date(), promotedBy: actorRef }
        : { promotedAt: null, promotedBy: null },
    });
    this.record(
      promoted ? 'shared-datasets.promote' : 'shared-datasets.unpromote',
      assetId,
      `shared.${row.domain}.${row.name}`,
      row.asset.sourceId,
      [{ field: 'promoted', from: String(!promoted), to: String(promoted) }],
      [],
    );
    return this.get(assetId);
  }

  /** Shared datasets reading a table (or any table of a source), for its owners. */
  async usesOf(
    scopeType: unknown,
    scopeId: unknown,
  ): Promise<DatasetUseView[]> {
    const target = await this.inputTarget(scopeType, scopeId);
    const assetIds =
      target.scopeType === 'asset'
        ? [target.id]
        : (
            await this.prisma.asset.findMany({
              where: { sourceId: target.id },
              select: { id: true },
            })
          ).map((a) => a.id);
    const rows = await this.prisma.sharedDataset.findMany({
      where: { inputs: { hasSome: assetIds } },
      include: {
        blocks: { where: { liftedAt: null } },
      },
      orderBy: [{ domain: 'asc' }, { name: 'asc' }],
    });
    if (!rows.length) return [];
    const roles = await this.ownerRoles(rows.map((r) => r.assetId));
    const canBlock = await this.mayBlock(target);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const reads = await this.prisma.auditEvent
      .findMany({
        where: {
          operation: { startsWith: 'query-runs.' },
          occurredAt: { gte: since },
          entityId: { in: assetIds },
          resources: { hasSome: rows.map((r) => `dataset:${r.assetId}`) },
        },
        select: { resources: true },
        take: 50_000,
      })
      .catch(() => []);
    const readsOf = new Map<string, number>();
    for (const read of reads) {
      for (const resource of read.resources) {
        if (resource.startsWith('dataset:')) {
          const id = resource.slice('dataset:'.length);
          readsOf.set(id, (readsOf.get(id) ?? 0) + 1);
        }
      }
    }
    const names = await this.names([
      ...rows.map((r) => `group:${r.owningGroupId}`),
      ...[...roles.values()].flat(),
      ...rows.flatMap((r) => r.blocks.map((b) => b.blockedBy ?? '')),
    ]);
    return rows.map((row) => {
      const ownerRef = roles.get(row.assetId)?.[0] ?? null;
      const block =
        row.blocks.find(
          (b) =>
            (b.scopeType === target.scopeType && b.scopeId === target.id) ||
            (target.scopeType === 'asset' &&
              b.scopeType === 'source' &&
              b.scopeId === target.sourceId),
        ) ?? null;
      return {
        datasetId: row.assetId,
        sqlName: `shared.${row.domain}.${row.name}`,
        name: row.name,
        owner: ownerRef
          ? { ref: ownerRef, name: names.get(ownerRef) ?? ownerRef }
          : null,
        owningGroup: {
          id: row.owningGroupId,
          name: names.get(`group:${row.owningGroupId}`) ?? row.owningGroupId,
        },
        block: block
          ? {
              id: block.id,
              scopeType: block.scopeType,
              reason: block.reason,
              blockedBy: block.blockedBy
                ? {
                    ref: block.blockedBy,
                    name: names.get(block.blockedBy) ?? block.blockedBy,
                  }
                : null,
              blockedAt: block.blockedAt,
            }
          : null,
        reads30d: readsOf.get(row.assetId) ?? 0,
        canBlock,
      };
    });
  }

  /** An input's owner or steward closes it to one dataset (§5.12). */
  async block(
    datasetId: string,
    input: { scopeType?: unknown; scopeId?: unknown; reason?: unknown },
  ): Promise<DatasetUseView[]> {
    const row = await this.exists(datasetId);
    const target = await this.inputTarget(input.scopeType, input.scopeId);
    const reads =
      target.scopeType === 'asset'
        ? row.inputs.includes(target.id)
        : (await this.prisma.asset.count({
            where: { id: { in: row.inputs }, sourceId: target.id },
          })) > 0;
    if (!reads) {
      throw new BadRequestException(
        `shared.${row.domain}.${row.name} does not read ${target.name}.`,
      );
    }
    if (!(await this.mayBlock(target))) {
      throw new ForbiddenException(
        'Only the owners and stewards of the table (or its source) block a shared dataset that reads it.',
      );
    }
    const reason =
      typeof input.reason === 'string' && input.reason.trim()
        ? input.reason.trim().slice(0, 2000)
        : null;
    const open = await this.prisma.sharedDatasetBlock.findFirst({
      where: {
        assetId: datasetId,
        scopeType: target.scopeType,
        scopeId: target.id,
        liftedAt: null,
      },
    });
    if (!open) {
      const actorRef = this.actors.current().ref ?? null;
      await this.prisma.sharedDatasetBlock.create({
        data: {
          assetId: datasetId,
          scopeType: target.scopeType,
          scopeId: target.id,
          reason,
          blockedBy: actorRef,
        },
      });
      this.record(
        'shared-datasets.block',
        datasetId,
        `shared.${row.domain}.${row.name}`,
        row.asset.sourceId,
        [
          { field: 'blockedBy', to: target.name },
          ...(reason ? [{ field: 'reason', to: reason }] : []),
        ],
        target.scopeType === 'asset' ? [target.id] : [],
        target.scopeType === 'source' ? target.id : target.sourceId,
      );
      await this.notifier.datasetBlocked({
        datasetId,
        datasetName: `shared.${row.domain}.${row.name}`,
        inputName: target.name,
        blocked: true,
        reason,
        actorRef,
      });
    }
    return this.usesOf(target.scopeType, target.id);
  }

  async unblock(datasetId: string, blockId: string): Promise<DatasetUseView[]> {
    const row = await this.exists(datasetId);
    const block = await this.prisma.sharedDatasetBlock.findFirst({
      where: { id: blockId, assetId: datasetId, liftedAt: null },
    });
    if (!block) throw new NotFoundException('No open block has this id.');
    const target = await this.inputTarget(block.scopeType, block.scopeId);
    if (!(await this.mayBlock(target))) {
      throw new ForbiddenException(
        'Only the owners and stewards of the table (or its source) lift its block.',
      );
    }
    const actorRef = this.actors.current().ref ?? null;
    await this.prisma.sharedDatasetBlock.update({
      where: { id: blockId },
      data: { liftedAt: new Date(), liftedBy: actorRef },
    });
    this.record(
      'shared-datasets.unblock',
      datasetId,
      `shared.${row.domain}.${row.name}`,
      row.asset.sourceId,
      [{ field: 'blockedBy', from: target.name, to: null }],
      target.scopeType === 'asset' ? [target.id] : [],
      target.scopeType === 'source' ? target.id : target.sourceId,
    );
    await this.notifier.datasetBlocked({
      datasetId,
      datasetName: `shared.${row.domain}.${row.name}`,
      inputName: target.name,
      blocked: false,
      reason: null,
      actorRef,
    });
    return this.usesOf(target.scopeType, target.id);
  }

  /** What the person may do here, for the SQL page's *Share as dataset*. */
  async options(): Promise<{
    canShare: boolean;
    viaRole: boolean;
    groups: { id: string; name: string }[];
    domains: string[];
  }> {
    const person = this.cls.isActive()
      ? this.cls.get<ClsPerson | undefined>(CLS_PERSON)
      : undefined;
    if (!person) {
      return { canShare: false, viaRole: false, groups: [], domains: [] };
    }
    const viaRole = await this.can('dataset.publish');
    const governed = viaRole
      ? null
      : await governedDataScope(this.prisma, person);
    const names = await this.names(person.groupIds.map((id) => `group:${id}`));
    const domains = await this.prisma.sharedDataset.findMany({
      distinct: ['domain'],
      select: { domain: true },
      orderBy: { domain: 'asc' },
    });
    return {
      canShare:
        viaRole ||
        Boolean(governed?.assetIds.length || governed?.sourceIds.length),
      viaRole,
      groups: person.groupIds
        .map((id) => ({ id, name: names.get(`group:${id}`) ?? id }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      domains: domains.map((d) => d.domain),
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private include() {
    return {
      blocks: { where: { liftedAt: null } },
      asset: {
        select: {
          sourceId: true,
          governance: { select: { status: true } },
        },
      },
    } satisfies Prisma.SharedDatasetInclude;
  }

  private async exists(assetId: string) {
    const row = await this.prisma.sharedDataset.findUnique({
      where: { assetId },
      include: this.include(),
    });
    if (!row) throw new NotFoundException('No shared dataset has this id.');
    return row;
  }

  private summary(
    row: Prisma.SharedDatasetGetPayload<{
      include: ReturnType<SharedDatasetsService['include']>;
    }>,
    catalog: QueryCatalog,
    roles: Map<string, string[]>,
    names: Map<string, string>,
  ): SharedDatasetSummary {
    const table = catalog.sources
      .flatMap((s) => s.tables)
      .find((t) => t.assetId === row.assetId);
    const ownerRef = roles.get(row.assetId)?.[0] ?? null;
    const lifecycle = row.asset.governance?.status ?? 'DRAFT';
    const state: SharedDatasetSummary['state'] =
      lifecycle === 'RETIRED'
        ? 'retired'
        : row.blocks.length
          ? 'blocked'
          : row.unavailableAt
            ? 'unavailable'
            : 'live';
    return {
      assetId: row.assetId,
      sqlName: table?.sqlName ?? `shared.${row.domain}.${row.name}`,
      domain: row.domain,
      name: row.name,
      description: row.description,
      owningGroup: {
        id: row.owningGroupId,
        name: names.get(`group:${row.owningGroupId}`) ?? row.owningGroupId,
      },
      owner: ownerRef
        ? { ref: ownerRef, name: names.get(ownerRef) ?? ownerRef }
        : null,
      lifecycle,
      promoted: Boolean(row.promotedAt),
      state,
      stateReason:
        state === 'blocked'
          ? 'An owner of a table it reads blocked it.'
          : state === 'unavailable'
            ? row.unavailableWhy
            : state === 'retired'
              ? 'Retired: no longer shared.'
              : null,
      inputCount: row.inputs.length,
      canQuery: Boolean(table?.canQuery),
      version: row.version,
      updatedAt: row.updatedAt,
    };
  }

  /** Open owners of each dataset (GOV: the asset's own, never the built-in source's). */
  private async ownerRoles(assetIds: string[]): Promise<Map<string, string[]>> {
    if (!assetIds.length) return new Map();
    const rows = await this.prisma.governanceRole.findMany({
      where: {
        scopeType: 'ASSET',
        scopeId: { in: assetIds },
        role: 'OWNER',
        dateOut: null,
      },
      select: { scopeId: true, principalRef: true },
    });
    const out = new Map<string, string[]>();
    for (const row of rows) {
      out.set(row.scopeId, [...(out.get(row.scopeId) ?? []), row.principalRef]);
    }
    return out;
  }

  private async governsDataset(
    assetId: string,
    person: ClsPerson,
  ): Promise<boolean> {
    if (await this.can('asset.govern')) return true;
    const rows = await this.prisma.governanceRole.findMany({
      where: { scopeType: 'ASSET', scopeId: assetId },
    });
    return holdsRole(rows, person, ['OWNER', 'STEWARD']);
  }

  /** What the owner of a new dataset holds on it, for the audience grants. */
  private async ownerHoldings(): Promise<Set<Capability>> {
    const capabilities = new Set(
      await this.policy.capabilities(this.actors.current()),
    );
    // Its owner queries it, and reads it in clear (GOV R3, DQ §5.8).
    capabilities.add('data.query');
    capabilities.add('data.connect');
    capabilities.add('data.unmask');
    return capabilities;
  }

  /**
   * Check a definition and work out what it reads: the describe run, the
   * inputs, the rights to share it, the owning group's access.
   */
  private async prepare(sql: string, owningGroupId: string, person: ClsPerson) {
    const described = await this.runs.describe(sql);
    if ('error' in described) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: described.error.code,
        message: described.error.message,
      });
    }
    const tables = await this.catalog.tables();
    const { inputIds, problems } = this.inputsOf(
      described.description.tables,
      tables.tables,
    );
    if (!inputIds.length) {
      problems.push('A shared dataset reads at least one table.');
    }
    if (!person.groupIds.includes(owningGroupId)) {
      problems.push('Pick an owning group you are in.');
    }
    const groupCatalog = await this.resolver.catalogForGroup(owningGroupId);
    const inputs = await this.inputViews(inputIds, {
      tables: tables.tables,
      sources: tables.sources,
      groupCatalog: groupCatalog ?? emptyCatalog(),
      blocks: [],
      person,
    });
    problems.push(
      ...(await this.shareProblems(inputIds, inputs, owningGroupId)),
    );
    if (problems.length) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'CANNOT_SHARE',
        message: problems.join(' '),
        problems,
      });
    }
    const columns = this.describedColumns(
      described.description.columns,
      described.description.lineage,
      tables.tables,
    );
    const sqlOf = new Map(tables.tables.map((t) => [t.assetId, t.sqlName]));
    return {
      inputIds,
      inputNames: inputIds.map((id) => sqlOf.get(id) ?? id),
      columns,
      lineage: described.description.lineage,
      sqlOf,
    };
  }

  /** Why the person (and the group) may not share this, if they may not. */
  private async shareProblems(
    inputIds: string[],
    inputs: DatasetInputView[],
    groupId: string | null,
  ): Promise<string[]> {
    const problems: string[] = [];
    if (
      !(await this.can('dataset.publish')) &&
      inputs.some((input) => !input.youGovern)
    ) {
      problems.push(
        'Sharing a dataset needs the Dataset publisher role, or owning or stewarding every table it reads.',
      );
    }
    const mine = await this.catalog.catalog();
    const queryable = new Set(
      mine.sources.flatMap((s) =>
        s.tables.filter((t) => t.canQuery).map((t) => t.assetId),
      ),
    );
    const notMine = inputIds.filter((id) => !queryable.has(id));
    if (notMine.length) {
      problems.push('You can only share tables you can query yourself.');
    }
    if (groupId) {
      const missing = inputs.filter((input) => input.groupCanQuery === false);
      if (missing.length) {
        problems.push(
          `The owning group cannot query ${missing.map((m) => m.sqlName).join(', ')}: give it access first.`,
        );
      }
    }
    return problems;
  }

  /** Input asset ids from the job's table names; datasets are refused (v1). */
  private inputsOf(
    sqlNames: string[],
    tables: Omit<CatalogTable, 'canQuery'>[],
  ): { inputIds: string[]; problems: string[] } {
    const problems: string[] = [];
    const inputIds: string[] = [];
    for (const name of sqlNames) {
      const table = tables.find((t) => t.sqlName === name.toLowerCase());
      if (!table) continue;
      if (table.location?.kind === 'dataset') {
        problems.push(
          `${table.sqlName} is a shared dataset: a dataset reads tables, not other datasets (yet).`,
        );
        continue;
      }
      inputIds.push(table.assetId);
    }
    return { inputIds: [...new Set(inputIds)], problems };
  }

  private describedColumns(
    columns: { name: string; type: string }[],
    lineage: DescribedLineage[],
    tables: Omit<CatalogTable, 'canQuery'>[],
  ): DatasetColumn[] {
    const bySql = new Map(tables.map((t) => [t.sqlName, t.assetId]));
    return datasetColumns(columns, lineage, (name) => bySql.get(name));
  }

  private async floorsFor(columns: DatasetColumn[], inputIds: string[]) {
    const classes = await this.catalog.classificationsOf(inputIds);
    let strictest: Classification | null = null;
    for (const map of classes.values()) {
      for (const value of map.values()) {
        strictest = stricterClassification(strictest, value);
      }
    }
    return columnFloors(
      columns,
      (assetId, column) =>
        classes.get(assetId)?.get(column) ??
        [...(classes.get(assetId) ?? [])].find(
          ([name]) => name.toLowerCase() === column.toLowerCase(),
        )?.[1] ??
        null,
      strictest,
    );
  }

  private columnView(
    column: DatasetColumn,
    floor:
      | {
          floor: Classification | null;
          from: { assetId: string; column: string }[];
        }
      | undefined,
    sqlOf: Map<string, string>,
  ): DatasetColumnView {
    const named = (u: { assetId: string; column: string }) => ({
      assetId: u.assetId,
      table: sqlOf.get(u.assetId) ?? u.assetId,
      column: u.column,
    });
    return {
      name: column.name,
      type: column.type,
      floor: floor?.floor ?? null,
      from: (floor?.from ?? []).map(named),
      upstreams: column.upstreams.map(named),
      traced: column.traced,
      transform: column.transform ?? null,
    };
  }

  private async inputViews(
    inputIds: string[],
    context: {
      tables: Omit<CatalogTable, 'canQuery'>[];
      sources: { id: string; name: string }[];
      groupCatalog: QueryCatalog | null;
      blocks: { scopeType: string; scopeId: string }[];
      person: ClsPerson;
    },
  ): Promise<DatasetInputView[]> {
    if (!inputIds.length) return [];
    const tables = inputIds
      .map((id) => context.tables.find((t) => t.assetId === id))
      .filter((t): t is Omit<CatalogTable, 'canQuery'> => Boolean(t));
    const sourceIds = [...new Set(tables.map((t) => t.sourceId))];
    const [own, bySource, governed] = await Promise.all([
      this.prisma.governanceRole.findMany({
        where: { scopeType: 'ASSET', scopeId: { in: inputIds }, dateOut: null },
      }),
      this.prisma.governanceRole.findMany({
        where: {
          scopeType: 'SOURCE',
          scopeId: { in: sourceIds },
          dateOut: null,
        },
      }),
      governedDataScope(this.prisma, context.person),
    ]);
    const answered = new Map<string, string[]>();
    for (const table of tables) {
      const roles = effectiveRoles(
        own.filter((r) => r.scopeId === table.assetId),
        bySource.filter((r) => r.scopeId === table.sourceId),
      );
      const owners = roles.filter((r) => r.role === 'OWNER');
      const pick = owners.length
        ? owners
        : roles.filter((r) => r.role === 'STEWARD');
      answered.set(
        table.assetId,
        pick.map((r) => r.principalRef),
      );
    }
    const names = await this.names([...answered.values()].flat());
    const groupTables = context.groupCatalog
      ? new Map(
          context.groupCatalog.sources
            .flatMap((s) => s.tables)
            .map((t) => [t.assetId, t]),
        )
      : null;
    const sourceName = new Map(context.sources.map((s) => [s.id, s.name]));
    return tables.map((table) => ({
      assetId: table.assetId,
      sqlName: table.sqlName,
      name: table.name,
      sourceId: table.sourceId,
      sourceName: sourceName.get(table.sourceId) ?? table.sourceId,
      answeredBy: (answered.get(table.assetId) ?? []).map((ref) => ({
        ref,
        name: names.get(ref) ?? ref,
      })),
      groupCanQuery: groupTables
        ? Boolean(groupTables.get(table.assetId)?.canQuery)
        : null,
      youGovern:
        governed.assetIds.includes(table.assetId) ||
        governed.sourceIds.includes(table.sourceId),
      blocked: context.blocks.some(
        (b) =>
          (b.scopeType === 'asset' && b.scopeId === table.assetId) ||
          (b.scopeType === 'source' && b.scopeId === table.sourceId),
      ),
    }));
  }

  private async inputTarget(
    scopeType: unknown,
    scopeId: unknown,
  ): Promise<{
    scopeType: 'asset' | 'source';
    id: string;
    sourceId: string;
    name: string;
  }> {
    if (scopeType !== 'asset' && scopeType !== 'source') {
      throw new BadRequestException('Name a table (asset) or a source.');
    }
    if (typeof scopeId !== 'string' || !scopeId) {
      throw new BadRequestException('Name the table or source.');
    }
    if (scopeType === 'asset') {
      const asset = await this.prisma.asset.findUnique({
        where: { id: scopeId },
        select: { id: true, name: true, sourceId: true },
      });
      if (!asset) throw new NotFoundException('No table has this id.');
      return {
        scopeType,
        id: asset.id,
        sourceId: asset.sourceId,
        name: asset.name,
      };
    }
    const source = await this.prisma.source.findUnique({
      where: { id: scopeId },
      select: { id: true, name: true },
    });
    if (!source) throw new NotFoundException('No source has this id.');
    return { scopeType, id: source.id, sourceId: source.id, name: source.name };
  }

  /** Owners and stewards of the input (or its source), or `asset.govern`. */
  private async mayBlock(target: {
    scopeType: 'asset' | 'source';
    id: string;
    sourceId: string;
  }): Promise<boolean> {
    if (await this.can('asset.govern')) return true;
    const person = this.cls.isActive()
      ? this.cls.get<ClsPerson | undefined>(CLS_PERSON)
      : undefined;
    if (!person) return false;
    const rows = await this.prisma.governanceRole.findMany({
      where: {
        OR: [
          ...(target.scopeType === 'asset'
            ? [{ scopeType: 'ASSET' as const, scopeId: target.id }]
            : []),
          { scopeType: 'SOURCE' as const, scopeId: target.sourceId },
        ],
      },
    });
    return holdsRole(rows, person, ['OWNER', 'STEWARD']);
  }

  private async tellInputOwners(
    inputIds: string[],
    datasetId: string,
    datasetName: string,
    audienceNames: Map<string, string>,
  ): Promise<void> {
    const actor = this.actors.current();
    const actorName =
      actor.displayName ??
      (await this.names([actor.id ?? ''])).get(actor.id ?? '') ??
      'Someone';
    const audience = audienceNames.size
      ? [...audienceNames.values()].join(', ')
      : 'the groups its owner gives access to';
    const tables = await this.catalog.tables();
    for (const inputId of inputIds) {
      const table = tables.tables.find((t) => t.assetId === inputId);
      await this.notifier.datasetShared({
        inputAssetId: inputId,
        inputName: table?.sqlName ?? inputId,
        datasetId,
        datasetName,
        audience,
        actorRef: actor.id ?? null,
        actorName,
      });
    }
  }

  /**
   * FLOW edges from each input to the dataset, with its column mappings,
   * asserted by the built-in source and replaced by the next version.
   */
  private async writeLineage(
    assetId: string,
    sourceId: string,
    sql: string,
    prepared: {
      inputIds: string[];
      lineage: DescribedLineage[];
      sqlOf: Map<string, string>;
    },
  ): Promise<void> {
    const assetOf = new Map(
      [...prepared.sqlOf].map(([id, name]) => [name, id]),
    );
    const fieldsOf = new Map<string, DescribedLineage['fields']>();
    for (const entry of prepared.lineage) {
      const id = assetOf.get(entry.table.toLowerCase());
      if (id) fieldsOf.set(id, entry.fields);
    }
    await this.prisma.$transaction([
      this.prisma.edge.deleteMany({
        where: {
          toType: 'asset',
          toId: assetId,
          assertedBySourceId: sourceId,
        },
      }),
      this.prisma.edge.createMany({
        data: prepared.inputIds.map((inputId) => {
          const fields = fieldsOf.get(inputId) ?? [];
          return {
            fromType: 'asset',
            fromId: inputId,
            toType: 'asset',
            toId: assetId,
            relationType: 'VIEW',
            relationClass: 'FLOW' as const,
            granularity: fields.length
              ? ('FIELD' as const)
              : ('DATASET' as const),
            method: 'SQL_PARSED' as const,
            origin: 'SOURCE_DERIVED' as const,
            confidence: 0.8,
            ...(fields.length ? { fieldMappings: fields } : {}),
            evidence: { sql },
            viaType: 'shared_dataset',
            viaId: assetId,
            assertedBySourceId: sourceId,
          };
        }),
        skipDuplicates: true,
      }),
    ]);
  }

  private assetMetadata(
    assetId: string,
    domain: string,
    name: string,
    columns: DatasetColumn[],
  ): Prisma.InputJsonValue {
    return {
      dataset_id: assetId,
      domain,
      table_name: name,
      table_type: 'SHARED_DATASET',
      columns: columns.map((c) => ({ name: c.name, type: c.type })),
    };
  }

  private record(
    operation: string,
    assetId: string,
    sqlName: string,
    sourceId: string,
    changes: AuditChange[],
    inputIds: string[],
    extraSourceId?: string,
  ): void {
    void this.audit.record({
      actor: this.actors.current(),
      channel: 'rest',
      capability: 'dataset.publish',
      operation,
      entityType: 'asset',
      entityId: assetId,
      entityName: sqlName,
      resources: [
        DATA_RESOURCE,
        ...governanceResources({ assetId, sourceId }),
        // The inputs' Activity shows that their data is shared, and how.
        ...inputIds.map((id) => assetResource(id)),
        ...(extraSourceId ? [sourceResource(extraSourceId)] : []),
      ],
      fields: changes.map((change) => change.field),
      changes,
    });
  }

  // ── Input checks ────────────────────────────────────────────────────────

  private identifier(value: unknown, what: 'name' | 'domain'): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`Give the dataset a ${what}.`);
    }
    const id = sqlIdentifier(
      value.trim(),
      what === 'name' ? 'dataset' : 'data',
    );
    if (id.length > NAME_MAX) {
      throw new BadRequestException(
        `A ${what} is at most ${NAME_MAX} characters.`,
      );
    }
    return id;
  }

  private description(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string') {
      throw new BadRequestException('The description is text.');
    }
    const text = value.trim();
    if (text.length > DESCRIPTION_MAX) {
      throw new BadRequestException(
        `A description is at most ${DESCRIPTION_MAX} characters.`,
      );
    }
    return text || null;
  }

  private sql(value: unknown): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException('Write the SELECT the dataset shares.');
    }
    const text = value.trim().replace(/;\s*$/, '');
    if (text.length > SQL_MAX) {
      throw new BadRequestException(
        'The SQL is longer than 100,000 characters.',
      );
    }
    return text;
  }

  private groupId(value: unknown): string {
    if (typeof value !== 'string' || !value) {
      throw new BadRequestException('Name the group that owns the dataset.');
    }
    return value;
  }

  private audience(
    value: unknown,
  ): { groupId: string; roleKey: (typeof AUDIENCE_ROLES)[number] }[] {
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException('The audience is a list of groups.');
    }
    return value.map((entry) => {
      const item = (entry ?? {}) as Record<string, unknown>;
      if (typeof item.groupId !== 'string' || !item.groupId) {
        throw new BadRequestException('Each audience entry names a group.');
      }
      const roleKey = item.roleKey ?? 'data-reader';
      if (
        !AUDIENCE_ROLES.includes(roleKey as (typeof AUDIENCE_ROLES)[number])
      ) {
        throw new BadRequestException(
          `An audience gets ${AUDIENCE_ROLES.join(' or ')}.`,
        );
      }
      return {
        groupId: item.groupId,
        roleKey: roleKey as (typeof AUDIENCE_ROLES)[number],
      };
    });
  }
}

function checksum(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

function emptyCatalog(): QueryCatalog {
  return {
    canQueryAll: false,
    limits: { maxRows: 0, timeoutSeconds: 0, exportMaxRows: 0 },
    sources: [],
  };
}
