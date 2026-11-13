import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { ActorContextService } from '../identity/actor-context.service';
import { ACCESS_POLICY, type AccessPolicy } from '../identity/access-policy';
import type { Capability } from '../identity/capabilities';
import { CLS_PERSON, type ClsPerson } from '../identity/iam-access-policy';
import { IDENTITY } from '../identity/identity.tokens';
import type { IdentityService } from '../identity/identity.service';
import { groupRef, parseActorRef } from '../identity/actor-ref';
import { ownerDataScope } from '../governance/governance-filter';

/**
 * Who may do what with SQL connections (docs/prd/DQ-data-query.md §5.7):
 * have one (`data.connect`, a Data reader grant, or owning tables), manage
 * everyone's (`data.connection.manage`), and have one for everything open —
 * admins and people who answer for data (owner, steward or custodian, in
 * person or through a group; decided 2026-11-13).
 */
@Injectable()
export class ConnectionRightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly actors: ActorContextService,
    @Inject(ACCESS_POLICY) private readonly policy: AccessPolicy,
    @Inject(IDENTITY) private readonly identity: IdentityService,
  ) {}

  /** The signed-in person (`user:<sub>`), or 401: connections belong to people. */
  me(): string {
    const person = this.person();
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

  /** The signed-in person with their groups, when there is one. */
  person(): ClsPerson | undefined {
    return this.cls.isActive()
      ? this.cls.get<ClsPerson | undefined>(CLS_PERSON)
      : undefined;
  }

  private async allows(capability: Capability): Promise<boolean> {
    return (await this.policy.check(this.actors.current(), capability)).allow;
  }

  canManage(): Promise<boolean> {
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

  /** The caller may have a connection for everything open. */
  async canConnectAll(): Promise<boolean> {
    if (await this.canManage()) return true;
    const person = this.person();
    return person ? this.holdsRole(person.actorRef, person.groupIds) : false;
  }

  /**
   * Another person may have a connection for everything open: their own
   * rights decide, not the giver's — `data.connection.manage` in this
   * workspace, or an owner, steward or custodian role of theirs.
   */
  async personMayConnectAll(personRef: string): Promise<boolean> {
    const parsed = parseActorRef(personRef);
    const workspaceId = this.actors.workspaceId();
    if (parsed.kind !== 'user' || !workspaceId) return false;
    const found = await this.identity.principalFor(parsed.id, workspaceId, {
      kind: 'sql',
      id: 'rights-check',
    });
    if (!found) return false;
    if (found.capabilities.has('data.connection.manage')) return true;
    // Their groups and the groups above them, as for the signed-in person.
    const groups = await this.identity.groupLineage(found.principal);
    return this.holdsRole(`user:${parsed.id}`, groups);
  }

  private async holdsRole(
    personRef: string,
    groupIds: readonly string[],
  ): Promise<boolean> {
    const held = await this.prisma.governanceRole.count({
      where: {
        principalRef: { in: [personRef, ...groupIds.map(groupRef)] },
        dateOut: null,
      },
    });
    return held > 0;
  }

  refuse(capability: Capability): never {
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
}
