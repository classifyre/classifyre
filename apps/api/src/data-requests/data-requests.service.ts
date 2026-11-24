import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import {
  CaseActivityType,
  CaseKind,
  CaseThreadEntryType,
  CaseThreadKind,
  DataRequestDeliveryMode,
  DataRequestState,
  Prisma,
  Severity,
} from '@prisma/client';
import { createHash } from 'node:crypto';
import { ClsService } from 'nestjs-cls';
import {
  DataRequestSpecSchema,
  EMPTY_DATA_REQUEST_SPEC,
  generateRequestSql,
  type DataRequestPin,
  type DataRequestSpec,
  type RequestTableMeta,
} from '@workspace/schemas/data-request';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import { ActorDirectoryService } from '../identity/actor-directory.service';
import { AuditTrailService } from '../identity/audit-trail.service';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import { CLS_PERSON, type ClsPerson } from '../identity/iam-access-policy';
import type { Capability } from '../identity/capabilities';
import { IDENTITY } from '../identity/identity.tokens';
import type { IdentityService } from '../identity/identity.service';
import {
  DATA_RESOURCE,
  GOVERNANCE_RESOURCE,
  datasetResource,
} from '../identity/audit-resources';
import { governedDataScope } from '../governance/governance-filter';
import {
  QueryCatalogService,
  type CatalogTable,
} from '../data-query/query-catalog.service';
import { SharedDatasetResolver } from '../data-query/shared-dataset-resolver';
import {
  extractThreePartNames,
  precheckSql,
  stripLiteralsAndComments,
} from '../data-query/sql-precheck';
import { SharedDatasetsService } from '../shared-datasets/shared-datasets.service';
import { CaseActivityService } from '../case-activity.service';
import { CaseThreadsService } from '../case-threads.service';
import {
  CASE_BOARD_EVENTS,
  type CaseBoardEvents,
} from '../case-board/case-board.events';
import {
  allowedActionsFor,
  canEditSpec,
  canEditSql,
  caseStatusFor,
  transitionForRoles,
  type DataRequestAction,
  type DataRequestRole,
} from './data-request-rules';
import { DataRequestNotifier } from './data-request.notifier';
import type {
  AddDataRequestCommentDto,
  ClaimDataRequestDto,
  CreateDataRequestDto,
  DataRequestCheckResultDto,
  DataRequestCheckTableDto,
  DataRequestCommentThreadDto,
  DataRequestDeliveryDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  DataRequestListItemDto,
  DataRequestListResponseDto,
  DataRequestLiveDatasetDto,
  DataRequestOptionsDto,
  DeclineDataRequestDto,
  DeliverDataRequestDto,
  LiveDatasetStatus,
  RequestChangesDto,
  RerouteDataRequestDto,
  UpdateDataRequestSpecDto,
  UpdateDataRequestSqlDto,
} from './dto/data-request.dto';

const TITLE_MAX = 200;
const DESCRIPTION_MAX = 4000;
const REASON_MAX = 2000;
const NOTE_MAX = 2000;
const SQL_MAX = 100_000;

const ALLOWED_PRIORITIES = new Set<Severity>([
  Severity.CRITICAL,
  Severity.HIGH,
  Severity.MEDIUM,
  Severity.LOW,
]);

function sqlHashOf(sql: string, routeGroupId: string): string {
  return createHash('sha256')
    .update(`${routeGroupId}\n${sql}`)
    .digest('hex')
    .slice(0, 32);
}

function parseSpecSafe(raw: unknown): DataRequestSpec {
  const parsed = DataRequestSpecSchema.safeParse(raw);
  return parsed.success ? parsed.data : EMPTY_DATA_REQUEST_SPEC;
}

@Injectable()
export class DataRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly actors: ActorContextService,
    private readonly directory: ActorDirectoryService,
    private readonly audit: AuditTrailService,
    private readonly catalog: QueryCatalogService,
    private readonly resolver: SharedDatasetResolver,
    private readonly sharedDatasets: SharedDatasetsService,
    private readonly activity: CaseActivityService,
    private readonly threads: CaseThreadsService,
    private readonly notifier: DataRequestNotifier,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
    @Inject(IDENTITY) private readonly identity: IdentityService,
    @Optional()
    @Inject(CASE_BOARD_EVENTS)
    private readonly boardEvents?: CaseBoardEvents,
  ) {}

  // ── Identity & roles ─────────────────────────────────────────────────────

  private person(): ClsPerson {
    const person = this.cls.isActive()
      ? this.cls.get<ClsPerson | undefined>(CLS_PERSON)
      : undefined;
    if (!person || !person.actorRef.startsWith('user:')) {
      throw new ForbiddenException('Sign in to work with data requests.');
    }
    return person;
  }

  private workspaceId(): string {
    const id = this.actors.workspaceId();
    if (!id) throw new BadRequestException('No active workspace.');
    return id;
  }

  private async can(capability: Capability): Promise<boolean> {
    return (await this.policy.check(this.actors.current(), capability)).allow;
  }

  private async resolveNames(refs: string[]): Promise<Map<string, string>> {
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

  private async rolesFor(
    row: { requesterRef: string; routeGroupId: string },
    person: ClsPerson,
  ): Promise<{
    roles: DataRequestRole[];
    isRequester: boolean;
    isTeam: boolean;
    isManager: boolean;
  }> {
    const isRequester = row.requesterRef === person.actorRef;
    const isTeam = person.groupIds.includes(row.routeGroupId);
    const isManager = await this.can('case.manage');
    const roles: DataRequestRole[] = [];
    if (isRequester) roles.push('requester');
    if (isTeam) roles.push('team');
    if (isManager) roles.push('manager');
    return { roles, isRequester, isTeam, isManager };
  }

  private async canView(
    row: {
      requesterRef: string;
      routeGroupId: string;
      audienceGroupId: string;
      state: DataRequestState;
    },
    person: ClsPerson,
  ): Promise<boolean> {
    if (row.state === DataRequestState.DRAFT) {
      return row.requesterRef === person.actorRef;
    }
    if (row.requesterRef === person.actorRef) return true;
    if (person.groupIds.includes(row.routeGroupId)) return true;
    if (person.groupIds.includes(row.audienceGroupId)) return true;
    return this.can('case.view');
  }

  private async canSelfServe(person: ClsPerson): Promise<boolean> {
    if (await this.can('dataset.publish')) return true;
    const governed = await governedDataScope(this.prisma, person);
    return governed.assetIds.length > 0 || governed.sourceIds.length > 0;
  }

  private async tableLookup(): Promise<Map<string, RequestTableMeta>> {
    const { tables } = await this.catalog.tables();
    return new Map(
      tables.map((t) => [
        t.assetId,
        {
          sqlName: t.sqlName,
          exists: true,
          columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
        },
      ]),
    );
  }

  private emitChanged(
    caseId: string,
    version: number,
    summary: string,
    clientId?: string,
  ): void {
    this.boardEvents?.emitChanged(caseId, {
      caseId,
      version,
      actor: this.actors.current().ref ?? null,
      clientId: clientId ?? 'api',
      summary,
    });
  }

  private recordAudit(
    operation: string,
    caseId: string,
    title: string,
    fields: string[],
    resources: string[] = [DATA_RESOURCE, GOVERNANCE_RESOURCE],
  ): void {
    void this.audit.record({
      actor: this.actors.current(),
      channel: 'rest',
      capability: 'workspace.view',
      operation: `data-requests.${operation}`,
      entityType: 'case',
      entityId: caseId,
      entityName: title,
      resources,
      fields,
    });
  }

  // ── Options & List ───────────────────────────────────────────────────────

  async options(): Promise<DataRequestOptionsDto> {
    const person = this.person();
    const workspaceId = this.workspaceId();
    const [eligible, selfServe, groupNames] = await Promise.all([
      this.identity.groupsWithCapabilityIn(workspaceId, 'dataset.publish'),
      this.canSelfServe(person),
      this.resolveNames(person.groupIds.map((id) => `group:${id}`)),
    ]);

    const routeGroups = eligible.map((g) => ({
      id: g.id,
      name: g.path || g.name,
    }));
    const audienceGroups = person.groupIds
      .map((id) => ({
        id,
        name: groupNames.get(`group:${id}`) ?? id,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      routeGroups,
      audienceGroups,
      canSelfServe: selfServe,
    };
  }

  async list(
    scope: 'mine' | 'team' | 'all' = 'mine',
  ): Promise<DataRequestListResponseDto> {
    const person = this.person();
    let where: Prisma.DataRequestWhereInput;

    if (scope === 'mine') {
      where = { requesterRef: person.actorRef };
    } else if (scope === 'team') {
      where = {
        routeGroupId: { in: person.groupIds },
        state: { not: DataRequestState.DRAFT },
      };
    } else if (scope === 'all') {
      if (!(await this.can('case.view'))) {
        throw new ForbiddenException(
          'Listing all data requests requires the case.view capability.',
        );
      }
      where = {
        OR: [
          { state: { not: DataRequestState.DRAFT } },
          { requesterRef: person.actorRef },
        ],
      };
    } else {
      throw new BadRequestException('scope must be mine, team, or all.');
    }

    const rows = await this.prisma.dataRequest.findMany({
      where,
      include: {
        case: true,
        dataset: { select: { domain: true, name: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    const names = await this.resolveNames(
      rows.flatMap((row) => [
        row.requesterRef,
        `group:${row.routeGroupId}`,
        `group:${row.audienceGroupId}`,
        row.assigneeRef ?? '',
      ]),
    );

    const items: DataRequestListItemDto[] = rows.map((row) =>
      this.toListItem(row, names),
    );
    return { items, total: items.length };
  }

  // ── Create & Get ─────────────────────────────────────────────────────────

  async create(dto: CreateDataRequestDto): Promise<DataRequestDetailDto> {
    const person = this.person();
    const workspaceId = this.workspaceId();
    const title = typeof dto.title === 'string' ? dto.title.trim() : '';
    if (!title || title.length > TITLE_MAX) {
      throw new BadRequestException(
        `Title is required and must be at most ${TITLE_MAX} characters.`,
      );
    }
    const description =
      typeof dto.description === 'string' && dto.description.trim()
        ? dto.description.trim().slice(0, DESCRIPTION_MAX)
        : null;
    const priority =
      dto.priority && ALLOWED_PRIORITIES.has(dto.priority)
        ? dto.priority
        : Severity.MEDIUM;

    const routeGroupId =
      typeof dto.routeGroupId === 'string' ? dto.routeGroupId.trim() : '';
    const audienceGroupId =
      typeof dto.audienceGroupId === 'string' ? dto.audienceGroupId.trim() : '';
    if (!routeGroupId) {
      throw new BadRequestException('Choose a data-team group to route to.');
    }
    if (!audienceGroupId) {
      throw new BadRequestException('Choose a group to share the dataset with.');
    }

    const eligible = await this.identity.groupsWithCapabilityIn(
      workspaceId,
      'dataset.publish',
    );
    if (!eligible.some((g) => g.id === routeGroupId)) {
      throw new BadRequestException(
        'The chosen route group does not hold dataset.publish in this workspace.',
      );
    }
    const audiencePrincipal =
      await this.resolver.principalForGroup(audienceGroupId);
    if (!audiencePrincipal) {
      throw new BadRequestException(
        'The chosen audience group is not a group of this workspace’s tenant.',
      );
    }

    const specInput = dto.spec ?? EMPTY_DATA_REQUEST_SPEC;
    const parsedSpec = DataRequestSpecSchema.safeParse(specInput);
    if (!parsedSpec.success) {
      throw new BadRequestException(
        `Invalid data request spec: ${parsedSpec.error.issues[0]?.message ?? 'schema mismatch'}`,
      );
    }

    const lookup = await this.tableLookup();
    const generated = parsedSpec.data.tables.length
      ? generateRequestSql(parsedSpec.data, lookup)
      : { sql: '', diagnostics: [] };

    const createdCase = await this.prisma.$transaction(async (tx) => {
      const kase = await tx.case.create({
        data: {
          kind: CaseKind.DATA_REQUEST,
          title,
          description,
          status: caseStatusFor(DataRequestState.DRAFT),
          severity: priority,
          createdBy: person.actorRef,
        },
      });
      await tx.dataRequest.create({
        data: {
          caseId: kase.id,
          requesterRef: person.actorRef,
          routeGroupId,
          audienceGroupId,
          state: DataRequestState.DRAFT,
          spec: parsedSpec.data as unknown as Prisma.InputJsonValue,
          specVersion: 1,
          draftSql: generated.sql,
          sqlEdited: false,
        },
      });
      await this.activity.record(
        kase.id,
        CaseActivityType.CASE_CREATED,
        { title, kind: CaseKind.DATA_REQUEST, routeGroupId, audienceGroupId },
        person.actorRef,
        tx,
      );
      return kase;
    });

    this.recordAudit('create', createdCase.id, title, [
      'title',
      'priority',
      'routeGroupId',
      'audienceGroupId',
    ]);

    return this.get(createdCase.id);
  }

  async get(caseId: string): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    if (!(await this.canView(row, person))) {
      throw new ForbiddenException('You do not have access to this data request.');
    }
    return this.toDetailDto(row, person);
  }

  // ── Spec & SQL edits ─────────────────────────────────────────────────────

  async updateSpec(
    caseId: string,
    dto: UpdateDataRequestSpecDto,
  ): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    if (!canEditSpec(row.state, roles)) {
      throw new ForbiddenException(
        'You cannot edit the request specification in its current state.',
      );
    }
    const baseVersion = Number(dto.baseVersion);
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new BadRequestException('baseVersion must be a positive integer.');
    }
    if (row.specVersion !== baseVersion) {
      throw new ConflictException({
        statusCode: 409,
        code: 'VERSION_CONFLICT',
        currentVersion: row.specVersion,
        message: 'This data request was updated by someone else. Reloading.',
      });
    }

    const parsedSpec = DataRequestSpecSchema.safeParse(dto.spec);
    if (!parsedSpec.success) {
      throw new BadRequestException(
        `Invalid data request spec: ${parsedSpec.error.issues[0]?.message ?? 'schema mismatch'}`,
      );
    }

    let nextSql = row.draftSql;
    if (!row.sqlEdited) {
      const lookup = await this.tableLookup();
      nextSql = generateRequestSql(parsedSpec.data, lookup).sql;
    }

    const updated = await this.prisma.dataRequest.updateMany({
      where: { caseId, specVersion: baseVersion },
      data: {
        spec: parsedSpec.data as unknown as Prisma.InputJsonValue,
        specVersion: baseVersion + 1,
        draftSql: nextSql,
      },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        statusCode: 409,
        code: 'VERSION_CONFLICT',
        message: 'This data request was updated by someone else. Reloading.',
      });
    }

    await this.prisma.case.update({
      where: { id: caseId },
      data: { updatedAt: new Date() },
    });

    this.emitChanged(caseId, baseVersion + 1, 'spec updated', dto.clientId);
    this.recordAudit('update-spec', caseId, row.case.title, ['spec']);
    return this.get(caseId);
  }

  async updateSql(
    caseId: string,
    dto: UpdateDataRequestSqlDto,
  ): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    if (!canEditSql(row.state, roles)) {
      throw new ForbiddenException(
        'Only members of the routed data team can edit SQL directly.',
      );
    }
    const baseVersion = Number(dto.baseVersion);
    if (!Number.isInteger(baseVersion) || baseVersion < 1) {
      throw new BadRequestException('baseVersion must be a positive integer.');
    }
    if (row.specVersion !== baseVersion) {
      throw new ConflictException({
        statusCode: 409,
        code: 'VERSION_CONFLICT',
        currentVersion: row.specVersion,
        message: 'This data request was updated by someone else. Reloading.',
      });
    }

    let nextSql: string;
    let nextSqlEdited: boolean;
    if (dto.regenerate) {
      const spec = parseSpecSafe(row.spec);
      const lookup = await this.tableLookup();
      nextSql = generateRequestSql(spec, lookup).sql;
      nextSqlEdited = false;
    } else {
      const sql = typeof dto.sql === 'string' ? dto.sql.trim() : '';
      if (!sql) {
        throw new BadRequestException('SQL cannot be empty.');
      }
      if (sql.length > SQL_MAX) {
        throw new BadRequestException(
          `SQL must be at most ${SQL_MAX} characters.`,
        );
      }
      nextSql = sql;
      nextSqlEdited = true;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const count = await tx.dataRequest.updateMany({
        where: { caseId, specVersion: baseVersion },
        data: {
          draftSql: nextSql,
          sqlEdited: nextSqlEdited,
          specVersion: baseVersion + 1,
        },
      });
      if (count.count === 0) return false;
      await tx.case.update({
        where: { id: caseId },
        data: { updatedAt: new Date() },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.REQUEST_SQL_EDITED,
        { regenerated: Boolean(dto.regenerate) },
        person.actorRef,
        tx,
      );
      return true;
    });

    if (!updated) {
      throw new ConflictException({
        statusCode: 409,
        code: 'VERSION_CONFLICT',
        message: 'This data request was updated by someone else. Reloading.',
      });
    }

    this.emitChanged(
      caseId,
      baseVersion + 1,
      dto.regenerate ? 'SQL regenerated' : 'SQL edited',
      dto.clientId,
    );
    this.recordAudit('update-sql', caseId, row.case.title, [
      dto.regenerate ? 'regenerate' : 'sql',
    ]);
    return this.get(caseId);
  }

  // ── Static Check & Group Describe ────────────────────────────────────────

  async check(caseId: string): Promise<DataRequestCheckResultDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { isRequester, isTeam, isManager } = await this.rolesFor(row, person);
    if (!isRequester && !isTeam && !isManager) {
      throw new ForbiddenException(
        'Only the requester, the routed data team, or a case manager can check this request.',
      );
    }
    return this.runStaticCheck(row);
  }

  async describe(caseId: string): Promise<DataRequestDescribeResultDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { isRequester, isTeam, isManager } = await this.rolesFor(row, person);
    if (!isRequester && !isTeam && !isManager) {
      throw new ForbiddenException(
        'Only the requester, the routed data team, or a case manager can describe this request.',
      );
    }

    const check = await this.runStaticCheck(row);
    const sql = check.sql.trim();
    const hash = sqlHashOf(sql, row.routeGroupId);

    if (!sql) {
      return {
        cached: false,
        sqlHash: hash,
        describe: null,
        error: {
          code: 'empty_sql',
          message:
            check.problems[0] ?? 'Complete the request before running describe.',
        },
        check,
      };
    }

    if (row.lastCheck && row.lastCheckSqlHash === hash) {
      return {
        cached: true,
        sqlHash: hash,
        describe: row.lastCheck as Record<string, unknown>,
        error: null,
        check,
      };
    }

    try {
      const described = await this.sharedDatasets.describeForGroup(
        sql,
        row.routeGroupId,
      );
      await this.prisma.dataRequest.update({
        where: { caseId },
        data: {
          lastCheck: described as unknown as Prisma.InputJsonValue,
          lastCheckSqlHash: hash,
        },
      });
      return {
        cached: false,
        sqlHash: hash,
        describe: described as unknown as Record<string, unknown>,
        error: null,
        check,
      };
    } catch (error) {
      const resp =
        error &&
        typeof error === 'object' &&
        'getResponse' in error &&
        typeof (error as { getResponse: () => unknown }).getResponse ===
          'function'
          ? (error as { getResponse: () => unknown }).getResponse()
          : null;
      const obj =
        resp && typeof resp === 'object'
          ? (resp as Record<string, unknown>)
          : null;
      const code =
        typeof obj?.code === 'string' ? obj.code : 'describe_failed';
      const message =
        typeof obj?.message === 'string'
          ? obj.message
          : error instanceof Error
            ? error.message
            : 'Could not describe SQL as the routed group.';
      return {
        cached: false,
        sqlHash: hash,
        describe: null,
        error: { code, message },
        check,
      };
    }
  }

  private async runStaticCheck(row: {
    routeGroupId: string;
    spec: Prisma.JsonValue;
    draftSql: string;
    sqlEdited: boolean;
  }): Promise<DataRequestCheckResultDto> {
    const spec = parseSpecSafe(row.spec);
    const [tablesInfo, groupCatalog, names] = await Promise.all([
      this.catalog.tables(),
      this.resolver.catalogForGroup(row.routeGroupId),
      this.resolveNames([`group:${row.routeGroupId}`]),
    ]);
    const routeGroupName =
      names.get(`group:${row.routeGroupId}`) ?? row.routeGroupId;

    const lookup = new Map<string, RequestTableMeta>(
      tablesInfo.tables.map((t) => [
        t.assetId,
        {
          sqlName: t.sqlName,
          exists: true,
          columns: t.columns.map((c) => ({ name: c.name, type: c.type })),
        },
      ]),
    );
    const generated = generateRequestSql(spec, lookup);
    const sql = row.sqlEdited ? row.draftSql.trim() : generated.sql;

    const groupTablesBySql = new Map<string, CatalogTable>();
    const groupTablesByAsset = new Map<string, CatalogTable>();
    if (groupCatalog) {
      for (const src of groupCatalog.sources) {
        for (const t of src.tables) {
          groupTablesBySql.set(t.sqlName.toLowerCase(), t);
          groupTablesByAsset.set(t.assetId, t);
        }
      }
    }
    const allTablesBySql = new Map(
      tablesInfo.tables.map((t) => [t.sqlName.toLowerCase(), t]),
    );
    const allTablesByAsset = new Map(
      tablesInfo.tables.map((t) => [t.assetId, t]),
    );

    const allowedInGroup = new Set(
      [...groupTablesBySql.values()]
        .filter((t) => t.canQuery && t.location)
        .map((t) => t.sqlName.toLowerCase()),
    );
    const allSources = new Set(
      (groupCatalog?.sources ?? []).map((s) => s.sqlName.toLowerCase()),
    );
    for (const t of tablesInfo.tables) {
      const src = t.sqlName.split('.')[0];
      if (src) allSources.add(src.toLowerCase());
    }

    const precheckError = sql
      ? precheckSql(sql, allowedInGroup, allSources)
      : null;

    // Collect every referenced table from spec + SQL 3-part names
    const referencedSqlNames = new Set<string>();
    const specTableBySql = new Map<string, { assetId: string; sqlName: string }>();
    for (const t of spec.tables) {
      const resolved = allTablesByAsset.get(t.assetId)?.sqlName ?? t.sqlName;
      const key = resolved.toLowerCase();
      referencedSqlNames.add(key);
      specTableBySql.set(key, { assetId: t.assetId, sqlName: resolved });
    }
    if (sql) {
      for (const name of extractThreePartNames(
        stripLiteralsAndComments(sql).toLowerCase(),
      )) {
        referencedSqlNames.add(name);
      }
    }

    const problems: string[] = [];
    if (!groupCatalog) {
      problems.push(
        `Data team ${routeGroupName} is not active in this workspace.`,
      );
    }

    const checkTables: DataRequestCheckTableDto[] = [];
    for (const sqlName of referencedSqlNames) {
      const fromSpec = specTableBySql.get(sqlName);
      const catalogEntry =
        (fromSpec ? allTablesByAsset.get(fromSpec.assetId) : undefined) ??
        allTablesBySql.get(sqlName);
      const groupEntry =
        (catalogEntry
          ? groupTablesByAsset.get(catalogEntry.assetId)
          : undefined) ?? groupTablesBySql.get(sqlName);

      const exists = Boolean(catalogEntry);
      const groupCanQuery = Boolean(groupEntry?.canQuery);
      const maskedColumns = (groupEntry?.masks ?? [])
        .filter((m) => m.action === 'mask')
        .map((m) => m.column);
      const hiddenColumnCount = groupEntry?.hiddenColumns ?? 0;

      checkTables.push({
        assetId: catalogEntry?.assetId ?? fromSpec?.assetId ?? null,
        sqlName: catalogEntry?.sqlName ?? fromSpec?.sqlName ?? sqlName,
        sourceId: catalogEntry?.sourceId ?? null,
        exists,
        groupCanQuery,
        maskedColumns,
        hiddenColumnCount,
      });

      if (!exists) {
        problems.push(`Table ${sqlName} no longer exists in the catalog.`);
      } else if (!groupCanQuery) {
        problems.push(
          `Data team ${routeGroupName} cannot query ${catalogEntry?.sqlName ?? sqlName}.`,
        );
      }
    }

    if (!row.sqlEdited) {
      for (const d of generated.diagnostics) {
        if (d.level === 'error') problems.push(d.message);
      }
    }
    if (precheckError) {
      problems.push(precheckError.message);
    }

    const uniqueProblems = [...new Set(problems)];
    return {
      ok: uniqueProblems.length === 0 && Boolean(sql),
      sql,
      routeGroup: { id: row.routeGroupId, name: routeGroupName },
      precheckError: precheckError
        ? { code: precheckError.code, message: precheckError.message }
        : null,
      diagnostics: row.sqlEdited
        ? []
        : (generated.diagnostics as unknown as Array<Record<string, unknown>>),
      tables: checkTables,
      problems: uniqueProblems,
    };
  }

  // ── Transitions ──────────────────────────────────────────────────────────

  async submit(caseId: string): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    const nextState = this.assertTransition(row.state, 'submit', roles);

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          state: nextState,
          submittedAt: now,
          specVersion: { increment: 1 },
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { status: caseStatusFor(nextState), updatedAt: now },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.REQUEST_SUBMITTED,
        { routeGroupId: row.routeGroupId },
        person.actorRef,
        tx,
      );
    });

    const names = await this.resolveNames([person.actorRef]);
    await this.notifier.submitted({
      caseId,
      title: row.case.title,
      routeGroupId: row.routeGroupId,
      requesterName: names.get(person.actorRef) ?? person.actorRef,
      triggeredBy: person.actorRef,
    });

    this.emitChanged(caseId, row.specVersion + 1, 'request submitted');
    this.recordAudit('submit', caseId, row.case.title, ['state']);
    return this.get(caseId);
  }

  async withdraw(caseId: string): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    const nextState = this.assertTransition(row.state, 'withdraw', roles);
    const wasSubmitted = row.state !== DataRequestState.DRAFT;

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          state: nextState,
          closedAt: now,
          specVersion: { increment: 1 },
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { status: caseStatusFor(nextState), updatedAt: now },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.REQUEST_WITHDRAWN,
        { previousState: row.state },
        person.actorRef,
        tx,
      );
    });

    if (wasSubmitted) {
      const names = await this.resolveNames([person.actorRef]);
      await this.notifier.withdrawn({
        caseId,
        title: row.case.title,
        routeGroupId: row.routeGroupId,
        requesterName: names.get(person.actorRef) ?? person.actorRef,
        triggeredBy: person.actorRef,
      });
    }

    this.emitChanged(caseId, row.specVersion + 1, 'request withdrawn');
    this.recordAudit('withdraw', caseId, row.case.title, ['state']);
    return this.get(caseId);
  }

  async claim(
    caseId: string,
    dto: ClaimDataRequestDto,
  ): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    const nextState = this.assertTransition(row.state, 'claim', roles);

    const assigneeRef =
      typeof dto.assigneeRef === 'string' && dto.assigneeRef.trim()
        ? dto.assigneeRef.trim()
        : person.actorRef;

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          state: nextState,
          assigneeRef,
          specVersion: { increment: 1 },
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: {
          status: caseStatusFor(nextState),
          assignee: assigneeRef,
          updatedAt: now,
        },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.REQUEST_CLAIMED,
        { assigneeRef },
        person.actorRef,
        tx,
      );
    });

    const names = await this.resolveNames([assigneeRef, person.actorRef]);
    const assigneeName = names.get(assigneeRef) ?? assigneeRef;
    const recipients = new Set<string>();
    if (row.requesterRef !== person.actorRef) recipients.add(row.requesterRef);
    if (assigneeRef !== person.actorRef && assigneeRef.startsWith('user:')) {
      recipients.add(assigneeRef);
    }
    if (recipients.size > 0) {
      await this.notifier.assigned({
        caseId,
        title: row.case.title,
        to: { personRefs: [...recipients] },
        summary: `${assigneeName} claimed this data request and started working on it.`,
        metadata: { assigneeRef },
        triggeredBy: person.actorRef,
      });
    }

    this.emitChanged(caseId, row.specVersion + 1, 'request claimed');
    this.recordAudit('claim', caseId, row.case.title, ['assigneeRef']);
    return this.get(caseId);
  }

  async reroute(
    caseId: string,
    dto: RerouteDataRequestDto,
  ): Promise<DataRequestDetailDto> {
    const person = this.person();
    const workspaceId = this.workspaceId();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    this.assertTransition(row.state, 'reroute', roles);

    const groupId = typeof dto.groupId === 'string' ? dto.groupId.trim() : '';
    if (!groupId) {
      throw new BadRequestException('Choose a target data-team group.');
    }
    const eligible = await this.identity.groupsWithCapabilityIn(
      workspaceId,
      'dataset.publish',
    );
    const targetGroup = eligible.find((g) => g.id === groupId);
    if (!targetGroup) {
      throw new BadRequestException(
        'The target group does not hold dataset.publish in this workspace.',
      );
    }

    const previousGroupId = row.routeGroupId;
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          routeGroupId: groupId,
          assigneeRef: null,
          lastCheck: Prisma.JsonNull,
          lastCheckSqlHash: null,
          specVersion: { increment: 1 },
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { assignee: null, updatedAt: now },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.REQUEST_REROUTED,
        { fromGroupId: previousGroupId, toGroupId: groupId },
        person.actorRef,
        tx,
      );
    });

    await this.notifier.assigned({
      caseId,
      title: row.case.title,
      to: { groupIds: [groupId] },
      summary: `This data request was rerouted to ${targetGroup.path || targetGroup.name}.`,
      metadata: { fromGroupId: previousGroupId, toGroupId: groupId },
      triggeredBy: person.actorRef,
    });

    this.emitChanged(caseId, row.specVersion + 1, 'request rerouted');
    this.recordAudit('reroute', caseId, row.case.title, ['groupId']);
    return this.get(caseId);
  }

  async deliver(
    caseId: string,
    dto: DeliverDataRequestDto,
  ): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles, isTeam, isManager, isRequester } = await this.rolesFor(
      row,
      person,
    );

    const datasetAssetId =
      typeof dto.datasetAssetId === 'string' ? dto.datasetAssetId.trim() : '';
    if (!datasetAssetId) {
      throw new BadRequestException('datasetAssetId is required.');
    }

    const dataset = await this.prisma.sharedDataset.findUnique({
      where: { assetId: datasetAssetId },
      include: {
        asset: { select: { governance: { select: { status: true } } } },
        blocks: { where: { liftedAt: null }, select: { id: true } },
      },
    });
    if (!dataset) {
      throw new NotFoundException('Shared dataset not found.');
    }

    // Determine whether this delivery is team/manager or requester self-serve.
    const isSelfServe =
      !isTeam && !isManager && isRequester && dataset.createdBy === person.actorRef;

    const action: DataRequestAction =
      isTeam || isManager
        ? row.state === DataRequestState.DRAFT &&
          isRequester &&
          dataset.createdBy === person.actorRef
          ? 'deliver_self_serve'
          : 'deliver'
        : isSelfServe
          ? 'deliver_self_serve'
          : 'deliver';

    const nextState = this.assertTransition(row.state, action, roles);

    // Verify the audience group can query the delivered dataset.
    const [audienceCatalog, names] = await Promise.all([
      this.resolver.catalogForGroup(row.audienceGroupId),
      this.resolveNames([`group:${row.audienceGroupId}`]),
    ]);
    const audienceName =
      names.get(`group:${row.audienceGroupId}`) ?? row.audienceGroupId;
    const audienceTable = audienceCatalog?.sources
      .flatMap((s) => s.tables)
      .find((t) => t.assetId === dataset.assetId);
    if (!audienceTable?.canQuery) {
      throw new BadRequestException(
        `Share it with ${audienceName} first.`,
      );
    }

    const note =
      typeof dto.note === 'string' && dto.note.trim()
        ? dto.note.trim().slice(0, NOTE_MAX)
        : null;

    const prevDeliveries = await this.prisma.dataRequestDelivery.count({
      where: { caseId },
    });
    const round = prevDeliveries + 1;
    const mode: DataRequestDeliveryMode =
      dto.mode ??
      (action === 'deliver_self_serve'
        ? DataRequestDeliveryMode.SELF_SERVE
        : row.datasetAssetId === dataset.assetId
          ? DataRequestDeliveryMode.UPDATED
          : prevDeliveries === 0 && dataset.version === 1
            ? DataRequestDeliveryMode.PUBLISHED
            : DataRequestDeliveryMode.LINKED);

    const datasetSqlName = `shared.${dataset.domain}.${dataset.name}`;
    const now = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.dataRequestDelivery.create({
        data: {
          caseId,
          round,
          datasetAssetId: dataset.assetId,
          datasetVersion: dataset.version,
          sqlSnapshot: dataset.sql,
          specSnapshot: row.spec as Prisma.InputJsonValue,
          mode,
          deliveredBy: person.actorRef,
          note,
        },
      });
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          state: nextState,
          datasetAssetId: dataset.assetId,
          deliveredVersion: dataset.version,
          deliveredAt: now,
          closedAt: now,
          specVersion: { increment: 1 },
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: {
          status: caseStatusFor(nextState),
          updatedAt: now,
        },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.REQUEST_DELIVERED,
        {
          round,
          datasetAssetId: dataset.assetId,
          datasetName: datasetSqlName,
          datasetVersion: dataset.version,
          mode,
          note,
        },
        person.actorRef,
        tx,
      );
    });

    if (row.requesterRef !== person.actorRef) {
      await this.notifier.delivered({
        caseId,
        title: row.case.title,
        requesterRef: row.requesterRef,
        datasetName: datasetSqlName,
        version: dataset.version,
        triggeredBy: person.actorRef,
      });
    }

    this.emitChanged(caseId, row.specVersion + 1, 'dataset delivered');
    this.recordAudit(
      'deliver',
      caseId,
      row.case.title,
      ['datasetAssetId', 'mode'],
      [DATA_RESOURCE, GOVERNANCE_RESOURCE, datasetResource(dataset.assetId)],
    );
    return this.get(caseId);
  }

  async requestChanges(
    caseId: string,
    dto: RequestChangesDto,
  ): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    const nextState = this.assertTransition(row.state, 'request_changes', roles);

    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (!reason || reason.length > REASON_MAX) {
      throw new BadRequestException(
        `Please explain the changes needed (up to ${REASON_MAX} characters).`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await this.threads.create(
        caseId,
        {
          kind: CaseThreadKind.DISCUSSION,
          title: `Changes requested: ${reason}`.slice(0, 200),
          statement: reason,
          createdBy: person.actorRef,
        },
        tx,
      );
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          state: nextState,
          closedAt: null,
          specVersion: { increment: 1 },
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: {
          status: caseStatusFor(nextState),
          updatedAt: now,
        },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.REQUEST_CHANGES_REQUESTED,
        { reason },
        person.actorRef,
        tx,
      );
    });

    const names = await this.resolveNames([person.actorRef]);
    await this.notifier.changesRequested({
      caseId,
      title: row.case.title,
      routeGroupId: row.routeGroupId,
      requesterName: names.get(person.actorRef) ?? person.actorRef,
      reason,
      triggeredBy: person.actorRef,
    });

    this.emitChanged(caseId, row.specVersion + 1, 'changes requested');
    this.recordAudit('request-changes', caseId, row.case.title, ['reason']);
    return this.get(caseId);
  }

  async decline(
    caseId: string,
    dto: DeclineDataRequestDto,
  ): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    const nextState = this.assertTransition(row.state, 'decline', roles);

    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (!reason || reason.length > REASON_MAX) {
      throw new BadRequestException(
        `Please provide a reason for declining (up to ${REASON_MAX} characters).`,
      );
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          state: nextState,
          declineReason: reason,
          closedAt: now,
          specVersion: { increment: 1 },
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: {
          status: caseStatusFor(nextState),
          updatedAt: now,
        },
      });
      await this.activity.record(
        caseId,
        CaseActivityType.REQUEST_DECLINED,
        { reason },
        person.actorRef,
        tx,
      );
    });

    await this.notifier.declined({
      caseId,
      title: row.case.title,
      requesterRef: row.requesterRef,
      reason,
      triggeredBy: person.actorRef,
    });

    this.emitChanged(caseId, row.specVersion + 1, 'request declined');
    this.recordAudit('decline', caseId, row.case.title, ['reason']);
    return this.get(caseId);
  }

  // ── Comments / Pins ──────────────────────────────────────────────────────

  async addComment(
    caseId: string,
    dto: AddDataRequestCommentDto,
  ): Promise<{
    thread: DataRequestCommentThreadDto;
    pin: DataRequestPin;
    specVersion: number;
  }> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { isRequester, isTeam, isManager } = await this.rolesFor(row, person);
    if (!isRequester && !isTeam && !isManager) {
      throw new ForbiddenException(
        'Only participants of this data request can add comments.',
      );
    }

    const body = typeof dto.body === 'string' ? dto.body.trim() : '';
    if (!body) {
      throw new BadRequestException('Comment text is required.');
    }

    const spec = parseSpecSafe(row.spec);
    const x = typeof dto.x === 'number' && Number.isFinite(dto.x) ? dto.x : 120;
    const y = typeof dto.y === 'number' && Number.isFinite(dto.y) ? dto.y : 120;
    const anchor =
      dto.anchor && typeof dto.anchor.tableId === 'string'
        ? {
            tableId: dto.anchor.tableId,
            ...(dto.anchor.column ? { column: dto.anchor.column } : {}),
          }
        : null;

    const result = await this.prisma.$transaction(async (tx) => {
      const thread = await this.threads.create(
        caseId,
        {
          kind: CaseThreadKind.DISCUSSION,
          title: body.slice(0, 200),
          statement: body,
          createdBy: person.actorRef,
        },
        tx,
      );
      const pin: DataRequestPin = {
        threadId: thread.id,
        anchor,
        x,
        y,
      };
      const nextSpec: DataRequestSpec = {
        ...spec,
        pins: [...spec.pins, pin],
      };
      const nextVersion = row.specVersion + 1;
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          spec: nextSpec as unknown as Prisma.InputJsonValue,
          specVersion: nextVersion,
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: { updatedAt: new Date() },
      });
      return { thread, pin, specVersion: nextVersion };
    });

    this.emitChanged(caseId, result.specVersion, 'comment added');
    this.recordAudit('comment', caseId, row.case.title, ['body', 'anchor']);

    return {
      thread: {
        id: result.thread.id,
        title: result.thread.title,
        createdBy: result.thread.createdBy ?? null,
        resolvedAt: null,
        resolvedBy: null,
        entryCount: 1,
        createdAt: result.thread.createdAt,
        updatedAt: result.thread.updatedAt,
      },
      pin: result.pin,
      specVersion: result.specVersion,
    };
  }

  async getCommentEntries(caseId: string, threadId: string) {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    if (!(await this.canView(row, person))) {
      throw new ForbiddenException('You do not have access to this data request.');
    }
    const thread = await this.prisma.caseThread.findFirst({
      where: { id: threadId, caseId, kind: CaseThreadKind.DISCUSSION },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException('Comment thread not found.');
    return this.threads.getEntries(threadId, undefined, 100);
  }

  async replyComment(caseId: string, threadId: string, body: string) {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { isRequester, isTeam, isManager } = await this.rolesFor(row, person);
    if (!isRequester && !isTeam && !isManager) {
      throw new ForbiddenException(
        'Only participants of this data request can reply to comments.',
      );
    }
    const thread = await this.prisma.caseThread.findFirst({
      where: { id: threadId, caseId, kind: CaseThreadKind.DISCUSSION },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException('Comment thread not found.');
    const trimmed = typeof body === 'string' ? body.trim() : '';
    if (!trimmed) throw new BadRequestException('Reply text is required.');
    const entry = await this.threads.addEntry(threadId, {
      entryType: CaseThreadEntryType.NOTE,
      body: trimmed,
      author: person.actorRef,
    });
    this.emitChanged(caseId, row.specVersion, 'comment reply');
    return entry;
  }

  async resolveComment(caseId: string, threadId: string, resolved: boolean) {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { isRequester, isTeam, isManager } = await this.rolesFor(row, person);
    if (!isRequester && !isTeam && !isManager) {
      throw new ForbiddenException(
        'Only participants of this data request can resolve comments.',
      );
    }
    const thread = await this.prisma.caseThread.findFirst({
      where: { id: threadId, caseId, kind: CaseThreadKind.DISCUSSION },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException('Comment thread not found.');
    const updated = await this.threads.setResolved(
      threadId,
      Boolean(resolved),
      person.actorRef,
    );
    this.emitChanged(caseId, row.specVersion, 'comment resolved');
    return updated;
  }

  // ── Internal loaders & mappers ───────────────────────────────────────────

  private assertTransition(
    state: DataRequestState,
    action: DataRequestAction,
    roles: readonly DataRequestRole[],
  ): DataRequestState {
    const res = transitionForRoles(state, action, roles);
    if (!res.allowed || !res.nextState) {
      const roleCheck = transitionForRoles(state, action, [
        'requester',
        'team',
        'manager',
      ]);
      if (roleCheck.allowed) {
        throw new ForbiddenException(res.reason);
      }
      throw new BadRequestException(res.reason);
    }
    return res.nextState;
  }

  private async loadRequest(caseId: string) {
    const row = await this.prisma.dataRequest.findUnique({
      where: { caseId },
      include: {
        case: {
          include: {
            threads: {
              where: { kind: CaseThreadKind.DISCUSSION },
              include: { _count: { select: { entries: true } } },
              orderBy: { createdAt: 'asc' },
            },
          },
        },
        deliveries: { orderBy: { round: 'desc' } },
        dataset: {
          include: {
            blocks: { where: { liftedAt: null }, select: { id: true } },
            asset: {
              select: { governance: { select: { status: true } } },
            },
          },
        },
      },
    });
    if (!row || row.case.kind !== CaseKind.DATA_REQUEST) {
      throw new NotFoundException('Data request not found.');
    }
    return row;
  }

  private toListItem(
    row: {
      caseId: string;
      requesterRef: string;
      routeGroupId: string;
      audienceGroupId: string;
      assigneeRef: string | null;
      state: DataRequestState;
      datasetAssetId: string | null;
      deliveredVersion: number | null;
      declineReason: string | null;
      submittedAt: Date | null;
      deliveredAt: Date | null;
      closedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      case: {
        kind: CaseKind;
        title: string;
        description: string | null;
        status: import('@prisma/client').CaseStatus;
        severity: Severity;
      };
      dataset: { domain: string; name: string } | null;
    },
    names: Map<string, string>,
  ): DataRequestListItemDto {
    return {
      id: row.caseId,
      kind: row.case.kind,
      title: row.case.title,
      description: row.case.description,
      status: row.case.status,
      priority: row.case.severity,
      state: row.state,
      requester: {
        ref: row.requesterRef,
        name: names.get(row.requesterRef) ?? row.requesterRef,
      },
      routeGroup: {
        id: row.routeGroupId,
        name: names.get(`group:${row.routeGroupId}`) ?? row.routeGroupId,
      },
      audienceGroup: {
        id: row.audienceGroupId,
        name: names.get(`group:${row.audienceGroupId}`) ?? row.audienceGroupId,
      },
      assignee: row.assigneeRef
        ? {
            ref: row.assigneeRef,
            name: names.get(row.assigneeRef) ?? row.assigneeRef,
          }
        : null,
      datasetAssetId: row.datasetAssetId,
      datasetName: row.dataset
        ? `shared.${row.dataset.domain}.${row.dataset.name}`
        : null,
      deliveredVersion: row.deliveredVersion,
      declineReason: row.declineReason,
      submittedAt: row.submittedAt,
      deliveredAt: row.deliveredAt,
      closedAt: row.closedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  private computeLiveDataset(row: {
    datasetAssetId: string | null;
    deliveredVersion: number | null;
    dataset: {
      assetId: string;
      domain: string;
      name: string;
      version: number;
      unavailableAt: Date | null;
      unavailableWhy: string | null;
      blocks: { id: string }[];
      asset: { governance: { status: string } | null };
    } | null;
  }): DataRequestLiveDatasetDto | null {
    if (!row.datasetAssetId && row.deliveredVersion === null) {
      return null;
    }
    if (!row.dataset) {
      return {
        assetId: null,
        sqlName: null,
        domain: null,
        name: null,
        currentVersion: null,
        deliveredVersion: row.deliveredVersion,
        status: 'removed',
        reason: 'The delivered shared dataset was removed.',
      };
    }
    const lifecycle = row.dataset.asset.governance?.status ?? 'DRAFT';
    let status: LiveDatasetStatus = 'ok';
    let reason: string | null = null;
    if (lifecycle === 'RETIRED') {
      status = 'retired';
      reason = 'This shared dataset has been retired.';
    } else if (row.dataset.blocks.length > 0) {
      status = 'blocked';
      reason = 'An owner of an underlying table blocked this dataset.';
    } else if (row.dataset.unavailableAt) {
      status = 'unavailable';
      reason =
        row.dataset.unavailableWhy ??
        'The owning group lost access to one of the underlying tables.';
    }
    return {
      assetId: row.dataset.assetId,
      sqlName: `shared.${row.dataset.domain}.${row.dataset.name}`,
      domain: row.dataset.domain,
      name: row.dataset.name,
      currentVersion: row.dataset.version,
      deliveredVersion: row.deliveredVersion,
      status,
      reason,
    };
  }

  private async toDetailDto(
    row: Awaited<ReturnType<DataRequestsService['loadRequest']>>,
    person: ClsPerson,
  ): Promise<DataRequestDetailDto> {
    const [{ roles, isRequester, isTeam, isManager }, selfServe] =
      await Promise.all([
        this.rolesFor(row, person),
        this.canSelfServe(person),
      ]);

    const deliveryAssetIds = [
      ...new Set(row.deliveries.map((d) => d.datasetAssetId)),
    ];
    const [deliveryDatasets, names] = await Promise.all([
      deliveryAssetIds.length
        ? this.prisma.sharedDataset.findMany({
            where: { assetId: { in: deliveryAssetIds } },
            select: { assetId: true, domain: true, name: true },
          })
        : Promise.resolve([]),
      this.resolveNames([
        row.requesterRef,
        `group:${row.routeGroupId}`,
        `group:${row.audienceGroupId}`,
        row.assigneeRef ?? '',
        ...row.deliveries.map((d) => d.deliveredBy),
      ]),
    ]);

    const datasetNameById = new Map<string, string>(
      deliveryDatasets.map(
        (d): [string, string] => [d.assetId, `shared.${d.domain}.${d.name}`],
      ),
    );

    const base = this.toListItem(row, names);
    const deliveries: DataRequestDeliveryDto[] = row.deliveries.map((d) => ({
      id: d.id,
      round: d.round,
      datasetAssetId: d.datasetAssetId,
      datasetName: datasetNameById.get(d.datasetAssetId) ?? null,
      datasetVersion: d.datasetVersion,
      sqlSnapshot: d.sqlSnapshot,
      specSnapshot: (d.specSnapshot ?? EMPTY_DATA_REQUEST_SPEC) as Record<
        string,
        unknown
      >,
      mode: d.mode,
      deliveredBy: {
        ref: d.deliveredBy,
        name: names.get(d.deliveredBy) ?? d.deliveredBy,
      },
      note: d.note,
      createdAt: d.createdAt,
    }));

    const threads: DataRequestCommentThreadDto[] = row.case.threads.map(
      (t) => ({
        id: t.id,
        title: t.title,
        createdBy: t.createdBy,
        resolvedAt: t.resolvedAt,
        resolvedBy: t.resolvedBy,
        entryCount: t._count.entries,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
      }),
    );

    return {
      ...base,
      spec: parseSpecSafe(row.spec) as unknown as Record<string, unknown>,
      specVersion: row.specVersion,
      draftSql: row.draftSql,
      sqlEdited: row.sqlEdited,
      lastCheck: (row.lastCheck as Record<string, unknown> | null) ?? null,
      lastCheckSqlHash: row.lastCheckSqlHash,
      dataset: this.computeLiveDataset(row),
      deliveries,
      threads,
      permissions: {
        isRequester,
        isTeam,
        isManager,
        canEditSpec: canEditSpec(row.state, roles),
        canEditSql: canEditSql(row.state, roles),
        canPreview: isTeam || isManager,
        canSelfServe: selfServe,
        allowedActions: allowedActionsFor(row.state, roles),
      },
    };
  }
}
