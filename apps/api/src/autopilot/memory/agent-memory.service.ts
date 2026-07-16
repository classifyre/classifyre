import { Injectable, Logger } from '@nestjs/common';
import { AgentMemoryKind, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { MAX_RECALLED_MEMORIES } from '../autopilot.constants';
import type { MemoryWrite, RecalledMemory } from '../autopilot.types';

/**
 * Long-lived agent knowledge store. Memories are small keyed facts
 * (domain glossary, generalized decision precedents, topic→inquiry mappings)
 * recalled via PostgreSQL full-text search over key+content (FTS indexes in
 * the autopilot migration; pg_trgm is intentionally avoided — not available
 * in all PostgreSQL distributions).
 */
@Injectable()
export class AgentMemoryService {
  private readonly logger = new Logger(AgentMemoryService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Top memories of a kind by reinforcement weight (e.g. the glossary). */
  async topByWeight(
    kind: AgentMemoryKind,
    limit: number,
  ): Promise<RecalledMemory[]> {
    const rows = await this.prisma.agentMemory.findMany({
      where: { kind },
      orderBy: [{ weight: 'desc' }, { updatedAt: 'desc' }],
      take: limit,
    });
    return rows.map((r) => this.toRecalled(r));
  }

  /**
   * Full-text recall across kinds for the given search terms (finding types,
   * source names, detector names…). Terms are OR-ed; ranked by FTS rank then
   * weight.
   */
  async recall(
    kinds: AgentMemoryKind[],
    terms: string[],
    limit = MAX_RECALLED_MEMORIES,
  ): Promise<RecalledMemory[]> {
    const safeTerms = [
      ...new Set(terms.map(normalizeTerm).filter((t) => t.length >= 2)),
    ].slice(0, 24);
    if (safeTerms.length === 0 || kinds.length === 0) return [];

    const tsQuery = safeTerms.join(' | ');
    try {
      const rows = await this.prisma.$queryRaw<
        Array<{ kind: string; key: string; content: string; weight: number }>
      >`
        SELECT kind::text, key, content, weight
        FROM agent_memories
        WHERE kind::text IN (${Prisma.join(kinds.map(String))})
          AND (
            to_tsvector('simple', key) @@ to_tsquery('simple', ${tsQuery})
            OR to_tsvector('simple', content) @@ to_tsquery('simple', ${tsQuery})
          )
        ORDER BY ts_rank(to_tsvector('simple', key || ' ' || content), to_tsquery('simple', ${tsQuery})) DESC,
                 weight DESC
        LIMIT ${limit}
      `;
      return rows.map((r) => ({
        kind: r.kind,
        key: r.key,
        content: r.content,
        weight: Number(r.weight),
      }));
    } catch (error) {
      // Recall is best-effort: a malformed tsquery must never break a cycle.
      this.logger.warn(
        `Memory recall failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  /**
   * Upsert a batch of model-proposed memories. An existing (kind, key) entry
   * is reinforced (weight + 1) and its content refreshed; tags are merged.
   */
  async writeMany(
    writes: MemoryWrite[],
    ref?: { refType: string; refId: string },
  ): Promise<number> {
    let written = 0;
    for (const w of writes) {
      const kind = toMemoryKind(w.kind);
      const key = normalizeKey(w.key);
      if (!kind || !key || !w.content?.trim()) continue;
      const tags = (w.tags ?? [])
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean)
        .slice(0, 10);
      // One atomic statement rather than findUnique-then-update/create. The
      // read-then-write raced: two agents writing the same (kind, key) both saw
      // the same row and the last writer clobbered the other's content and
      // dropped its tags, and the findUnique→create path could collide on the
      // kind_key unique constraint outright. Tags are merged in SQL so a
      // concurrent write cannot lose entries.
      await this.prisma.$executeRaw`
        INSERT INTO agent_memories (id, kind, key, content, tags, weight, ref_type, ref_id, created_at, updated_at)
        VALUES (
          gen_random_uuid()::text,
          ${kind}::"AgentMemoryKind",
          ${key},
          ${w.content.trim()},
          ${tags}::text[],
          1,
          ${ref?.refType ?? null},
          ${ref?.refId ?? null},
          now(),
          now()
        )
        ON CONFLICT (kind, key) DO UPDATE SET
          content = EXCLUDED.content,
          tags = ARRAY(
            SELECT DISTINCT unnest(agent_memories.tags || EXCLUDED.tags)
          ),
          weight = agent_memories.weight + 1,
          ref_type = COALESCE(EXCLUDED.ref_type, agent_memories.ref_type),
          ref_id = COALESCE(EXCLUDED.ref_id, agent_memories.ref_id),
          updated_at = now()
      `;
      written++;
    }
    return written;
  }

  // ── Dream-mode consolidation primitives ────────────────────────────────────

  /** Full memory inventory (capped) for the dream agent to review. */
  async listForConsolidation(limit = 500): Promise<
    Array<{
      id: string;
      kind: string;
      key: string;
      content: string;
      tags: string[];
      weight: number;
      updatedAt: Date;
    }>
  > {
    const rows = await this.prisma.agentMemory.findMany({
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
    });
    return rows.map((r) => ({
      id: r.id,
      kind: String(r.kind),
      key: r.key,
      content: r.content,
      tags: r.tags,
      weight: r.weight,
      updatedAt: r.updatedAt,
    }));
  }

  /** Delete one memory by id. Returns false when it no longer exists. */
  async deleteById(id: string): Promise<boolean> {
    const result = await this.prisma.agentMemory.deleteMany({ where: { id } });
    return result.count > 0;
  }

  /** Rewrite one memory's content (and optionally tags). False when missing. */
  async rewriteById(
    id: string,
    content: string,
    tags?: string[],
  ): Promise<boolean> {
    const result = await this.prisma.agentMemory.updateMany({
      where: { id },
      data: {
        content: content.trim(),
        ...(tags
          ? {
              tags: tags
                .map((t) => t.trim().toLowerCase())
                .filter(Boolean)
                .slice(0, 10),
            }
          : {}),
      },
    });
    return result.count > 0;
  }

  /**
   * Sync memory with an operator deletion of an inquiry/case: drop memories
   * referencing the dead entity and record a precedent so the agent never
   * recreates the topic on its own. Best-effort — must not break the delete.
   */
  async recordEntityDeletion(
    entityType: 'inquiry' | 'case',
    entityId: string,
    title: string,
  ): Promise<void> {
    try {
      await this.prisma.agentMemory.deleteMany({
        where: {
          OR: [
            { refType: entityType, refId: entityId },
            { content: { contains: entityId } },
          ],
        },
      });
      await this.writeMany([
        {
          kind: 'DECISION_PRECEDENT',
          key: `deleted-${entityType}-${entityId}`,
          content: `The operator deleted ${entityType} "${title}". Do not recreate this ${entityType} or its topic unless the operator explicitly asks for it.`,
          tags: ['operator-deletion', entityType],
        },
      ]);
    } catch (error) {
      this.logger.warn(
        `Failed to sync agent memory after ${entityType} deletion: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private toRecalled(r: {
    kind: AgentMemoryKind;
    key: string;
    content: string;
    weight: number;
  }): RecalledMemory {
    return {
      kind: String(r.kind),
      key: r.key,
      content: r.content,
      weight: r.weight,
    };
  }
}

function toMemoryKind(value: string): AgentMemoryKind | null {
  return value in AgentMemoryKind ? (value as AgentMemoryKind) : null;
}

function normalizeKey(key: string): string {
  return key.trim().toLowerCase().replace(/\s+/g, '-').slice(0, 200);
}

/** Strip everything tsquery could choke on; keep word characters only. */
function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_]+/gu, '')
    .slice(0, 50);
}
