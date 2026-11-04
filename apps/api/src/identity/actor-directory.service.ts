import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { parseActorRef, type ActorRefKind } from './actor-ref';
import { TenancyService } from './tenancy.service';

export interface ResolvedActor {
  ref: string;
  kind: ActorRefKind;
  displayName: string;
  /** For a delegated action: the token it came through. */
  viaDisplayName?: string;
}

const AGENT_NAMES: Record<string, string> = { autopilot: 'Autopilot' };
const MAX_REFS = 200;

/**
 * Turns actor references into what the UI shows (§11.2). Self-declared names
 * are their own display name; MCP tokens are named after the token, also
 * once it is revoked or deleted. Signed-in people (`user:`) are named from
 * `iam_principals`, written at sign-in.
 */
@Injectable()
export class ActorDirectoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenancy: TenancyService,
  ) {}

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
                : actor.id,
      ...(actor.via ? { viaDisplayName: nameOfToken(actor.via.id) } : {}),
    }));
  }
}
