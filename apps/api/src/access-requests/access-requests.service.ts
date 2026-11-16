import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import type { DataAccessRequest } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import { AccessManagementService } from '../identity/access-management.service';
import { ActorContextService } from '../identity/actor-context.service';
import {
  ActorDirectoryService,
  type ResolvedActor,
} from '../identity/actor-directory.service';
import { AuditTrailService } from '../identity/audit-trail.service';
import {
  DATA_RESOURCE,
  assetResource,
  sourceResource,
} from '../identity/audit-resources';
import type { Capability } from '../identity/capabilities';
import { CLS_PERSON, type ClsPerson } from '../identity/iam-access-policy';
import type { Principal } from '../identity/identity.service';
import { roleCapabilities } from '../identity/grant-evaluation';
import { DATA_ROLE_KEYS } from '../identity/roles';
import { resourceScopeId } from '../identity/tenancy.service';
import { GovernanceNotifier } from '../governance/governance-notifier';
import { effectiveRoles, type RoleRow } from '../governance/governance-rules';
import { QueryCatalogService } from '../data-query/query-catalog.service';
import { readsInClear } from '../data-query/clear-scope';

export const REQUEST_STATUSES = [
  'PENDING',
  'APPROVED',
  'DENIED',
  'WITHDRAWN',
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const DEFAULT_REQUEST_DAYS = 90;
export const MAX_REQUEST_DAYS = 365;
const MIN_REASON = 10;
const MAX_REASON = 2000;
const MAX_LISTED = 200;

export type RequestScopeType = 'asset' | 'source';

export interface RequestTarget {
  scopeType: RequestScopeType;
  /** The table's or the source's id. */
  id: string;
  sourceId: string;
  name: string;
  /** For a table: what to type in SQL. */
  sqlName: string | null;
}

export interface AccessRequestView {
  id: string;
  scopeType: RequestScopeType;
  scopeId: string;
  sourceId: string;
  targetName: string;
  sqlName: string | null;
  requesterRef: string;
  requesterName: string;
  groupId: string;
  groupName: string;
  groupPath: string | null;
  roleKey: string;
  reason: string;
  durationDays: number;
  status: RequestStatus;
  createdAt: Date;
  decidedBy: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  grantExpiresAt: Date | null;
  canDecide: boolean;
  canWithdraw: boolean;
}

export interface AccessRequestOptions {
  target: RequestTarget;
  /** The caller already queries it (and, for the unmasked role, in clear). */
  canQuery: boolean;
  readsInClear: boolean;
  /** Groups of the caller's that a grant could go to. */
  groups: { id: string; name: string; path: string | null }[];
  /** Who decides: the owner, else the stewards, else the workspace's admins. */
  deciders: { ref: string; displayName: string; role: string }[];
  /** The caller's own request still waiting, if any. */
  pending: AccessRequestView | null;
  roles: string[];
  defaultDays: number;
  maxDays: number;
}

/**
 * Access requests (docs/prd/DQ-data-query.md §5.9): someone who cannot query
 * a table or source asks for it, saying why and for how long; its owner
 * decides (else its stewards, else whoever manages access in the
 * workspace), and approval gives a group of the requester's an expiring Data
 * reader grant on exactly that table or source. Grants go to groups, as
 * everywhere in IAM; the requester picks which of theirs.
 *
 * The decider gives the grant as themselves: never more than they hold on
 * that table (an owner queries and reads their table in clear, so they may
 * give either data role on it), and never on their own request.
 */
@Injectable()
export class AccessRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly actors: ActorContextService,
    private readonly directory: ActorDirectoryService,
    private readonly audit: AuditTrailService,
    private readonly catalog: QueryCatalogService,
    private readonly access: AccessManagementService,
    private readonly notifier: GovernanceNotifier,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
  ) {}

  // ── Who and what ─────────────────────────────────────────────────────────

  private person(): ClsPerson {
    const person = this.cls.isActive()
      ? this.cls.get<ClsPerson | undefined>(CLS_PERSON)
      : undefined;
    if (!person?.actorRef.startsWith('user:')) {
      throw new ForbiddenException('Sign in as a person to ask for access.');
    }
    return person;
  }

  private workspaceId(): string {
    const id = this.actors.workspaceId();
    if (!id) throw new BadRequestException('No workspace.');
    return id;
  }

  /** A table SQL can read, or a source with such tables. */
  async target(scopeType: unknown, scopeId: unknown): Promise<RequestTarget> {
    if (scopeType !== 'asset' && scopeType !== 'source') {
      throw new BadRequestException('Ask for a table (asset) or a source.');
    }
    if (typeof scopeId !== 'string' || !scopeId) {
      throw new BadRequestException('Name the table or source.');
    }
    const { tables, sources } = await this.catalog.tables();
    if (scopeType === 'asset') {
      const table = tables.find((t) => t.assetId === scopeId);
      if (!table) {
        throw new NotFoundException('No table SQL can read has this id.');
      }
      return {
        scopeType,
        id: table.assetId,
        sourceId: table.sourceId,
        name: table.name,
        sqlName: table.sqlName,
      };
    }
    const source = sources.find((s) => s.id === scopeId);
    if (!source || !tables.some((t) => t.sourceId === scopeId)) {
      throw new NotFoundException(
        'No source with tables SQL can read has this id.',
      );
    }
    return {
      scopeType,
      id: source.id,
      sourceId: source.id,
      name: source.name,
      sqlName: source.sqlName,
    };
  }

  /** Whether the caller already queries the target, and reads it in clear. */
  private async callerAccess(
    target: RequestTarget,
  ): Promise<{ canQuery: boolean; inClear: boolean }> {
    const [scope, clear] = await Promise.all([
      this.catalog.scope(),
      this.catalog.clearScope(),
    ]);
    const where = {
      sourceId: target.sourceId,
      assetId: target.scopeType === 'asset' ? target.id : null,
    };
    const canQuery =
      scope.all ||
      scope.sourceIds.has(target.sourceId) ||
      (target.scopeType === 'asset' && scope.assetIds.has(target.id));
    return { canQuery, inClear: readsInClear(clear, where) };
  }

  /**
   * Who answers a request: the owner (the table's own, else its source's);
   * with no owner, the stewards; with neither, nobody by name, and the
   * workspace's admins decide.
   */
  private async deciders(
    target: RequestTarget,
  ): Promise<{ ref: string; role: 'OWNER' | 'STEWARD' }[]> {
    const [own, source] = await Promise.all([
      target.scopeType === 'asset'
        ? this.prisma.governanceRole.findMany({
            where: { scopeType: 'ASSET', scopeId: target.id },
          })
        : Promise.resolve([]),
      this.prisma.governanceRole.findMany({
        where: { scopeType: 'SOURCE', scopeId: target.sourceId },
      }),
    ]);
    const roles = effectiveRoles(own as RoleRow[], source);
    const owners = roles.filter((role) => role.role === 'OWNER');
    if (owners.length) {
      return owners.map((role) => ({ ref: role.principalRef, role: 'OWNER' }));
    }
    return roles
      .filter((role) => role.role === 'STEWARD')
      .map((role) => ({ ref: role.principalRef, role: 'STEWARD' }));
  }

  private isNamed(person: ClsPerson, refs: readonly string[]): boolean {
    return refs.some(
      (ref) =>
        ref === person.actorRef ||
        person.groupIds.some((id) => ref === `group:${id}`),
    );
  }

  /** The caller may decide requests on the target. */
  private async mayDecide(
    target: RequestTarget,
    person: ClsPerson,
  ): Promise<boolean> {
    if (
      (await this.policy.check(this.actors.current(), 'access.manage')).allow
    ) {
      return true;
    }
    const deciders = await this.deciders(target);
    return this.isNamed(
      person,
      deciders.map((decider) => decider.ref),
    );
  }

  /**
   * What the decider holds on the target, for "no more than you have": their
   * workspace capabilities, plus what the table gives them — querying it
   * (a grant on it, or owning it) and reading it in clear (an unmasked grant,
   * owning or stewarding it).
   */
  private async holdingsOn(target: RequestTarget): Promise<Set<Capability>> {
    const capabilities = new Set(
      await this.policy.capabilities(this.actors.current()),
    );
    const { canQuery, inClear } = await this.callerAccess(target);
    if (canQuery) {
      capabilities.add('data.query');
      capabilities.add('data.connect');
    }
    if (inClear) capabilities.add('data.unmask');
    return capabilities;
  }

  // ── Reads ────────────────────────────────────────────────────────────────

  async options(
    scopeType: unknown,
    scopeId: unknown,
  ): Promise<AccessRequestOptions> {
    const person = this.person();
    const target = await this.target(scopeType, scopeId);
    const [{ canQuery, inClear }, deciders, groups, pending] =
      await Promise.all([
        this.callerAccess(target),
        this.deciders(target),
        this.resolve(person.groupIds.map((id) => `group:${id}`)),
        this.prisma.dataAccessRequest.findFirst({
          where: {
            requesterRef: person.actorRef,
            scopeType: target.scopeType === 'asset' ? 'ASSET' : 'SOURCE',
            scopeId: target.id,
            status: 'PENDING',
          },
        }),
      ]);
    const named = await this.resolve(deciders.map((decider) => decider.ref));
    return {
      target,
      canQuery,
      readsInClear: inClear,
      groups: groups
        .map((group) => ({
          id: group.ref.slice('group:'.length),
          name: group.displayName,
          path: group.path ?? null,
        }))
        .sort((a, b) => (a.path ?? a.name).localeCompare(b.path ?? b.name)),
      deciders: deciders.map((decider) => ({
        ref: decider.ref,
        role: decider.role,
        displayName:
          named.find((actor) => actor.ref === decider.ref)?.displayName ??
          decider.ref,
      })),
      pending: pending ? (await this.views([pending]))[0] : null,
      roles: [...DATA_ROLE_KEYS],
      defaultDays: DEFAULT_REQUEST_DAYS,
      maxDays: MAX_REQUEST_DAYS,
    };
  }

  /**
   * Requests the caller sees: `mine` (theirs), `decide` (waiting for them),
   * or every request on one table or source they may decide.
   */
  async list(query: {
    view?: unknown;
    status?: unknown;
    scopeType?: unknown;
    scopeId?: unknown;
  }): Promise<AccessRequestView[]> {
    const person = this.person();
    const status =
      typeof query.status === 'string' &&
      (REQUEST_STATUSES as readonly string[]).includes(query.status)
        ? query.status
        : undefined;
    if (query.view === 'mine') {
      const rows = await this.prisma.dataAccessRequest.findMany({
        where: {
          requesterRef: person.actorRef,
          ...(status ? { status } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: MAX_LISTED,
      });
      return this.views(rows);
    }
    let where = {};
    if (query.scopeType !== undefined || query.scopeId !== undefined) {
      const target = await this.target(query.scopeType, query.scopeId);
      if (!(await this.mayDecide(target, person))) return [];
      where =
        target.scopeType === 'asset'
          ? { scopeType: 'ASSET' as const, scopeId: target.id }
          : { sourceId: target.id };
    }
    const rows = await this.prisma.dataAccessRequest.findMany({
      where: {
        ...where,
        ...(status
          ? { status }
          : query.view === 'decide'
            ? { status: 'PENDING' }
            : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: MAX_LISTED,
    });
    // Only requests on what the caller decides: an owner sees their tables',
    // an admin every one.
    const mine = new Map<string, boolean>();
    const visible: DataAccessRequest[] = [];
    for (const row of rows) {
      const key = `${row.scopeType}:${row.scopeId}`;
      if (!mine.has(key)) {
        const target = await this.target(
          row.scopeType === 'ASSET' ? 'asset' : 'source',
          row.scopeId,
        ).catch(() => null);
        mine.set(key, target ? await this.mayDecide(target, person) : false);
      }
      if (mine.get(key)) visible.push(row);
    }
    return this.views(visible);
  }

  // ── Changes ──────────────────────────────────────────────────────────────

  async create(body: {
    scopeType?: unknown;
    scopeId?: unknown;
    groupId?: unknown;
    roleKey?: unknown;
    reason?: unknown;
    durationDays?: unknown;
  }): Promise<AccessRequestView> {
    const person = this.person();
    const target = await this.target(body.scopeType, body.scopeId);
    const roleKey = body.roleKey ?? 'data-reader';
    if (typeof roleKey !== 'string' || !DATA_ROLE_KEYS.includes(roleKey)) {
      throw new BadRequestException(`Ask for ${DATA_ROLE_KEYS.join(' or ')}.`);
    }
    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason.length < MIN_REASON || reason.length > MAX_REASON) {
      throw new BadRequestException(
        `Say why you need it, in ${MIN_REASON} to ${MAX_REASON} characters: the owner decides on it.`,
      );
    }
    const durationDays = this.days(body.durationDays, DEFAULT_REQUEST_DAYS);
    if (
      typeof body.groupId !== 'string' ||
      !person.groupIds.includes(body.groupId)
    ) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'GROUP_REQUIRED',
        message:
          'Access is given to groups: pick one you are in. With none, ask an admin to put you in a small group.',
      });
    }
    const { canQuery, inClear } = await this.callerAccess(target);
    if (canQuery && (roleKey === 'data-reader' || inClear)) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'ALREADY_HAS_ACCESS',
        message: 'You can already query this.',
      });
    }
    const scopeType = target.scopeType === 'asset' ? 'ASSET' : 'SOURCE';
    const waiting = await this.prisma.dataAccessRequest.findFirst({
      where: {
        requesterRef: person.actorRef,
        scopeType,
        scopeId: target.id,
        status: 'PENDING',
      },
    });
    if (waiting) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'REQUEST_PENDING',
        message: 'Your request for this is still waiting.',
      });
    }
    const row = await this.prisma.dataAccessRequest.create({
      data: {
        scopeType,
        scopeId: target.id,
        sourceId: target.sourceId,
        requesterRef: person.actorRef,
        groupId: body.groupId,
        roleKey,
        reason,
        durationDays,
      },
    });
    this.record(row, target, 'data-access-requests.create', 'data.query', [
      {
        field: 'request',
        from: null,
        to: `${roleKey} for ${durationDays} days`,
      },
    ]);
    const deciders = await this.deciders(target);
    const [view] = await this.views([row]);
    void this.notifier.accessRequested({
      to: deciders.map((decider) => decider.ref),
      requestId: row.id,
      targetName: target.name,
      targetPath: this.pathOf(target),
      sourceId: target.sourceId,
      requesterName: view.requesterName,
      requesterRef: person.actorRef,
      reason,
    });
    return view;
  }

  async approve(
    principal: Principal,
    id: string,
    body: { roleKey?: unknown; durationDays?: unknown; note?: unknown },
  ): Promise<AccessRequestView> {
    const { row, target, person } = await this.decidable(id);
    let roleKey = row.roleKey;
    if (body.roleKey !== undefined && body.roleKey !== row.roleKey) {
      // The decider may give less than asked (masked instead of unmasked),
      // never more.
      if (body.roleKey !== 'data-reader') {
        throw new BadRequestException(
          'Approve as asked, or give Data reader instead of the unmasked role.',
        );
      }
      roleKey = 'data-reader';
    }
    const durationDays = this.days(body.durationDays, row.durationDays);
    const holdings = await this.holdingsOn(target);
    const missing = roleCapabilities(roleKey).find(
      (capability) => !holdings.has(capability),
    );
    if (missing) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'GRANT_EXCEEDS_OWN_ACCESS',
        capability: missing,
        message:
          missing === 'data.unmask'
            ? 'You do not read this in clear yourself, so you can approve it only as Data reader.'
            : `You cannot give access you do not have here (${missing}).`,
      });
    }
    const expiresAt = new Date(Date.now() + durationDays * 86_400_000);
    const grant = await this.access.addGrant(
      principal,
      {
        subjectType: 'group',
        subjectId: row.groupId,
        roleKey,
        scopeType: target.scopeType,
        scopeId: resourceScopeId(this.workspaceId(), target.id),
        expiresAt: expiresAt.toISOString(),
      },
      holdings,
    );
    const note = this.note(body.note);
    const updated = await this.prisma.dataAccessRequest.update({
      where: { id: row.id },
      data: {
        status: 'APPROVED',
        roleKey,
        durationDays,
        decidedBy: person.actorRef,
        decidedAt: new Date(),
        decisionNote: note,
        grantId: grant.id,
        grantExpiresAt: expiresAt,
      },
    });
    this.record(
      updated,
      target,
      'data-access-requests.approve',
      'access.manage',
      [
        { field: 'status', from: 'PENDING', to: 'APPROVED' },
        {
          field: 'grant',
          from: null,
          to: `${roleKey} to ${grant.subjectLabel} until ${expiresAt.toISOString().slice(0, 10)}`,
        },
      ],
    );
    const [view] = await this.views([updated]);
    void this.notifier.accessDecided({
      requesterRef: row.requesterRef,
      approved: true,
      targetName: target.name,
      targetPath: this.pathOf(target),
      sourceId: target.sourceId,
      deciderRef: person.actorRef,
      note,
      expiresAt,
      groupName: view.groupName,
      requestId: row.id,
    });
    return view;
  }

  async deny(id: string, body: { note?: unknown }): Promise<AccessRequestView> {
    const { row, target, person } = await this.decidable(id);
    const note = this.note(body.note);
    const updated = await this.prisma.dataAccessRequest.update({
      where: { id: row.id },
      data: {
        status: 'DENIED',
        decidedBy: person.actorRef,
        decidedAt: new Date(),
        decisionNote: note,
      },
    });
    this.record(updated, target, 'data-access-requests.deny', 'access.manage', [
      { field: 'status', from: 'PENDING', to: 'DENIED' },
    ]);
    void this.notifier.accessDecided({
      requesterRef: row.requesterRef,
      approved: false,
      targetName: target.name,
      targetPath: this.pathOf(target),
      sourceId: target.sourceId,
      deciderRef: person.actorRef,
      note,
      requestId: row.id,
    });
    return (await this.views([updated]))[0];
  }

  async withdraw(id: string): Promise<AccessRequestView> {
    const person = this.person();
    const row = await this.prisma.dataAccessRequest.findUnique({
      where: { id },
    });
    if (!row || row.requesterRef !== person.actorRef) {
      throw new NotFoundException('No such request of yours.');
    }
    if (row.status !== 'PENDING') {
      throw new ConflictException('This request was already decided.');
    }
    const updated = await this.prisma.dataAccessRequest.update({
      where: { id },
      data: {
        status: 'WITHDRAWN',
        decidedBy: person.actorRef,
        decidedAt: new Date(),
      },
    });
    const target = await this.target(
      row.scopeType === 'ASSET' ? 'asset' : 'source',
      row.scopeId,
    ).catch(() => null);
    if (target) {
      this.record(
        updated,
        target,
        'data-access-requests.withdraw',
        'data.query',
        [{ field: 'status', from: 'PENDING', to: 'WITHDRAWN' }],
      );
    }
    return (await this.views([updated]))[0];
  }

  /** A waiting request the caller may decide, and not their own. */
  private async decidable(id: string): Promise<{
    row: DataAccessRequest;
    target: RequestTarget;
    person: ClsPerson;
  }> {
    const person = this.person();
    const row = await this.prisma.dataAccessRequest.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('No such request.');
    const target = await this.target(
      row.scopeType === 'ASSET' ? 'asset' : 'source',
      row.scopeId,
    );
    if (!(await this.mayDecide(target, person))) {
      throw new NotFoundException('No such request.');
    }
    if (row.requesterRef === person.actorRef) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'OWN_REQUEST',
        message: 'Someone else decides your own request.',
      });
    }
    if (row.status !== 'PENDING') {
      throw new ConflictException('This request was already decided.');
    }
    return { row, target, person };
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private days(value: unknown, fallback: number): number {
    if (value === undefined || value === null) return fallback;
    const days = typeof value === 'number' ? value : Number(value);
    if (!Number.isInteger(days) || days < 1 || days > MAX_REQUEST_DAYS) {
      throw new BadRequestException(
        `Access lasts 1 to ${MAX_REQUEST_DAYS} days.`,
      );
    }
    return days;
  }

  private note(value: unknown): string | null {
    if (value === undefined || value === null) return null;
    if (typeof value !== 'string')
      throw new BadRequestException('A note is text.');
    const note = value.trim();
    if (note.length > MAX_REASON) {
      throw new BadRequestException(
        `A note is at most ${MAX_REASON} characters.`,
      );
    }
    return note || null;
  }

  private pathOf(target: RequestTarget): string {
    return target.scopeType === 'asset'
      ? `/assets/${target.id}`
      : `/sources/${target.id}`;
  }

  private async resolve(refs: string[]): Promise<ResolvedActor[]> {
    if (!refs.length) return [];
    try {
      return await this.directory.resolve([...new Set(refs)]);
    } catch {
      return [];
    }
  }

  /**
   * One audit event per step of a request, filed under the request (not the
   * table: asking changes nothing about it) and tagged with the table and
   * its source, so their Activity shows it.
   */
  private record(
    row: DataAccessRequest,
    target: RequestTarget,
    operation: string,
    capability: Capability,
    changes: { field: string; from: string | null; to: string | null }[],
  ): void {
    void this.audit.record({
      actor: this.actors.current(),
      channel: 'rest',
      capability,
      operation,
      entityType: 'data-access-request',
      entityId: row.id,
      entityName: target.sqlName ?? target.name,
      resources: [
        DATA_RESOURCE,
        ...(target.scopeType === 'asset' ? [assetResource(target.id)] : []),
        sourceResource(target.sourceId),
      ],
      fields: ['accessRequest'],
      changes,
    });
  }

  /** Requests as people read them, with names and what the caller may do. */
  private async views(rows: DataAccessRequest[]): Promise<AccessRequestView[]> {
    if (!rows.length) return [];
    const person = this.person();
    const names = new Map(
      (
        await this.resolve(
          rows.flatMap((row) => [
            row.requesterRef,
            `group:${row.groupId}`,
            ...(row.decidedBy ? [row.decidedBy] : []),
          ]),
        )
      ).map((actor) => [actor.ref, actor] as const),
    );
    const { tables, sources } = await this.catalog.tables();
    const decide = new Map<string, boolean>();
    const out: AccessRequestView[] = [];
    for (const row of rows) {
      const table =
        row.scopeType === 'ASSET'
          ? tables.find((t) => t.assetId === row.scopeId)
          : undefined;
      const source = sources.find((s) => s.id === row.sourceId);
      const target: RequestTarget = {
        scopeType: row.scopeType === 'ASSET' ? 'asset' : 'source',
        id: row.scopeId,
        sourceId: row.sourceId,
        name: table?.name ?? source?.name ?? 'Removed',
        sqlName: table?.sqlName ?? source?.sqlName ?? null,
      };
      const key = `${target.scopeType}:${target.id}`;
      if (row.status === 'PENDING' && !decide.has(key)) {
        decide.set(key, await this.mayDecide(target, person));
      }
      const group = names.get(`group:${row.groupId}`);
      out.push({
        id: row.id,
        scopeType: target.scopeType,
        scopeId: row.scopeId,
        sourceId: row.sourceId,
        targetName: target.name,
        sqlName: target.sqlName,
        requesterRef: row.requesterRef,
        requesterName:
          names.get(row.requesterRef)?.displayName ?? 'Former member',
        groupId: row.groupId,
        groupName: group?.displayName ?? 'Removed group',
        groupPath: group?.path ?? null,
        roleKey: row.roleKey,
        reason: row.reason,
        durationDays: row.durationDays,
        status: row.status as RequestStatus,
        createdAt: row.createdAt,
        decidedBy: row.decidedBy,
        decidedByName: row.decidedBy
          ? (names.get(row.decidedBy)?.displayName ?? null)
          : null,
        decidedAt: row.decidedAt,
        decisionNote: row.decisionNote,
        grantExpiresAt: row.grantExpiresAt,
        canDecide:
          row.status === 'PENDING' &&
          row.requesterRef !== person.actorRef &&
          Boolean(decide.get(key)),
        canWithdraw:
          row.status === 'PENDING' && row.requesterRef === person.actorRef,
      });
    }
    return out;
  }
}
