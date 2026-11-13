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
import {
  AuditTrailService,
  type AuditChange,
} from '../identity/audit-trail.service';
import {
  CLS_ORG_ID,
  CLS_PERSON,
  type ClsPerson,
} from '../identity/iam-access-policy';
import type { IdentityService } from '../identity/identity.service';
import { IDENTITY } from '../identity/identity.tokens';
import type { OrgMember } from '../identity/membership.service';
import {
  KeyTakenError,
  QualityService,
  type AssetQuality,
} from './quality.service';
import {
  RuleError,
  validateRule,
  type RuleInput,
  type ValidRule,
} from './quality-rules';
import { GovernanceNotifier } from './governance-notifier';
import { fromContract, toContract, type ContractPlan } from './odcs';
import { parse as parseYaml } from 'yaml';
import { CLS_SLUG } from '../namespace/namespace.constants';
import {
  GovernanceMeaningService,
  type GovernanceMeaning,
} from './governance-meaning.service';
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

type QualitySummary = {
  rules: number;
  failing: number;
  score: number | null;
};

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
    private readonly meaning: GovernanceMeaningService,
    private readonly quality: QualityService,
    private readonly notifier: GovernanceNotifier,
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
    const [record, assetRows, sourceRows, approvedTerms, columns, quality] =
      await Promise.all([
        this.prisma.assetGovernance.findUnique({ where: { assetId } }),
        this.rows('ASSET', assetId),
        this.rows('SOURCE', target.sourceId),
        // Linked terms, and links made by hand the linker has not rolled up.
        Promise.all([
          this.prisma.assetTerm.count({
            where: { assetId, goneAt: null, term: { status: 'APPROVED' } },
          }),
          this.prisma.glossaryReference.count({
            where: {
              entityType: 'asset',
              entityId: assetId,
              role: 'ABOUT',
              term: { status: 'APPROVED' },
            },
          }),
        ]).then(([linked, byHand]) => linked + byHand),
        this.columns.state(assetId),
        this.quality.summaries([assetId]).then((map) => map.get(assetId)),
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
        qualityPassing: quality
          ? quality.failing === 0 && quality.score !== null
          : false,
      }),
      canGovern: await this.mayGovern([...assetRows, ...sourceRows]),
      canAssignRoles: await this.hasCapability(),
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
      canAssignRoles: await this.hasCapability(),
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
    const [checked, failing] = await Promise.all([
      this.prisma.asset.count({
        where: { ...live, qualityRules: { some: { enabled: true } } },
      }),
      this.prisma.asset.count({
        where: {
          ...live,
          findings: { some: { detectorType: 'QUALITY', status: 'OPEN' } },
        },
      }),
    ]);
    return { assets, owned, active, checked, failing };
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

  /**
   * Who answers for an asset is decided by people with `asset.govern` (an
   * admin, a curator), never by the owner or steward themselves: naming an
   * owner hands out rights (R3), and only a role may do that.
   */
  private async authorizeRoles(): Promise<void> {
    if (!(await this.hasCapability())) {
      throw new ForbiddenException({
        statusCode: 403,
        error: 'Forbidden',
        code: 'CAPABILITY_REQUIRED',
        capability: 'asset.govern',
        message:
          'Naming owners, stewards and custodians needs asset.govern (an admin or curator role).',
      });
    }
  }

  private record(
    target: Target,
    operation: string,
    fields: string[],
    status = 200,
    changes?: AuditChange[],
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
      ...(changes?.length ? { changes } : {}),
    });
  }

  /** People and groups by name, for what an audit event says changed. */
  private async names(refs: readonly string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    if (!refs.length) return out;
    const resolved = await this.directory
      .resolve([...new Set(refs)])
      .catch(() => []);
    for (const actor of resolved) out.set(actor.ref, actor.displayName);
    return out;
  }

  private async termName(termId: string): Promise<string> {
    const term = await this.prisma.glossaryTerm
      .findUnique({ where: { id: termId }, select: { term: true } })
      .catch(() => null);
    return term?.term ?? termId;
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
    const before: Record<string, unknown> = {
      status: 'DRAFT',
      ...(current ?? {}),
    };
    const changes: AuditChange[] = [];
    for (const field of fields) {
      const from = before[field] ?? null;
      const to = (patch as Record<string, unknown>)[field] ?? null;
      if (from === to) continue;
      changes.push({
        field,
        from: valueText(from),
        to: valueText(to),
      });
    }
    this.record(
      target,
      patch.status && patch.status !== current?.status
        ? `governance.status.${patch.status.toLowerCase()}`
        : 'governance.update',
      fields,
      200,
      changes,
    );
    if (patch.status && patch.status !== (current?.status ?? 'DRAFT')) {
      void this.notifier.statusChanged({
        assetId,
        assetName: target.name,
        status: patch.status,
        actorRef,
      });
    }
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
    await this.authorizeRoles();
    await this.assertPrincipalExists(ref);

    const scopeType = target.scopeType;
    const scopeId =
      target.scopeType === 'ASSET' ? target.assetId : target.sourceId;
    const actorRef = this.actors.current().ref ?? null;
    let held: string[] = [];
    try {
      await this.prisma.$transaction(async (tx) => {
        const open = await tx.governanceRole.findMany({
          where: { scopeType, scopeId, role: kind, dateOut: null },
        });
        held = open.map((row) => row.principalRef);
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
    // An owner replaces the one before; stewards and custodians are added.
    const named = await this.names([ref, ...held]);
    const label = (one: string) => named.get(one) ?? one;
    this.record(
      target,
      `governance.role.${kind.toLowerCase()}.assign`,
      ['principalRef', 'role'],
      201,
      [
        {
          field: kind.toLowerCase(),
          from: held.length ? held.map(label).join(', ') : null,
          to:
            kind === 'OWNER'
              ? label(ref)
              : [...held, ref].map(label).join(', '),
        },
      ],
    );
    void this.notifier.roleAssigned({
      scope: target.scopeType === 'ASSET' ? 'asset' : 'source',
      id: target.scopeType === 'ASSET' ? target.assetId : target.sourceId,
      name: target.name,
      role: kind,
      principalRef: ref,
      actorRef,
    });
  }

  private async remove(target: Target, roleId: string): Promise<void> {
    await this.authorizeRoles();
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
    const named = await this.names([row.principalRef]);
    this.record(
      target,
      `governance.role.${row.role.toLowerCase()}.remove`,
      ['role'],
      200,
      [
        {
          field: row.role.toLowerCase(),
          from: named.get(row.principalRef) ?? row.principalRef,
          to: null,
        },
      ],
    );
  }

  // ── Meaning (glossary terms) ────────────────────────────────────────────────

  async assetMeaning(
    assetId: string,
  ): Promise<
    GovernanceMeaning & { canGovern: boolean; canEditGlossary: boolean }
  > {
    const target = await this.assetTarget(assetId);
    if (target.scopeType !== 'ASSET') throw new Error('unreachable');
    const [state, assetRows, sourceRows, glossary] = await Promise.all([
      this.meaning.state(assetId),
      this.rows('ASSET', assetId),
      this.rows('SOURCE', target.sourceId),
      this.policy.check(this.actors.current(), 'glossary.edit'),
    ]);
    return {
      ...state,
      canGovern: await this.mayGovern([...assetRows, ...sourceRows]),
      canEditGlossary: glossary.allow,
    };
  }

  async linkTerm(assetId: string, termId: unknown) {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    if (typeof termId !== 'string' || !termId) {
      throw new BadRequestException('termId names a glossary term.');
    }
    await this.meaning.link(assetId, termId, this.actorName());
    this.record(target, 'governance.meaning.link', ['termId'], 201, [
      { field: 'term', from: null, to: await this.termName(termId) },
    ]);
    return this.assetMeaning(assetId);
  }

  async unlinkTerm(assetId: string, termId: string) {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    await this.meaning.unlink(assetId, termId, this.actorName());
    this.record(target, 'governance.meaning.unlink', ['termId'], 200, [
      { field: 'term', from: await this.termName(termId), to: null },
    ]);
    return this.assetMeaning(assetId);
  }

  async dismissSuggestion(assetId: string, suggestionId: string) {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    const suggestion = await this.prisma.semanticSuggestion.findFirst({
      where: { id: suggestionId, assetId },
      select: { termId: true },
    });
    await this.meaning.dismiss(assetId, suggestionId, this.actorName());
    this.record(target, 'governance.meaning.dismiss', ['suggestionId'], 200, [
      {
        field: 'suggested term',
        from: suggestion?.termId
          ? await this.termName(suggestion.termId)
          : suggestionId,
        to: 'dismissed',
      },
    ]);
    return this.assetMeaning(assetId);
  }

  private actorName(): string {
    return this.actors.current().ref ?? 'operator';
  }

  // ── Quality (G-3) ─────────────────────────────────────────────────────────

  async assetQuality(
    assetId: string,
  ): Promise<AssetQuality & { canGovern: boolean }> {
    const target = await this.assetTarget(assetId);
    if (target.scopeType !== 'ASSET') throw new Error('unreachable');
    const [quality, assetRows, sourceRows] = await Promise.all([
      this.quality.forAsset(assetId),
      this.rows('ASSET', assetId),
      this.rows('SOURCE', target.sourceId),
    ]);
    return {
      ...quality,
      canGovern: await this.mayGovern([...assetRows, ...sourceRows]),
    };
  }

  private validRule(
    input: RuleInput,
    current?: Parameters<typeof validateRule>[1],
  ) {
    try {
      return validateRule(input ?? {}, current);
    } catch (error) {
      if (error instanceof RuleError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }

  async createQualityRule(assetId: string, body: RuleInput) {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    const rule = this.validRule(body);
    if (rule.columnName) await this.assertColumn(assetId, rule.columnName);
    let created: { id: string };
    try {
      created = await this.quality.create(
        assetId,
        rule,
        this.actors.current().ref ?? null,
      );
    } catch (error) {
      if (error instanceof KeyTakenError) {
        throw new ConflictException(error.message);
      }
      throw error;
    }
    this.record(
      target,
      'governance.quality.rule.create',
      Object.keys(body ?? {}).sort(),
      201,
      [{ field: `rule ${rule.key}`, from: null, to: ruleText(rule) }],
    );
    // A new rule says something only once it is measured.
    await this.quality.evaluate([assetId], 'manual', {
      actorRef: this.actors.current().ref ?? null,
      ruleIds: [created.id],
    });
    return this.assetQuality(assetId);
  }

  async updateQualityRule(ruleId: string, body: RuleInput) {
    const current = await this.quality.rule(ruleId);
    const target = await this.assetTarget(current.assetId);
    await this.authorize(target);
    const rule = this.validRule(body, this.quality.toValid(current));
    if (rule.columnName)
      await this.assertColumn(current.assetId, rule.columnName);
    try {
      await this.quality.update(ruleId, rule);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          `A rule with key ${rule.key} already exists on this asset.`,
        );
      }
      throw error;
    }
    this.record(
      target,
      'governance.quality.rule.update',
      Object.keys(body ?? {}).sort(),
      200,
      ruleChanges(this.quality.toValid(current), rule),
    );
    await this.quality.evaluate([current.assetId], 'manual', {
      actorRef: this.actors.current().ref ?? null,
      ruleIds: [ruleId],
    });
    return this.assetQuality(current.assetId);
  }

  async removeQualityRule(ruleId: string) {
    const current = await this.quality.rule(ruleId);
    const target = await this.assetTarget(current.assetId);
    await this.authorize(target);
    await this.quality.remove(ruleId);
    const gone = this.quality.toValid(current);
    this.record(target, 'governance.quality.rule.remove', ['ruleId'], 200, [
      { field: `rule ${gone.key}`, from: ruleText(gone), to: null },
    ]);
    return this.assetQuality(current.assetId);
  }

  async qualityOptions(assetId: string) {
    await this.assetTarget(assetId);
    return this.quality.options(assetId);
  }

  /** Measure a rule as written, saving nothing (the editor's test run). */
  async testQualityRule(assetId: string, body: RuleInput) {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    const input = { ...(body ?? {}) };
    if (typeof input.name !== 'string' || !input.name.trim()) {
      input.name = 'Test run';
    }
    const rule = this.validRule(input);
    if (rule.columnName) await this.assertColumn(assetId, rule.columnName);
    return this.quality.test(assetId, rule);
  }

  async runQuality(assetId: string) {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    await this.quality.evaluate([assetId], 'manual', {
      actorRef: this.actors.current().ref ?? null,
    });
    this.record(target, 'governance.quality.run', []);
    return this.assetQuality(assetId);
  }

  private async assertColumn(assetId: string, columnName: string) {
    const state = await this.columns.state(assetId);
    if (!state.columns.some((column) => column.name === columnName)) {
      throw new BadRequestException(`No column ${columnName} on this asset.`);
    }
  }

  // ── ODCS contract (G-4, R10) ────────────────────────────────────────────────

  /** The asset as an ODCS v3.2 contract object (GOV §5.5). */
  async exportContract(assetId: string): Promise<{
    name: string;
    contract: Record<string, unknown>;
  }> {
    const [governance, columns, quality, asset, table, refs, changes] =
      await Promise.all([
        this.assetGovernance(assetId),
        this.columns.state(assetId),
        this.quality.forAsset(assetId),
        this.prisma.asset.findUnique({
          where: { id: assetId },
          select: { name: true, urn: true, externalUrl: true },
        }),
        this.quality.tableName(assetId),
        this.prisma.glossaryReference.findMany({
          where: { entityType: 'asset', entityId: assetId, role: 'ABOUT' },
          select: { term: { select: { key: true } } },
        }),
        this.prisma.auditEvent.count({
          where: {
            resources: { hasEvery: [`asset:${assetId}`, 'governance'] },
          },
        }),
      ]);
    if (!asset) throw new NotFoundException(`Asset ${assetId} not found`);
    const linked = await this.prisma.assetTerm.findMany({
      where: { assetId, goneAt: null },
      select: { term: { select: { key: true } } },
    });
    const member = (role: GovernanceRoleDto) => ({
      username:
        role.principal.email ?? role.principal.path ?? role.principal.ref,
      name: role.principal.displayName,
      role: role.role.toLowerCase() as 'owner' | 'steward' | 'custodian',
      dateIn: new Date(role.dateIn).toISOString(),
      ...(role.dateOut
        ? { dateOut: new Date(role.dateOut).toISOString() }
        : {}),
      ...(role.replacedByRef ? { replacedByUsername: role.replacedByRef } : {}),
    });
    const slug = this.cls.isActive()
      ? (this.cls.get<string | undefined>(CLS_SLUG) ?? null)
      : null;
    const contract = toContract({
      id: asset.urn ?? `asset:${assetId}`,
      version: `1.${changes}.0`,
      name: asset.name,
      domain: slug,
      status: governance.status?.toLowerCase() ?? null,
      description: governance.description,
      usage: governance.usage,
      limitations: governance.limitations,
      legalBasis: governance.legalBasis,
      retention: governance.retention,
      terms: [
        ...new Set([
          ...linked.map((row) => row.term.key),
          ...refs.map((row) => row.term.key),
        ]),
      ],
      members: [
        ...governance.roles.map(member),
        ...governance.history.map(member),
      ],
      table: table ?? asset.name,
      physicalName: asset.name,
      columns: columns.columns.map((column) => ({
        name: column.name,
        type: column.type,
        businessName: column.businessName,
        description: column.description,
        classification: column.effectiveClassification,
        criticalDataElement: column.criticalDataElement,
        termKey: column.term?.key ?? null,
      })),
      rules: quality.rules.map((rule) => ({
        key: rule.key,
        name: rule.name,
        description: rule.description,
        columnName: rule.columnName,
        dimension: rule.dimension,
        type: rule.type,
        metric: rule.metric,
        arguments: rule.arguments as Record<string, unknown>,
        operator: rule.operator,
        threshold: rule.threshold,
        unit: rule.unit,
        severity: rule.severity,
        businessImpact: rule.businessImpact,
        schedule: rule.schedule,
      })),
      qualityScore: quality.score,
      url: null,
    });
    return { name: asset.name, contract };
  }

  /**
   * Apply an ODCS contract to the asset (GOV §5.5): description, team,
   * column annotations and quality rules, matched by name. Returns what was
   * applied and what was skipped, and why.
   */
  async importContract(assetId: string, text: unknown) {
    const target = await this.assetTarget(assetId);
    await this.authorize(target);
    if (typeof text !== 'string' || !text.trim()) {
      throw new BadRequestException('Send the contract as YAML or JSON text.');
    }
    if (text.length > 1_000_000) {
      throw new BadRequestException('A contract is at most 1 MB.');
    }
    let plan: ContractPlan;
    try {
      plan = fromContract(parseYaml(text));
    } catch (error) {
      throw new BadRequestException(
        `Not a readable contract: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const skipped = [...plan.skipped];
    const applied = { governance: false, members: 0, columns: 0, rules: 0 };

    // Team first: certifying needs an owner.
    if (plan.members.length) {
      const orgId = this.orgId();
      const people: OrgMember[] = await this.tenantMembers().catch(() => []);
      const groups = orgId
        ? await this.identity.membership.groups(orgId).catch(() => [])
        : [];
      const current = effectiveRoles(
        await this.rows('ASSET', assetId),
        target.scopeType === 'ASSET'
          ? await this.rows('SOURCE', target.sourceId)
          : [],
      );
      for (const member of plan.members) {
        const name = member.username.toLowerCase();
        const person = people.find(
          (p) =>
            p.email?.toLowerCase() === name ||
            p.username.toLowerCase() === name,
        );
        const group = groups.find(
          (g) => g.path.toLowerCase() === name || g.name.toLowerCase() === name,
        );
        const ref = person
          ? `user:${person.id}`
          : group
            ? `group:${group.id}`
            : null;
        if (!ref) {
          skipped.push({
            path: `team: ${member.username}`,
            reason: 'No such person or group in this tenant.',
          });
          continue;
        }
        if (
          // Held already, here or through the source (an exported contract
          // lists inherited roles too: re-importing it changes nothing).
          current.some(
            (role) => role.role === member.role && role.principalRef === ref,
          )
        ) {
          continue;
        }
        try {
          await this.assign(target, member.role, ref);
          applied.members += 1;
        } catch (error) {
          skipped.push({
            path: `team: ${member.username}`,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    const status = plan.status
      ? (
          {
            proposed: 'DRAFT',
            draft: 'DRAFT',
            active: 'ACTIVE',
            deprecated: 'DEPRECATED',
            retired: 'RETIRED',
          } as Record<string, GovernanceStatus>
        )[plan.status]
      : undefined;
    if (plan.status && !status) {
      skipped.push({
        path: 'status',
        reason: `Unknown status ${plan.status}.`,
      });
    }
    const patch: UpdateAssetGovernanceDto = {
      ...(plan.description !== undefined
        ? { description: plan.description }
        : {}),
      ...(plan.usage !== undefined ? { usage: plan.usage } : {}),
      ...(plan.limitations !== undefined
        ? { limitations: plan.limitations }
        : {}),
      ...(plan.retention !== undefined ? { retention: plan.retention } : {}),
      ...(plan.legalBasis !== undefined &&
      plan.legalBasis !== null &&
      (Object.values(LegalBasis) as string[]).includes(plan.legalBasis)
        ? { legalBasis: plan.legalBasis as LegalBasis }
        : {}),
      ...(status ? { status } : {}),
    };
    if (Object.keys(patch).length) {
      try {
        await this.updateAssetGovernance(assetId, patch);
        applied.governance = true;
      } catch (error) {
        skipped.push({
          path: 'description/status',
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const state = await this.columns.state(assetId);
    const names = new Set(state.columns.map((column) => column.name));
    for (const column of plan.columns) {
      if (!names.has(column.name)) {
        skipped.push({
          path: `schema.properties: ${column.name}`,
          reason: 'The table has no such column.',
        });
        continue;
      }
      const body: Record<string, unknown> = {};
      if (column.businessName !== undefined)
        body.businessName = column.businessName;
      if (column.description !== undefined)
        body.description = column.description;
      if (column.criticalDataElement !== undefined)
        body.criticalDataElement = column.criticalDataElement;
      if (column.classification !== undefined) {
        if (
          column.classification === null ||
          (CLASSIFICATIONS as readonly string[]).includes(column.classification)
        ) {
          body.classification = column.classification;
        } else {
          skipped.push({
            path: `schema.properties: ${column.name}.classification`,
            reason: `${column.classification} is not one of ${CLASSIFICATIONS.join(', ')}.`,
          });
        }
      }
      if (column.termKey !== undefined) {
        const term = column.termKey
          ? await this.prisma.glossaryTerm.findUnique({
              where: { key: column.termKey },
              select: { id: true },
            })
          : null;
        if (column.termKey && !term) {
          skipped.push({
            path: `schema.properties: ${column.name}.authoritativeDefinitions`,
            reason: `No glossary term ${column.termKey}.`,
          });
        } else {
          body.termId = term?.id ?? null;
        }
      }
      if (!Object.keys(body).length) continue;
      try {
        await this.updateColumn(assetId, column.name, body);
        applied.columns += 1;
      } catch (error) {
        skipped.push({
          path: `schema.properties: ${column.name}`,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }

    const existing = new Map(
      (await this.quality.forAsset(assetId)).rules.map((rule) => [
        rule.key,
        rule,
      ]),
    );
    const touched: string[] = [];
    for (const input of plan.rules) {
      try {
        const before = existing.get(input.key);
        const column =
          typeof input.columnName === 'string' ? input.columnName : null;
        if (column && !names.has(column)) {
          throw new Error(`The table has no column ${column}.`);
        }
        if (before) {
          const current = await this.quality.rule(before.id);
          const rule = this.validRule(input, this.quality.toValid(current));
          await this.quality.update(before.id, rule);
          touched.push(before.id);
        } else {
          const rule = this.validRule(input);
          const created = await this.quality.create(
            assetId,
            rule,
            this.actors.current().ref ?? null,
          );
          touched.push(created.id);
        }
        applied.rules += 1;
      } catch (error) {
        skipped.push({
          path: `quality: ${input.key}`,
          reason:
            error instanceof Error
              ? error.message
              : String((error as { message?: unknown })?.message ?? error),
        });
      }
    }
    if (touched.length) {
      await this.quality.evaluate([assetId], 'manual', {
        actorRef: this.actors.current().ref ?? null,
        ruleIds: touched,
      });
    }
    this.record(target, 'governance.contract.import', ['contract'], 200, [
      ...Object.entries(applied)
        .filter(([, count]) => typeof count === 'number' && count > 0)
        .map(([field, count]) => ({
          field: `contract ${field}`,
          from: null,
          to: `${count} applied`,
        })),
      ...(skipped.length
        ? [
            {
              field: 'contract skipped',
              from: null,
              to: skipped.map((item) => item.path).join(', '),
            },
          ]
        : []),
    ]);
    return { applied, skipped };
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
    const previous = await this.prisma.assetColumnAnnotation.findUnique({
      where: { assetId_columnName: { assetId, columnName: name } },
    });
    await this.prisma.assetColumnAnnotation.upsert({
      where: { assetId_columnName: { assetId, columnName: name } },
      create: {
        ...(data as Prisma.AssetColumnAnnotationUncheckedCreateInput),
        assetId,
        columnName: name,
      },
      update: data,
    });
    const changes: AuditChange[] = [];
    for (const field of fields) {
      if (field === 'reviewClassification') {
        if (!('classification' in body)) {
          changes.push({
            field: `${name}.classification`,
            from: null,
            to: 'reviewed',
          });
        }
        continue;
      }
      const key = field as
        | 'businessName'
        | 'description'
        | 'termId'
        | 'criticalDataElement'
        | 'classification';
      let from: unknown = previous?.[key] ?? null;
      let to: unknown = (data as Record<string, unknown>)[key] ?? null;
      if (from === to) continue;
      if (key === 'termId') {
        from = typeof from === 'string' ? await this.termName(from) : null;
        to = typeof to === 'string' ? await this.termName(to) : null;
      }
      changes.push({
        field: `${name}.${key === 'termId' ? 'term' : key}`,
        from: valueText(from),
        to: valueText(to),
      });
    }
    this.record(
      target,
      'governance.column.update',
      fields.sort(),
      200,
      changes,
    );
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
    this.record(target, 'governance.column.move', ['columnName', 'to'], 200, [
      { field: 'column', from: columnName, to: dest.name },
    ]);
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
    if (count) {
      this.record(target, 'governance.column.remove', ['columnName'], 200, [
        { field: 'column', from: columnName, to: null },
      ]);
    }
    return this.assetColumns(assetId);
  }

  // ── Assets lists ──────────────────────────────────────────────────────────

  /**
   * Owner and lifecycle of each asset on a page of search results (§5.7):
   * one query for the page's roles, one for its records.
   */
  async summaries(assets: readonly { id: string; sourceId: string }[]): Promise<
    Map<
      string,
      {
        status: GovernanceStatus | null;
        ownerRef: string | null;
        quality: QualitySummary | null;
      }
    >
  > {
    const out = new Map<
      string,
      {
        status: GovernanceStatus | null;
        ownerRef: string | null;
        quality: QualitySummary | null;
      }
    >();
    if (!assets.length) return out;
    const assetIds = assets.map((asset) => asset.id);
    const sourceIds = [...new Set(assets.map((asset) => asset.sourceId))];
    const [owners, records, quality] = await Promise.all([
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
      this.quality.summaries(assetIds),
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
        quality: quality.get(asset.id) ?? null,
        status: effectiveStatus(
          statusOf.has(asset.id) ? { status: statusOf.get(asset.id)! } : null,
          ownerRef !== null,
        ),
      });
    }
    return out;
  }
}

/** One line for a rule: what it measures and what it must be. */
function ruleText(rule: ValidRule): string {
  const threshold = Array.isArray(rule.threshold)
    ? `${rule.threshold[0]}..${rule.threshold[1]}`
    : String(rule.threshold);
  const where = rule.columnName ? ` on ${rule.columnName}` : '';
  return `${rule.name}: ${rule.metric}${where} ${rule.operator} ${threshold}${
    rule.unit === 'percent' ? '%' : ''
  } (${rule.severity}${rule.enabled ? '' : ', off'})`;
}

const RULE_FIELDS = [
  'name',
  'columnName',
  'metric',
  'operator',
  'threshold',
  'unit',
  'severity',
  'enabled',
  'schedule',
  'dimension',
  'description',
] as const;

/** What an edit changed in a rule, field by field. */
function ruleChanges(before: ValidRule, after: ValidRule): AuditChange[] {
  const show = (value: unknown): string | null =>
    Array.isArray(value) ? value.join('..') : valueText(value);
  const out: AuditChange[] = [];
  for (const field of RULE_FIELDS) {
    const from = show(before[field]);
    const to = show(after[field]);
    if (from !== to) out.push({ field: `${after.key}.${field}`, from, to });
  }
  if (JSON.stringify(before.arguments) !== JSON.stringify(after.arguments)) {
    out.push({
      field: `${after.key}.arguments`,
      from: JSON.stringify(before.arguments),
      to: JSON.stringify(after.arguments),
    });
  }
  return out;
}

/** A value as the audit trail keeps it: text, a date, or JSON. */
function valueText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return String(value);
  }
  return JSON.stringify(value) ?? null;
}
