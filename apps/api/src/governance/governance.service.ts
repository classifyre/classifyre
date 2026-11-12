import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { GovernanceStatus, LegalBasis, Prisma } from '@prisma/client';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import { ActorContextService } from '../identity/actor-context.service';
import { ActorDirectoryService } from '../identity/actor-directory.service';
import { parseActorRef } from '../identity/actor-ref';
import { governanceResources } from '../identity/audit-resources';
import { AuditTrailService } from '../identity/audit-trail.service';
import {
  CLS_ORG_ID,
  CLS_PERSON,
  type ClsPerson,
} from '../identity/iam-access-policy';
import type { IdentityService } from '../identity/identity.service';
import { IDENTITY } from '../identity/identity.tokens';
import type { OrgMember } from '../identity/membership.service';
import {
  GovernanceColumnsService,
  type AssetColumns,
} from './governance-columns.service';
import {
  canGovern,
  checklist,
  CLASSIFICATIONS,
  effectiveRoles,
  effectiveStatus,
  GOVERNANCE_ROLES,
  principalError,
  type EffectiveRole,
  type GovernancePerson,
  type GovernanceRoleKind,
  type RoleRow,
} from './governance-rules';
import type {
  AssetGovernanceDto,
  GovernancePrincipalDto,
  GovernanceRoleDto,
  SourceGovernanceDto,
  UpdateAssetGovernanceDto,
} from './governance.dto';

const MEMBERS_TTL_MS = 60_000;
const MAX_PRINCIPALS = 20;

type Target =
  | { scopeType: 'ASSET'; assetId: string; sourceId: string; name: string }
  | { scopeType: 'SOURCE'; sourceId: string; name: string };

/**
 * Owners, stewards and custodians of sources and assets, and an asset's
 * description and lifecycle (docs/prd/GOV-governed-data-assets.md, G-1).
 *
 * Routes need only `asset.view`; this service decides who may change what
 * (R3): `asset.govern` on the workspace, or an open owner or steward role on
 * the asset or its source. It records its own audit events, tagged
 * `governance`, `asset:<id>`, `source:<id>` (R4).
 */
@Injectable()
export class GovernanceService {
  private readonly members = new Map<
    string,
    { at: number; members: Promise<OrgMember[]> }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly actors: ActorContextService,
    private readonly directory: ActorDirectoryService,
    private readonly audit: AuditTrailService,
    private readonly columns: GovernanceColumnsService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
    @Inject(IDENTITY) private readonly identity: IdentityService,
  ) {}

  // ── Who is asking ─────────────────────────────────────────────────────────

  person(): GovernancePerson | null {
    if (!this.cls.isActive()) return null;
    const person = this.cls.get<ClsPerson | undefined>(CLS_PERSON);
    return person
      ? { actorRef: person.actorRef, groupIds: person.groupIds }
      : null;
  }

  private async hasCapability(): Promise<boolean> {
    return (await this.policy.check(this.actors.current(), 'asset.govern'))
      .allow;
  }

  private orgId(): string | null {
    return this.cls.isActive()
      ? (this.cls.get<string | undefined>(CLS_ORG_ID) ?? null)
      : null;
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  private async assetTarget(assetId: string): Promise<Target> {
    const asset = await this.prisma.asset.findUnique({
      where: { id: assetId },
      select: { id: true, sourceId: true, name: true },
    });
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    return {
      scopeType: 'ASSET',
      assetId: asset.id,
      sourceId: asset.sourceId,
      name: asset.name,
    };
  }

  private async sourceTarget(sourceId: string): Promise<Target> {
    const source = await this.prisma.source.findUnique({
      where: { id: sourceId },
      select: { id: true, name: true },
    });
    if (!source) throw new NotFoundException(`Source ${sourceId} not found`);
    return { scopeType: 'SOURCE', sourceId: source.id, name: source.name };
  }

  private rows(
    scopeType: 'ASSET' | 'SOURCE',
    scopeId: string,
  ): Promise<RoleRow[]> {
    return this.prisma.governanceRole.findMany({
      where: { scopeType, scopeId },
      orderBy: { dateIn: 'asc' },
    });
  }

  private async mayGovern(rows: readonly RoleRow[]): Promise<boolean> {
    return canGovern({
      hasCapability: await this.hasCapability(),
      person: this.person(),
      rows,
    });
  }

  async assetGovernance(assetId: string): Promise<AssetGovernanceDto> {
    const target = await this.assetTarget(assetId);
    if (target.scopeType !== 'ASSET') throw new Error('unreachable');
    const [record, assetRows, sourceRows, approvedTerms, columns] =
      await Promise.all([
        this.prisma.assetGovernance.findUnique({ where: { assetId } }),
        this.rows('ASSET', assetId),
        this.rows('SOURCE', target.sourceId),
        this.prisma.assetTerm.count({
          where: { assetId, goneAt: null, term: { status: 'APPROVED' } },
        }),
        this.columns.state(assetId),
      ]);
    const roles = effectiveRoles(assetRows, sourceRows);
    const governed = roles.some((role) => role.role === 'OWNER');
    const status = effectiveStatus(record, governed);
    const history = assetRows
      .filter((row) => row.dateOut !== null)
      .sort((a, b) => b.dateOut!.getTime() - a.dateOut!.getTime());
    const named = await this.principals([...roles, ...history]);
    return {
      assetId,
      sourceId: target.sourceId,
      governed,
      status,
      description: record?.description ?? null,
      usage: record?.usage ?? null,
      limitations: record?.limitations ?? null,
      legalBasis: record?.legalBasis ?? null,
      retention: record?.retention ?? null,
      certifiedAt: record?.certifiedAt ?? null,
      certifiedBy: record?.certifiedBy ?? null,
      updatedAt: record?.updatedAt ?? null,
      updatedBy: record?.updatedBy ?? null,
      roles: roles.map((role) => this.roleDto(role, named)),
      history: history.map((row) =>
        this.roleDto({ ...row, inherited: false }, named),
      ),
      checklist: checklist({
        roles,
        description: record?.description,
        approvedTerms,
        status,
        classificationReviewed: columns.classificationReviewed,
      }),
      canGovern: await this.mayGovern([...assetRows, ...sourceRows]),
    };
  }

  async sourceGovernance(sourceId: string): Promise<SourceGovernanceDto> {
    await this.sourceTarget(sourceId);
    const rows = await this.rows('SOURCE', sourceId);
    const open = rows
      .filter((row) => row.dateOut === null)
      .map((row) => ({ ...row, inherited: false }));
    const history = rows
      .filter((row) => row.dateOut !== null)
      .sort((a, b) => b.dateOut!.getTime() - a.dateOut!.getTime());
    const named = await this.principals([...open, ...history]);
    return {
      sourceId,
      roles: open.map((role) => this.roleDto(role, named)),
      history: history.map((row) =>
        this.roleDto({ ...row, inherited: false }, named),
      ),
      coverage: await this.coverage(
        sourceId,
        open.some((row) => row.role === 'OWNER'),
      ),
      canGovern: await this.mayGovern(rows),
    };
  }

  private async coverage(sourceId: string, sourceOwned: boolean) {
    const live = { sourceId, status: { not: 'DELETED' as const } };
    const assets = await this.prisma.asset.count({ where: live });
    let owned = assets;
    let ownedIds: string[] = [];
    if (!sourceOwned) {
      ownedIds = (
        await this.prisma.$queryRaw<{ id: string }[]>`
          SELECT a.id FROM assets a
          JOIN governance_roles r
            ON r.scope_type = 'ASSET' AND r.scope_id = a.id
           AND r.role = 'OWNER' AND r.date_out IS NULL
          WHERE a.source_id = ${sourceId} AND a.status <> 'DELETED'`
      ).map((row) => row.id);
      owned = ownedIds.length;
    }
    const active = await this.prisma.asset.count({
      where: {
        ...live,
        governance: { status: 'ACTIVE' },
        ...(sourceOwned ? {} : { id: { in: ownedIds } }),
      },
    });
    return { assets, owned, active };
  }

  // ── Principals ────────────────────────────────────────────────────────────

  private async principals(
    rows: readonly RoleRow[],
  ): Promise<Map<string, GovernancePrincipalDto>> {
    const refs = [...new Set(rows.map((row) => row.principalRef))];
    const resolved = await this.directory.resolve(refs);
    const members: OrgMember[] = await this.tenantMembers().catch(() => []);
    const email = new Map<string, string>();
    for (const member of members) {
      if (member.email) email.set(`user:${member.id}`, member.email);
    }
    const out = new Map<string, GovernancePrincipalDto>();
    for (const actor of resolved) {
      const address = email.get(actor.ref);
      out.set(actor.ref, {
        ref: actor.ref,
        kind: actor.kind === 'group' ? 'group' : 'user',
        displayName: actor.displayName,
        ...(address ? { email: address } : {}),
        ...(actor.path ? { path: actor.path } : {}),
      });
    }
    return out;
  }

  private roleDto(
    role: EffectiveRole,
    named: Map<string, GovernancePrincipalDto>,
  ): GovernanceRoleDto {
    const kind = parseActorRef(role.principalRef).kind;
    return {
      id: role.id,
      role: role.role,
      principal: named.get(role.principalRef) ?? {
        ref: role.principalRef,
        kind: kind === 'group' ? 'group' : 'user',
        displayName: kind === 'group' ? 'Removed group' : 'Former member',
      },
      inherited: role.inherited,
      dateIn: role.dateIn,
      ...(role.dateOut ? { dateOut: role.dateOut } : {}),
      ...(role.replacedByRef ? { replacedByRef: role.replacedByRef } : {}),
      ...(role.assignedBy ? { assignedBy: role.assignedBy } : {}),
      ...(role.removedBy ? { removedBy: role.removedBy } : {}),
    };
  }

  /** The tenant's people, cached for a minute (the identity server pages them). */
  private tenantMembers(): Promise<OrgMember[]> {
    const orgId = this.orgId();
    if (!orgId) return Promise.resolve([]);
    const hit = this.members.get(orgId);
    if (hit && Date.now() - hit.at < MEMBERS_TTL_MS) return hit.members;
    const members = this.identity.membership.members(orgId);
    this.members.set(orgId, { at: Date.now(), members });
    members.catch(() => this.members.delete(orgId));
    return members;
  }

  /**
   * People and groups of the tenant matching `q`, for the owner and steward
   * pickers (§5.2). Only for people who may govern something: tenant e-mail
   * addresses are not every viewer's to list.
   */
  async searchPrincipals(
    q: string | undefined,
    kinds: readonly ('user' | 'group')[],
  ): Promise<GovernancePrincipalDto[]> {
    const person = this.person();
    if (!person) {
      throw new ForbiddenException('Sign in to look up people and groups.');
    }
    const allowed =
      (await this.hasCapability()) ||
      (await this.policy.check(this.actors.current(), 'access.view')).allow ||
      (await this.prisma.governanceRole.count({
        where: {
          dateOut: null,
          role: { in: ['OWNER', 'STEWARD'] },
          principalRef: {
            in: [
              person.actorRef,
              ...person.groupIds.map((id) => `group:${id}`),
            ],
          },
        },
      })) > 0;
    if (!allowed) {
      throw new ForbiddenException(
        'Looking up people needs asset.govern or access.view, or a role as owner or steward.',
      );
    }
    const orgId = this.orgId();
    if (!orgId) return [];
    const needle = (q ?? '').trim().toLowerCase();
    const out: GovernancePrincipalDto[] = [];
    if (kinds.includes('user')) {
      const members = await this.tenantMembers();
      for (const member of members) {
        if (!member.enabled) continue;
        const name =
          [member.firstName, member.lastName].filter(Boolean).join(' ') ||
          member.username;
        const hay =
          `${name} ${member.username} ${member.email ?? ''}`.toLowerCase();
        if (needle && !hay.includes(needle)) continue;
        out.push({
          ref: `user:${member.id}`,
          kind: 'user',
          displayName: name,
          ...(member.email ? { email: member.email } : {}),
        });
      }
    }
    if (kinds.includes('group')) {
      const groups = await this.identity.membership.groups(orgId);
      for (const group of groups) {
        if (
          needle &&
          !`${group.name} ${group.path}`.toLowerCase().includes(needle)
        )
          continue;
        out.push({
          ref: `group:${group.id}`,
          kind: 'group',
          displayName: group.name,
          path: group.path,
        });
      }
    }
    return out
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, MAX_PRINCIPALS);
  }

  /** Whether the ref names a current member or group of the tenant. */
  private async assertPrincipalExists(ref: string): Promise<void> {
    const orgId = this.orgId();
    if (!orgId) {
      throw new BadRequestException(
        'People and groups need a signed-in tenant.',
      );
    }
    const parsed = parseActorRef(ref);
    const exists =
      parsed.kind === 'user'
        ? (await this.tenantMembers()).some((m) => m.id === parsed.id)
        : (await this.identity.membership.groups(orgId)).some(
            (group) => group.id === parsed.id,
          );
    if (!exists) {
      throw new BadRequestException(
        parsed.kind === 'user'
          ? 'No such person in this tenant.'
          : 'No such group in this tenant.',
      );
    }
  }

  // ── Changes ───────────────────────────────────────────────────────────────

  private async authorize(target: Target): Promise<void> {
    const rows = [
      ...(target.scopeType === 'ASSET'
        ? await this.rows('ASSET', target.assetId)
        : []),
      ...(await this.rows('SOURCE', target.sourceId)),
    ];
    if (!(await this.mayGovern(rows))) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'CAPABILITY_REQUIRED',
        capability: 'asset.govern',
        message:
          'Changing governance needs asset.govern, or the owner or steward role on this asset or its source.',
      });
    }
  }

  private record(
    target: Target,
    operation: string,
    fields: string[],
    status = 200,
  ): void {
    void this.audit.record({
      actor: this.actors.current(),
      channel: 'rest',
      capability: 'asset.govern',
      operation,
      entityType: target.scopeType === 'ASSET' ? 'asset' : 'source',
      entityId: target.scopeType === 'ASSET' ? target.assetId : target.sourceId,
      entityName: target.name,
      resources: governanceResources({
        assetId: target.scopeType === 'ASSET' ? target.assetId : null,
        sourceId: target.sourceId,
      }),
      fields,
      status,
    });
  }

  async updateAssetGovernance(
    assetId: string,
    body: UpdateAssetGovernanceDto,
  ): Promise<AssetGovernanceDto> {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    const patch = this.validatePatch(body ?? {});
    const fields = Object.keys(patch).sort();
    if (!fields.length) return this.assetGovernance(assetId);

    const actorRef = this.actors.current().ref ?? null;
    const current = await this.prisma.assetGovernance.findUnique({
      where: { assetId },
    });
    const data: Prisma.AssetGovernanceUncheckedUpdateInput = {
      ...patch,
      updatedBy: actorRef,
    };
    if (patch.status && patch.status !== current?.status) {
      if (patch.status === 'ACTIVE') {
        const roles = effectiveRoles(
          await this.rows('ASSET', assetId),
          await this.rows('SOURCE', target.sourceId),
        );
        if (!roles.some((role) => role.role === 'OWNER')) {
          throw new ConflictException(
            'Only an owned asset can be certified: assign an owner first.',
          );
        }
        data.certifiedAt = new Date();
        data.certifiedBy = actorRef;
      }
    }
    await this.prisma.assetGovernance.upsert({
      where: { assetId },
      create: {
        ...(data as Prisma.AssetGovernanceUncheckedCreateInput),
        assetId,
      },
      update: data,
    });
    this.record(
      target,
      patch.status && patch.status !== current?.status
        ? `governance.status.${patch.status.toLowerCase()}`
        : 'governance.update',
      fields,
    );
    return this.assetGovernance(assetId);
  }

  private validatePatch(body: UpdateAssetGovernanceDto) {
    const patch: {
      description?: string | null;
      usage?: string | null;
      limitations?: string | null;
      retention?: string | null;
      legalBasis?: LegalBasis | null;
      status?: GovernanceStatus;
    } = {};
    const text = (
      key: 'description' | 'usage' | 'limitations' | 'retention',
      max: number,
    ) => {
      if (!(key in body)) return;
      const value = body[key];
      if (value === null || value === undefined) {
        patch[key] = null;
        return;
      }
      if (typeof value !== 'string') {
        throw new BadRequestException(`${key} is text.`);
      }
      if (value.length > max) {
        throw new BadRequestException(`${key} is at most ${max} characters.`);
      }
      patch[key] = value.trim() ? value : null;
    };
    text('description', 20_000);
    text('usage', 5_000);
    text('limitations', 5_000);
    text('retention', 100);
    if ('legalBasis' in body) {
      const value = body.legalBasis;
      if (value !== null && value !== undefined) {
        if (!Object.values(LegalBasis).includes(value)) {
          throw new BadRequestException(
            `legalBasis is one of ${Object.values(LegalBasis).join(', ')}.`,
          );
        }
      }
      patch.legalBasis = value ?? null;
    }
    if (body.status !== undefined) {
      if (!Object.values(GovernanceStatus).includes(body.status)) {
        throw new BadRequestException(
          `status is one of ${Object.values(GovernanceStatus).join(', ')}.`,
        );
      }
      patch.status = body.status;
    }
    return patch;
  }

  async assignAssetRole(
    assetId: string,
    role: unknown,
    principalRef: unknown,
  ): Promise<AssetGovernanceDto> {
    const target = await this.assetTarget(assetId);
    await this.assign(target, role, principalRef);
    return this.assetGovernance(assetId);
  }

  async assignSourceRole(
    sourceId: string,
    role: unknown,
    principalRef: unknown,
  ): Promise<SourceGovernanceDto> {
    const target = await this.sourceTarget(sourceId);
    await this.assign(target, role, principalRef);
    return this.sourceGovernance(sourceId);
  }

  async removeAssetRole(
    assetId: string,
    roleId: string,
  ): Promise<AssetGovernanceDto> {
    const target = await this.assetTarget(assetId);
    await this.remove(target, roleId);
    return this.assetGovernance(assetId);
  }

  async removeSourceRole(
    sourceId: string,
    roleId: string,
  ): Promise<SourceGovernanceDto> {
    const target = await this.sourceTarget(sourceId);
    await this.remove(target, roleId);
    return this.sourceGovernance(sourceId);
  }

  private async assign(
    target: Target,
    role: unknown,
    principalRef: unknown,
  ): Promise<void> {
    if (
      typeof role !== 'string' ||
      !(GOVERNANCE_ROLES as readonly string[]).includes(role)
    ) {
      throw new BadRequestException(
        `role is one of ${GOVERNANCE_ROLES.join(', ')}.`,
      );
    }
    if (typeof principalRef !== 'string' || !principalRef.trim()) {
      throw new BadRequestException('principalRef names a person or a group.');
    }
    const kind = role as GovernanceRoleKind;
    const ref = principalRef.trim();
    const problem = principalError(kind, ref);
    if (problem) throw new BadRequestException(problem);
    await this.authorize(target);
    await this.assertPrincipalExists(ref);

    const scopeType = target.scopeType;
    const scopeId =
      target.scopeType === 'ASSET' ? target.assetId : target.sourceId;
    const actorRef = this.actors.current().ref ?? null;
    try {
      await this.prisma.$transaction(async (tx) => {
        const open = await tx.governanceRole.findMany({
          where: { scopeType, scopeId, role: kind, dateOut: null },
        });
        if (open.some((row) => row.principalRef === ref)) {
          throw new ConflictException('Already holds this role here.');
        }
        // One owner: a new one replaces the current, whose row is closed and
        // points at the successor (ODCS replacedByUsername).
        if (kind === 'OWNER') {
          for (const row of open) {
            await tx.governanceRole.update({
              where: { id: row.id },
              data: {
                dateOut: new Date(),
                replacedByRef: ref,
                removedBy: actorRef,
              },
            });
          }
        }
        await tx.governanceRole.create({
          data: {
            scopeType,
            scopeId,
            role: kind,
            principalRef: ref,
            assignedBy: actorRef,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Someone changed this role at the same time; reload and try again.',
        );
      }
      throw error;
    }
    this.record(
      target,
      `governance.role.${kind.toLowerCase()}.assign`,
      ['principalRef', 'role'],
      201,
    );
  }

  private async remove(target: Target, roleId: string): Promise<void> {
    await this.authorize(target);
    const scopeId =
      target.scopeType === 'ASSET' ? target.assetId : target.sourceId;
    const row = await this.prisma.governanceRole.findFirst({
      where: { id: roleId, scopeType: target.scopeType, scopeId },
    });
    if (!row) throw new NotFoundException(`Role ${roleId} not found here.`);
    if (row.dateOut) return;
    await this.prisma.governanceRole.update({
      where: { id: row.id },
      data: {
        dateOut: new Date(),
        removedBy: this.actors.current().ref ?? null,
      },
    });
    this.record(target, `governance.role.${row.role.toLowerCase()}.remove`, [
      'role',
    ]);
  }

  // ── Columns (G-2, R6) ──────────────────────────────────────────────────────

  async assetColumns(
    assetId: string,
  ): Promise<AssetColumns & { canGovern: boolean }> {
    const target = await this.assetTarget(assetId);
    if (target.scopeType !== 'ASSET') throw new Error('unreachable');
    const [state, assetRows, sourceRows] = await Promise.all([
      this.columns.state(assetId),
      this.rows('ASSET', assetId),
      this.rows('SOURCE', target.sourceId),
    ]);
    return {
      ...state,
      canGovern: await this.mayGovern([...assetRows, ...sourceRows]),
    };
  }

  /**
   * What a steward says about one column. `reviewClassification` confirms
   * the classification as it stands (derived or set); setting one confirms
   * it too. A column the scan no longer has can still be edited or removed.
   */
  async updateColumn(
    assetId: string,
    columnName: string,
    body: {
      businessName?: unknown;
      description?: unknown;
      termId?: unknown;
      criticalDataElement?: unknown;
      classification?: unknown;
      reviewClassification?: unknown;
    },
  ): Promise<AssetColumns & { canGovern: boolean }> {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    const name = columnName.trim();
    const state = await this.columns.state(assetId);
    const known =
      state.columns.some((column) => column.name === name) ||
      state.removed.some((column) => column.name === name);
    if (!name || !known) {
      throw new NotFoundException(`No column ${columnName} on this asset.`);
    }
    const actorRef = this.actors.current().ref ?? null;
    const data: Prisma.AssetColumnAnnotationUncheckedUpdateInput = {
      updatedBy: actorRef,
    };
    const fields: string[] = [];
    const text = (key: 'businessName' | 'description', max: number) => {
      if (!(key in body)) return;
      const value = body[key];
      if (value !== null && typeof value !== 'string') {
        throw new BadRequestException(`${key} is text.`);
      }
      if (typeof value === 'string' && value.length > max) {
        throw new BadRequestException(`${key} is at most ${max} characters.`);
      }
      data[key] =
        typeof value === 'string' && value.trim() ? value.trim() : null;
      fields.push(key);
    };
    text('businessName', 200);
    text('description', 5_000);
    if ('termId' in body) {
      const termId = body.termId;
      if (termId !== null && typeof termId !== 'string') {
        throw new BadRequestException('termId names a glossary term.');
      }
      if (termId) {
        const term = await this.prisma.glossaryTerm.findUnique({
          where: { id: termId },
          select: { id: true },
        });
        if (!term) throw new BadRequestException('No such glossary term.');
      }
      data.termId = termId || null;
      fields.push('termId');
    }
    if ('criticalDataElement' in body) {
      if (typeof body.criticalDataElement !== 'boolean') {
        throw new BadRequestException('criticalDataElement is true or false.');
      }
      data.criticalDataElement = body.criticalDataElement;
      fields.push('criticalDataElement');
    }
    let reviewed = body.reviewClassification === true;
    if ('classification' in body) {
      const value = body.classification;
      if (
        value !== null &&
        (typeof value !== 'string' ||
          !(CLASSIFICATIONS as readonly string[]).includes(value))
      ) {
        throw new BadRequestException(
          `classification is one of ${CLASSIFICATIONS.join(', ')}, or null for the derived one.`,
        );
      }
      data.classification = value;
      fields.push('classification');
      reviewed = reviewed || value !== null;
    }
    if (reviewed) {
      data.classificationReviewedAt = new Date();
      data.classificationReviewedBy = actorRef;
      fields.push('reviewClassification');
    }
    if (!fields.length) return this.assetColumns(assetId);
    await this.prisma.assetColumnAnnotation.upsert({
      where: { assetId_columnName: { assetId, columnName: name } },
      create: {
        ...(data as Prisma.AssetColumnAnnotationUncheckedCreateInput),
        assetId,
        columnName: name,
      },
      update: data,
    });
    this.record(target, 'governance.column.update', fields.sort());
    return this.assetColumns(assetId);
  }

  /**
   * Move what was said about a column the scan no longer has to the column it
   * became (a rename at the source). The target must carry nothing yet.
   */
  async moveColumn(
    assetId: string,
    columnName: string,
    to: unknown,
  ): Promise<AssetColumns & { canGovern: boolean }> {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    if (typeof to !== 'string' || !to.trim()) {
      throw new BadRequestException('to names the column it became.');
    }
    const state = await this.columns.state(assetId);
    const from = state.removed.find((column) => column.name === columnName);
    if (!from) {
      throw new NotFoundException(
        `${columnName} is not a removed column of this asset.`,
      );
    }
    const dest = state.columns.find((column) => column.name === to.trim());
    if (!dest) throw new BadRequestException(`No column ${to} on this asset.`);
    const taken = await this.prisma.assetColumnAnnotation.count({
      where: { assetId, columnName: dest.name },
    });
    if (taken) {
      throw new ConflictException(
        `${dest.name} already has a description or classification.`,
      );
    }
    await this.prisma.assetColumnAnnotation.update({
      where: { assetId_columnName: { assetId, columnName } },
      data: {
        columnName: dest.name,
        updatedBy: this.actors.current().ref ?? null,
      },
    });
    this.record(target, 'governance.column.move', ['columnName', 'to']);
    return this.assetColumns(assetId);
  }

  /** Forget what was said about a column (a removed one, usually). */
  async removeColumn(
    assetId: string,
    columnName: string,
  ): Promise<AssetColumns & { canGovern: boolean }> {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    const { count } = await this.prisma.assetColumnAnnotation.deleteMany({
      where: { assetId, columnName },
    });
    if (count) this.record(target, 'governance.column.remove', ['columnName']);
    return this.assetColumns(assetId);
  }

  // ── Assets lists ──────────────────────────────────────────────────────────

  /**
   * Owner and lifecycle of each asset on a page of search results (§5.7):
   * one query for the page's roles, one for its records.
   */
  async summaries(
    assets: readonly { id: string; sourceId: string }[],
  ): Promise<
    Map<string, { status: GovernanceStatus | null; ownerRef: string | null }>
  > {
    const out = new Map<
      string,
      { status: GovernanceStatus | null; ownerRef: string | null }
    >();
    if (!assets.length) return out;
    const assetIds = assets.map((asset) => asset.id);
    const sourceIds = [...new Set(assets.map((asset) => asset.sourceId))];
    const [owners, records] = await Promise.all([
      this.prisma.governanceRole.findMany({
        where: {
          role: 'OWNER',
          dateOut: null,
          OR: [
            { scopeType: 'ASSET', scopeId: { in: assetIds } },
            { scopeType: 'SOURCE', scopeId: { in: sourceIds } },
          ],
        },
        select: { scopeType: true, scopeId: true, principalRef: true },
      }),
      this.prisma.assetGovernance.findMany({
        where: { assetId: { in: assetIds } },
        select: { assetId: true, status: true },
      }),
    ]);
    const ownerOf = new Map(
      owners.map((row) => [
        `${row.scopeType}:${row.scopeId}`,
        row.principalRef,
      ]),
    );
    const statusOf = new Map(records.map((row) => [row.assetId, row.status]));
    for (const asset of assets) {
      const ownerRef =
        ownerOf.get(`ASSET:${asset.id}`) ??
        ownerOf.get(`SOURCE:${asset.sourceId}`) ??
        null;
      out.set(asset.id, {
        ownerRef,
        status: effectiveStatus(
          statusOf.has(asset.id) ? { status: statusOf.get(asset.id)! } : null,
          ownerRef !== null,
        ),
      });
    }
    return out;
  }
}
