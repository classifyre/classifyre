import { Inject, Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../prisma.service';
import { CLS_ORG_ID } from './iam-access-policy';
import type { IdentityService } from './identity.service';
import { IDENTITY } from './identity.tokens';
import { parseActorRef, type ActorRefKind } from './actor-ref';
import { TenancyService } from './tenancy.service';

export interface ResolvedActor {
  ref: string;
  kind: ActorRefKind;
  displayName: string;
  /** For a delegated action: the token it came through. */
  viaDisplayName?: string;
  /** For a group: its path in the tenant (`/finance/controlling`). */
  path?: string;
}

const AGENT_NAMES: Record<string, string> = { autopilot: 'Autopilot' };
const MAX_REFS = 200;

/**
 * Turns actor references into what the UI shows (§11.2). Self-declared names
 * are their own display name; MCP tokens are named after the token, also
 * once it is revoked or deleted. Signed-in people (`user:`) are named from
 * `iam_principals`, written at sign-in. Groups (`group:`) are named from the
 * tenant's groups in the identity server.
 */
@Injectable()
export class ActorDirectoryService {
  private readonly logger = new Logger(ActorDirectoryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
    private readonly cls: ClsService,
    @Inject(IDENTITY) private readonly identity: IdentityService,
  ) {}

  /** Groups of the request's tenant by id; empty outside a signed-in workspace request. */
  private async groupsById(
    wanted: boolean,
  ): Promise<Map<string, { name: string; path: string }>> {
    const orgId =
      wanted && this.cls.isActive()
        ? this.cls.get<string>(CLS_ORG_ID)
        : undefined;
    if (!orgId) return new Map();
    try {
      const groups = await this.identity.membership.groups(orgId);
      return new Map(
        groups.map((group) => [
          group.id,
          { name: group.name, path: group.path },
        ]),
      );
    } catch (error) {
      this.logger.warn(`Group names unavailable: ${String(error)}`);
      return new Map();
    }
  }

  /** `withTokens: false` outside a workspace, where there is no token table to read. */
  async resolve(
    refs: string[],
    options: { withTokens?: boolean } = {},
  ): Promise<ResolvedActor[]> {
    const unique = [...new Set(refs.filter(Boolean))].slice(0, MAX_REFS);
    const parsed = unique.map((ref) => ({ ref, ...parseActorRef(ref) }));

    const tokenIds = [
      ...new Set(
        parsed.flatMap((actor) => [
          ...(actor.kind === 'mcp' ? [actor.id] : []),
          ...(actor.via ? [actor.via.id] : []),
        ]),
      ),
    ];
    const tokens =
      tokenIds.length && options.withTokens !== false
        ? await this.prisma.mcpAccessToken.findMany({
            where: { id: { in: tokenIds } },
            select: { id: true, name: true },
          })
        : [];
    const tokenName = new Map(tokens.map((token) => [token.id, token.name]));
    const people = await this.tenancy.principalNames([
      ...new Set(
        parsed
          .filter((actor) => actor.kind === 'user')
          .map((actor) => actor.id),
      ),
    ]);
    const groups = await this.groupsById(
      parsed.some((actor) => actor.kind === 'group'),
    );
    const nameOfToken = (id: string) =>
      tokenName.get(id) ?? 'Deleted MCP token';

    return parsed.map((actor) => ({
      ref: actor.ref,
      kind: actor.kind,
      displayName:
        actor.kind === 'mcp'
          ? nameOfToken(actor.id)
          : actor.kind === 'agent'
            ? (AGENT_NAMES[actor.id] ?? actor.id)
            : actor.kind === 'system'
              ? 'System'
              : actor.kind === 'user'
                ? (people.get(actor.id)?.displayName ?? 'Former member')
                : actor.kind === 'group'
                  ? (groups.get(actor.id)?.name ?? 'Removed group')
                  : actor.id,
      ...(actor.via ? { viaDisplayName: nameOfToken(actor.via.id) } : {}),
      ...(actor.kind === 'group' && groups.get(actor.id)
        ? { path: groups.get(actor.id)!.path }
        : {}),
    }));
  }
}
