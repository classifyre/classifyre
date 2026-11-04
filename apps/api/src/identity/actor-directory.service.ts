import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { parseActorRef, type ActorRefKind } from './actor-ref';

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
 * once it is revoked or deleted. Signed-in people (`user:`) resolve once IAM
 * keeps a principal directory (step 5); until then they show their id.
 */
@Injectable()
export class ActorDirectoryService {
  constructor(private readonly prisma: PrismaService) {}

  async resolve(refs: string[]): Promise<ResolvedActor[]> {
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
    const tokens = tokenIds.length
      ? await this.prisma.mcpAccessToken.findMany({
          where: { id: { in: tokenIds } },
          select: { id: true, name: true },
        })
      : [];
    const tokenName = new Map(tokens.map((token) => [token.id, token.name]));
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
              : actor.id,
      ...(actor.via ? { viaDisplayName: nameOfToken(actor.via.id) } : {}),
    }));
  }
}
