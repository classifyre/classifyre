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
import { ClsService } from 'nestjs-cls';
import {
  DataRequestSpecSchema,
  EMPTY_DATA_REQUEST_SPEC,
  generateRequestSql,
  type DataRequestPin,
  type DataRequestSpec,
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
import { SharedDatasetResolver } from '../data-query/shared-dataset-resolver';
import { CaseActivityService } from '../case-activity.service';
import { CaseThreadsService } from '../case-threads.service';
import {
  CASE_BOARD_EVENTS,
  type CaseBoardEvents,
} from '../case-board/case-board.events';
import {
  canEditSpec,
  canEditSql,
  caseStatusFor,
  transitionForRoles,
  type DataRequestAction,
  type DataRequestRole,
} from './data-request-rules';
import { DataRequestNotifier } from './data-request.notifier';
import { DataRequestChecksService } from './data-request-checks.service';
import {
  mapDataRequestDetail,
  mapDataRequestListItem,
  parseSpecSafe,
  type DataRequestDetailRow,
} from './data-request.mapper';
import type {
  AddDataRequestCommentDto,
  AddDataRequestCommentResponseDto,
  ClaimDataRequestDto,
  CreateDataRequestDto,
  DataRequestCheckResultDto,
  DataRequestDescribeResultDto,
  DataRequestDetailDto,
  DataRequestListResponseDto,
  DataRequestOptionsDto,
  DeclineDataRequestDto,
  DeliverDataRequestDto,
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

@Injectable()
export class DataRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly actors: ActorContextService,
    private readonly directory: ActorDirectoryService,
    private readonly audit: AuditTrailService,
    private readonly resolver: SharedDatasetResolver,
    private readonly checks: DataRequestChecksService,
    private readonly activity: CaseActivityService,
    private readonly threads: CaseThreadsService,
    private readonly notifier: DataRequestNotifier,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
    @Inject(IDENTITY) private readonly identity: IdentityService,
    @Optional()
    @Inject(CASE_BOARD_EVENTS)
    private readonly boardEvents?: CaseBoardEvents,
  ) {}

  // ── Identity, visibility & helpers ───────────────────────────────────────

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

  /** Drafts are strictly requester-only across every read and mutation. */
  private assertDraftVisible(
    row: { state: DataRequestState; requesterRef: string },
    person: ClsPerson,
  ): void {
    if (
      row.state === DataRequestState.DRAFT &&
      row.requesterRef !== person.actorRef
    ) {
      throw new ForbiddenException(
        'Draft data requests are visible only to their requester.',
      );
    }
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

  private async assertParticipant(
    row: {
      state: DataRequestState;
      requesterRef: string;
      routeGroupId: string;
    },
    person: ClsPerson,
    message: string,
  ) {
    this.assertDraftVisible(row, person);
    const roleInfo = await this.rolesFor(row, person);
    if (!roleInfo.isRequester && !roleInfo.isTeam && !roleInfo.isManager) {
      throw new ForbiddenException(message);
    }
    return roleInfo;
  }

  private assertBaseVersion(
    row: { specVersion: number },
    rawBaseVersion: unknown,
  ): number {
    const baseVersion = Number(rawBaseVersion);
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
    return baseVersion;
  }

  private async canSelfServe(person: ClsPerson): Promise<boolean> {
    if (await this.can('dataset.publish')) return true;
    const governed = await governedDataScope(this.prisma, person);
    return governed.assetIds.length > 0 || governed.sourceIds.length > 0;
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

  private async runTransition(
    caseId: string,
    nextState: DataRequestState,
    dataRequestData: Prisma.DataRequestUncheckedUpdateInput,
    caseData: Prisma.CaseUncheckedUpdateInput,
    activityType: CaseActivityType,
    activityPayload: Record<string, unknown>,
    actorRef: string,
    extra?: (tx: Prisma.TransactionClient) => Promise<void>,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      if (extra) await extra(tx);
      await tx.dataRequest.update({
        where: { caseId },
        data: {
          state: nextState,
          specVersion: { increment: 1 },
          ...dataRequestData,
        },
      });
      await tx.case.update({
        where: { id: caseId },
        data: {
          status: caseStatusFor(nextState),
          updatedAt: now,
          ...caseData,
        },
      });
      await this.activity.record(
        caseId,
        activityType,
        activityPayload,
        actorRef,
        tx,
      );
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

    return {
      routeGroups: eligible.map((g) => ({
        id: g.id,
        name: g.path || g.name,
      })),
      audienceGroups: person.groupIds
        .map((id) => ({
          id,
          name: groupNames.get(`group:${id}`) ?? id,
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
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

    const items = rows.map((row) => mapDataRequestListItem(row, names));
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
      throw new BadRequestException(
        'Choose a group to share the dataset with.',
      );
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

    const lookup = await this.checks.tableLookup();
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
      throw new ForbiddenException(
        'You do not have access to this data request.',
      );
    }
    return this.buildDetailDto(row, person);
  }

  // ── Spec & SQL edits ─────────────────────────────────────────────────────

  async updateSpec(
    caseId: string,
    dto: UpdateDataRequestSpecDto,
  ): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    this.assertDraftVisible(row, person);
    const { roles } = await this.rolesFor(row, person);
    if (!canEditSpec(row.state, roles)) {
      throw new ForbiddenException(
        'You cannot edit the request specification in its current state.',
      );
    }
    const baseVersion = this.assertBaseVersion(row, dto.baseVersion);

    const parsedSpec = DataRequestSpecSchema.safeParse(dto.spec);
    if (!parsedSpec.success) {
      throw new BadRequestException(
        `Invalid data request spec: ${parsedSpec.error.issues[0]?.message ?? 'schema mismatch'}`,
      );
    }

    let nextSql = row.draftSql;
    if (!row.sqlEdited) {
      const lookup = await this.checks.tableLookup();
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
    this.assertDraftVisible(row, person);
    const { roles } = await this.rolesFor(row, person);
    if (!canEditSql(row.state, roles)) {
      throw new ForbiddenException(
        'Only members of the routed data team can edit SQL directly.',
      );
    }
    const baseVersion = this.assertBaseVersion(row, dto.baseVersion);

    let nextSql: string;
    let nextSqlEdited: boolean;
    if (dto.regenerate) {
      const spec = parseSpecSafe(row.spec);
      const lookup = await this.checks.tableLookup();
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
    await this.assertParticipant(
      row,
      person,
      'Only the requester, the routed data team, or a case manager can check this request.',
    );
    return this.checks.runStaticCheck(row);
  }

  async describe(caseId: string): Promise<DataRequestDescribeResultDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    await this.assertParticipant(
      row,
      person,
      'Only the requester, the routed data team, or a case manager can describe this request.',
    );
    return this.checks.describe(caseId, row);
  }

  // ── Transitions ──────────────────────────────────────────────────────────

  async submit(caseId: string): Promise<DataRequestDetailDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    const { roles } = await this.rolesFor(row, person);
    const nextState = this.assertTransition(row.state, 'submit', roles);

    await this.runTransition(
      caseId,
      nextState,
      { submittedAt: new Date() },
      {},
      CaseActivityType.REQUEST_SUBMITTED,
      { routeGroupId: row.routeGroupId },
      person.actorRef,
    );

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

    await this.runTransition(
      caseId,
      nextState,
      { closedAt: new Date() },
      {},
      CaseActivityType.REQUEST_WITHDRAWN,
      { previousState: row.state },
      person.actorRef,
    );

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

    await this.runTransition(
      caseId,
      nextState,
      { assigneeRef },
      { assignee: assigneeRef },
      CaseActivityType.REQUEST_CLAIMED,
      { assigneeRef },
      person.actorRef,
    );

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
    const nextState = this.assertTransition(row.state, 'reroute', roles);

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
    await this.runTransition(
      caseId,
      nextState,
      {
        routeGroupId: groupId,
        assigneeRef: null,
        lastCheck: Prisma.JsonNull,
        lastCheckSqlHash: null,
      },
      { assignee: null },
      CaseActivityType.REQUEST_REROUTED,
      { fromGroupId: previousGroupId, toGroupId: groupId },
      person.actorRef,
    );

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
    this.assertDraftVisible(row, person);
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

    const isSelfServe =
      !isTeam &&
      !isManager &&
      isRequester &&
      dataset.createdBy === person.actorRef;

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
      throw new BadRequestException(`Share it with ${audienceName} first.`);
    }

    const note =
      typeof dto.note === 'string' && dto.note.trim()
        ? dto.note.trim().slice(0, NOTE_MAX)
        : null;

    const prevDeliveries = await this.prisma.dataRequestDelivery.count({
      where: { caseId },
    });
    const round = prevDeliveries + 1;
    // Delivery mode is always derived server-side (PRD DR §4.4).
    const mode: DataRequestDeliveryMode =
      action === 'deliver_self_serve'
        ? DataRequestDeliveryMode.SELF_SERVE
        : row.datasetAssetId === dataset.assetId
          ? DataRequestDeliveryMode.UPDATED
          : prevDeliveries === 0 && dataset.version === 1
            ? DataRequestDeliveryMode.PUBLISHED
            : DataRequestDeliveryMode.LINKED;

    const datasetSqlName = `shared.${dataset.domain}.${dataset.name}`;
    const now = new Date();

    await this.runTransition(
      caseId,
      nextState,
      {
        datasetAssetId: dataset.assetId,
        deliveredVersion: dataset.version,
        deliveredAt: now,
        closedAt: now,
      },
      {},
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
      async (tx) => {
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
      },
    );

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
      ['datasetAssetId'],
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
    const nextState = this.assertTransition(
      row.state,
      'request_changes',
      roles,
    );

    const reason = typeof dto.reason === 'string' ? dto.reason.trim() : '';
    if (!reason || reason.length > REASON_MAX) {
      throw new BadRequestException(
        `Please explain the changes needed (up to ${REASON_MAX} characters).`,
      );
    }

    await this.runTransition(
      caseId,
      nextState,
      { closedAt: null },
      {},
      CaseActivityType.REQUEST_CHANGES_REQUESTED,
      { reason },
      person.actorRef,
      async (tx) => {
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
      },
    );

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

    await this.runTransition(
      caseId,
      nextState,
      { declineReason: reason, closedAt: new Date() },
      {},
      CaseActivityType.REQUEST_DECLINED,
      { reason },
      person.actorRef,
    );

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

  private async loadCommentThread(caseId: string, threadId: string) {
    const thread = await this.prisma.caseThread.findFirst({
      where: { id: threadId, caseId, kind: CaseThreadKind.DISCUSSION },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException('Comment thread not found.');
    return thread;
  }

  async addComment(
    caseId: string,
    dto: AddDataRequestCommentDto,
  ): Promise<AddDataRequestCommentResponseDto> {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    await this.assertParticipant(
      row,
      person,
      'Only participants of this data request can add comments.',
    );

    const body = typeof dto.body === 'string' ? dto.body.trim() : '';
    if (!body) {
      throw new BadRequestException('Comment text is required.');
    }

    const spec = parseSpecSafe(row.spec);
    const x =
      typeof dto.x === 'number' && Number.isFinite(dto.x) ? dto.x : 120;
    const y =
      typeof dto.y === 'number' && Number.isFinite(dto.y) ? dto.y : 120;
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
      throw new ForbiddenException(
        'You do not have access to this data request.',
      );
    }
    await this.loadCommentThread(caseId, threadId);
    return this.threads.getEntries(threadId, undefined, 100);
  }

  async replyComment(caseId: string, threadId: string, body: string) {
    const person = this.person();
    const row = await this.loadRequest(caseId);
    await this.assertParticipant(
      row,
      person,
      'Only participants of this data request can reply to comments.',
    );
    await this.loadCommentThread(caseId, threadId);
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
    await this.assertParticipant(
      row,
      person,
      'Only participants of this data request can resolve comments.',
    );
    await this.loadCommentThread(caseId, threadId);
    const updated = await this.threads.setResolved(
      threadId,
      Boolean(resolved),
      person.actorRef,
    );
    this.emitChanged(caseId, row.specVersion, 'comment resolved');
    return updated;
  }

  // ── Internal loaders ─────────────────────────────────────────────────────

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

  private async loadRequest(caseId: string): Promise<DataRequestDetailRow> {
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

  private async buildDetailDto(
    row: DataRequestDetailRow,
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

    return mapDataRequestDetail(row, {
      names,
      datasetNameById,
      roles,
      isRequester,
      isTeam,
      isManager,
      canSelfServe: selfServe,
    });
  }
}
