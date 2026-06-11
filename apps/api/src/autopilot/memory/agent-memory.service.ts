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
      const existing = await this.prisma.agentMemory.findUnique({
        where: { kind_key: { kind, key } },
      });
      if (existing) {
        await this.prisma.agentMemory.update({
          where: { id: existing.id },
          data: {
            content: w.content.trim(),
            tags: [...new Set([...existing.tags, ...tags])],
            weight: { increment: 1 },
            ...(ref ?? {}),
          },
        });
      } else {
        await this.prisma.agentMemory.create({
          data: { kind, key, content: w.content.trim(), tags, ...(ref ?? {}) },
        });
      }
      written++;
    }
    return written;
  }

  /** Record the canonical topic→inquiry mapping for a created/enriched inquiry. */
  async rememberTopicInquiry(
    topicKey: string,
    inquiryId: string,
    inquiryTitle: string,
  ): Promise<void> {
    await this.writeMany(
      [
        {
          kind: 'TOPIC_INQUIRY_MAP',
          key: topicKey,
          content: `Inquiry "${inquiryTitle}" (${inquiryId}) covers topic "${topicKey}". Enrich it instead of creating a duplicate.`,
        },
      ],
      { refType: 'inquiry', refId: inquiryId },
    );
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
